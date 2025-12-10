// ================== 全局配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";

// 自动刷新间隔（秒） — 可在设置中更改并保存
let refreshIntervalSec = Number(localStorage.getItem("refreshIntervalSec") || 180);

// 本地状态（从设置读取 / 保存）
let settings = {
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"), 
};

// 地图与图层
const map = L.map('map', { worldCopyJump: true, minZoom: 0.1 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 14 }).addTo(map);//7

let airportDB = {};
let flights = [];
let airportMarkers = {};
let flightMarkers = {};
let flightLines = {};
let highlightedKey = null; 

const PLANE_IMG = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png"; // 机头向上（北）

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

// 返回北京时的 Date 对象
function beijingNowDate() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset()*60000;
  const bj = new Date(utc + 8*3600*1000);
  return bj;
}

// 返回北京基准当天的午夜（00:00）
function beijingTodayMidnight() {
  const bj = beijingNowDate();
  const mid = new Date(bj.getTime());
  mid.setHours(0,0,0,0);
  return mid;
}

// 计算以“北京时”为基准的当前分钟（自 epoch）
function nowBeijingTotalMinutes() {
  const bj = beijingNowDate();
  return Math.floor(bj.getTime() / 60000);
}

// 格式化日期
function formatDateOffset(offsetDays) {
  const base = beijingTodayMidnight();
  base.setDate(base.getDate() + Number(offsetDays||0));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth()+1).padStart(2,'0');
  const dd = String(base.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

// 计算方位角
function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = d => d*Math.PI/180;
  const toDeg = r => r*180/Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2-λ1)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
  let θ = toDeg(Math.atan2(y,x)); 
  θ = (θ + 360 + 90) % 360; // 修正图片方向
  return θ;
}

// ============== 解析 flight_data.txt ==============
function parseFlightData(raw) {
  const entries = [];
  const parts = raw.split("《航班结束》");
  for (let block of parts) {
    block = block.trim();
    if (!block) continue;

    const getVal = (reg) => { const m = block.match(reg); return m ? m[1].trim() : ""; };

    const flightNo = getVal(/【\s*([^\]　]+)\s*】/);
    const planeType = getVal(/〔\s*([^\]　]+)\s*〕/);
    const airline = getVal(/『\s*([^』]+)\s*』/);
    const reg = getVal(/<\s*([^>]+)\s*>/);

    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const depName = depMatch ? depMatch[1].trim() : "";
    const depTimeRaw = depMatch ? depMatch[2].trim() : "";
    const depOffsetRaw = depMatch && depMatch[3] ? depMatch[3].replace(/[^\d]/g,"") : "0";

    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const arrName = arrMatch ? arrMatch[1].trim() : "";
    const arrTimeRaw = arrMatch ? arrMatch[2].trim() : "";
    const arrOffsetRaw = arrMatch && arrMatch[3] ? arrMatch[3].replace(/[^\d]/g,"") : "0";

    entries.push({
      flightNo, planeType, airline,
      dep: depName, depTimeRaw, depOffset: Number(depOffsetRaw||0),
      arr: arrName, arrTimeRaw, arrOffset: Number(arrOffsetRaw||0),
      reg, raw: block
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
    const nm = (a.name || "").toLowerCase();
    const city = (a.city || "").toLowerCase();
    const aliases = (a.aliases || []).map(x=>x.toLowerCase());
    if (nm === key || city === key || aliases.includes(key)) return a;
    if (nm.includes(key) || city.includes(key)) return a;
    if ((a.code||"").toLowerCase() === key) return a;
  }
  for (let code in airportDB) {
    const a = airportDB[code];
    if ((a.name||"").toLowerCase().includes(key)) return a;
    if ((a.city||"").toLowerCase().includes(key)) return a;
    if ((a.aliases||[]).some(x=>x.toLowerCase().includes(key))) return a;
  }
  return null;
}

// ============== 渲染机场 ==============
function renderAllAirports() {
  for (let code in airportDB) {
    const ap = airportDB[code];
    const lat = ap.lat || ap.latitude;
    const lng = ap.lon || ap.lng || ap.longitude;
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

// ============== 核心计算与渲染 ==============

function computeProgress(flight) {
  const depMin = timeStrToMinutes(flight.depTimeRaw);
  const arrMin = timeStrToMinutes(flight.arrTimeRaw);
  if (depMin === null || arrMin === null) return null;

  const baseMid = beijingTodayMidnight().getTime() / 60000;
  const depTotal = baseMid + depMin + (flight.depOffset||0)*24*60;
  const arrTotal = baseMid + arrMin + (flight.arrOffset||0)*24*60;

  if (arrTotal === depTotal) return null;

  const nowTotal = nowBeijingTotalMinutes();
  const frac = (nowTotal - depTotal) / (arrTotal - depTotal);
  return frac;
}

function keyForFlight(flight) {
  if (flight.reg) return flight.reg.trim();
  return (flight.flightNo || "") + "|" + (flight.depTimeRaw || "") + "|" + (flight.arrTimeRaw || "");
}

// 强制移除函数（你要求的外部挂载删除程序）
function forceRemoveFlight(idKey) {
    if (flightLines[idKey]) {
        try { map.removeLayer(flightLines[idKey]); } catch(e){}
        delete flightLines[idKey];
    }
    if (flightMarkers[idKey]) {
        try { map.removeLayer(flightMarkers[idKey]); } catch(e){}
        delete flightMarkers[idKey];
    }
    if (highlightedKey === idKey) {
        highlightedKey = null;
    }
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

// 渲染单个航班（已打补丁）
function renderFlight(flight, options={forceShow:false}) {
  const depA = airportByName(flight.dep);
  const arrA = airportByName(flight.arr);
  const idKey = keyForFlight(flight);

  // 1. 基础数据校验，不全直接删
  if (!depA || !arrA || !depA.lat || !arrA.lat) {
    forceRemoveFlight(idKey);
    return;
  }

  // 计算进度
  const prog = computeProgress(flight);

  // =========================================================
  // 【强制删除补丁】(Forced Deletion Patch)
  // 这是你要求的“外挂”逻辑：直接判断是否在天上。
  // 逻辑：只要进度 <= 0.001 (还没飞) 或者 >= 0.999 (飞到了)，直接杀掉图层并退出。
  // 无论 options.forceShow 是什么，只要不在天上，就不显示。
  // =========================================================
  if (prog === null || prog <= 0.001 || prog >= 0.999) {
      forceRemoveFlight(idKey);
      return; // 直接终止，不再往下执行
  }
  // =========================================================

  const depLat = depA.lat || depA.latitude;
  const depLng = depA.lon || depA.lng || depA.longitude;
  const arrLat = arrA.lat || arrA.latitude;
  const arrLng = arrA.lon || arrA.lng || arrA.longitude;

  // 绘制/更新航线
  if (!flightLines[idKey]) {
    const line = L.polyline([[depLat,depLng],[arrLat,arrLng]], { color: "var(--orange)", weight: 2, dashArray: "6 6" }).addTo(map);
    line.on("click", ()=> onFlightClicked(idKey, flight));
    flightLines[idKey] = line;
  } else {
    flightLines[idKey].setLatLngs([[depLat,depLng],[arrLat,arrLng]]);
    if (highlightedKey !== idKey) {
        flightLines[idKey].setStyle({ color: "var(--orange)", dashArray: "6 6", weight: 2 });
    }
  }

  // 绘制/更新飞机图标
  if (settings.showPlaneIcon) {
    const angle = bearingBetween(depLat,depLng,arrLat,arrLng);
    // 限制 prog 范围防止计算溢出
    const safeProg = Math.max(0, Math.min(1, prog));
    const curLat = depLat + (arrLat - depLat) * safeProg;
    const curLng = depLng + (arrLng - depLng) * safeProg;
    
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
    // 如果设置关闭了图标，但图层还存在，删掉图标
    if (flightMarkers[idKey]) {
      try { map.removeLayer(flightMarkers[idKey]); } catch(e){}
      delete flightMarkers[idKey];
    }
  }
}

// ============== 清理飞行层 ==============
function clearFlightLayers() {
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

// ============== 信息卡片 ==============
function showInfoCard(f, depA, arrA) {
  const card = document.getElementById("infoCard");
  const prog = computeProgress(f);
  const percent = (prog === null) ? "-" : Math.round(Math.max(0, Math.min(1, prog))*100);

  const depDateStr = formatDateOffset(f.depOffset || 0);
  const arrDateStr = formatDateOffset(f.arrOffset || 0);

  let prevHtml = "", nextHtml = "";
  if (f.reg) {
    const same = flights.filter(x => x.reg && x.reg.toLowerCase() === f.reg.toLowerCase());
    same.sort((a,b) => {
      const am = (timeStrToMinutes(a.depTimeRaw) === null) ? 1e9 : timeStrToMinutes(a.depTimeRaw) + (a.depOffset||0)*24*60;
      const bm = (timeStrToMinutes(b.depTimeRaw) === null) ? 1e9 : timeStrToMinutes(b.depTimeRaw) + (b.depOffset||0)*24*60;
      return am - bm;
    });
    const idx = same.findIndex(x => x.raw === f.raw);
    if (idx > 0) prevHtml = `<button id="cardPrev" class="btn ghost">上一行程</button>`;
    if (idx >= 0 && idx < same.length - 1) nextHtml = `<button id="cardNext" class="btn ghost">下一行程</button>`;
  }

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div style="flex:1">
        <h3 style="margin:0">${f.flightNo || "-"}</h3>
        <div style="font-size:12px;color:rgba(0,0,0,0.6);margin-top:4px">${f.airline||""} · ${f.planeType||""}</div>
        <div style="margin-top:8px;font-size:13px"><b>注册号：</b> ${f.reg?f.reg:'—'}</div>
      </div>

      <div style="text-align:right;font-size:12px;min-width:140px">
        <div style="font-weight:700">${depA?depA.name||depA.code:''} → ${arrA?arrA.name||arrA.code:''}</div>
        <div style="font-size:12px;color:rgba(0,0,0,0.6)">${f.depTimeRaw||''} <div style="font-size:11px;color:rgba(0,0,0,0.45)">${depDateStr}</div></div>
        <div style="font-size:12px;color:rgba(0,0,0,0.6);margin-top:6px">${f.arrTimeRaw||''} <div style="font-size:11px;color:rgba(0,0,0,0.45)">${arrDateStr}</div></div>
      </div>
    </div>

    <div style="margin-top:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px">
        <div>进度</div>
        <div>${percent === "-" ? "-" : percent + "%"}</div>
      </div>
      <div class="progressWrap"><div class="progressBar" style="width:${percent==="-"?0:percent}%"></div></div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      ${prevHtml}
      ${nextHtml}
      <button id="cardClose" class="btn primary">关闭</button>
    </div>
  `;
  card.classList.remove("hidden");

  document.getElementById("cardClose").onclick = ()=> card.classList.add("hidden");

  if (document.getElementById("cardPrev")) {
    document.getElementById("cardPrev").onclick = () => {
      const same = flights.filter(x => x.reg && x.reg.toLowerCase() === f.reg.toLowerCase());
      same.sort((a,b)=> (timeStrToMinutes(a.depTimeRaw)||0) + (a.depOffset||0)*24*60 - ( (timeStrToMinutes(b.depTimeRaw)||0) + (b.depOffset||0)*24*60) );
      const idx = same.findIndex(x => x.raw === f.raw);
      if (idx > 0) onFlightClicked(keyForFlight(same[idx-1]), same[idx-1]);
    };
  }
  if (document.getElementById("cardNext")) {
    document.getElementById("cardNext").onclick = () => {
      const same = flights.filter(x => x.reg && x.reg.toLowerCase() === f.reg.toLowerCase());
      same.sort((a,b)=> (timeStrToMinutes(a.depTimeRaw)||0) + (a.depOffset||0)*24*60 - ( (timeStrToMinutes(b.depTimeRaw)||0) + (b.depOffset||0)*24*60) );
      const idx = same.findIndex(x => x.raw === f.raw);
      if (idx >= 0 && idx < same.length-1) onFlightClicked(keyForFlight(same[idx+1]), same[idx+1]);
    };
  }
}

function showAirportCard(ap) {
  const card = document.getElementById("infoCard");
  const aliases = (ap.aliases && ap.aliases.length) ? `<p><b>别名：</b>${ap.aliases.join(' / ')}</p>` : '';
  card.innerHTML = `
    <h3 style="margin:0">${ap.name || ""} (${ap.code || ""})</h3>
    ${aliases}
    ${ap.level?`<p><b>机场等级：</b>${ap.level}</p>` : ''}
    ${ap.runways?`<p><b>跑道数量：</b>${ap.runways}</p>` : ''}
    <div style="display:flex;justify-content:flex-end;margin-top:8px"><button id="cardClose" class="btn primary">关闭</button></div>
  `;
  card.classList.remove("hidden");
  document.getElementById("cardClose").onclick = ()=> card.classList.add("hidden");
}

// ============== 渲染主流程 ==============
function renderFlights() {
  // 注意：这里我们不再暴力清空所有（clearFlightLayers），而是依赖 renderFlight 内部的更新或删除逻辑
  // 但为了保险，初次加载或切换过滤时，还是清理一下比较稳妥
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
    
    // 这里即使 forceShow 为 true，renderFlight 内部的强制删除补丁也会生效
    // 如果不在天上，forceShow 也没用，直接会被删除
    const forceShow = matchesFilter; 
    renderFlight(f, { forceShow });
  });

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

// ============== 数据加载 ==============
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

// ============== UI init ==============
function initUI() {
  const topToggle = document.getElementById("toggleFlightNo");
  if (topToggle) {
    topToggle.checked = settings.showFlightNo;
    topToggle.addEventListener("change", ()=>{
      settings.showFlightNo = topToggle.checked;
      localStorage.setItem("showFlightNo", JSON.stringify(settings.showFlightNo));
      renderFlights();
      const panelSw = document.getElementById("sw_showFlightNo");
      if (panelSw) panelSw.checked = settings.showFlightNo;
    });
  }

  const input = document.getElementById("searchInput");
  const btn = document.getElementById("searchBtn");
  const clear = document.getElementById("clearBtn");
  if (input && btn) btn.addEventListener("click", ()=> performSearch(input.value));
  if (input) input.addEventListener("keydown", (e)=> { if (e.key === "Enter") performSearch(input.value); });
  if (clear) clear.addEventListener("click", ()=> { input.value=''; history.replaceState(null,"",location.pathname); renderFlights(); });

  const settingsBtn = document.getElementById("settingsBtn");
  const panel = document.getElementById("settingsPanel");
  if (settingsBtn && panel) settingsBtn.addEventListener("click", ()=> panel.classList.toggle("hidden"));

  const settingsClose = document.getElementById("settingsClose");
  if (settingsClose && panel) document.getElementById("settingsClose").addEventListener("click", ()=> panel.classList.add("hidden"));

  const swName = document.getElementById("sw_showAirportName");
  const swCode = document.getElementById("sw_showAirportCode");
  const swFlight = document.getElementById("sw_showFlightNo");
  const swPlaneIcon = document.getElementById("sw_showPlaneIcon");
  const swHide = document.getElementById("sw_hideOtherWhenFilter");
  const inputRefresh = document.getElementById("input_refreshInterval");

  if (swName) swName.checked = settings.showAirportName;
  if (swCode) swCode.checked = settings.showAirportCode;
  if (swFlight) swFlight.checked = settings.showFlightNo;
  if (swPlaneIcon) swPlaneIcon.checked = settings.showPlaneIcon;
  if (swHide) swHide.checked = settings.hideOtherWhenFilter;
  if (inputRefresh) inputRefresh.value = refreshIntervalSec;

  if (swName) swName.onchange = () => { settings.showAirportName = swName.checked; localStorage.setItem("showAirportName", JSON.stringify(settings.showAirportName)); renderAllAirports(); };
  if (swCode) swCode.onchange = () => { settings.showAirportCode = swCode.checked; localStorage.setItem("showAirportCode", JSON.stringify(settings.showAirportCode)); renderAllAirports(); };
  if (swFlight) swFlight.onchange = () => { settings.showFlightNo = swFlight.checked; localStorage.setItem("showFlightNo", JSON.stringify(settings.showFlightNo)); const topToggle = document.getElementById("toggleFlightNo"); if (topToggle) topToggle.checked = settings.showFlightNo; renderFlights(); };
  if (swPlaneIcon) swPlaneIcon.onchange = () => { settings.showPlaneIcon = swPlaneIcon.checked; localStorage.setItem("showPlaneIcon", JSON.stringify(settings.showPlaneIcon)); renderFlights(); };
  if (swHide) swHide.onchange = () => { settings.hideOtherWhenFilter = swHide.checked; localStorage.setItem("hideOtherWhenFilter", JSON.stringify(settings.hideOtherWhenFilter)); renderFlights(); };
  if (inputRefresh) inputRefresh.onchange = () => { refreshIntervalSec = Number(inputRefresh.value) || 180; localStorage.setItem("refreshIntervalSec", String(refreshIntervalSec)); restartAutoRefresh(); };

  map.on("click", ()=> {
    const card = document.getElementById("infoCard");
    if (card) card.classList.add("hidden");
  });
}

function performSearch(q) {
  q = (q||"").trim();
  if (!q) {
    history.replaceState(null, "", location.pathname);
    renderFlights();
    return;
  }
  const p = new URLSearchParams(location.search);
  p.set("flights_map", q);
  history.replaceState(null, "", location.pathname + "?" + p.toString());
  renderFlights();
}

let refreshTimer = null;
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(()=> { loadData(); }, refreshIntervalSec*1000);
}
function restartAutoRefresh() { startAutoRefresh(); }

(async function main(){
  settings.showAirportName = JSON.parse(localStorage.getItem("showAirportName") || "true");
  settings.showAirportCode = JSON.parse(localStorage.getItem("showAirportCode") || "true");
  settings.showFlightNo = JSON.parse(localStorage.getItem("showFlightNo") || "false");
  settings.hideOtherWhenFilter = JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false");
  settings.showPlaneIcon = JSON.parse(localStorage.getItem("showPlaneIcon") || "true");
  refreshIntervalSec = Number(localStorage.getItem("refreshIntervalSec") || 180);

  initUI();
  await loadData();
  startAutoRefresh();
  setInterval(()=> { renderFlights(); }, 30000); 
})();















// ================== 全局配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png";

let refreshIntervalSec = 180;
let settings = {
  showAirportName: true,
  showAirportCode: true,
  showFlightNo: false,
  hideOtherWhenFilter: false,
};

// 初始化地图 (去除默认控件，追求极简)
const map = L.map('map', { 
  zoomControl: false, 
  attributionControl: false,
  worldCopyJump: true,
  minZoom: 2
}).setView([35, 105], 4);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  className: 'map-tiles' // 可以后续加CSS滤镜变暗适应夜间模式
}).addTo(map);

// 数据存储
let airportDB = {}; // key: code, value: object
let flights = [];
let airportMarkers = []; // 存对象 {marker, level, code, lat, lng} 以便手动控制
let flightLayers = {};   // key: flightId, val: {line, plane}

// ================== 智能机场显示逻辑 (Smart LOD) ==================

// 机场等级映射 (假设数据里有 level, 没有则按跑道数或随机模拟)
function getAirportWeight(ap) {
  if (ap.level === "4F") return 100;
  if (ap.level === "4E") return 80;
  if (ap.level === "4D") return 60;
  if (ap.level === "4C") return 40;
  // 如果没有等级数据，用名字长度反向或者跑道数量做权重
  if (ap.runways) return 50 + ap.runways * 10;
  return 20; 
}

function updateAirportVisibility() {
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  
  // 1. 筛选在当前视野内的机场
  const visibleCandidates = airportMarkers.filter(item => bounds.contains(item.latlng));
  
  // 2. 按权重排序 (重要的先处理)
  visibleCandidates.sort((a, b) => b.weight - a.weight);
  
  const accepted = []; // 已经决定显示的机场
  const minPxDist = 40; // 两个图标之间最小像素距离 (防止重叠)

  visibleCandidates.forEach(item => {
    // 基础缩放过滤：太小的机场在小比例尺下直接不看
    if (zoom < 5 && item.weight < 80) { item.marker.remove(); return; }
    if (zoom < 7 && item.weight < 50) { item.marker.remove(); return; }

    // 碰撞检测
    const point = map.latLngToLayerPoint(item.latlng);
    let collision = false;
    
    for (let other of accepted) {
      const otherPoint = map.latLngToLayerPoint(other.latlng);
      const dist = point.distanceTo(otherPoint);
      if (dist < minPxDist) {
        collision = true;
        break;
      }
    }

    if (!collision) {
      item.marker.addTo(map);
      accepted.push(item);
      
      // 控制文字显示 (缩放够大才显示名字，否则只显示圆点)
      const el = item.marker.getElement();
      if (el) {
        const label = el.querySelector('.airport-label');
        if (label) {
            // 如果 zoom 很大或者这是个超级大机场，则显示名字
            label.style.opacity = (zoom >= 6 || item.weight >= 90) ? "1" : "0";
            // 根据设置隐藏
            if(!settings.showAirportName && !settings.showAirportCode) label.style.display = 'none';
            else label.style.display = 'flex';
        }
      }
    } else {
      item.marker.remove();
    }
  });
}

function renderAllAirports() {
    // 清除旧的
    airportMarkers.forEach(i => i.marker.remove());
    airportMarkers = [];

    for (let code in airportDB) {
        const ap = airportDB[code];
        if (!ap.lat || !ap.lon) continue;
        
        const weight = getAirportWeight(ap);
        
        const html = `
          <div class="airport-marker-ios">
            <div class="dot" style="width:${weight>=80?12:8}px;height:${weight>=80?12:8}px;"></div>
            <div class="airport-label">
              <span class="name" style="display:${settings.showAirportName?'block':'none'}">${ap.name||''}</span>
            </div>
          </div>
        `;
        
        const icon = L.divIcon({
            className: 'airport-div-wrapper',
            html: html,
            iconSize: [20, 20],
            iconAnchor: [10, 10] // Center
        });

        const marker = L.marker([ap.lat, ap.lon], {icon});
        marker.on('click', () => showFlightCard(null, ap)); // 点击显示机场信息

        airportMarkers.push({
            marker: marker,
            latlng: L.latLng(ap.lat, ap.lon),
            weight: weight,
            data: ap
        });
    }
    updateAirportVisibility();
}

// 监听移动和缩放来更新机场聚合
map.on('zoomend moveend', updateAirportVisibility);

// ================== 航班逻辑 ==================

// ... (这里保留原有的计算 progress, parsing 逻辑，为了节省篇幅，假设 computeProgress, timeStrToMinutes 等工具函数已存在) ...
// 这里直接复用你原有代码的工具函数部分
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
function computeProgress(flight) {
    const depMin = timeStrToMinutes(flight.depTimeRaw);
    const arrMin = timeStrToMinutes(flight.arrTimeRaw);
    if (depMin === null || arrMin === null) return null;
    
    // 简单模拟跨天
    let duration = arrMin - depMin + (flight.arrOffset - flight.depOffset) * 24 * 60;
    if (duration < 0) duration += 24*60; 

    const now = beijingNowDate();
    const nowMin = now.getHours()*60 + now.getMinutes();
    
    // 注意：这里需要更严谨的绝对时间计算，为演示效果简化逻辑
    // 假设 flight.depOffset 是相对于今天的
    // 实际项目中应用 UTC timestamp 对比
    
    // 简化版逻辑：只演示UI，假设 flight 是当天的
    const elapsed = nowMin - depMin;
    let prog = elapsed / duration;
    
    // 补丁：不在天上
    if (prog < 0 || prog > 1) return null;
    return prog;
}

// 渲染单个航班
function renderFlight(flight) {
    const depA = airportDB[flight.depCode] || Object.values(airportDB).find(a=>a.name===flight.dep);
    const arrA = airportDB[flight.arrCode] || Object.values(airportDB).find(a=>a.name===flight.arr);
    
    if (!depA || !arrA) return;

    const prog = computeProgress(flight);
    if (prog === null) return; // 不在天上

    const id = flight.flightNo + flight.depTimeRaw;
    const lat1 = depA.lat, lng1 = depA.lon;
    const lat2 = arrA.lat, lng2 = arrA.lon;

    // 当前位置
    const curLat = lat1 + (lat2 - lat1) * prog;
    const curLng = lng1 + (lng2 - lng1) * prog;
    
    // 角度
    const angle = Math.atan2(lng2-lng1, lat2-lat1) * 180 / Math.PI;

    // 绘制线
    if (!flightLayers[id]) {
        const line = L.polyline([[lat1, lng1], [lat2, lng2]], {
            color: 'var(--orange)', 
            weight: 2, 
            dashArray: '5, 10',
            opacity: 0.6
        }).addTo(map);

        const iconHtml = `<div style="transform: rotate(${angle}deg); transition: all 1s linear;">
            <img src="${PLANE_IMG}" style="width:24px;height:24px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));" />
        </div>`;
        const icon = L.divIcon({ html: iconHtml, className: '', iconSize:[24,24], iconAnchor:[12,12] });
        
        const marker = L.marker([curLat, curLng], {icon}).addTo(map);
        
        marker.on('click', () => showFlightCard(flight, null));
        line.on('click', () => showFlightCard(flight, null));

        flightLayers[id] = { line, marker, data: flight };
    } else {
        // 更新位置
        flightLayers[id].marker.setLatLng([curLat, curLng]);
    }
}

function renderFlights() {
    // 简单循环，实际建议加 diff 更新
    flights.forEach(f => renderFlight(f));
}

// ================== UI 交互逻辑 ==================

function showFlightCard(flight, airport) {
    const card = document.getElementById('infoCard');
    const content = document.getElementById('cardContent');
    const btnFocus = document.getElementById('btnFocusMode');
    
    card.classList.remove('hidden');
    
    if (flight) {
        const depCode = flight.depCode || "DEP";
        const arrCode = flight.arrCode || "ARR";
        const prog = Math.floor((computeProgress(flight)||0)*100);
        
        content.innerHTML = `
            <div style="font-weight:600; font-size:18px; margin-bottom:12px;">${flight.flightNo}</div>
            <div class="flight-info-grid">
                <div>
                    <div class="ap-code">${depCode}</div>
                    <div class="ap-time">${flight.depTimeRaw}</div>
                </div>
                <div class="flight-arrow">✈</div>
                <div>
                    <div class="ap-code">${arrCode}</div>
                    <div class="ap-time">${flight.arrTimeRaw}</div>
                </div>
            </div>
            <div class="progress-container">
                <div class="progress-labels">
                    <span>已飞行 ${prog}%</span>
                    <span>${flight.planeType||''}</span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${prog}%"></div>
                </div>
            </div>
        `;
        btnFocus.style.display = 'flex';
        btnFocus.onclick = () => enterFocusMode(flight);
    } else if (airport) {
        content.innerHTML = `
           <div style="font-weight:700; font-size:22px;">${airport.name}</div>
           <div style="color:gray; margin-bottom:10px;">${airport.code}</div>
           <div>${airport.city || ''}</div>
           ${airport.runways ? `<div>跑道数: ${airport.runways}</div>` : ''}
        `;
        btnFocus.style.display = 'none';
    }
}

document.getElementById('cardClose').onclick = () => {
    document.getElementById('infoCard').classList.add('hidden');
};

document.getElementById('settingsBtn').onclick = () => {
    const panel = document.getElementById('settingsPanel');
    panel.classList.toggle('hidden');
};
document.getElementById('settingsClose').onclick = () => {
    document.getElementById('settingsPanel').classList.add('hidden');
};

// ================== 专注模式 (Focus Mode) ==================

let focusTimer = null;

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // 英里 radius
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
              Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)*Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function enterFocusMode(flight) {
    const overlay = document.getElementById('focusOverlay');
    const audio = document.getElementById('cabinAudio');
    
    overlay.classList.remove('hidden');
    // 播放白噪音
    audio.play().catch(e=>console.log("Audio autoplay blocked needed interaction"));

    const depA = airportDB[flight.depCode] || Object.values(airportDB).find(a=>a.name===flight.dep);
    const arrA = airportDB[flight.arrCode] || Object.values(airportDB).find(a=>a.name===flight.arr);

    // 启动即时刷新
    if (focusTimer) clearInterval(focusTimer);
    
    const updateStats = () => {
        const prog = computeProgress(flight);
        if (prog === null || prog >= 1) {
            document.getElementById('focusTime').innerText = "Arrived";
            document.getElementById('focusDist').innerText = "0";
            return;
        }

        // 计算剩余
        const totalDist = calculateDistance(depA.lat, depA.lon, arrA.lat, arrA.lon);
        const remainDist = Math.floor(totalDist * (1 - prog));
        
        // 计算剩余时间 (粗略估计)
        const arrMin = timeStrToMinutes(flight.arrTimeRaw);
        const nowMin = beijingNowDate().getHours()*60 + beijingNowDate().getMinutes();
        let remainMin = arrMin - nowMin;
        if (remainMin < 0) remainMin += 24*60; // 跨天

        document.getElementById('focusTime').innerHTML = `${remainMin} <span class="unit">min</span>`;
        document.getElementById('focusDist').innerHTML = `${remainDist} <span class="unit">mi</span>`;
    };

    updateStats();
    focusTimer = setInterval(updateStats, 1000); // 每秒刷新倒计时
}

document.getElementById('exitFocus').onclick = () => {
    document.getElementById('focusOverlay').classList.add('hidden');
    document.getElementById('cabinAudio').pause();
    if (focusTimer) clearInterval(focusTimer);
};

// ================== 数据加载 (模拟) ==================

async function init() {
    // 加载机场
    try {
        const res = await fetch(AIRPORTS_PATH);
        const data = await res.json();
        // 转换格式
        if (Array.isArray(data)) {
            data.forEach(a => {
                const c = a.code || a.iata || "UNK";
                airportDB[c] = a;
            });
        } else {
            airportDB = data;
        }
        renderSmartAirports(); // 使用新的智能渲染
    } catch(e) { console.error(e); }

    // 加载航班 (解析txt逻辑同前，这里简写)
    try {
        const txt = await fetch(FLIGHT_DATA_PATH).then(r=>r.text());
        // ... (你需要把之前的 parseFlightData 函数放回来) ...
        // flights = parseFlightData(txt);
        // 这里模拟一个数据方便测试：
        flights = [{
            flightNo: "MU5183",
            dep: "北京大兴", depCode: "PKX", depTimeRaw: "08:00", depOffset: 0,
            arr: "上海虹桥", arrCode: "SHA", arrTimeRaw: "23:55", arrOffset: 0, // 故意设晚点方便测试
            planeType: "A350-900"
        }];
        renderFlights();
    } catch(e){}
}

init();
