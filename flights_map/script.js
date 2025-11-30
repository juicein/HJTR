// ================== 全局配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";

// 自动刷新间隔（秒）
let refreshIntervalSec = Number(localStorage.getItem("refreshIntervalSec") || 180);

// 本地状态
let settings = {
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"),
};

// 地图与图层
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 }).addTo(map);

let airportDB = {};
let flights = [];
let airportMarkers = {};
let flightMarkers = {};
let flightLines = {};
let highlightedKey = null;

const PLANE_IMG = "https://i.imgur.com/4bZtV3y.png";

// ================== 工具函数 ==================
function getFlightIDFromURL() {
  const urlParams = new URLSearchParams(location.search);
  if(!urlParams.has("flights_map")) return null;
  const v = urlParams.get("flights_map");
  if (!v || v === "0") return "ALL";
  return v;
}

function timeStrToMinutes(t) {
  if (!t) return null;
  const parts = t.split(":").map(s=>s.trim());
  if (parts.length < 2) return null;
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h*60 + m;
}

function beijingNowDate() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset()*60000;
  return new Date(utc + 8*3600*1000);
}

function beijingTodayMidnight() {
  const bj = beijingNowDate();
  const mid = new Date(bj.getTime());
  mid.setHours(0,0,0,0);
  return mid;
}

function nowBeijingTotalMinutes() {
  return Math.floor(beijingNowDate().getTime() / 60000);
}

function formatDateOffset(offsetDays) {
  const base = beijingTodayMidnight();
  base.setDate(base.getDate() + Number(offsetDays||0));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth()+1).padStart(2,'0');
  const dd = String(base.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = d => d*Math.PI/180;
  const toDeg = r => r*180/Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2-λ1)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
  let θ = toDeg(Math.atan2(y,x));
  θ = (θ + 360 + 90) % 360;
  return θ;
}

// ================== flight_data.txt 解析 ==================
function parseFlightData(raw) {
  const entries = [];
  const parts = raw.split("《航班结束》");
  for (let block of parts) {
    block = block.trim();
    if (!block) continue;

    const flightNoMatch = block.match(/【\s*([^\]　]+)\s*】/);
    const flightNo = flightNoMatch ? flightNoMatch[1].trim() : "";

    const typeMatch = block.match(/〔\s*([^\]　]+)\s*〕/);
    const planeType = typeMatch ? typeMatch[1].trim() : "";

    const airlineMatch = block.match(/『\s*([^』]+)\s*』/);
    const airline = airlineMatch ? airlineMatch[1].trim() : "";

    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const depName = depMatch ? depMatch[1].trim() : "";
    const depTimeRaw = depMatch ? depMatch[2].trim() : "";
    const depOffsetRaw = depMatch && depMatch[3] ? depMatch[3].replace(/[^\d]/g,"") : "0";

    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const arrName = arrMatch ? arrMatch[1].trim() : "";
    const arrTimeRaw = arrMatch ? arrMatch[2].trim() : "";
    const arrOffsetRaw = arrMatch && arrMatch[3] ? arrMatch[3].replace(/[^\d]/g,"") : "0";

    const regMatch = block.match(/<\s*([^>]+)\s*>/);
    const reg = regMatch ? regMatch[1].trim() : "";

    entries.push({
      flightNo,
      planeType,
      airline,
      dep: depName,
      depTimeRaw,
      depOffset: Number(depOffsetRaw||0),
      arr: arrName,
      arrTimeRaw,
      arrOffset: Number(arrOffsetRaw||0),
      reg,
      raw: block
    });
  }
  return entries;
}

// ================== 机场查找 ==================
function airportByName(nameOrCode) {
  if (!nameOrCode) return null;
  const key = String(nameOrCode).trim().toLowerCase();
  for (let code in airportDB) {
    if (code.toLowerCase() === key) return airportDB[code];
  }
  for (let code in airportDB) {
    const a = airportDB[code];
    const nm = (a.name || "").toLowerCase();
    const city = (a.city || "").toLowerCase();
    const aliases = (a.aliases || []).map(x=>x.toLowerCase());
    if (nm === key || city === key || aliases.includes(key)) return a;
    if (nm.includes(key) || city.includes(key)) return a;
    if ((a.code||"").toLowerCase() === key) return a;
  }
  return null;
}

// ================== 渲染机场 ==================
function renderAllAirports() {
  for (let code in airportDB) {
    const ap = airportDB[code];
    const lat = ap.lat || ap.latitude || ap.latitude;
    const lng = ap.lon || ap.lng || ap.longitude || ap.lng;
    if (lat === undefined || lng === undefined) continue;

    if (airportMarkers[code]) {
      const el = airportMarkers[code].getElement();
      if (el) {
        const nameEl = el.querySelector(".airport-name");
        const codeEl = el.querySelector(".airport-code");
        if (nameEl) nameEl.style.display = settings.showAirportName ? "block" : "none";
        if (codeEl) codeEl.style.display = settings.showAirportCode ? "block" : "none";
      }
      continue;
    }

    const aliasesText = (ap.aliases && ap.aliases.length) ? ap.aliases.join(" / ") : "";
    const html = `
      <div class="airport-marker" title="${ap.name || ''}${aliasesText?(' — ' + aliasesText):''}">
        <div class="airport-circle"></div>
        <div class="airport-label">
          <div class="airport-name">${ap.name || ''}</div>
          <div class="airport-code">${ap.code || ''}</div>
        </div>
      </div>`;
    const icon = L.divIcon({ className: "airport-divicon", html, iconAnchor: [12,12] });
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    marker.on("click", ()=> showAirportCard(ap));
    airportMarkers[code] = marker;

    const el = marker.getElement();
    if (el) {
      const nameEl = el.querySelector(".airport-name");
      const codeEl = el.querySelector(".airport-code");
      if (nameEl) nameEl.style.display = settings.showAirportName ? "block" : "none";
      if (codeEl) codeEl.style.display = settings.showAirportCode ? "block" : "none";
    }
  }
}

// ================== 渲染航班 ==================
function computeProgress(flight) {
  const depMin = timeStrToMinutes(flight.depTimeRaw);
  const arrMin = timeStrToMinutes(flight.arrTimeRaw);
  if (depMin === null || arrMin === null) return null;

  const baseMid = beijingTodayMidnight().getTime() / 60000;
  const depTotal = baseMid + depMin + (flight.depOffset||0)*24*60;
  const arrTotal = baseMid + arrMin + (flight.arrOffset||0)*24*60;

  if (arrTotal === depTotal) return null;

  const nowTotal = nowBeijingTotalMinutes();
  return (nowTotal - depTotal) / (arrTotal - depTotal);
}

function keyForFlight(flight) {
  if (flight.reg) return flight.reg.trim();
  return (flight.flightNo || "") + "|" + (flight.depTimeRaw || "") + "|" + (flight.arrTimeRaw || "");
}

function highlightReset() {
  if (highlightedKey && flightLines[highlightedKey]) {
    try {
      flightLines[highlightedKey].setStyle({ color: "var(--orange)", dashArray: "6 6", weight: 2 });
    } catch(e){}
    highlightedKey = null;
  }
}

function onFlightClicked(key, flight) {
  highlightReset();
  if (flightLines[key]) {
    flightLines[key].setStyle({ color: "var(--accent)", dashArray: "6 6", weight: 3 });
    highlightedKey = key;
  }
  const depA = airportByName(flight.dep);
  const arrA = airportByName(flight.arr);
  showInfoCard(flight, depA, arrA);
}

function renderFlight(flight, options={forceShow:false}) {
  const depA = airportByName(flight.dep);
  const arrA = airportByName(flight.arr);
  if (!depA || !arrA) return;

  const depLat = depA.lat || depA.latitude;
  const depLng = depA.lon || depA.lng || depA.longitude;
  const arrLat = arrA.lat || arrA.latitude;
  const arrLng = arrA.lon || arrA.lng || arrA.longitude;
  if ([depLat,depLng,arrLat,arrLng].some(v=>v===undefined)) return;

  const idKey = keyForFlight(flight);

  const prog = computeProgress(flight);
  if (prog === null) {
    if (flightLines[idKey]) try { map.removeLayer(flightLines[idKey]); } catch(e){}
    if (flightMarkers[idKey]) try { map.removeLayer(flightMarkers[idKey]); } catch(e){}
    delete flightLines[idKey];
    delete flightMarkers[idKey];
    return;
  }

  if (!options.forceShow) {
    if (!(prog > 0 && prog < 1)) {
      if (flightLines[idKey]) try { map.removeLayer(flightLines[idKey]); } catch(e){}
      if (flightMarkers[idKey]) try { map.removeLayer(flightMarkers[idKey]); } catch(e){}
      delete flightLines[idKey];
      delete flightMarkers[idKey];
      return;
    }
  }

  if (!flightLines[idKey]) {
    const line = L.polyline([[depLat,depLng],[arrLat,arrLng]], { color: "var(--orange)", weight: 2, dashArray: "6 6" }).addTo(map);
    line.on("click", ()=> onFlightClicked(idKey, flight));
    flightLines[idKey] = line;
  } else {
    flightLines[idKey].setLatLngs([[depLat,depLng],[arrLat,arrLng]]);
  }

  if (settings.showPlaneIcon) {
    const angle = bearingBetween(depLat,depLng,arrLat,arrLng);
    const curLat = depLat + (arrLat - depLat) * Math.max(0, Math.min(1, prog));
    const curLng = depLng + (arrLng - depLng) * Math.max(0, Math.min(1, prog));
    const planeHtml = `<div style="transform: rotate(${angle}deg);"><img class="plane-icon" src="${PLANE_IMG}" /></div>`;
    const planeIcon = L.divIcon({ html: planeHtml, className: "plane-divicon", iconSize:[36,36], iconAnchor:[18,18] });

    if (!flightMarkers[idKey]) {
      const mk = L.marker([curLat, curLng], { icon: planeIcon }).addTo(map);
      mk.on("click", ()=> onFlightClicked(idKey, flight));
      flightMarkers[idKey] = mk;
    } else {
      flightMarkers[idKey].setLatLng([curLat, curLng]);
      flightMarkers[idKey].setIcon(L.divIcon({ html: planeHtml, className: "plane-divicon", iconSize:[36,36], iconAnchor:[18,18] }));
    }

    if (settings.showFlightNo) {
      try { flightMarkers[idKey].bindTooltip(flight.flightNo || flight.reg || "", {permanent:true, direction:"right", className:"flight-label"}); } catch(e){}
    } else {
      try { flightMarkers[idKey].unbindTooltip(); } catch(e){}
    }
  } else {
    if (flightMarkers[idKey]) {
      try { map.removeLayer(flightMarkers[idKey]); } catch(e){}
      delete flightMarkers[idKey];
    }
  }
}

// ================== 强制删除未飞/已到航班 ==================
function removeLandedOrPendingFlights() {
  const nowTotal = nowBeijingTotalMinutes();
  flights.forEach(flight => {
    const depMin = timeStrToMinutes(flight.depTimeRaw);
    const arrMin = timeStrToMinutes(flight.arrTimeRaw);
    if (depMin === null || arrMin === null) return;

    const baseMid = beijingTodayMidnight().getTime() / 60000;
    const depTotal = baseMid + depMin + (flight.depOffset||0)*24*60;
    const arrTotal = baseMid + arrMin + (flight.arrOffset||0)*24*60;

    // 如果未起飞或已到达
    if (nowTotal < depTotal || nowTotal > arrTotal) {
      const idKey = keyForFlight(flight);
      if (flightLines[idKey]) { try { map.removeLayer(flightLines[idKey]); } catch(e){} delete flightLines[idKey]; }
      if (flightMarkers[idKey]) { try { map.removeLayer(flightMarkers[idKey]); } catch(e){} delete flightMarkers[idKey]; }
    }
  });
}

// ================== 清理飞行层 ==================
function clearFlightLayers() {
  for (let k in flightLines) { try { map.removeLayer(flightLines[k]); } catch(e){} }
  for (let k in flightMarkers) { try { map.removeLayer(flightMarkers[k]); } catch(e){} }
  flightLines = {};
  flightMarkers = {};
  highlightedKey = null;
}

// ================== 渲染主流程 ==================
function renderFlights() {
  clearFlightLayers();
  renderAllAirports();

  const urlId = getFlightIDFromURL();
  const filterKey = (urlId && urlId !== "ALL") ? String(urlId).toLowerCase() : null;

  flights.forEach(f => {
    let matchesFilter = true;
    if (filterKey) {
      const a = (f.flightNo || "").toLowerCase();
      const b = (f.reg || "").toLowerCase();
      matchesFilter = (a.includes(filterKey) || b.includes(filterKey));
    }
    if (filterKey && settings.hideOtherWhenFilter && !matchesFilter) return;
    const forceShow = matchesFilter;
    renderFlight(f, { forceShow });
  });

  // 强制删除未起飞/已到达航班
  removeLandedOrPendingFlights();

  // zoom to matched flights if filter present
  if (filterKey) {
    const matchedCoords = [];
    for (let k in flightLines) {
      try {
        const latlngs = flightLines[k].getLatLngs();
        if (latlngs && latlngs.length) {
          matchedCoords.push(latlngs[0]);
          matchedCoords.push(latlngs[latlngs.length-1]);
        }
      } catch(e){}
    }
    if (matchedCoords.length) {
      const bounds = L.latLngBounds(matchedCoords);
      map.fitBounds(bounds.pad(0.4));
    }
  }
}

// ================== 数据加载 ==================
async function loadData() {
  try {
    const res = await fetch(AIRPORTS_PATH);
    airportDB = await res.json();
    if (Array.isArray(airportDB)) {
      const arr = airportDB; airportDB = {};
      arr.forEach(a => { const code = a.code || (a.name && a.name.slice(0,3).toUpperCase()); if (code) airportDB[code] = a; });
    }
  } catch(e) { console.error("加载 airports.json 错误：", e); airportDB = {}; }

  try {
    const txt = await fetch(FLIGHT_DATA_PATH).then(r=>r.text());
    flights = parseFlightData(txt);
  } catch(e) { console.error("加载 flight_data.txt 错误：", e); flights = []; }

  renderAllAirports();
  renderFlights();
}

// ================== UI 与搜索/刷新逻辑 ==================
// … 保持你原来的 initUI、performSearch、startAutoRefresh 等逻辑不变 …
