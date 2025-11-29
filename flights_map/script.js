// ================== 配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "https://i.imgur.com/4bZtV3y.png"; // 飞机图标
// 默认刷新间隔（秒）
let refreshIntervalSec = Number(localStorage.getItem("refreshIntervalSec") || 180);

// 设置（使用开关，立即保存）
let settings = {
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false")
};

// 地图与图层
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 }).addTo(map);

let airportDB = {};      // code -> airport object
let flights = [];        // parsed flights array
let airportMarkers = {}; // code -> marker
let flightLines = {};    // key -> polyline
let flightMarkers = {};  // key -> plane marker
let highlightedKey = null; // currently highlighted flight key

// ================== 工具函数 ==================
function nowBeijingMinutes() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset()*60000;
  const bj = new Date(utc + 8*3600*1000);
  return bj.getHours()*60 + bj.getMinutes();
}
function toMinutes(t) {
  if (!t) return null;
  const p = t.split(":").map(s=>parseInt(s,10));
  if (p.length < 2 || isNaN(p[0]) || isNaN(p[1])) return null;
  return p[0]*60 + p[1];
}
function bearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d*Math.PI/180;
  const toDeg = r => r*180/Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2-λ1)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
  let θ = toDeg(Math.atan2(y,x));
  θ = (θ + 360 + 90) % 360; // adjust for image orientation
  return θ;
}

// ============ 解析航班原始格式 ============
function parseFlightData(raw) {
  const list = [];

  const reg = /【(.*?)】[\s\S]*?«([^»]+)»〔(.*?)〕『(.*?)』《(.*?)出发》\{(.*?)\}.*?《(.*?)到达》\{(.*?)\}[\s\S]*?(<([^>]+)>)?/g;

  let m;
  while ((m = reg.exec(raw)) !== null) {
    const depCity = m[5].replace("出发", "").trim();
    const arrCity = m[7].replace("到达", "").trim();

    list.push({
      flightNo: m[1],        // 航班号
      cycle: m[2],           // 运行日
      aircraft: m[3],        // 机型
      airline: m[4],         // 航空公司
      dep: depCity,          // 出发城市
      depTime: m[6],         // 出发时间
      arr: arrCity,          // 到达城市
      arrTime: m[8],         // 到达时间
      reg: m[10] || null     // 注册号（可为空）
    });
  }
  return list;
}


// 从机场数据库查找（支持 code/name/aliases/包含）
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
    if ((a.aliases||[]).some(x=>x.toLowerCase() === key)) return a;
  }
  for (let code in airportDB) {
    const a = airportDB[code];
    if ((a.name||"").toLowerCase().includes(key)) return a;
    if ((a.city||"").toLowerCase().includes(key)) return a;
    if ((a.aliases||[]).some(x=>x.toLowerCase().includes(key))) return a;
    if ((a.code||"").toLowerCase() === key) return a;
  }
  return null;
}

// ================== 渲染机场（永远显示） ==================
function renderAllAirports() {
  for (let code in airportDB) {
    const ap = airportDB[code];
    const lat = ap.lat || ap.latitude;
    const lon = ap.lon || ap.lng || ap.longitude;
    if (lat === undefined || lon === undefined) continue;

    if (airportMarkers[code]) {
      // update text display
      const el = airportMarkers[code].getElement();
      if (el) {
        const nameEl = el.querySelector(".airport-name");
        const codeEl = el.querySelector(".airport-code");
        if (nameEl) nameEl.style.display = settings.showAirportName ? "block" : "none";
        if (codeEl) codeEl.style.display = settings.showAirportCode ? "block" : "none";
      }
      continue;
    }

    const html = `<div class="airport-marker">
      <div class="airport-circle"></div>
      <div class="airport-label">
        <div class="airport-name">${ap.name||""}</div>
        <div class="airport-code">${ap.code||""}</div>
      </div>
    </div>`;

    const icon = L.divIcon({ html, className: "airport-divicon", iconAnchor:[12,12] });
    const mk = L.marker([lat, lon], { icon }).addTo(map);
    mk.on("click", ()=> showAirportCard(ap));
    airportMarkers[code] = mk;

    // apply initial visibility
    const el = mk.getElement();
    if (el) {
      const nameEl = el.querySelector(".airport-name");
      const codeEl = el.querySelector(".airport-code");
      if (nameEl) nameEl.style.display = settings.showAirportName ? "block" : "none";
      if (codeEl) codeEl.style.display = settings.showAirportCode ? "block" : "none";
    }
  }
}

// ================== 渲染航班（只显示 0<progress<1 且有时间） ==================

function computeProgress(f) {
  const depMin = toMinutes(f.depTimeRaw);
  const arrMin = toMinutes(f.arrTimeRaw);
  if (depMin === null || arrMin === null) return null;
  const depTotal = depMin + (f.depOffset||0)*24*60;
  const arrTotal = arrMin + (f.arrOffset||0)*24*60;
  if (arrTotal === depTotal) return null;
  const now = nowBeijingMinutes();
  // treat now possibly on another day: if arrTotal < depTotal, arrTotal likely next day(s) already represented by offset
  const frac = (now - depTotal)/(arrTotal - depTotal);
  return frac;
}

function keyForFlight(f) {
  // use registration if exists, else flightNo + dep time fallback
  if (f.reg) return f.reg.trim();
  return (f.flightNo || "") + "|" + (f.depTimeRaw || "") + "|" + (f.arrTimeRaw || "");
}

function renderFlightOverlay(f) {
  const depA = airportByName(f.dep);
  const arrA = airportByName(f.arr);
  if (!depA || !arrA) return;

  const depLat = depA.lat || depA.latitude;
  const depLon = depA.lon || depA.lng || depA.longitude;
  const arrLat = arrA.lat || arrA.latitude;
  const arrLon = arrA.lon || arrA.lng || arrA.longitude;
  if ([depLat,depLon,arrLat,arrLon].some(v=>v===undefined)) return;

  const key = keyForFlight(f);

  // compute progress and require 0<progress<1
  const prog = computeProgress(f);
  if (prog === null) return; // cannot compute -> do not display per requirement
  if (!(prog > 0 && prog < 1)) {
    // do not display not-yet-departed or already-arrived
    // remove any previous overlays if exist
    if (flightLines[key]) try { map.removeLayer(flightLines[key]); } catch(e){}
    if (flightMarkers[key]) try { map.removeLayer(flightMarkers[key]); } catch(e){}
    return;
  }

  // create or update line
  if (!flightLines[key]) {
    const line = L.polyline([[depLat,depLon],[arrLat,arrLon]], { color:"orange", weight:2, dashArray:"6 6" }).addTo(map);
    line._flightKey = key;
    line.on("click", ()=> onFlightClick(key, f));
    flightLines[key] = line;
  } else {
    flightLines[key].setLatLngs([[depLat,depLon],[arrLat,arrLon]]);
  }

  // plane marker at interpolated position
  const angle = bearing(depLat,depLon,arrLat,arrLon);
  const curLat = depLat + (arrLat - depLat) * prog;
  const curLon = depLon + (arrLon - depLon) * prog;
  const planeHtml = `<div style="transform:rotate(${angle}deg)"><img class="plane-icon" src="${PLANE_IMG}" /></div>`;
  const planeIcon = L.divIcon({ html:planeHtml, className:"plane-divicon", iconSize:[36,36], iconAnchor:[18,18] });

  if (!flightMarkers[key]) {
    const mk = L.marker([curLat,curLon], { icon: planeIcon }).addTo(map);
    mk.on("click", ()=> onFlightClick(key, f));
    flightMarkers[key] = mk;
  } else {
    flightMarkers[key].setLatLng([curLat,curLon]);
    flightMarkers[key].setIcon(L.divIcon({ html:planeHtml, className:"plane-divicon", iconSize:[36,36], iconAnchor:[18,18] }));
  }

  // flightNo tooltip controlled by setting
  if (settings.showFlightNo) {
    flightMarkers[key].bindTooltip(f.flightNo || f.reg || "", { permanent:true, direction:"right", className:"flight-label" });
  } else {
    try { flightMarkers[key].unbindTooltip(); } catch(e){}
  }
}

// 当点击某条航班（line 或 marker）
function onFlightClick(key, flight) {
  // highlight line
  if (highlightedKey && flightLines[highlightedKey]) {
    flightLines[highlightedKey].setStyle({ color:"orange" , dashArray:"6 6" });
  }
  if (flightLines[key]) {
    flightLines[key].setStyle({ color: "var(--accent)", dashArray:"6 6", weight:3 });
    highlightedKey = key;
  }
  // show card
  const depA = airportByName(flight.dep);
  const arrA = airportByName(flight.arr);
  showInfoCard(flight, depA, arrA);
}

// 清理旧航班显示（仅航班层）
function clearFlightOverlays() {
  for (let k in flightLines) {
    try { map.removeLayer(flightLines[k]); } catch(e){}
  }
  for (let k in flightMarkers) {
    try { map.removeLayer(flightMarkers[k]); } catch(e){}
  }
  flightLines = {};
  flightMarkers = {};
  highlightedKey = null;
}

// ================== 信息卡片（含进度条与前后续） ==================
function showInfoCard(f, depA, arrA) {
  const card = document.getElementById("infoCard");
  // progress percent
  const prog = computeProgress(f);
  const percent = (prog===null) ? "-" : Math.round(Math.max(0, Math.min(1, prog))*100);
  // prev/next by registration number only
  let prevBtn = "";
  let nextBtn = "";
  if (f.reg) {
    const same = flights.filter(x => x.reg && x.reg.toLowerCase() === f.reg.toLowerCase());
    // sort by dep total minutes
    same.sort((a,b) => {
      const am = toMinutes(a.depTimeRaw) === null ? 1e9 : toMinutes(a.depTimeRaw) + (a.depOffset||0)*24*60;
      const bm = toMinutes(b.depTimeRaw) === null ? 1e9 : toMinutes(b.depTimeRaw) + (b.depOffset||0)*24*60;
      return am - bm;
    });
    const idx = same.findIndex(x => x.raw === f.raw);
    if (idx > 0) prevBtn = `<button id="btnPrev" class="btn ghost">上一行程</button>`;
    if (idx >= 0 && idx < same.length-1) nextBtn = `<button id="btnNext" class="btn ghost">下一行程</button>`;
  } else {
    // no reg -> do not show prev/next
  }

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h3 style="margin:0">${f.flightNo || "-"} ${f.reg?`(${f.reg})`:''}</h3>
        <div style="font-size:12px;color:rgba(0,0,0,0.6)">${f.airline||""} · ${f.planeType||""}</div>
      </div>
      <div style="text-align:right;font-size:12px">
        <div>${depA?depA.name||depA.code:''}</div>
        <div style="font-size:11px;color:rgba(0,0,0,0.6)">${f.depTimeRaw||""} → ${f.arrTimeRaw||""}</div>
      </div>
    </div>
    <div style="margin-top:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px">
        <div>进度</div>
        <div>${percent === "-" ? "-" : percent + "%"}</div>
      </div>
      <div class="progressWrap" style="margin-top:6px"><div class="progressBar" style="width:${percent==="-"?0:percent}%"></div></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      ${prevBtn}
      ${nextBtn}
      <button id="btnCloseCard" class="btn primary">关闭</button>
    </div>
  `;
  card.classList.remove("hidden");

  document.getElementById("btnCloseCard").onclick = ()=> card.classList.add("hidden");
  if (document.getElementById("btnPrev")) {
    document.getElementById("btnPrev").onclick = () => {
      const same = flights.filter(x => x.reg && x.reg.toLowerCase() === f.reg.toLowerCase());
      same.sort((a,b)=> (toMinutes(a.depTimeRaw||"0") + (a.depOffset||0)*24*60) - (toMinutes(b.depTimeRaw||"0") + (b.depOffset||0)*24*60));
      const idx = same.findIndex(x => x.raw === f.raw);
      if (idx > 0) {
        onFlightClick(keyForFlight(same[idx-1]), same[idx-1]);
      }
    };
  }
  if (document.getElementById("btnNext")) {
    document.getElementById("btnNext").onclick = () => {
      const same = flights.filter(x => x.reg && x.reg.toLowerCase() === f.reg.toLowerCase());
      same.sort((a,b)=> (toMinutes(a.depTimeRaw||"0") + (a.depOffset||0)*24*60) - (toMinutes(b.depTimeRaw||"0") + (b.depOffset||0)*24*60));
      const idx = same.findIndex(x => x.raw === f.raw);
      if (idx >= 0 && idx < same.length-1) {
        onFlightClick(keyForFlight(same[idx+1]), same[idx+1]);
      }
    };
  }
}

// 显示机场卡片
function showAirportCard(ap) {
  const card = document.getElementById("infoCard");
  card.innerHTML = `<h3 style="margin:0">${ap.name || ""} (${ap.code||""})</h3>
    ${ap.level?`<p><b>等级：</b>${ap.level}</p>`:""}
    ${ap.runways?`<p><b>跑道：</b>${ap.runways}</p>`:""}
    <div style="display:flex;justify-content:flex-end;margin-top:8px"><button id="btnClose" class="btn primary">关闭</button></div>`;
  card.classList.remove("hidden");
  document.getElementById("btnClose").onclick = ()=> card.classList.add("hidden");
}

// ================== 渲染主流程 ==================
function renderAll() {
  clearFlightOverlays();
  renderAllAirports();
  const urlParam = getFlightIDFromURL();
  const filterKey = urlParam && urlParam !== "ALL" ? String(urlParam).toLowerCase() : null;

  flights.forEach(f => {
    // If filtering by url and hideOtherWhenFilter is true, skip non-matching
    let matches = true;
    if (filterKey) {
      const a = (f.reg||"").toLowerCase();
      const b = (f.flightNo||"").toLowerCase();
      matches = (a.includes(filterKey) || b.includes(filterKey));
      if (!matches && settings.hideOtherWhenFilter) return;
    }
    // render overlay (renderFlightOverlay will itself filter based on progress)
    renderFlightOverlay(f);
  });

  // zoom to filtered items if any
  if (filterKey) {
    const coords = [];
    for (let k in flightLines) {
      const latlngs = flightLines[k].getLatLngs();
      if (latlngs && latlngs.length) {
        coords.push(latlngs[0]);
        coords.push(latlngs[latlngs.length-1]);
      }
    }
    if (coords.length) {
      const bounds = L.latLngBounds(coords);
      map.fitBounds(bounds.pad(0.4));
    }
  }
}

function getFlightIDFromURL() {
  const p = new URLSearchParams(location.search);
  if (!p.has("flights_map")) return "ALL";
  const v = p.get("flights_map");
  if (!v || v === "0") return "ALL";
  return v;
}

// ================== 数据加载 ==================
async function loadData() {
  try {
    let res = await fetch(AIRPORTS_PATH);
    airportDB = await res.json();
    if (Array.isArray(airportDB)) {
      const tmp = {}; airportDB.forEach(a=> { const code = a.code || (a.name && a.name.slice(0,3).toUpperCase()); if (code) tmp[code]=a; });
      airportDB = tmp;
    }
  } catch(e) { console.error("加载 airports.json 错误", e); airportDB = {}; }

  try {
    const txt = await fetch(FLIGHT_DATA_PATH).then(r => r.text());
    flights = parseFlightData(txt);
  } catch(e) { console.error("加载 flight_data.txt 错误", e); flights = []; }

  renderAll();
}

// ================== UI & 设置 控制 ==================
function initUI() {
  // search
  const input = document.getElementById("searchInput");
  const btn = document.getElementById("searchBtn");
  const clear = document.getElementById("clearBtn");
  btn.onclick = ()=> { const v = (input.value||"").trim(); if (!v) { history.replaceState(null,"",location.pathname); renderAll(); } else { const p=new URLSearchParams(location.search); p.set("flights_map", v); history.replaceState(null,"",location.pathname + "?" + p.toString()); renderAll(); } };
  input.addEventListener("keydown", (e)=> { if (e.key === "Enter") btn.click(); });
  clear.onclick = ()=> { input.value=''; history.replaceState(null,"",location.pathname); renderAll(); };

  // settings panel open/close
  const settingsBtn = document.getElementById("settingsBtn");
  const panel = document.getElementById("settingsPanel");
  settingsBtn.onclick = ()=> panel.classList.toggle("hidden");

  // initialize switches & inputs
  const swName = document.getElementById("sw_showAirportName");
  const swCode = document.getElementById("sw_showAirportCode");
  const swFlightNo = document.getElementById("sw_showFlightNo");
  const swHideOther = document.getElementById("sw_hideOtherWhenFilter");
  const inputRefresh = document.getElementById("input_refreshInterval");

  swName.checked = settings.showAirportName;
  swCode.checked = settings.showAirportCode;
  swFlightNo.checked = settings.showFlightNo;
  swHideOther.checked = settings.hideOtherWhenFilter;
  inputRefresh.value = refreshIntervalSec;

  // change handlers: immediate save & apply
  swName.onchange = ()=> { settings.showAirportName = swName.checked; localStorage.setItem("showAirportName", JSON.stringify(settings.showAirportName)); renderAllAirports(); };
  swCode.onchange = ()=> { settings.showAirportCode = swCode.checked; localStorage.setItem("showAirportCode", JSON.stringify(settings.showAirportCode)); renderAllAirports(); };
  swFlightNo.onchange = ()=> { settings.showFlightNo = swFlightNo.checked; localStorage.setItem("showFlightNo", JSON.stringify(settings.showFlightNo)); renderAll(); };
  swHideOther.onchange = ()=> { settings.hideOtherWhenFilter = swHideOther.checked; localStorage.setItem("hideOtherWhenFilter", JSON.stringify(settings.hideOtherWhenFilter)); renderAll(); };
  inputRefresh.onchange = ()=> { refreshIntervalSec = Number(inputRefresh.value) || 180; localStorage.setItem("refreshIntervalSec", String(refreshIntervalSec)); restartAutoRefresh(); };

  // close infoCard when clicking map
  map.on("click", ()=> document.getElementById("infoCard").classList.add("hidden"));
}

// ================== 高亮重置工具 ==================
function resetHighlight() {
  if (highlightedKey && flightLines[highlightedKey]) {
    flightLines[highlightedKey].setStyle({ color:"orange", dashArray:"6 6", weight:2 });
    highlightedKey = null;
  }
}

// ================== 自动刷新 ==================
let refreshTimer = null;
function restartAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(()=> {
    loadData();
  }, refreshIntervalSec*1000);
}

// ================== 启动入口 ==================
(async function main(){
  // load persisted settings
  settings.showAirportName = JSON.parse(localStorage.getItem("showAirportName") || "true");
  settings.showAirportCode = JSON.parse(localStorage.getItem("showAirportCode") || "true");
  settings.showFlightNo = JSON.parse(localStorage.getItem("showFlightNo") || "false");
  settings.hideOtherWhenFilter = JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false");
  refreshIntervalSec = Number(localStorage.getItem("refreshIntervalSec") || 180);

  initUI();
  await loadData();
  restartAutoRefresh();

  // also rerender in-place progress every 30s without re-fetch to keep plane moving
  setInterval(()=> {
    // update positions/lines without reloading file
    renderAll();
  }, 30000);
})();
