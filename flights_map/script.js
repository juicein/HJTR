const PLANE_IMG = "../image/flight_icon.png"; // 你确认的图片：机头向上（北）




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
const map = L.map('map', { worldCopyJump: true, minZoom: 4 }).setView([30, 90], 4);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 }).addTo(map);

let airportDB = {};
let flights = [];
let airportMarkers = {};
let flightMarkers = {};
let flightLines = {};
let highlightedKey = null;

const PLANE_IMG = "https://i.imgur.com/4bZtV3y.png";

// ============== 工具函数 ==============
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
  return (θ + 360 + 90) % 360;
}

// ============== flight_data 解析 ==============
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

// ============== 机场查找 ==============
function airportByName(nameOrCode) {
  if (!nameOrCode) return null;
  const key = String(nameOrCode).trim().toLowerCase();
  for (let code in airportDB) {
    if (code.toLowerCase() === key) return airportDB[code];
  }
  for (let code in airportDB) {
    const a = airportDB[code];
    if ((a.name||"").toLowerCase() === key) return a;
    if ((a.city||"").toLowerCase() === key) return a;
    if ((a.aliases||[]).map(x=>x.toLowerCase()).includes(key)) return a;
  }
  return null;
}

// ============== 渲染机场 ==============
function renderAllAirports() {
  for (let code in airportDB) {
    const ap = airportDB[code];
    const lat = ap.lat || ap.latitude;
    const lng = ap.lon || ap.lng;
    if (lat === undefined || lng === undefined) continue;

    if (airportMarkers[code]) {
      const el = airportMarkers[code].getElement();
      if (el) {
        el.querySelector(".airport-name").style.display = settings.showAirportName ? "block" : "none";
        el.querySelector(".airport-code").style.display = settings.showAirportCode ? "block" : "none";
      }
      continue;
    }

    const html = `
      <div class="airport-marker">
        <div class="airport-circle"></div>
        <div class="airport-label">
          <div class="airport-name">${ap.name || ''}</div>
          <div class="airport-code">${ap.code || ''}</div>
        </div>
      </div>`;
    const icon = L.divIcon({ className: "airport-divicon", html, iconAnchor: [12,12] });
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    airportMarkers[code] = marker;
  }
}

// ============== flight progress 计算 ==============
function computeProgress(f) {
  const depMin = timeStrToMinutes(f.depTimeRaw);
  const arrMin = timeStrToMinutes(f.arrTimeRaw);
  if (depMin === null || arrMin === null) return null;

  const baseMid = beijingTodayMidnight().getTime() / 60000;

  const depAbs = baseMid + depMin + (f.depOffset||0)*1440;
  const arrAbs = baseMid + arrMin + (f.arrOffset||0)*1440;

  if (arrAbs === depAbs) return null;

  const nowAbs = nowBeijingTotalMinutes();
  return (nowAbs - depAbs) / (arrAbs - depAbs);
}

function keyForFlight(f) {
  return f.reg || (f.flightNo + "|" + f.depTimeRaw + "|" + f.arrTimeRaw);
}

// ============== 重置突出航线 ==============
function highlightReset() {
  if (highlightedKey && flightLines[highlightedKey]) {
    flightLines[highlightedKey].setStyle({ color: "var(--orange)", dashArray: "6 6", weight: 2 });
  }
  highlightedKey = null;
}

// ============== 点击航线 ==============
function onFlightClicked(key, flight) {
  highlightReset();
  if (flightLines[key]) {
    flightLines[key].setStyle({ color: "var(--accent)", dashArray: "6 6", weight: 3 });
    highlightedKey = key;
  }
}

// ============== 渲染单个航班 ==============
function renderFlight(f, { forceShow=false }={}) {
  const depA = airportByName(f.dep);
  const arrA = airportByName(f.arr);
  if (!depA || !arrA) return;

  const depLat = depA.lat;  const depLng = depA.lon;
  const arrLat = arrA.lat;  const arrLng = arrA.lon;

  const key = keyForFlight(f);
  const prog = computeProgress(f);

  // ⭐⭐最重要部分：彻底隐藏 0 <= progress <= 1 以外的飞机⭐⭐
  if (prog === null || !(prog > 0 && prog < 1)) {
    if (flightLines[key]) { map.removeLayer(flightLines[key]); delete flightLines[key]; }
    if (flightMarkers[key]) { map.removeLayer(flightMarkers[key]); delete flightMarkers[key]; }
    return;
  }

  // ===== 渲染航线 =====
  if (!flightLines[key]) {
    const line = L.polyline([[depLat,depLng],[arrLat,arrLng]], {
      color: "var(--orange)", weight: 2, dashArray: "6 6"
    }).addTo(map);
    flightLines[key] = line;
  }
  flightLines[key].setLatLngs([[depLat,depLng],[arrLat,arrLng]]);

  // ===== 飞机图标 =====
  if (settings.showPlaneIcon) {
    const angle = bearingBetween(depLat,depLng,arrLat,arrLng);
    const lat = depLat + (arrLat - depLat)*prog;
    const lng = depLng + (arrLng - depLng)*prog;
    const planeHtml = `<div style="transform: rotate(${angle}deg);"><img class="plane-icon" src="${PLANE_IMG}"></div>`;
    const icon = L.divIcon({ html: planeHtml, className: "plane-divicon", iconSize:[36,36], iconAnchor:[18,18] });

    if (!flightMarkers[key]) {
      flightMarkers[key] = L.marker([lat, lng], { icon }).addTo(map);
    } else {
      flightMarkers[key].setLatLng([lat,lng]);
      flightMarkers[key].setIcon(icon);
    }

    if (settings.showFlightNo) {
      flightMarkers[key].bindTooltip(f.flightNo, {
        permanent: true,
        direction: "right",
        className: "flight-label"
      });
    } else {
      flightMarkers[key].unbindTooltip();
    }

  } else {
    if (flightMarkers[key]) {
      map.removeLayer(flightMarkers[key]);
      delete flightMarkers[key];
    }
  }
}

// ============== 清除所有航线/图标 ==============
function clearFlightLayers() {
  for (let k in flightLines) map.removeLayer(flightLines[k]);
  for (let k in flightMarkers) map.removeLayer(flightMarkers[k]);
  flightLines = {};
  flightMarkers = {};
  highlightedKey = null;
}

// ============== 渲染所有航班 ==============
function renderFlights() {
  clearFlightLayers();
  renderAllAirports();

  const param = getFlightIDFromURL();
  const filterKey = param && param !== "ALL" ? param.toLowerCase() : null;

  flights.forEach(f => {
    const match = filterKey
      ? (f.flightNo.toLowerCase().includes(filterKey) || (f.reg||"").toLowerCase().includes(filterKey))
      : true;

    if (filterKey && settings.hideOtherWhenFilter && !match) return;

    renderFlight(f, { forceShow: match });
  });

  if (filterKey) {
    const coords = [];
    for (let k in flightLines) {
      const arr = flightLines[k].getLatLngs();
      coords.push(arr[0], arr[arr.length-1]);
    }
    if (coords.length) map.fitBounds(L.latLngBounds(coords).pad(0.4));
  }
}

// ============== 读取数据 ==============
async function loadData() {
  try {
    airportDB = await fetch(AIRPORTS_PATH).then(r=>r.json());
  } catch(e){ airportDB = {}; }

  try {
    const txt = await fetch(FLIGHT_DATA_PATH).then(r=>r.text());
    flights = parseFlightData(txt);
  } catch(e){ flights=[]; }

  renderFlights();
}

// ============== UI 初始化 ==============
function initUI() {
  map.on("click", ()=> document.getElementById("infoCard")?.classList.add("hidden"));
}

// ============== 自动刷新 ==============
let refreshTimer=null;
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadData, refreshIntervalSec*1000);
}

// ============== 主入口 ==============
(async function main(){
  initUI();
  await loadData();
  startAutoRefresh();
})();
