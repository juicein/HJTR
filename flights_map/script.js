// flights_map/script.js
// Enhanced map (object-mode airports + PNG plane rotated + search + progress + responsive sidebar)

/* ========== CONFIG ========== */
// hide other flights when focusing via search or click (default true)
const HIDE_OTHER_FLIGHTS_ON_SEARCH = true;

// refresh interval (ms) — 默认 3 分钟（可改）
const REFRESH_INTERVAL_MS = 3 * 60 * 1000;

// data files
const DATA_AIRPORTS = '/data/airports.json';
const DATA_FLIGHTS = '/data/flight_data.txt';

// placeholder PNG plane icon (you will replace with your own PNG later)
const PLANE_PNG_URL = 'https://i.imgur.com/4bZtV3y.png'; // placeholder

/* ========== GLOBAL STATE ========== */
let airportDB = {}; // normalized object keyed by code
let flights = [];   // parsed flights
let map, flightMarkers = {}, flightPolylines = {}, airportMarkers = {};
let showFlightNo = localStorage.getItem('showFlightNo') === 'true';

/* ========== HELPERS ========== */
function safeFetchJSON(url) { return fetch(url, {cache:'no-cache'}).then(r => r.json()); }
function safeFetchText(url) { return fetch(url, {cache:'no-cache'}).then(r => r.text()); }

function toMin(hhmm) {
  if (!hhmm) return null;
  const p = String(hhmm).trim().split(':').map(x => parseInt(x,10));
  if (p.length < 2 || Number.isNaN(p[0]) || Number.isNaN(p[1])) return null;
  return p[0] * 60 + p[1];
}
function makeDateFromToday(hhmm, addDays=0){
  const now = new Date();
  const p = String(hhmm).split(':').map(x=>parseInt(x,10));
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), (p[0]||0), (p[1]||0), 0, 0);
  if (addDays) d.setDate(d.getDate() + addDays);
  return d;
}
function fracBetween(now, start, end){
  const total = end - start;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (now - start) / total));
}
function formatDT(d){
  if(!d) return '--';
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
function bearing(lat1, lon1, lat2, lon2){
  const toRad = Math.PI/180, toDeg = 180/Math.PI;
  const φ1 = lat1*toRad, φ2 = lat2*toRad, Δλ = (lon2-lon1)*toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y,x)*toDeg + 360) % 360;
}

/* ========== PARSE FLIGHT LINES (support #+n#) ========== */
function parseFlightLine(line){
  if(!line) return null;
  try{
    const raw = line.trim();
    const flightNo = (raw.match(/【([^】]+)】/)||[null,''])[1] || '';
    const aircraft = (raw.match(/〔([^〕]+)〕/)||[null,''])[1] || '';
    const airline = (raw.match(/『([^』]+)』/)||[null,''])[1] || '';
    const daysStr = (raw.match(/«([^»]+)»/)||[null,''])[1] || '';
    const days = daysStr ? daysStr.split(',').map(s=>s.trim()) : [];
    // segs
    const segRegex = /《([^》]+?)》\{([0-2]?\d:[0-5]\d)\}#\+?([0-9]+)?#@[^@]*@/g;
    let segs = [], m;
    while((m = segRegex.exec(raw))!==null){
      const name = m[1].replace(/出发|到达|到达站|出发站/g,'').trim();
      const time = m[2];
      const dayOffset = m[3] ? parseInt(m[3],10) : 0;
      segs.push({airport: name, time, dayOffset});
    }
    const dep = segs[0] || null;
    const arr = segs[1] || null;
    const priceEco = (raw.match(/§([^§]+)§/)||[null,''])[1] || '';
    const priceBiz = (raw.match(/θ([^θ]+)θ/)||[null,''])[1] || '';
    const special = (raw.match(/△([^△]+)△/)||[null,''])[1] || '';
    const regNo = (raw.match(/<([^>]+)>/)||[null,''])[1] || '';
    return {raw, flightNo, aircraft, airline, days, dep, arr, priceEco, priceBiz, special, regNo};
  }catch(e){
    console.error('parseFlightLine',e,line);
    return null;
  }
}

/* ========== AIRPORTS LOADING & NORMALIZE ========== */
async function loadAirports(){
  try{
    const json = await safeFetchJSON(DATA_AIRPORTS);
    // normalize object-mode (if array, convert)
    if(Array.isArray(json)){
      airportDB = {};
      json.forEach(a => {
        if(!a.code) return;
        airportDB[a.code.toUpperCase()] = {
          name: a.name, code: a.code.toUpperCase(), city: a.city || a.name,
          lat: a.lat, lng: a.lng, aliases: a.aliases || [], level: a.level || null, runways: a.runways || null
        };
      });
    } else {
      airportDB = {};
      Object.keys(json).forEach(k=>{
        const a = json[k];
        airportDB[(a.code||k).toUpperCase()] = {
          name: a.name, code: (a.code||k).toUpperCase(), city: a.city||a.name,
          lat: a.lat, lng: a.lng, aliases: a.aliases||[], level: a.level||null, runways: a.runways||null
        };
      });
    }
    console.log('airports loaded', Object.keys(airportDB).length);
  }catch(e){
    console.error('loadAirports error', e);
    airportDB = {};
  }
}

/* ========== FLIGHTS LOADING ========== */
async function loadFlights(){
  try{
    const txt = await safeFetchText(DATA_FLIGHTS);
    const lines = txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    flights = lines.map(parseFlightLine).filter(Boolean);
    console.log('flights loaded', flights.length);
  }catch(e){
    console.error('loadFlights error', e);
    flights = [];
  }
}

/* ========== MAP INIT ========== */
function initMap(){
  map = L.map('map', { worldCopyJump:true, minZoom:2 }).setView([30,90], 3);
  // protocol-relative tile to avoid mixed content issues
  L.tileLayer('//{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 8, attribution: '' }).addTo(map);
  setTimeout(()=> map.invalidateSize(), 250);
}

/* ========== DRAW AIRPORTS ========== */
function drawAirports(){
  // clear previous markers
  Object.values(airportMarkers).forEach(m => map.removeLayer(m));
  airportMarkers = {};
  Object.keys(airportDB).forEach(code=>{
    const a = airportDB[code];
    if(a.lat==null||a.lng==null) return;
    const html = `<div style="display:flex;align-items:center;justify-content:center;"><div class="airport-marker-inner"></div></div>`;
    const icon = L.divIcon({ html, className:'airport-marker-outer', iconSize:[16,16], iconAnchor:[8,8] });
    const mk = L.marker([a.lat, a.lng], { icon }).addTo(map);
    mk.on('click', ()=> showAirportCard(a));
    airportMarkers[code] = mk;
    // inline label if toggles enabled
    const labelParts = [];
    if(document.getElementById('showAirportNames')?.checked) labelParts.push(a.name);
    if(document.getElementById('showAirportCodes')?.checked) labelParts.push(a.code);
    if(labelParts.length){
      L.tooltip({permanent:true, direction:'right', className:'flight-label'}).setContent(labelParts.join(' ')).setLatLng([a.lat,a.lng]).addTo(map);
    }
  });
}

/* ========== DRAW FLIGHTS ========== */
function clearFlights(){
  Object.values(flightMarkers).forEach(m => map.removeLayer(m));
  Object.values(flightPolylines).forEach(p => map.removeLayer(p));
  flightMarkers = {}; flightPolylines = {};
}
function buildRuntimeForFlight(f){
  const base = new Date();
  let depDate=null, arrDate=null;
  if(f.dep && f.dep.time) depDate = makeDateFromToday(f.dep.time, f.dep.dayOffset||0);
  if(f.arr && f.arr.time) arrDate = makeDateFromToday(f.arr.time, f.arr.dayOffset||0);
  if(depDate && arrDate && arrDate < depDate && !(f.arr && f.arr.dayOffset>0)) arrDate.setDate(arrDate.getDate()+1);
  // status
  const now = new Date();
  let status = 'no-service';
  if(f.days && f.days.length){
    const wk = now.getDay(); const map = {SUN:0,MON:1,TUE:2,WED:3,THU:4,FRI:5,SAT:6};
    const run = f.days.some(t => map[(t||'').toUpperCase()] === wk);
    if(run){
      if(depDate && now < depDate) status='preparing';
      else if(depDate && arrDate && now >= depDate && now <= arrDate) status='in-flight';
      else status='arrived';
    } else status='no-service';
  } else {
    if(depDate && arrDate){
      if(now < depDate) status='preparing';
      else if(now>=depDate && now <= arrDate) status='in-flight';
      else status='arrived';
    }
  }
  let progress = 0;
  if(status === 'in-flight' && depDate && arrDate) progress = fracBetween(new Date(), depDate, arrDate);
  else if(status === 'arrived') progress = 1;
  return {depDate, arrDate, status, progress};
}

function drawFlights(options={}) {
  const focusId = options.focusId ? String(options.focusId).toLowerCase() : null;
  const hideOthers = (options.hideOthers===true);
  clearFlights();
  flights.forEach(f=>{
    // resolve airports
    const depName = f.dep ? f.dep.airport : '';
    const arrName = f.arr ? f.arr.airport : '';
    // try code or name
    const depAirport = findAirportAny(depName);
    const arrAirport = findAirportAny(arrName);
    if(!depAirport || !arrAirport) return;
    const runtime = buildRuntimeForFlight(f);
    // if hideOthers and not focus => skip
    if(focusId && hideOthers){
      const isMatch = (f.flightNo && f.flightNo.toLowerCase()===focusId) || (f.regNo && f.regNo.toLowerCase()===focusId);
      if(!isMatch) return;
    } else {
      // default draw only in-flight to reduce clutter
      if(runtime.status !== 'in-flight' && !focusId) return;
    }
    // draw polyline
    const isFocused = focusId && ((f.flightNo && f.flightNo.toLowerCase()===focusId) || (f.regNo && f.regNo.toLowerCase()===focusId));
    const pl = L.polyline([[depAirport.lat,depAirport.lng],[arrAirport.lat,arrAirport.lng]], {
      color: isFocused ? '#ff4d4f' : '#ff8c00',
      weight: isFocused ? 4 : 2,
      dashArray: '6 6',
      opacity: isFocused ? 1 : 0.9
    }).addTo(map);
    flightPolylines[f.flightNo] = pl;
    // compute position
    let lat, lng;
    if(runtime.status === 'in-flight'){ lat = depAirport.lat + (arrAirport.lat-depAirport.lat)*runtime.progress; lng = depAirport.lng + (arrAirport.lng-depAirport.lng)*runtime.progress; }
    else if(isFocused){ lat = runtime.status === 'preparing' ? depAirport.lat : (runtime.status === 'arrived' ? arrAirport.lat : depAirport.lat); lng = runtime.status === 'preparing' ? depAirport.lng : (runtime.status === 'arrived' ? arrAirport.lng : depAirport.lng); }
    else return;
    // compute bearing
    const ang = bearing(depAirport.lat, depAirport.lng, arrAirport.lat, arrAirport.lng);
    // create divIcon with img (png) rotated
    const html = `<img src="${PLANE_PNG_URL}" style="width:28px;height:28px;transform:rotate(${ang}deg);transform-origin:center center;">`;
    const icon = L.divIcon({ html, className:'plane-div', iconSize:[28,28], iconAnchor:[14,14] });
    const mk = L.marker([lat,lng], { icon }).addTo(map);
    mk.flight = f; mk.runtime = runtime;
    mk.on('click', ()=> {
      // focus and show card
      drawFlights({ focusId: f.flightNo, hideOthers: document.getElementById('hideOthersSwitch')?.checked || HIDE_OTHER_FLIGHTS_ON_SEARCH });
      showFlightCard(f, runtime, depAirport, arrAirport);
      // center
      const pl = flightPolylines[f.flightNo];
      if(pl) map.fitBounds(pl.getBounds(), {padding:[80,80]}); else map.panTo([lat,lng]);
    });
    // label
    if(document.getElementById('toggleFlightNo')?.checked) mk.bindTooltip(f.flightNo,{permanent:true,direction:'right',className:'flight-label'}).openTooltip();
    flightMarkers[f.flightNo] = mk;
  });
}

/* ========== SEARCH & HELPERS ========== */
function findAirportAny(query){
  if(!query) return null;
  const q = String(query).trim().toLowerCase();
  // try code
  if(airportDB[q.toUpperCase()]) return airportDB[q.toUpperCase()];
  // scan
  for(const k in airportDB){
    const a = airportDB[k];
    if((a.name && a.name.toLowerCase().includes(q)) || (a.code && a.code.toLowerCase()===q) || (a.aliases && a.aliases.some(x=>x.toLowerCase().includes(q)))) return a;
  }
  return null;
}
function searchFlights(query){
  if(!query) return [];
  const q = query.trim().toLowerCase();
  return flights.filter(f=>{
    if(f.flightNo && f.flightNo.toLowerCase().includes(q)) return true;
    if(f.regNo && f.regNo.toLowerCase().includes(q)) return true;
    if(f.dep && f.dep.airport && f.dep.airport.toLowerCase().includes(q)) return true;
    if(f.arr && f.arr.airport && f.arr.airport.toLowerCase().includes(q)) return true;
    return false;
  });
}
function handleSearch(q){
  if(!q) return;
  const flightsFound = searchFlights(q);
  if(flightsFound.length){
    const f = flightsFound[0];
    // center on that flight
    drawFlights({ focusId: f.flightNo, hideOthers: document.getElementById('hideOthersSwitch')?.checked || HIDE_OTHER_FLIGHTS_ON_SEARCH });
    const dep = findAirportAny(f.dep.airport);
    const arr = findAirportAny(f.arr.airport);
    const runtime = buildRuntimeForFlight(f);
    showFlightCard(f, runtime, dep, arr);
    const pl = flightPolylines[f.flightNo];
    if(pl) map.fitBounds(pl.getBounds(), {padding:[80,80]});
    return;
  }
  // try airports
  const ap = findAirportAny(q);
  if(ap){
    map.panTo([ap.lat, ap.lng]);
    showAirportCard(ap);
    return;
  }
  alert('未找到匹配项：' + q);
}

/* ========== INFO CARDS ========== */
function showFlightCard(f, runtime, depA, arrA){
  const progressPct = Math.round((runtime.progress||0)*100);
  // siblings by regNo
  let siblings = [];
  if(f.regNo){
    siblings = flights.filter(x=>x.regNo && x.regNo === f.regNo).map(x=>x.flightNo);
  }
  let html = `<div class="title">${f.flightNo} ${f.airline || ''}</div>`;
  html += `<div class="meta">机型：${f.aircraft || '—'} · 注册号：${f.regNo || '—'}</div>`;
  html += `<div style="margin-top:8px"><b>起飞：</b>${depA? depA.name + ' ('+depA.code+')' : (f.dep?f.dep.airport:'--')} · ${runtime.depDate? formatDT(runtime.depDate):'--'}</div>`;
  html += `<div><b>到达：</b>${arrA? arrA.name + ' ('+arrA.code+')' : (f.arr?f.arr.airport:'--')} · ${runtime.arrDate? formatDT(runtime.arrDate):'--'}</div>`;
  html += `<div style="margin-top:10px"><b>进度：</b>${progressPct}%</div>`;
  html += `<div class="progress-wrap" style="margin-top:6px"><div class="progress" style="width:${progressPct}%;height:8px;border-radius:6px;background:linear-gradient(90deg,var(--accent),#2fd3ff);"></div></div>`;
  if(siblings.length) html += `<div style="margin-top:8px;color:var(--muted);font-size:12px">相同注册号航班：${siblings.join(', ')}</div>`;
  html += `<div style="margin-top:8px;color:var(--muted);font-size:12px">经济：${f.priceEco||'—'} · 商务：${f.priceBiz||'—'} · 头等：${f.special||'—'}</div>`;
  const card = document.getElementById('infoCard'); card.innerHTML = html; card.classList.remove('hidden');
}
function showAirportCard(a){ if(!a) return; const card = document.getElementById('infoCard'); card.innerHTML = `<div class="title">${a.name} (${a.code})</div>${a.level?`<div class="meta">等级：${a.level}</div>`:''}${a.runways?`<div class="meta">跑道：${a.runways}</div>`:''}`; card.classList.remove('hidden'); }

/* ========== UI BINDINGS ========== */
document.getElementById('btnSearch')?.addEventListener('click', ()=> handleSearch(document.getElementById('searchInput').value));
document.getElementById('searchInput')?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') handleSearch(e.target.value); });

document.getElementById('toggleFlightNo')?.addEventListener('change', (e)=>{ localStorage.setItem('showFlightNo', e.target.checked); drawFlights(); });
document.getElementById('sidebarToggle')?.addEventListener('click', ()=> { document.getElementById('sidebar').classList.toggle('open'); });

map?.on && map.on('click', ()=> { document.getElementById('infoCard')?.classList.add('hidden'); });

/* ========== BOOT ========== */
async function boot(){
  initMap();
  await loadAirports();
  await loadFlights();
  drawAirports();
  drawFlights();

  // URL param support ?flights_map=...
  const qs = new URLSearchParams(location.search).get('flights_map');
  if(qs){
    handleSearch(qs);
  }

  // auto-refresh
  setInterval(async ()=>{
    await loadFlights();
    drawFlights();
    // keep airports and labels
    drawAirports();
  }, REFRESH_INTERVAL_MS);
}

boot();
