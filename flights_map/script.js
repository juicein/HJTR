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
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"), // 新增：飞机图标开关
};

// 地图与图层
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 }).addTo(map);

let airportDB = {};
let flights = [];
let airportMarkers = {};
let flightMarkers = {};
let flightLines = {};
let highlightedKey = null; // track highlighted flight

const PLANE_IMG = "https://i.imgur.com/4bZtV3y.png"; // 你确认的图片：机头向上（北）

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

// 返回北京时的 Date 对象（当前时刻）
function beijingNowDate() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset()*60000;
  const bj = new Date(utc + 8*3600*1000);
  return bj;
}

// 返回北京基准当天的午夜（00:00）Date对象
function beijingTodayMidnight() {
  const bj = beijingNowDate();
  const mid = new Date(bj.getTime());
  mid.setHours(0,0,0,0);
  return mid;
}

// 计算以“北京时”为基准的当前分钟（自 epoch），返回整数分钟
function nowBeijingTotalMinutes() {
  const bj = beijingNowDate();
  return Math.floor(bj.getTime() / 60000);
}

// compute formatted date string for given offset days (relative to Beijing today)
function formatDateOffset(offsetDays) {
  const base = beijingTodayMidnight();
  base.setDate(base.getDate() + Number(offsetDays||0));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth()+1).padStart(2,'0');
  const dd = String(base.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

// 计算两个经纬之间的方位角（度），并调整使机头朝向目的地（图标机头向上）
function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = d => d*Math.PI/180;
  const toDeg = r => r*180/Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2-λ1)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
  let θ = toDeg(Math.atan2(y,x)); // 0 = east
  // For an image that points UP (north), we need to rotate so that:
  // east -> rotate 90deg, so add 90. Keep previous behavior (works for up-pointing images).
  θ = (θ + 360 + 90) % 360;
  return θ;
}

// ============== 解析 flight_data.txt（兼容） ==============
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

    // 注册号 anywhere
    const regMatch = block.match(/<\s*([^>]+)\s*>/);
    const reg = regMatch ? regMatch[1].trim() : "";

    const priceEconMatch = block.match(/§([^§]+)§/);
    const priceEconomy = priceEconMatch ? priceEconMatch[1].trim() : "";
    const priceBizMatch = block.match(/θ([^θ]+)θ/);
    const priceBiz = priceBizMatch ? priceBizMatch[1].trim() : "";
    const priceOtherMatch = block.match(/△([^△]+)△/);
    const priceOther = priceOtherMatch ? priceOtherMatch[1].trim() : "";

    const depTerminalMatch = block.match(/《[^》]+出发》\{[^}]+\}.*?@T([^@\s　]+)/i);
    const depTerminal = depTerminalMatch ? depTerminalMatch[1].trim() : "";
    const arrTerminalMatch = block.match(/《[^》]+到达》\{[^}]+\}.*?@T([^@\s　]+)/i);
    const arrTerminal = arrTerminalMatch ? arrTerminalMatch[1].trim() : "";

    entries.push({
      flightNo,
      planeType,
      airline,
      dep: depName,
      depTimeRaw,
      depOffset: Number(depOffsetRaw||0),
      depTerminal,
      arr: arrName,
      arrTimeRaw,
      arrOffset: Number(arrOffsetRaw||0),
      arrTerminal,
      reg,
      priceEconomy,
      priceBiz,
      priceOther,
      raw: block
    });
  }
  return entries;
}

// ============== 机场查找（支持 aliases） ==============
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

// ============== 渲染机场（同心圆 + 横向 label + 分开开关） ==============
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

    // html: same-line layout, gap enforced by CSS
    // include aliases as title attribute (hover) and in popup/card
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

    // initial visibility
    const el = marker.getElement();
    if (el) {
      const nameEl = el.querySelector(".airport-name");
      const codeEl = el.querySelector(".airport-code");
      if (nameEl) nameEl.style.display = settings.showAirportName ? "block" : "none";
      if (codeEl) codeEl.style.display = settings.showAirportCode ? "block" : "none";
    }
  }
}

// ============== 渲染航班（只显示 0<progress<1 的航段，除非 forceShow） ==============

// 计算进度：基于“北京时”的绝对分钟数进行计算，确保跨天/跨日正确
function computeProgress(flight) {
  const depMin = timeStrToMinutes(flight.depTimeRaw);
  const arrMin = timeStrToMinutes(flight.arrTimeRaw);
  if (depMin === null || arrMin === null) return null;

  // 以北京今日午夜为基准，计算 dep 和 arr 的绝对分钟数（相对于 epoch）
  const baseMid = beijingTodayMidnight().getTime() / 60000; // 分钟数
  const depTotal = baseMid + depMin + (flight.depOffset||0)*24*60;
  const arrTotal = baseMid + arrMin + (flight.arrOffset||0)*24*60;

  // 如果起降时间完全相同（或无有效差值），无法计算进度
  if (arrTotal === depTotal) return null;

  const nowTotal = nowBeijingTotalMinutes();

  // 计算进度 frac
  const frac = (nowTotal - depTotal) / (arrTotal - depTotal);
  return frac;
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

// render one flight overlay if progress in (0,1)
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

  // compute progress and skip if <=0 or >=1 (MOD requirement)
  const prog = computeProgress(flight);
  if (prog === null) {
    // remove existing if present
    if (flightLines[idKey]) try { map.removeLayer(flightLines[idKey]); } catch(e){}
    if (flightMarkers[idKey]) try { map.removeLayer(flightMarkers[idKey]); } catch(e){}
    delete flightLines[idKey];
    delete flightMarkers[idKey];
    return;
  }
  // when not forceShow, require 0<prog<1 (strict)
  if (!options.forceShow) {
    if (!(prog > 0 && prog < 1)) {
      // remove existing if present
      if (flightLines[idKey]) try { map.removeLayer(flightLines[idKey]); } catch(e){}
      if (flightMarkers[idKey]) try { map.removeLayer(flightMarkers[idKey]); } catch(e){}
      delete flightLines[idKey];
      delete flightMarkers[idKey];
      return;
    }
  }

  // create or update line
  if (!flightLines[idKey]) {
    const line = L.polyline([[depLat,depLng],[arrLat,arrLng]], { color: "var(--orange)", weight: 2, dashArray: "6 6" }).addTo(map);
    line.on("click", ()=> onFlightClicked(idKey, flight));
    flightLines[idKey] = line;
  } else {
    flightLines[idKey].setLatLngs([[depLat,depLng],[arrLat,arrLng]]);
  }

  // plane marker: only create if showPlaneIcon setting true
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

    // tooltip flight number controlled by setting
    if (settings.showFlightNo) {
      try { flightMarkers[idKey].bindTooltip(flight.flightNo || flight.reg || "", {permanent:true, direction:"right", className:"flight-label"}); } catch(e){}
    } else {
      try { flightMarkers[idKey].unbindTooltip(); } catch(e){}
    }
  } else {
    // if plane icons disabled, ensure any existing markers are removed
    if (flightMarkers[idKey]) {
      try { map.removeLayer(flightMarkers[idKey]); } catch(e){}
      delete flightMarkers[idKey];
    }
    // still optionally show tooltip on line? we keep previous behavior (no tooltip if no marker)
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

// ============== 信息卡片（注册号单独一行 + 日期显示 + 起降机场信息） ==============
function showInfoCard(f, depA, arrA) {
  const card = document.getElementById("infoCard");
  const prog = computeProgress(f);
  const percent = (prog === null) ? "-" : Math.round(Math.max(0, Math.min(1, prog))*100);

  // compute date strings based on offsets
  const depDateStr = formatDateOffset(f.depOffset || 0);
  const arrDateStr = formatDateOffset(f.arrOffset || 0);

  // prev/next only based on registration number
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

// airport card (include aliases)
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

// ============== 渲染主流程（保留你原本 renderFlights 的逻辑） ==============
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
    // If filterKey present, forceShow matched flights even if not in-flight
    const forceShow = matchesFilter;
    renderFlight(f, { forceShow });
  });

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

// ============== UI init（settings switches 即改即存） ==============
function initUI() {
  // topbar toggleFlightNo (small switch)
  const topToggle = document.getElementById("toggleFlightNo");
  topToggle.checked = settings.showFlightNo;
  topToggle.addEventListener("change", ()=>{
    settings.showFlightNo = topToggle.checked;
    localStorage.setItem("showFlightNo", JSON.stringify(settings.showFlightNo));
    renderFlights();
    const panelSw = document.getElementById("sw_showFlightNo");
    if (panelSw) panelSw.checked = settings.showFlightNo;
  });

  // search
  const input = document.getElementById("searchInput");
  const btn = document.getElementById("searchBtn");
  const clear = document.getElementById("clearBtn");
  btn.addEventListener("click", ()=> performSearch(input.value));
  input.addEventListener("keydown", (e)=> { if (e.key === "Enter") performSearch(input.value); });
  clear.addEventListener("click", ()=> { input.value=''; history.replaceState(null,"",location.pathname); renderFlights(); });

  // settings panel toggle
  const settingsBtn = document.getElementById("settingsBtn");
  const panel = document.getElementById("settingsPanel");
  settingsBtn.addEventListener("click", ()=> panel.classList.toggle("hidden"));

  // settings close button
  document.getElementById("settingsClose").addEventListener("click", ()=> panel.classList.add("hidden"));

  // panel elements
  const swName = document.getElementById("sw_showAirportName");
  const swCode = document.getElementById("sw_showAirportCode");
  const swFlight = document.getElementById("sw_showFlightNo");
  const swPlaneIcon = document.getElementById("sw_showPlaneIcon"); // 新增
  const swHide = document.getElementById("sw_hideOtherWhenFilter");
  const inputRefresh = document.getElementById("input_refreshInterval");

  // init values
  swName.checked = settings.showAirportName;
  swCode.checked = settings.showAirportCode;
  swFlight.checked = settings.showFlightNo;
  swPlaneIcon.checked = settings.showPlaneIcon;
  swHide.checked = settings.hideOtherWhenFilter;
  inputRefresh.value = refreshIntervalSec;

  // immediate-save handlers
  swName.onchange = () => {
    settings.showAirportName = swName.checked;
    localStorage.setItem("showAirportName", JSON.stringify(settings.showAirportName));
    renderAllAirports();
  };
  swCode.onchange = () => {
    settings.showAirportCode = swCode.checked;
    localStorage.setItem("showAirportCode", JSON.stringify(settings.showAirportCode));
    renderAllAirports();
  };
  swFlight.onchange = () => {
    settings.showFlightNo = swFlight.checked;
    localStorage.setItem("showFlightNo", JSON.stringify(settings.showFlightNo));
    document.getElementById("toggleFlightNo").checked = settings.showFlightNo;
    renderFlights();
  };
  swPlaneIcon.onchange = () => {
    settings.showPlaneIcon = swPlaneIcon.checked;
    localStorage.setItem("showPlaneIcon", JSON.stringify(settings.showPlaneIcon));
    // Immediately re-render flights to add/remove plane icons (but keep lines)
    renderFlights();
  };
  swHide.onchange = () => {
    settings.hideOtherWhenFilter = swHide.checked;
    localStorage.setItem("hideOtherWhenFilter", JSON.stringify(settings.hideOtherWhenFilter));
    renderFlights();
  };
  inputRefresh.onchange = () => {
    refreshIntervalSec = Number(inputRefresh.value) || 180;
    localStorage.setItem("refreshIntervalSec", String(refreshIntervalSec));
    restartAutoRefresh();
  };

  // hide infoCard when click on map
  map.on("click", ()=> document.getElementById("infoCard").classList.add("hidden"));
}

// ============== 搜索函数（保留） ==============
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

// ============== 自动刷新 ==============
let refreshTimer = null;
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(()=> { loadData(); }, refreshIntervalSec*1000);
}
function restartAutoRefresh() { startAutoRefresh(); }

// ============== 启动入口 ==============
(async function main(){
  // load settings
  settings.showAirportName = JSON.parse(localStorage.getItem("showAirportName") || "true");
  settings.showAirportCode = JSON.parse(localStorage.getItem("showAirportCode") || "true");
  settings.showFlightNo = JSON.parse(localStorage.getItem("showFlightNo") || "false");
  settings.hideOtherWhenFilter = JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false");
  settings.showPlaneIcon = JSON.parse(localStorage.getItem("showPlaneIcon") || "true");
  refreshIntervalSec = Number(localStorage.getItem("refreshIntervalSec") || 180);

  initUI();
  await loadData();
  startAutoRefresh();

  // smooth position update every 30s without re-fetch
  setInterval(()=> { renderFlights(); }, 30000);
})();
