// ================== 全局配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";

// 自动刷新间隔（秒） — 可在设置中更改并保存
let refreshIntervalSec = Number(localStorage.getItem("refreshIntervalSec") || 180);

// 本地状态（从设置读取 / 保存）
let settings = {
  showAirportLabel: JSON.parse(localStorage.getItem("showAirportLabel") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
};

// 地图与图层
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 }).addTo(map);

let airportDB = {};       // code -> airport object
let flights = [];         // parsed flights
let airportMarkers = {};  // airport code -> marker (always present)
let flightMarkers = {};   // flightNo_or_reg -> marker for airplane
let flightLines = {};     // flightNo_or_reg -> polyline

// 飞机图标（使用 img 的 divIcon，以便 CSS 旋转）
const PLANE_IMG = "https://i.imgur.com/4bZtV3y.png"; // 可替换

// ============== 工具函数 ==============

// 获取 URL 中 flights_map 参数（大小写不敏感）
function getFlightIDFromURL() {
  const urlParams = new URLSearchParams(location.search);
  if(!urlParams.has("flights_map")) return null;
  const v = urlParams.get("flights_map");
  if (!v || v === "0") return "ALL"; // 按你的要求：0 或 空 或 无参数 => 显示全部
  return v;
}

// 将 HH:MM 转为分钟计（不含跨日）
function timeStrToMinutes(t) {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h*60 + m;
}

// 获取当前东八区分钟（用于进度判断）
// 使用 UTC 时间 +8，确保与数据约定一致（你要求“所有时间基于东八区设计”）
function nowInBeijingMinutes() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset()*60000;
  const bj = new Date(utc + 8*3600*1000);
  return bj.getHours()*60 + bj.getMinutes();
}

// 计算两个经纬之间的方位角（度，0-360，0是北）
function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = d => d*Math.PI/180;
  const toDeg = r => r*180/Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2-λ1)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
  let θ = toDeg(Math.atan2(y,x));
  θ = (θ + 360 + 90) % 360; // add 90 to make 0->east for our plane image orientation; adjust if needed
  return θ;
}

// 解析 flight_data.txt（高度容错）
function parseFlightData(raw) {
  const entries = [];
  // 先用 标记《航班结束》 切分
  const parts = raw.split("《航班结束》");
  for (let block of parts) {
    block = block.trim();
    if (!block) continue;

    // flightNo
    const flightNoMatch = block.match(/【\s*([^\]　]+)\s*】/);
    const flightNo = flightNoMatch ? flightNoMatch[1].trim() : "";

    // 机型
    const typeMatch = block.match(/〔\s*([^\]　]+)\s*〕/);
    const planeType = typeMatch ? typeMatch[1].trim() : "";

    // 航空公司
    const airlineMatch = block.match(/『\s*([^』]+)\s*』/);
    const airline = airlineMatch ? airlineMatch[1].trim() : "";

    // 出发: 名称 + {time} + #+n#
    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const depName = depMatch ? depMatch[1].trim() : "";
    const depTimeRaw = depMatch ? depMatch[2].trim() : "";
    const depOffsetRaw = depMatch && depMatch[3] ? depMatch[3].replace(/[^\d]/g,"") : "0";

    // 到达
    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const arrName = arrMatch ? arrMatch[1].trim() : "";
    const arrTimeRaw = arrMatch ? arrMatch[2].trim() : "";
    const arrOffsetRaw = arrMatch && arrMatch[3] ? arrMatch[3].replace(/[^\d]/g,"") : "0";

    // 注册号：尖括号 <...>
    const regMatch = block.match(/<\s*([^>]+)\s*>/);
    const reg = regMatch ? regMatch[1].trim() : "";

    // 价格：经济 (§...), 商务 (θ...), 其它 (△...)
    const priceEconMatch = block.match(/§([^§]+)§/);
    const priceEconomy = priceEconMatch ? priceEconMatch[1].trim() : "";
    const priceBizMatch = block.match(/θ([^θ]+)θ/);
    const priceBiz = priceBizMatch ? priceBizMatch[1].trim() : "";
    const priceOtherMatch = block.match(/△([^△]+)△/);
    const priceOther = priceOtherMatch ? priceOtherMatch[1].trim() : "";

    // optional terminal info after @T...
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

// 从机场数据库中查找机场（支持 code / name / aliases / 包含）
function airportByName(nameOrCode) {
  if (!nameOrCode) return null;
  const key = String(nameOrCode).trim().toLowerCase();
  // 先按 code 精确匹配
  for (let code in airportDB) {
    if (code.toLowerCase() === key) return airportDB[code];
  }
  // 按 name / aliases / city / 包含匹配
  for (let code in airportDB) {
    const a = airportDB[code];
    const nm = (a.name || "").toLowerCase();
    const city = (a.city || "").toLowerCase();
    const aliases = (a.aliases || []).map(x=>x.toLowerCase());
    if (nm === key || city === key || aliases.includes(key)) return a;
    if (nm.includes(key) || city.includes(key)) return a;
    // include code too
    if ((a.code||"").toLowerCase() === key) return a;
  }
  // 尝试包含匹配（宽容）
  for (let code in airportDB) {
    const a = airportDB[code];
    if ((a.name||"").toLowerCase().includes(key)) return a;
    if ((a.city||"").toLowerCase().includes(key)) return a;
    if ((a.aliases||[]).some(x=>x.toLowerCase().includes(key))) return a;
  }
  return null;
}

// 创建或更新机场标记（永远显示）
function renderAllAirports() {
  for (let code in airportDB) {
    const ap = airportDB[code];
    const lat = ap.lat || ap.latitude || ap.lat;
    const lng = ap.lon || ap.lng || ap.longitude || ap.lon;
    if (!lat || !lng) continue;

    if (airportMarkers[code]) {
      // update label visibility
      const mk = airportMarkers[code];
      const el = mk.getElement();
      if (el) {
        const labelEl = el.querySelector(".airport-label");
        if (labelEl) labelEl.style.display = settings.showAirportLabel ? "flex" : "none";
      }
      continue;
    }

    // use divIcon with horizontal layout: Name + CODE
    const html = `<div class="airport-icon" title="${ap.name || ''}">
                    <div style="display:flex;flex-direction:column;align-items:flex-start">
                      <div style="font-size:13px;font-weight:700">${ap.name || ''}</div>
                      <div style="font-size:12px;opacity:0.85">${ap.code || ''}</div>
                    </div>
                  </div>`;

    const icon = L.divIcon({
      className: "airport-divicon",
      html,
      iconAnchor: [0, 0],
    });

    const marker = L.marker([lat, lng], { icon }).addTo(map);
    marker.on("click", ()=> showAirportCard(ap));
    airportMarkers[code] = marker;

    // apply label visibility initially
    const el = marker.getElement();
    if (el) {
      const labelEl = el.querySelector(".airport-icon");
      if (labelEl) labelEl.style.display = settings.showAirportLabel ? "flex" : "none";
    }
  }
}

// 渲染单条航班（line + plane marker + tooltip）
function renderFlight(flight, options={forceShow:false}) {
  const depA = airportByName(flight.dep);
  const arrA = airportByName(flight.arr);
  if (!depA || !arrA) return; // require airports to exist

  const depLat = depA.lat || depA.latitude;
  const depLng = depA.lon || depA.lng || depA.longitude;
  const arrLat = arrA.lat || arrA.latitude;
  const arrLng = arrA.lon || arrA.lng || arrA.longitude;
  if ([depLat,depLng,arrLat,arrLng].some(v=>v===undefined)) return;

  const idKey = (flight.reg && flight.reg.trim()) || flight.flightNo || Math.random().toString(36).slice(2,9);
  // create line (if not exists)
  if (!flightLines[idKey]) {
    const line = L.polyline([[depLat,depLng],[arrLat,arrLng]], {
      color: "orange", weight: 2, dashArray: "6 6"
    }).addTo(map);
    flightLines[idKey] = line;
  } else {
    flightLines[idKey].setLatLngs([[depLat,depLng],[arrLat,arrLng]]);
  }

  // compute progress ratio and current position
  // parse times and offsets
  const depMin = timeStrToMinutes(flight.depTimeRaw);
  const arrMin = timeStrToMinutes(flight.arrTimeRaw);
  const depTotalMin = (depMin!==null) ? depMin + (flight.depOffset||0)*24*60 : null;
  const arrTotalMin = (arrMin!==null) ? arrMin + (flight.arrOffset||0)*24*60 : null;
  const nowMin = nowInBeijingMinutes();

  let show = true;
  // default: show only if flying (now between dep and arr)
  if (!options.forceShow) {
    if (depTotalMin === null || arrTotalMin === null) {
      // if missing times, still show only if forceShow OR global "show all" mode
      show = true;
    } else {
      show = (nowMin >= depTotalMin && nowMin <= arrTotalMin);
    }
  }

  // create plane marker icon with rotation
  const angle = bearingBetween(depLat,depLng,arrLat,arrLng);
  const planeHtml = `<div style="transform: rotate(${angle}deg);">
                       <img class="plane-icon" src="${PLANE_IMG}" />
                     </div>`;
  const planeIcon = L.divIcon({ html: planeHtml, className: "plane-divicon", iconSize:[36,36], iconAnchor:[18,18] });

  let fraction = 0;
  if (depTotalMin!==null && arrTotalMin!==null) {
    fraction = (nowMin - depTotalMin) / (arrTotalMin - depTotalMin);
    if (!isFinite(fraction)) fraction = 0;
    fraction = Math.max(0, Math.min(1, fraction));
  }

  // compute current lat/lng via interpolation
  const curLat = depLat + (arrLat - depLat) * fraction;
  const curLng = depLng + (arrLng - depLng) * fraction;

  // create/update marker
  if (!flightMarkers[idKey]) {
    const mk = L.marker([curLat, curLng], { icon: planeIcon }).addTo(map);
    mk.flightData = flight;
    mk.on("click", ()=> showInfoCard(flight, depA, arrA));
    flightMarkers[idKey] = mk;
  } else {
    const mk = flightMarkers[idKey];
    mk.setLatLng([curLat, curLng]);
    // update icon rotation HTML
    const newHtml = `<div style="transform: rotate(${angle}deg);"><img class="plane-icon" src="${PLANE_IMG}" /></div>`;
    mk.setIcon(L.divIcon({ html:newHtml, className:"plane-divicon", iconSize:[36,36], iconAnchor:[18,18] }));
    mk.flightData = flight;
  }

  // tooltip flight number (controlled by setting)
  if (settings.showFlightNo) {
    flightMarkers[idKey].bindTooltip(flight.flightNo || flight.reg || "", {permanent:true, direction:"right", className:"flight-label"});
  } else {
    try { flightMarkers[idKey].unbindTooltip(); } catch(e){}
  }

  // show/hide line & marker based on show flag
  if (show) {
    flightLines[idKey].addTo(map);
    flightMarkers[idKey].addTo(map);
  } else {
    // if hideOtherWhenFilter true and global filter active, we may hide
    try { map.removeLayer(flightLines[idKey]); } catch(e){}
    try { map.removeLayer(flightMarkers[idKey]); } catch(e){}
  }
}

// 清理旧的 flight layers（但保留机场 markers）
function clearFlightLayers() {
  for (let k in flightLines) {
    try { map.removeLayer(flightLines[k]); } catch(e){}
  }
  for (let k in flightMarkers) {
    try { map.removeLayer(flightMarkers[k]); } catch(e){}
  }
  flightLines = {};
  flightMarkers = {};
}

// ============== 信息卡片 ==============
function showInfoCard(f, depA, arrA) {
  const card = document.getElementById("infoCard");
  // 计算进度百分比（如果时间可用）
  const depTotal = timeStrToMinutes(f.depTimeRaw) !== null ? timeStrToMinutes(f.depTimeRaw) + (f.depOffset||0)*24*60 : null;
  const arrTotal = timeStrToMinutes(f.arrTimeRaw) !== null ? timeStrToMinutes(f.arrTimeRaw) + (f.arrOffset||0)*24*60 : null;
  const now = nowInBeijingMinutes();
  let progTxt = "进度不可用";
  if (depTotal!==null && arrTotal!==null) {
    const frac = Math.max(0, Math.min(1, (now - depTotal)/(arrTotal - depTotal)));
    progTxt = Math.round(frac*100) + "%";
  }

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h3 style="margin:0">${f.flightNo || ""} ${f.reg?`(${f.reg})`:''}</h3>
      <div style="font-size:12px;color:rgba(0,0,0,0.6)">${f.airline || ""}</div>
    </div>
    <p style="margin:6px 0"><b>航程：</b> ${f.dep || ""} → ${f.arr || ""}</p>
    <p style="margin:6px 0"><b>时间：</b> ${f.depTimeRaw || "-"} ${f.depOffset?`(+#${f.depOffset})`:''} — ${f.arrTimeRaw || "-"} ${f.arrOffset?`(+#${f.arrOffset})`:''} （东八区）</p>
    <p style="margin:6px 0"><b>机型：</b> ${f.planeType || "-"}</p>
    <p style="margin:6px 0"><b>价格：</b> ${f.priceEconomy?f.priceEconomy+'(经)': '-'} ${f.priceBiz?('/ '+f.priceBiz + '(商)'):''} ${f.priceOther?('/ '+f.priceOther):''}</p>
    <p style="margin:6px 0"><b>当前进度：</b> ${progTxt}</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      <button id="cardPrev" class="btn ghost">上一航程</button>
      <button id="cardNext" class="btn ghost">下一航程</button>
      <button id="cardClose" class="btn primary">关闭</button>
    </div>
  `;
  card.classList.remove("hidden");

  document.getElementById("cardClose").addEventListener("click", ()=> card.classList.add("hidden"));
  // prev/next 可以通过 flights 数组索引实现简单分页（若存在）
  document.getElementById("cardPrev").addEventListener("click", ()=>{
    const idx = flights.indexOf(f);
    if (idx > 0) showInfoCard(flights[idx-1], airportByName(flights[idx-1].dep), airportByName(flights[idx-1].arr));
  });
  document.getElementById("cardNext").addEventListener("click", ()=>{
    const idx = flights.indexOf(f);
    if (idx < flights.length-1) showInfoCard(flights[idx+1], airportByName(flights[idx+1].dep), airportByName(flights[idx+1].arr));
  });
}

function showAirportCard(ap) {
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <h3 style="margin:0">${ap.name || ""} (${ap.code || ""})</h3>
    ${ap.level?`<p><b>机场等级：</b>${ap.level}</p>` : ''}
    ${ap.runways?`<p><b>跑道数量：</b>${ap.runways}</p>` : ''}
    <div style="display:flex;justify-content:flex-end;margin-top:8px">
      <button id="cardClose" class="btn primary">关闭</button>
    </div>
  `;
  card.classList.remove("hidden");
  document.getElementById("cardClose").addEventListener("click", ()=> card.classList.add("hidden"));
}

// ============== 渲染与过滤主流程 ==============
function renderFlights() {
  clearFlightLayers(); // remove previous flight overlays but keep airports
  renderAllAirports(); // ensure airports exist & labels reflect settings

  const urlId = getFlightIDFromURL(); // "ALL" or specific or null
  const showAllMode = (urlId === "ALL" || urlId === null);
  const filterKey = (urlId && urlId !== "ALL") ? String(urlId).toLowerCase() : null;

  // iterate flights and decide which to draw
  flights.forEach(f => {
    // when filtering by flight/reg (case-insensitive), match either flightNo or reg
    let matchesFilter = true;
    if (filterKey) {
      const a = (f.flightNo || "").toLowerCase();
      const b = (f.reg || "").toLowerCase();
      matchesFilter = (a.includes(filterKey) || b.includes(filterKey));
    }

    // decide to force show (if filter matches) OR follow in-flight logic (default)
    const forceShow = matchesFilter;
    // hide others if hideOtherWhenFilter and filter present
    if (filterKey && settings.hideOtherWhenFilter && !matchesFilter) {
      // do nothing (skip rendering)
      return;
    }

    // if showAllMode (no filter), we still by default only show flights that are "in flight"
    // renderFlight has argument to override; here pass forceShow accordingly
    renderFlight(f, { forceShow });
  });

  // if filterKey present and matches exist, zoom to bounds of matched flights
  if (filterKey) {
    const matchedCoords = [];
    flights.forEach(f => {
      const depA = airportByName(f.dep);
      const arrA = airportByName(f.arr);
      if (!depA || !arrA) return;
      const aLat = depA.lat || depA.latitude;
      const aLng = depA.lon || depA.lng || depA.longitude;
      const bLat = arrA.lat || arrA.latitude;
      const bLng = arrA.lon || arrA.lng || arrA.longitude;
      const a = (f.flightNo || "").toLowerCase();
      const b = (f.reg || "").toLowerCase();
      if (a.includes(filterKey) || b.includes(filterKey)) {
        matchedCoords.push([aLat,aLng]);
        matchedCoords.push([bLat,bLng]);
      }
    });
    if (matchedCoords.length) {
      const bounds = L.latLngBounds(matchedCoords);
      map.fitBounds(bounds.pad(0.4));
    }
  }
}

// ============== 数据加载与启动 ==============
async function loadData() {
  // load airports
  try {
    const res = await fetch(AIRPORTS_PATH);
    airportDB = await res.json();
    // normalize: if airportDB is array -> convert to code->obj map
    if (Array.isArray(airportDB)) {
      const arr = airportDB;
      airportDB = {};
      arr.forEach(a=>{
        const code = a.code || (a.name && a.name.slice(0,3).toUpperCase());
        if (code) airportDB[code] = a;
      });
    }
  } catch (e) {
    console.error("加载 airports.json 错误：", e);
    airportDB = {};
  }

  // load flight data
  try {
    const txt = await fetch(FLIGHT_DATA_PATH).then(r => r.text());
    flights = parseFlightData(txt);
  } catch (e) {
    console.error("加载 flight_data.txt 错误：", e);
    flights = [];
  }

  // initial render
  renderAllAirports();
  renderFlights();
}

// ============== 设置面板与交互 ==============
function initUI() {
  // toolbar checkbox sync with settings
  const chk = document.getElementById("toggleFlightNo");
  chk.checked = settings.showFlightNo;
  chk.addEventListener("change",()=>{
    settings.showFlightNo = chk.checked;
    localStorage.setItem("showFlightNo", JSON.stringify(settings.showFlightNo));
    renderFlights();
  });

  // search
  const input = document.getElementById("searchInput");
  const btn = document.getElementById("searchBtn");
  const clear = document.getElementById("clearBtn");
  btn.addEventListener("click", ()=> performSearch(input.value));
  input.addEventListener("keydown", (e)=> { if (e.key === "Enter") performSearch(input.value); });
  clear.addEventListener("click", ()=> { input.value=''; location.search = ''; renderFlights(); });

  // settings modal
  const settingsBtn = document.getElementById("settingsBtn");
  const modal = document.getElementById("settingsModal");
  settingsBtn.addEventListener("click", ()=>{
    // fill values
    document.getElementById("setting_showAirportLabel").checked = settings.showAirportLabel;
    document.getElementById("setting_showFlightNo").checked = settings.showFlightNo;
    document.getElementById("setting_hideOtherWhenFilter").checked = settings.hideOtherWhenFilter;
    document.getElementById("setting_refreshInterval").value = refreshIntervalSec;
    modal.classList.remove("hidden");
  });
  document.getElementById("closeSettings").addEventListener("click", ()=> modal.classList.add("hidden"));
  document.getElementById("saveSettings").addEventListener("click", ()=>{
    settings.showAirportLabel = document.getElementById("setting_showAirportLabel").checked;
    settings.showFlightNo = document.getElementById("setting_showFlightNo").checked;
    settings.hideOtherWhenFilter = document.getElementById("setting_hideOtherWhenFilter").checked;
    refreshIntervalSec = Number(document.getElementById("setting_refreshInterval").value) || 180;

    // persist
    localStorage.setItem("showAirportLabel", JSON.stringify(settings.showAirportLabel));
    localStorage.setItem("showFlightNo", JSON.stringify(settings.showFlightNo));
    localStorage.setItem("hideOtherWhenFilter", JSON.stringify(settings.hideOtherWhenFilter));
    localStorage.setItem("refreshIntervalSec", String(refreshIntervalSec));

    // UI updates
    document.getElementById("toggleFlightNo").checked = settings.showFlightNo;
    modal.classList.add("hidden");
    renderFlights();
  });

  // clicking outside infoCard hides it
  map.on("click", ()=> { document.getElementById("infoCard").classList.add("hidden"); });
}

// 搜索函数：支持航班号 / 注册号 / 机场三字码/别名
function performSearch(q) {
  q = (q||"").trim();
  if (!q) {
    // clear filter
    history.replaceState(null, "", location.pathname);
    renderFlights();
    return;
  }
  // put in URL param and reload render
  const p = new URLSearchParams(location.search);
  p.set("flights_map", q);
  history.replaceState(null, "", location.pathname + "?" + p.toString());
  renderFlights();
}

// ============== 自动刷新机制 ==============
let refreshTimer = null;
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(()=> {
    // reload data and rerender
    loadData();
  }, refreshIntervalSec*1000);
}

// ============== 启动入口 ==============
(async function main(){
  // load initial settings from storage
  settings.showAirportLabel = JSON.parse(localStorage.getItem("showAirportLabel") || "true");
  settings.showFlightNo = JSON.parse(localStorage.getItem("showFlightNo") || "false");
  settings.hideOtherWhenFilter = JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false");
  refreshIntervalSec = Number(localStorage.getItem("refreshIntervalSec") || 180);

  initUI();
  await loadData();

  // start auto refresh
  startAutoRefresh();

  // also refresh render every 30s for progress smoothness (without reloading file)
  setInterval(()=> {
    renderFlights();
  }, 30000);
})();
