// ============ 可配常量 ============
const AUTO_REFRESH_DEFAULT = 180000; // 默认 3 分钟（ms），可在设置中修改
const PLANE_ICON_URL = "https://i.imgur.com/4bZtV3y.png"; // 飞机图标
const SHOW_FLIGHTNO_KEY = "showFlightNo";
const SHOW_AIRPORT_LABELS_KEY = "showAirportLabels";
const HIDE_OTHERS_KEY = "hideOthersInSingleMode";
const REFRESH_INTERVAL_KEY = "refreshInterval";

// ============ 初始化地图 ============
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 7,
}).addTo(map);

let airportDB = {};      // code -> airport object
let flights = [];        // flight objects parsed from raw
let markers = {};        // flightNo -> marker (aircraft)
let polyLines = {};      // flightNo -> polyline
let airportMarkers = {}; // code -> airport marker
let showFlightNo = localStorage.getItem(SHOW_FLIGHTNO_KEY) === "true";
let showAirportLabels = localStorage.getItem(SHOW_AIRPORT_LABELS_KEY) !== "false"; // default true
let hideOthersInSingleMode = localStorage.getItem(HIDE_OTHERS_KEY) === "true";
let refreshIntervalMs = parseInt(localStorage.getItem(REFRESH_INTERVAL_KEY) || AUTO_REFRESH_DEFAULT, 10);
let refreshTimer = null;

// ============ DOM 元素 ============
const infoCard = document.getElementById("infoCard");
const toggleFlightNoChk = document.getElementById("toggleFlightNo");
const toggleAirportLabelsChk = document.getElementById("toggleAirportLabels");
const toggleHideOthersChk = document.getElementById("toggleHideOthers");
const refreshIntervalSelect = document.getElementById("refreshInterval");

// 搜索相关
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const clearSearchBtn = document.getElementById("clearSearch");

// 设置面板
const settingsPanel = document.getElementById("settings");
const openSettingsBtn = document.getElementById("openSettings");
const closeSettingsBtn = document.getElementById("closeSettings");
const saveSettingsBtn = document.getElementById("saveSettings");

// ============ 启动 ============
async function loadData() {
  // 加载机场数据库 (保证和你提供的格式一致)
  airportDB = await fetch("../data/airports.json").then(r => r.json())
    .then(arr => {
      // 转成 code -> object
      const mapObj = {};
      for (const a of arr) {
        // 允许经度键名为 lon 或 lng
        mapObj[a.code] = {
          name: a.name,
          code: a.code,
          lat: a.lat,
          lng: a.lon !== undefined ? a.lon : (a.lng || 0),
          aliases: a.aliases || [],
          level: a.level,
          runways: a.runways
        };
      }
      return mapObj;
    });

  // 确保机场标点先添加（常态化显示）
  renderAirportMarkers();

  // 加载航班文本
  const txt = await fetch("../data/flight_data.txt").then(r => r.text());
  flights = parseFlightData(txt);

  initToolbar();
  renderFlights();

  // 自动刷新（第一次设置）
  setupAutoRefresh();
}

// ============ 解析航班原始格式（更强健的解析） ============
function parseFlightData(raw) {
  const blocks = raw.split(/《航班结束》/g);
  const list = [];
  for (const b of blocks) {
    if (!b.includes("【")) continue;
    // flightNo
    const flightNoMatch = b.match(/【(.*?)】/);
    if (!flightNoMatch) continue;
    const flightNo = flightNoMatch[1].trim();

    // 机型 «...»
    const aircraftMatch = b.match(/«(.*?)»/);
    const aircraft = aircraftMatch ? aircraftMatch[1].trim() : "";

    // 航空公司 『...』
    const airlineMatch = b.match(/『(.*?)』/);
    const airline = airlineMatch ? airlineMatch[1].trim() : "";

    // 注册号 <...>
    const regMatch = b.match(/<([^>]+)>/);
    const reg = regMatch ? regMatch[1].trim() : "";

    // 票价（§...§、θ...θ、△...△ 可能多种）
    const priceMatch = b.match(/§(.*?)§/);
    const price2Match = b.match(/θ(.*?)θ/);
    const price3Match = b.match(/△(.*?)△/);
    const price = priceMatch ? priceMatch[1].trim() : (price2Match ? price2Match[1].trim() : (price3Match ? price3Match[1].trim() : ""));

    // 出发与到达块（可能出现多个 '《xxx出发》{time}#+N#@...@'）
    const depMatch = b.match(/《(.*?)出发》\{(.*?)\}([^\@]*)@?([^@]*)@?/);
    const arrMatch = b.match(/《(.*?)到达》\{(.*?)\}([^\@]*)@?([^@]*)@?/);

    const depName = depMatch ? depMatch[1].trim() : "";
    const depTimeRaw = depMatch ? depMatch[2].trim() : "";
    const depTerminal = depMatch && depMatch[4] ? depMatch[4].trim() : "";

    const arrName = arrMatch ? arrMatch[1].trim() : "";
    const arrTimeRaw = arrMatch ? arrMatch[2].trim() : "";
    const arrTerminal = arrMatch && arrMatch[4] ? arrMatch[4].trim() : "";

    // 跨日规则：#+N# 出现在 dep 或 arr 周围
    const crossDayMatch = b.match(/#\+(\d+)#/);
    const crossDays = crossDayMatch ? parseInt(crossDayMatch[1], 10) : 0;

    // 价格之外可能还有其它标记位置/类目 (∥...∥)
    const locationMatch = b.match(/\∥(.*?)\∥/);
    const location = locationMatch ? locationMatch[1] : "";

    // id（如果有），有些数据会把 ID 放在 <...> (已用于注册号)，或在 {} 里有 id：尝试从 <...> 捕获不到时用正则最后的 <...>
    let idMatch = b.match(/<([^>]+)>/g);
    let id = "";
    if (idMatch && idMatch.length > 0) {
      id = idMatch[idMatch.length - 1].replace(/[<>]/g, "").trim();
    } else {
      // 尝试找到形如 {id:...} （如果存在）
      const id2 = b.match(/\{([^}]*)\}/);
      id = id2 ? id2[1].trim() : "";
    }

    // 标准化时间（以 HH:MM 字符串保存 — 时区都为东八）
    const depTime = normalizeTimeString(depTimeRaw);
    const arrTime = normalizeTimeString(arrTimeRaw);

    list.push({
      flightNo,
      aircraft,
      airline,
      reg,
      price,
      dep: depName,
      depTime,
      depTerminal,
      arr: arrName,
      arrTime,
      arrTerminal,
      crossDays,
      id,
      raw: b,
      location
    });
  }
  return list;
}

function normalizeTimeString(s) {
  if (!s) return "";
  const m = s.match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : s;
}

// ============ 工具函数 ============
function timeToMinutes(t) {
  if (!t) return 0;
  const [h,m] = t.split(":").map(Number);
  return h*60 + m;
}
function getFlightIDFromURL() {
  return new URLSearchParams(location.search).get("flights_map");
}
function airportByName(name) {
  if (!name) return null;
  name = name.trim();
  for (let code in airportDB) {
    const a = airportDB[code];
    if (!a) continue;
    if (a.name === name || a.code === name || (a.aliases && a.aliases.includes(name)) || a.name.includes(name) || a.aliases.some(al=>al.includes(name))) return a;
  }
  return null;
}

// 计算两点之间的插值经纬度（线性近似，适合短/中程）
function interpolateLatLng(a, b, ratio) {
  return { lat: a.lat + (b.lat - a.lat) * ratio, lng: a.lng + (b.lng - a.lng) * ratio };
}

// 计算航向（度）
function bearingBetween(aLat, aLng, bLat, bLng) {
  const toRad = Math.PI/180, toDeg = 180/Math.PI;
  const y = Math.sin((bLng - aLng)*toRad) * Math.cos(bLat*toRad);
  const x = Math.cos(aLat*toRad)*Math.sin(bLat*toRad) - Math.sin(aLat*toRad)*Math.cos(bLat*toRad)*Math.cos((bLng - aLng)*toRad);
  let brng = Math.atan2(y, x) * toDeg;
  brng = (brng + 360) % 360;
  return brng;
}

// ============ 渲染机场标注（常态化显示） ============
function renderAirportMarkers() {
  for (let code in airportDB) {
    const ap = airportDB[code];
    if (airportMarkers[code]) {
      // 更新位置/内容
      const mp = airportMarkers[code];
      mp.setLatLng([ap.lat, ap.lng]);
      continue;
    }
    const html = `<div class="airport-icon"><div style="font-size:13px">${ap.name}</div><small>${ap.code}</small></div>`;
    const marker = L.marker([ap.lat, ap.lng], {
      icon: L.divIcon({ className: "airport-icon", html, iconAnchor: [0,0] })
    }).addTo(map);
    airportMarkers[code] = marker;
    marker.on("click", ()=> showAirportCard(ap));
  }
  // 根据设置显示或隐藏名称（通过 CSS opacity）
  setAirportLabelVisibility(showAirportLabels);
}

function setAirportLabelVisibility(show) {
  for (let code in airportMarkers) {
    const el = airportMarkers[code].getElement();
    if (!el) continue;
    el.style.display = show ? "block" : "none";
  }
}

// ============ 渲染航班 ============
function renderFlights() {
  const filterID = getFlightIDFromURL();

  // 清理旧的航班及线
  for (let k in markers) {
    try { map.removeLayer(markers[k]); } catch(e) {}
  }
  for (let k in polyLines) {
    try { map.removeLayer(polyLines[k]); } catch(e) {}
  }
  markers = {}; polyLines = {};

  // 强制渲染所有机场（保证不丢失）
  renderAirportMarkers();

  const now = new Date();
  // 以东八为基准时间（把本地时间转换为东八时间）
  // 这里假设服务器/用户时间几乎是在本地时区，用户指定所有时间以东八区，因此我们直接以当前本地时间的东八时间角度考虑。
  // 计算当前东八小时分钟
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const beijingNow = new Date(utc + (8 * 3600000));
  const nowMin = beijingNow.getHours()*60 + beijingNow.getMinutes();

  flights.forEach(f => {
    // 支持 URL 单航班模式：如果设置为隐藏其他并提供了 flights_map 则只显示匹配航班
    const singleQ = getFlightIDFromURL();
    if (singleQ && hideOthersInSingleMode && !matchFlightQuery(f, singleQ)) return;

    const depA = airportByName(f.dep);
    const arrA = airportByName(f.arr);
    if (!depA || !arrA) return;

    // 转换到分钟（如果时间丢失则跳过）
    const depMin = timeToMinutes(f.depTime);
    const arrMinBase = timeToMinutes(f.arrTime);
    const arrMin = arrMinBase + (f.crossDays || 0) * 24 * 60; // 支持跨日
    // 如果到达小于出发（无 crossDays 指定），判定为隔天
    let adjNowMin = nowMin;
    // 如果当前小时比 dep 的小时小并 arrMin>depMin assume current time on next day?  简化逻辑：为了展示“飞行中”范围，我们把 nowMin + 0 或 +1440 两种尝试满足范围
    let inFlight = false;
    if (adjNowMin >= depMin && adjNowMin <= arrMin) inFlight = true;
    else if ((adjNowMin + 24*60) >= depMin && (adjNowMin + 24*60) <= arrMin) { adjNowMin += 24*60; inFlight = true; }

    if (!inFlight) return; // 仅显示飞行中

    // 飞行比例
    const ratio = (adjNowMin - depMin) / (arrMin - depMin);
    const pos = interpolateLatLng(depA, arrA, ratio);
    const lat = pos.lat, lng = pos.lng;

    // 航线
    const line = L.polyline([[depA.lat, depA.lng],[arrA.lat, arrA.lng]], {
      color:"orange", weight:2, dashArray:"6 6"
    }).addTo(map);
    polyLines[f.flightNo] = line;

    // 飞机图标（div + img，便于旋转）
    const planeHtml = `<div class="flight-marker"><img src="${PLANE_ICON_URL}" alt="plane" /></div>`;
    const icon = L.divIcon({ className: 'flight-divicon', html: planeHtml, iconSize: [32,32], iconAnchor: [16,16] });
    const mk = L.marker([lat,lng], {icon}).addTo(map);
    mk.flight = f;
    mk.on("click",()=>showInfoCard(f, depA, arrA));
    markers[f.flightNo] = mk;

    // 旋转飞机朝向
    const angle = bearingBetween(depA.lat, depA.lng, arrA.lat, arrA.lng);
    // 等待元素渲染
    setTimeout(()=>{
      const el = mk.getElement();
      if (el) {
        const img = el.querySelector("img");
        if (img) img.style.transform = `rotate(${angle}deg)`;
      }
    }, 50);

    // 显示航班号
    if (showFlightNo) {
      mk.bindTooltip(f.flightNo,{permanent:true,direction:"right",className:"flight-label"});
    }

    // 点击机场显示信息（确保机场 marker 存在）
    [depA, arrA].forEach(ap=>{
      // airport markers created earlier
    });

    // 如果 URL 单航班指定，自动定位并高亮
    if (singleQ && matchFlightQuery(f, singleQ)) {
      mk.openTooltip();
      centerAndHighlightFlight(f.flightNo);
    }
  });
}

// 匹配查询（航班号 / 注册号 / ID / 三字码）
function matchFlightQuery(f, q) {
  if (!q) return false;
  q = q.trim().toUpperCase();
  return (f.flightNo && f.flightNo.toUpperCase() === q) ||
         (f.reg && f.reg.toUpperCase() === q) ||
         (f.id && f.id.toUpperCase() === q) ||
         (f.dep && f.dep.toUpperCase().includes(q)) ||
         (f.arr && f.arr.toUpperCase().includes(q));
}

// 居中与高亮航班（给 polyline 添加类）
function centerAndHighlightFlight(flightNo) {
  const mk = markers[flightNo];
  const line = polyLines[flightNo];
  if (mk) {
    map.setView(mk.getLatLng(), Math.max(map.getZoom(), 5), { animate: true });
  } else if (line) {
    map.fitBounds(line.getBounds(), { padding: [60,60] });
  }
  // 高亮线段：给多段元素修改样式（Leaflet polyline -> _path）
  if (line && line._path) {
    line._path.classList.add("highlight-line");
    setTimeout(()=> {
      if (line._path) line._path.classList.remove("highlight-line");
    }, 6000);
  }
}

// ============ 信息卡片 ============
function showInfoCard(f, depA, arrA){
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const beijingNow = new Date(utc + (8 * 3600000));
  const nowMin = beijingNow.getHours()*60 + beijingNow.getMinutes();

  const depMin = timeToMinutes(f.depTime);
  const arrMin = timeToMinutes(f.arrTime) + (f.crossDays || 0) * 24*60;
  let adjNowMin = nowMin;
  if (!(adjNowMin >= depMin && adjNowMin <= arrMin) && (adjNowMin + 24*60 >= depMin && adjNowMin + 24*60 <= arrMin)) adjNowMin += 24*60;
  const ratio = Math.max(0, Math.min(1, (adjNowMin - depMin) / (arrMin - depMin)));

  const percent = Math.round(ratio * 100);

  infoCard.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h3 style="margin:0">${f.flightNo} <small style="opacity:0.7">${f.airline || ""}</small></h3>
      <div style="text-align:right">
        <div style="font-size:14px;font-weight:700">${percent}%</div>
        <div style="font-size:12px;opacity:0.7">${f.depTime} → ${f.arrTime}${f.crossDays?(' (+'+f.crossDays+'天)'):''} 东八区</div>
      </div>
    </div>
    <hr style="opacity:0.08">
    <p style="margin:6px 0"><b>航程：</b>${f.dep} → ${f.arr}</p>
    <p style="margin:6px 0"><b>机型：</b>${f.aircraft || "—"} &nbsp; <b>注册号：</b>${f.reg || "—"}</p>
    <p style="margin:6px 0"><b>票价：</b>${f.price || "—"}</p>
    <p style="margin:6px 0"><b>航班ID：</b>${f.id || "—"}</p>
    <div style="margin-top:10px">
      <div style="height:8px;background:rgba(0,0,0,0.06);border-radius:6px;overflow:hidden">
        <div style="width:${percent}%;height:8px;background:linear-gradient(90deg,#ffd54f,#ff8a00)"></div>
      </div>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn ghost" onclick="zoomToFlight('${f.flightNo}')">定位航班</button>
      <button class="btn secondary" onclick="openFlightRoute('${f.flightNo}')">查看航程</button>
    </div>
  `;
  infoCard.classList.remove("hidden");
}

function showAirportCard(ap){
  const card = infoCard;
  card.innerHTML=`
    <h3 style="margin:0">${ap.name} (${ap.code})</h3>
    ${ap.level?`<p style="margin:6px 0"><b>机场等级：</b>${ap.level}</p>`:""}
    ${ap.runways?`<p style="margin:6px 0"><b>跑道数量：</b>${ap.runways}</p>`:""}
  `;
  card.classList.remove("hidden");
}

// ============ 工具交互函数 ============
function zoomToFlight(flightNo) {
  const mk = markers[flightNo];
  if (mk) map.setView(mk.getLatLng(), 6, {animate:true});
}
function openFlightRoute(flightNo) {
  // 简单行为：缩放并打开信息卡片（如果存在 marker 则触发）
  const mk = markers[flightNo];
  if (mk) {
    mk.fire('click');
    map.fitBounds(polyLines[flightNo].getBounds(), {padding:[60,60]});
  } else {
    alert("当前未显示该航班（可能未在飞行中或数据缺失）。");
  }
}

// ============ 顶部工具栏 & 设置初始化 ============
function initToolbar(){
  // 初始化复选状态
  toggleFlightNoChk.checked = showFlightNo;
  toggleAirportLabelsChk.checked = showAirportLabels;
  toggleHideOthersChk.checked = hideOthersInSingleMode;
  refreshIntervalSelect.value = String(refreshIntervalMs);

  // FlightNo toggle
  toggleFlightNoChk.addEventListener("change", ()=>{
    showFlightNo = toggleFlightNoChk.checked;
    localStorage.setItem(SHOW_FLIGHTNO_KEY, showFlightNo);
    renderFlights();
  });
  toggleAirportLabelsChk.addEventListener("change", ()=>{
    showAirportLabels = toggleAirportLabelsChk.checked;
    localStorage.setItem(SHOW_AIRPORT_LABELS_KEY, showAirportLabels);
    setAirportLabelVisibility(showAirportLabels);
  });
  toggleHideOthersChk.addEventListener("change", ()=>{
    hideOthersInSingleMode = toggleHideOthersChk.checked;
    localStorage.setItem(HIDE_OTHERS_KEY, hideOthersInSingleMode);
    renderFlights();
  });

  refreshIntervalSelect.addEventListener("change", ()=>{
    refreshIntervalMs = parseInt(refreshIntervalSelect.value, 10);
    localStorage.setItem(REFRESH_INTERVAL_KEY, refreshIntervalMs);
    setupAutoRefresh();
  });

  // 搜索
  searchBtn.addEventListener("click", ()=> doSearch(searchInput.value));
  clearSearchBtn.addEventListener("click", ()=> {
    searchInput.value = "";
    renderFlights();
    infoCard.classList.add("hidden");
  });
  searchInput.addEventListener("keypress", (e)=> { if (e.key === "Enter") doSearch(searchInput.value); });

  // 设置面板开关
  openSettingsBtn.addEventListener("click", ()=> settingsPanel.classList.remove("hidden"));
  closeSettingsBtn && closeSettingsBtn.addEventListener && closeSettingsBtn.addEventListener("click", ()=> settingsPanel.classList.add("hidden"));
  saveSettingsBtn && saveSettingsBtn.addEventListener && saveSettingsBtn.addEventListener("click", ()=>{
    settingsPanel.classList.add("hidden");
    // 已有的变更通过事件自动生效
  });

  // URL 参数（单航班）如果存在则自动触发定位
  const q = getFlightIDFromURL();
  if (q) {
    // 将查询放入搜索框并执行
    searchInput.value = q;
    doSearch(q);
  }
}

// 搜索逻辑：按航班号/注册号/机场 三个维度搜索
function doSearch(q) {
  if (!q || !q.trim()) {
    renderFlights();
    return;
  }
  q = q.trim();
  // 先尝试精确匹配 flightNo / reg / id
  let found = null;
  for (const f of flights) {
    if (matchFlightQuery(f, q)) { found = f; break; }
  }
  if (found) {
    // 显示（如果单航班模式 hideOthersInSingleMode 则只显示匹配）
    // 将 URL 更新为 ?flights_map=...
    const url = new URL(location);
    url.searchParams.set("flights_map", q);
    history.replaceState({}, "", url);
    // 如果设置 hideOthersInSingleMode = true，则 renderFlights 会过滤
    renderFlights();
    // 高亮并定位（如果 marker 存在）
    setTimeout(()=> {
      if (found.flightNo) centerAndHighlightFlight(found.flightNo);
      // 打开卡片（如果 marker 存在，会触发）
      for (let k in markers) {
        const mk = markers[k];
        if (mk && mk.flight && matchFlightQuery(mk.flight, q)) {
          mk.fire("click");
          break;
        }
      }
    }, 300);
    return;
  } else {
    alert("未找到匹配项，请确认航班号/三字码/注册号是否正确。");
  }
}

// ============ 自动刷新机制 ============
function setupAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(()=>{
    // 重新读取航班数据并渲染（这里只重新读取并 parse，假设 flight_data.txt 会更新）
    fetch("../data/flight_data.txt").then(r=>r.text()).then(txt=>{
      flights = parseFlightData(txt);
      renderFlights();
    }).catch(err => console.error("刷新航班数据失败：", err));
  }, refreshIntervalMs);
}

// ============ 启动加载 ============
loadData();

// ============ 额外导出到 window 便于按钮调用 ============
window.zoomToFlight = zoomToFlight;
window.openFlightRoute = openFlightRoute;
