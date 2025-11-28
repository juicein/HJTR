// /flights_map/script.js
// Enhanced flight map script
// - supports cross-day +#n# offsets
// - search, focus, highlight, hide-other-flights (backend switch)
// - plane icons rotate toward destination (SVG inline)
// - FR24-like info card with progress & prev/next by regNo

/* ======================== CONFIG ======================== */

// whether searching a flight should hide other flights on the map
const HIDE_OTHER_FLIGHTS_ON_SEARCH = true;

// refresh interval (ms)
const REFRESH_INTERVAL = 30 * 1000;

// data paths
const DATA_FLIGHTS = '/data/flight_data.txt';
const DATA_AIRPORTS = '/data/airports.json';

/* ======================== MAP INIT ======================== */

// ensure the map container is present
if (!document.getElementById('map')) {
  console.error('Map container #map not found in DOM.');
}

const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);

// Use protocol-relative tile URL to avoid mixed-content issues
L.tileLayer('//{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 8,
  attribution: ''
}).addTo(map);

// sometimes Leaflet needs to recalc size on some desktop layouts
setTimeout(() => map.invalidateSize(), 300);

/* ======================== STATE ======================== */

let airportDB = {};   // normalized: { CODE: {name,code,lat,lon,...} }
let flights = [];     // parsed flight objects
let flightMarkers = {}; // keyed by flight flightNo (Leaflet marker)
let flightPolylines = {}; // keyed by flightNo
let airportMarkers = {}; // keyed by airport code
let showFlightNo = localStorage.getItem('showFlightNo') === 'true';
const searchInput = document.getElementById('searchInput');
const toggleFlightNoElem = document.getElementById('toggleFlightNo');
const showAirportNamesElem = document.getElementById('showAirportNames');
const showAirportCodesElem = document.getElementById('showAirportCodes');
const flightListEl = document.getElementById('flightList');
const infoCard = document.getElementById('infoCard');

/* ======================== UTILITIES ======================== */

// parse HH:MM (allow H:MM etc.) into minutes since 00:00
function timeToMinutes(t) {
  if (!t) return null;
  const parts = String(t).trim().split(':').map(s => parseInt(s, 10));
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

// parse flight line with support for #+n# (day offset)
function parseFlightLine(line) {
  if (!line || typeof line !== 'string') return null;
  try {
    const raw = line.trim();
    // flightNo
    const flightNo = (raw.match(/【([^】]+)】/) || [null, ''])[1] || '';
    // machine / aircraft
    const aircraft = (raw.match(/〔([^〕]+)〕/) || [null, ''])[1] || '';
    const airline = (raw.match(/『([^』]+)』/) || [null, ''])[1] || '';
    const daysStr = (raw.match(/«([^»]+)»/) || [null, ''])[1] || '';
    const days = daysStr ? daysStr.split(',').map(s => s.trim()) : [];
    // segments extraction: we handle both dep and arr segments
    // pattern matches: 《Place出发》{HH:MM}#+n#@T...
    const segRegex = /《([^》]+?)》\{([0-2]?\d:[0-5]\d)\}#\+?([0-9]+)?#@[^@]*@/g;
    let segs = [], m;
    while ((m = segRegex.exec(raw)) !== null) {
      const placeText = m[1];
      const time = m[2];
      const dayOffset = m[3] ? parseInt(m[3], 10) : 0;
      const airportName = placeText.replace(/出发|到达|到达站|出发站/g, '').trim();
      segs.push({ airport: airportName, time: time, dayOffset: dayOffset });
    }
    const dep = segs[0] || null;
    const arr = segs[1] || null;
    const priceEco = (raw.match(/§([^§]+)§/) || [null, ''])[1] || '';
    const priceBiz = (raw.match(/θ([^θ]+)θ/) || [null, ''])[1] || '';
    const special = (raw.match(/△([^△]+)△/) || [null, ''])[1] || '';
    const regNo = (raw.match(/<([^>]+)>/) || [null, ''])[1] || '';
    // also capture id pattern if different
    const id = regNo || ((raw.match(/<([^>]+)>/)||[])[1] || '');
    return {
      raw, flightNo, aircraft, airline, days,
      dep, arr, priceEco, priceBiz, special, regNo, id
    };
  } catch (e) {
    console.error('parseFlightLine error', e, line);
    return null;
  }
}

// Normalize airport DB: support array or object
function normalizeAirportDB(json) {
  const out = {};
  if (Array.isArray(json)) {
    json.forEach(a => {
      if (!a.code) return;
      out[a.code.toUpperCase()] = {
        name: a.name,
        code: a.code.toUpperCase(),
        lat: a.lat,
        lon: a.lon,
        aliases: a.aliases || [],
        level: a.level || null,
        runways: a.runways || null
      };
    });
  } else if (json && typeof json === 'object') {
    // assume keyed by code
    Object.keys(json).forEach(k => {
      const a = json[k];
      out[(a.code || k).toUpperCase()] = {
        name: a.name,
        code: (a.code || k).toUpperCase(),
        lat: a.lat,
        lon: a.lon,
        aliases: a.aliases || [],
        level: a.level || null,
        runways: a.runways || null
      };
    });
  }
  return out;
}

// find airport by various keys: code, name or alias (case-insensitive)
function findAirport(query) {
  if (!query) return null;
  const q = String(query).trim().toLowerCase();
  // exact code
  if (airportDB[q.toUpperCase()]) return airportDB[q.toUpperCase()];
  // scan names and aliases
  for (const code in airportDB) {
    const a = airportDB[code];
    if ((a.name && a.name.toLowerCase().includes(q)) ||
        (a.code && a.code.toLowerCase() === q) ||
        (a.aliases && a.aliases.some(x => x.toLowerCase().includes(q)))) {
      return a;
    }
  }
  return null;
}

// search flights by flightNo, regNo, dep/arr airport names or codes (fuzzy)
function searchFlights(query) {
  if (!query) return [];
  const q = query.trim().toLowerCase();
  return flights.filter(f => {
    if (f.flightNo && f.flightNo.toLowerCase().includes(q)) return true;
    if (f.regNo && f.regNo.toLowerCase().includes(q)) return true;
    if (f.dep && f.dep.airport && f.dep.airport.toLowerCase().includes(q)) return true;
    if (f.arr && f.arr.airport && f.arr.airport.toLowerCase().includes(q)) return true;
    return false;
  });
}

// compute bearing from A to B (degrees)
function computeBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180, toDeg = 180 / Math.PI;
  const φ1 = lat1 * toRad, φ2 = lat2 * toRad;
  const Δλ = (lon2 - lon1) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (θ * toDeg + 360) % 360;
}

// build Date from base date and hh:mm and addDays offsets
function makeDateTime(base, hhmm, addDays = 0) {
  // base is Date object
  const parts = String(hhmm).split(':').map(s => parseInt(s, 10));
  const hh = parts[0] || 0, mm = parts[1] || 0;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0);
  if (addDays) d.setDate(d.getDate() + addDays);
  return d;
}

// fraction between two Date objects (0..1)
function fracBetween(now, start, end) {
  const total = end - start;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (now - start) / total));
}

// format time string from Date
function formatDateTime(d) {
  if (!d) return '--:--';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' +
         String(d.getMinutes()).padStart(2, '0');
}

/* ======================== LOADING DATA ======================== */

async function loadAirports() {
  try {
    const res = await fetch(DATA_AIRPORTS, { cache: 'no-cache' });
    if (!res.ok) throw new Error('无法加载 airports.json: ' + res.status);
    const json = await res.json();
    airportDB = normalizeAirportDB(json);
    console.log('[flights_map] airports loaded:', Object.keys(airportDB).length);
  } catch (e) {
    console.error('loadAirports error', e);
    airportDB = {};
  }
}

async function loadFlights() {
  try {
    const res = await fetch(DATA_FLIGHTS, { cache: 'no-cache' });
    if (!res.ok) throw new Error('无法加载 flight_data.txt: ' + res.status);
    const txt = await res.text();
    const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    flights = lines.map(parseFlightLine).filter(Boolean);
    console.log('[flights_map] flights loaded:', flights.length);
  } catch (e) {
    console.error('loadFlights error', e);
    flights = [];
  }
}

/* ======================== DRAW AIRPORTS ======================== */

function drawAirports() {
  // clear existing
  Object.values(airportMarkers).forEach(m => map.removeLayer(m));
  airportMarkers = {};

  Object.keys(airportDB).forEach(code => {
    const a = airportDB[code];
    if (!a || a.lat == null || a.lon == null) return;

    // create a divIcon that looks like concentric circles
    const html = `
      <div class="airport-marker-outer" style="display:flex;align-items:center;justify-content:center;">
        <div class="airport-marker-inner" style="width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.25);"></div>
      </div>
    `;
    const icon = L.divIcon({
      html: html,
      className: 'airport-marker',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    const mk = L.marker([a.lat, a.lon], { icon }).addTo(map);
    mk.on('click', () => showAirportCard(a));
    airportMarkers[code] = mk;

    // show inline label (not a popup) if toggles enabled
    const labelParts = [];
    if (showAirportNamesElem && showAirportNamesElem.checked) labelParts.push(a.name);
    if (showAirportCodesElem && showAirportCodesElem.checked) labelParts.push(a.code);
    const label = labelParts.join(' ');
    if (label) {
      const tooltip = L.tooltip({
        permanent: true,
        direction: 'right',
        className: 'flight-label'
      }).setContent(label).setLatLng([a.lat, a.lon]);
      tooltip.addTo(map);
    }
  });
}

/* ======================== DRAW FLIGHTS ======================== */

// helper to build runtime info (dep/arr Date objects and status)
function buildFlightRuntime(flight) {
  const base = new Date(); // base date = today
  // default nulls
  let depDate = null, arrDate = null;
  if (flight.dep && flight.dep.time) {
    depDate = makeDateTime(base, flight.dep.time, flight.dep.dayOffset || 0);
  }
  if (flight.arr && flight.arr.time) {
    arrDate = makeDateTime(base, flight.arr.time, flight.arr.dayOffset || 0);
    // if arr earlier than dep and arr dayOffset not set, assume next day
    if (depDate && arrDate < depDate && !(flight.arr.dayOffset && flight.arr.dayOffset > 0)) {
      arrDate.setDate(arrDate.getDate() + 1);
    }
  }
  // status
  const now = new Date();
  let status = 'no-service-today';
  if (flight.days && flight.days.length) {
    const wk = now.getDay();
    const runToday = flight.days.some(t => {
      const map = {SUN:0,MON:1,TUE:2,WED:3,THU:4,FRI:5,SAT:6};
      return map[(t||'').toUpperCase()] === wk;
    });
    if (runToday) {
      if (depDate && now < depDate) status = 'preparing';
      else if (depDate && arrDate && now >= depDate && now <= arrDate) status = 'in-flight';
      else status = 'arrived';
    } else {
      status = 'no-service-today';
    }
  } else {
    // if no days defined assume daily
    if (depDate && arrDate) {
      if (now < depDate) status = 'preparing';
      else if (now >= depDate && now <= arrDate) status = 'in-flight';
      else status = 'arrived';
    }
  }

  // progress
  let progress = 0;
  if (status === 'in-flight' && depDate && arrDate) {
    progress = fracBetween(new Date(), depDate, arrDate);
  } else {
    if (status === 'arrived') progress = 1;
    else progress = 0;
  }

  return { depDate, arrDate, status, progress };
}

function clearFlightsFromMap() {
  Object.values(flightMarkers).forEach(m => map.removeLayer(m));
  Object.values(flightPolylines).forEach(p => map.removeLayer(p));
  flightMarkers = {};
  flightPolylines = {};
}

function drawFlights(options = {}) {
  // options:
  //  focusId: string (flightNo or regNo or id)
  //  hideOthers: boolean
  const focusId = options.focusId ? String(options.focusId).toLowerCase() : null;
  const hideOthers = options.hideOthers === true;

  clearFlightsFromMap();

  const now = new Date();

  flights.forEach(f => {
    // find airports
    const depName = f.dep ? f.dep.airport : null;
    const arrName = f.arr ? f.arr.airport : null;
    const depAirport = findAirport(depName) || null;
    const arrAirport = findAirport(arrName) || null;
    if (!depAirport || !arrAirport) {
      // cannot draw route without both airports
      return;
    }

    // compute runtime
    const runtime = buildFlightRuntime(f);
    const status = runtime.status;
    const progress = runtime.progress;

    // if focused only show that flight (if hideOthers true)
    if (focusId) {
      const idLower = focusId.toLowerCase();
      const isMatch = (f.flightNo && f.flightNo.toLowerCase() === idLower) ||
                      (f.regNo && f.regNo.toLowerCase() === idLower) ||
                      ((f.id || '').toLowerCase() === idLower);
      if (!isMatch && hideOthers && HIDE_OTHER_FLIGHTS_ON_SEARCH) {
        // skip drawing this non-focused flight
        return;
      }
    }

    // draw polyline (full route) but style depends on focus / status
    const pl = L.polyline([[depAirport.lat, depAirport.lon], [arrAirport.lat, arrAirport.lon]], {
      color: (focusId && ((f.flightNo && f.flightNo.toLowerCase() === focusId) || (f.regNo && f.regNo.toLowerCase() === focusId))) ? '#ff4d4f' : '#ff8c00',
      weight: (focusId && ((f.flightNo && f.flightNo.toLowerCase() === focusId) || (f.regNo && f.regNo.toLowerCase() === focusId))) ? 4 : 2,
      opacity: (status === 'in-flight' || (focusId && (f.flightNo && f.flightNo.toLowerCase() === focusId))) ? 1 : 0.45,
      dashArray: '6 6'
    }).addTo(map);
    flightPolylines[f.flightNo] = pl;

    // compute position for in-flight or for focused flight (even if not in flight)
    let lat, lon;
    if (status === 'in-flight') {
      lat = depAirport.lat + (arrAirport.lat - depAirport.lat) * progress;
      lon = depAirport.lon + (arrAirport.lon - depAirport.lon) * progress;
    } else if (focusId) {
      // if focused and not in-flight, position at dep if preparing, at arr if arrived
      if (status === 'preparing') {
        lat = depAirport.lat; lon = depAirport.lon;
      } else if (status === 'arrived') {
        lat = arrAirport.lat; lon = arrAirport.lon;
      } else {
        lat = depAirport.lat; lon = depAirport.lon;
      }
    } else {
      // by default we only draw in-flight aircraft on the map (to reduce clutter)
      if (status !== 'in-flight') {
        // skip drawing marker
        return;
      } else {
        lat = depAirport.lat + (arrAirport.lat - depAirport.lat) * progress;
        lon = depAirport.lon + (arrAirport.lon - depAirport.lon) * progress;
      }
    }

    // compute bearing to rotate airplane
    const angle = computeBearing(depAirport.lat, depAirport.lon, arrAirport.lat, arrAirport.lon);

    // create an SVG data URI plane icon rotated via inline style on <img>
    const planeSvg = createPlaneSvgDataUri('#1e90ff'); // color can be customized
    const planeHtml = `<img src="${planeSvg}" style="width:28px;height:28px;transform:rotate(${angle}deg);transform-origin:center center;" />`;
    const icon = L.divIcon({
      html: planeHtml,
      className: 'plane-div-icon',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const marker = L.marker([lat, lon], { icon }).addTo(map);
    marker.flight = f;
    marker.runtime = runtime;
    marker.on('click', () => {
      focusFlightOnMap(f);
      showFlightInfoCard(f, runtime, depAirport, arrAirport);
    });

    // optionally show label
    if (showFlightNoElem && showFlightNoElem.checked) {
      marker.bindTooltip(f.flightNo, { permanent: true, direction: 'right', className: 'flight-label' }).openTooltip();
    }

    flightMarkers[f.flightNo] = marker;
  });
}

/* ======================== SEARCH & FOCUS ======================== */

// focus flight: center map, highlight polyline, optionally hide other flights
function focusFlightOnMap(flight, options = { hideOthers: HIDE_OTHER_FLIGHTS_ON_SEARCH }) {
  if (!flight) return;
  // find corresponding polyline
  const pl = flightPolylines[flight.flightNo];
  if (pl) {
    map.fitBounds(pl.getBounds(), { padding: [80, 80] });
  } else {
    // fallback: center to dep airport
    const dep = findAirport(flight.dep.airport);
    if (dep) map.panTo([dep.lat, dep.lon]);
  }
  // redraw flights with focus
  drawFlights({ focusId: flight.flightNo, hideOthers: options.hideOthers });
}

// create plane svg data URI (simple stylized plane)
function createPlaneSvgDataUri(color = '#1e90ff') {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-12 -12 24 24'><g fill='${color}'><path d='M0-9 L4 0 L0 -2 L-4 0 Z' /></g></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

// handle search action (query may be flightNo, regNo, airport code/name)
function handleSearch(query) {
  if (!query || !query.trim()) return;
  const q = query.trim();
  // try flights first
  const matches = searchFlights(q);
  if (matches.length > 0) {
    // take first match, focus it
    const f = matches[0];
    focusFlightOnMap(f, { hideOthers: HIDE_OTHER_FLIGHTS_ON_SEARCH });
    // show info card
    const runtime = buildFlightRuntime(f);
    const depAirport = findAirport(f.dep.airport);
    const arrAirport = findAirport(f.arr.airport);
    showFlightInfoCard(f, runtime, depAirport, arrAirport);
    return;
  }
  // try airport
  const ap = findAirport(q);
  if (ap) {
    map.panTo([ap.lat, ap.lon]);
    showAirportCard(ap);
    return;
  }
  alert('未找到匹配的航班或机场 (' + q + ')');
}

/* ======================== INFO CARDS ======================== */

// show flight info card (FR24-like)
function showFlightInfoCard(flight, runtime, depAirport, arrAirport) {
  const depDate = runtime.depDate;
  const arrDate = runtime.arrDate;
  const progressPct = Math.round(runtime.progress * 100);
  // siblings by regNo
  const siblings = flight.regNo ? flights.filter(x => x.regNo && x.regNo === flight.regNo) : [];
  let html = '';
  html += `<div class="title">${flight.flightNo} ${flight.airline || ''}</div>`;
  html += `<div class="meta">机型：${flight.aircraft || '—'} · 注册号：${flight.regNo || '—'}</div>`;
  html += `<div style="margin-top:8px"><b>起飞：</b> ${depAirport ? depAirport.name + ' (' + depAirport.code + ')' : (flight.dep ? flight.dep.airport : '--')} · ${depDate ? formatDateTime(depDate) : '--'}</div>`;
  html += `<div><b>到达：</b> ${arrAirport ? arrAirport.name + ' (' + arrAirport.code + ')' : (flight.arr ? flight.arr.airport : '--')} · ${arrDate ? formatDateTime(arrDate) : '--'}</div>`;
  html += `<div style="margin-top:10px"><b>进度：</b> ${progressPct}%</div>`;
  html += `<div class="progress-wrap" style="margin-top:6px"><div class="progress" style="width:${progressPct}%;height:8px;border-radius:6px;background:linear-gradient(90deg,var(--accent),#2fd3ff);"></div></div>`;
  if (siblings.length > 1) {
    html += `<div style="margin-top:8px;color:var(--muted);font-size:12px">同注册号航班：${siblings.map(s => s.flightNo).join(', ')}</div>`;
  }
  html += `<div style="margin-top:8px;color:var(--muted);font-size:12px">经济：${flight.priceEco || '—'} · 商务：${flight.priceBiz || '—'} · 头等：${flight.special || '—'}</div>`;

  infoCard.innerHTML = html;
  infoCard.classList.remove('hidden');
}

// show airport card
function showAirportCard(ap) {
  if (!ap) return;
  let html = `<div class="title">${ap.name} (${ap.code})</div>`;
  if (ap.level) html += `<div class="meta">等级：${ap.level}</div>`;
  if (ap.runways != null) html += `<div class="meta">跑道：${ap.runways}</div>`;
  infoCard.innerHTML = html;
  infoCard.classList.remove('hidden');
}

/* ======================== UI BINDINGS ======================== */

// top search input
if (searchInput) {
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      handleSearch(searchInput.value);
    }
  });
}

// toggle flight number labels
if (toggleFlightNoElem) {
  toggleFlightNoElem.checked = showFlightNo;
  toggleFlightNoElem.addEventListener('change', () => {
    showFlightNo = toggleFlightNoElem.checked;
    localStorage.setItem('showFlightNo', showFlightNo);
    // redraw so markers update labels
    drawFlights();
  });
}

// airport label toggles
if (showAirportNamesElem) {
  showAirportNamesElem.addEventListener('change', () => drawAirports());
}
if (showAirportCodesElem) {
  showAirportCodesElem.addEventListener('change', () => drawAirports());
}

// hide info card when clicking map
map.on('click', () => {
  if (infoCard) infoCard.classList.add('hidden');
});

/* ======================== BOOT & REFRESH ======================== */

async function boot() {
  await loadAirports();
  await loadFlights();
  drawAirports();
  drawFlights();

  // if URL param present, auto-focus
  const q = new URLSearchParams(location.search).get('flights_map') || null;
  if (q) {
    // try to find match
    const candidates = searchFlights(q);
    if (candidates.length > 0) {
      const target = candidates[0];
      focusFlightOnMap(target, { hideOthers: HIDE_OTHER_FLIGHTS_ON_SEARCH });
      const runtime = buildFlightRuntime(target);
      const dep = findAirport(target.dep.airport);
      const arr = findAirport(target.arr.airport);
      showFlightInfoCard(target, runtime, dep, arr);
    }
  }

  // periodic refresh
  setInterval(() => {
    // reload flights periodically (optional: you may prefer only recalculating positions)
    loadFlights().then(() => {
      drawAirports();
      drawFlights();
    });
  }, REFRESH_INTERVAL);
}

boot();

/* ======================== SEARCH HELPERS (used by UI) ======================== */

function findAirport(q) { return findAirportByAny(q); }

// internal: find airport by code/name/alias
function findAirportByAny(q) {
  if (!q) return null;
  const s = String(q).trim().toLowerCase();
  // try direct code
  if (airportDB[s.toUpperCase()]) return airportDB[s.toUpperCase()];
  // scan
  for (const k in airportDB) {
    const a = airportDB[k];
    if ((a.name && a.name.toLowerCase().includes(s)) ||
        (a.code && a.code.toLowerCase() === s) ||
        (a.aliases && a.aliases.some(x => x.toLowerCase().includes(s)))) {
      return a;
    }
  }
  return null;
}
function searchFlights(q) {
  if (!q) return [];
  const s = String(q).trim().toLowerCase();
  return flights.filter(f => {
    if (f.flightNo && f.flightNo.toLowerCase().includes(s)) return true;
    if (f.regNo && f.regNo.toLowerCase().includes(s)) return true;
    if (f.dep && f.dep.airport && f.dep.airport.toLowerCase().includes(s)) return true;
    if (f.arr && f.arr.airport && f.arr.airport.toLowerCase().includes(s)) return true;
    return false;
  });
}
