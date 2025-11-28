/* script.js
   Leaflet + OSM 实现：解析航班文本文件，按 UTC+8 判断状态，显示 IN_FLIGHT 的航班与飞机图标（方向朝向目的地），
   支持单航班 URL 模式、搜索、侧栏设置、自动刷新、平滑动画。
*/

/* ========== 配置 ========== */
const FLIGHT_DATA_PATH = "./flight_data.txt";   // 航班文本（你的文件）
const AIRPORTS_JSON = "./airports.json";        // 机场数据
const PLANE_ICON = "https://i.imgur.com/4bZtV3y.png"; // 初始PNG飞机图标，可替换
const DEFAULT_REFRESH_MS = 180000; // 默认 3 分钟
const SMOOTH_LERP = 0.12; // 平滑移动 lerp 系数（0..1）
const PREPARE_WINDOW_MIN = 30; // 起飞前多少分钟视为 PREPARING
const USE_URL_SINGLE_MODE_BY_DEFAULT = true; // 若存在 URL flights_map，则默认隐藏其它航班（侧栏可覆盖）

/* ========== 全局状态 ========== */
let airportDB = {};    // object keyed by code or array? we'll load as array and make map
let airportsArr = [];
let flights = [];      // parsed flights array
let markers = {};      // flightNo -> marker (plane)
let routeLines = {};   // flightNo -> polyline
let airportMarkers = []; // airport markers array

/* settings persisted */
let settings = {
  showFlightNo: localStorage.getItem("showFlightNo") === "true",
  showAirportLabel: localStorage.getItem("showAirportLabel") === "true",
  urlSingleMode: localStorage.getItem("urlSingleMode") === "true",
  autoRefresh: localStorage.getItem("autoRefresh") === "true" || true,
  refreshInterval: Number(localStorage.getItem("refreshInterval")) || DEFAULT_REFRESH_MS,
  showPreparing: localStorage.getItem("showPreparing")==="true" || false
};

/* animation loop */
let rafId = null;

/* ========== 地图初始化（保持与你原来相同的 Leaflet 初始化） ========== */
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 }).addTo(map);

/* ========== DOM 引用 ========== */
const infoCard = document.getElementById("infoCard");
const optShowFlightNo = document.getElementById("optShowFlightNo");
const optShowAirportLabel = document.getElementById("optShowAirportLabel");
const optURLSingleMode = document.getElementById("optURLSingleMode");
const optAutoRefresh = document.getElementById("optAutoRefresh");
const refreshIntervalInput = document.getElementById("refreshInterval");
const flightListEl = document.getElementById("flightList");
const openSettingsBtn = document.getElementById("openSettings");
const sideBar = document.getElementById("sideBar");
const closeSidebarBtn = document.getElementById("closeSidebar");
const mobilePanel = document.getElementById("mobilePanel");
const mobileHandle = document.getElementById("mobileHandle");
const mobileContent = document.getElementById("mobileContent");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const clearSearchBtn = document.getElementById("clearSearch");

/* init UI values */
optShowFlightNo.checked = settings.showFlightNo;
optShowAirportLabel.checked = settings.showAirportLabel;
optURLSingleMode.checked = settings.urlSingleMode;
optAutoRefresh.checked = settings.autoRefresh;
refreshIntervalInput.value = Math.floor(settings.refreshInterval/1000);

/* ========== 辅助时间函数（东八区） ========== */
function nowBeijing(){
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset()*60000);
  return new Date(utc + 3600000*8);
}
function hhmmToMinutes(t){
  if(!t) return null;
  const [hh,mm] = t.split(":").map(n=>Number(n||0));
  return hh*60 + mm;
}
function dayOfWeekStr(d){
  // return MON..SUN
  const arr = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  return arr[d.getUTCDay()];
}

/* ========== 解析 flight_data.txt 格式（你给定的结构） ========== */
function parseFlightData(raw){
  const lines = raw.split("\n").map(s=>s.trim()).filter(Boolean);
  const out = [];
  for(const line of lines){
    // flightNo in 【】
    const fno = (line.match(/【([^】]+)】/) || [null,null])[1] || "";
    // weekdays in «»
    const dowRaw = (line.match(/«([^»]+)»/) || [null,""])[1] || "";
    const weekdays = dowRaw.split(",").map(s=>s.trim()).filter(Boolean).map(s=>{
      const mm = s.toUpperCase();
      if(mm.startsWith("MON")) return "MON";
      if(mm.startsWith("TUE")) return "TUE";
      if(mm.startsWith("WED")) return "WED";
      if(mm.startsWith("THU")) return "THU";
      if(mm.startsWith("FRI")) return "FRI";
      if(mm.startsWith("SAT")) return "SAT";
      if(mm.startsWith("SUN")) return "SUN";
      // chinese
      if(mm.includes("一")) return "MON";
      if(mm.includes("二")) return "TUE";
      if(mm.includes("三")) return "WED";
      if(mm.includes("四")) return "THU";
      if(mm.includes("五")) return "FRI";
      if(mm.includes("六")) return "SAT";
      if(mm.includes("日")||mm.includes("天")) return "SUN";
      return mm;
    });

    // aircraft in 〔〕 and airline in 『』
    const aircraft = (line.match(/〔([^〕]+)〕/) || [null,""])[1] || "";
    const airline = (line.match(/『([^』]+)』/) || [null,""])[1] || "";

    // departure 《...出发》{hh:mm} optionally #+n#
    const depMatch = line.match(/《([^》]+)出发》\{([^}]*)\}(#\+(\d)#)?/);
    const dep = depMatch ? depMatch[1].trim() : "";
    const depTime = depMatch ? depMatch[2].trim() : "";
    // arrival 《...到达》{hh:mm} and cross-day detection #+n#
    const arrMatch = line.match(/《([^》]+)到达》\{([^}]*)\}(#\+(\d)#)?/);
    const arr = arrMatch ? arrMatch[1].trim() : "";
    const arrTime = arrMatch ? arrMatch[2].trim() : "";
    const arrCross = arrMatch && arrMatch[3] ? Number(arrMatch[3]) : 0;
    // registration / next id in <...> (可能有多个)
    const ids = (line.match(/<([^>]+)>/g) || []).map(s=>s.replace(/[<>]/g,""));
    const id = ids.length>0 ? ids[0] : null;

    out.push({
      raw: line,
      flightNo: fno,
      weekdays,
      aircraft,
      airline,
      dep, depTime,
      arr, arrTime,
      arrCross,
      ids,
      id
    });
  }
  return out;
}

/* ========== 加载数据 ========== */
async function loadAirports(){
  try{
    const r = await fetch(AIRPORTS_JSON);
    const arr = await r.json();
    airportsArr = arr;
    // build map keyed by code and by name aliases for quick lookup
    airportDB = {};
    arr.forEach(a=>{
      if(a.code) airportDB[a.code.toUpperCase()] = a;
      if(a.name) airportDB[a.name] = a;
      if(Array.isArray(a.aliases)){
        a.aliases.forEach(al=>airportDB[al.toUpperCase()] = a);
      }
    });
  }catch(e){
    console.error("加载 airports.json 失败", e);
    airportsArr = [];
    airportDB = {};
  }
}
async function loadFlights(){
  try{
    const txt = await fetch(FLIGHT_DATA_PATH).then(r=>r.text());
    flights = parseFlightData(txt);
  }catch(e){
    console.error("加载 flight_data.txt 失败", e);
    flights = [];
  }
}

/* ========== 助手：通过机场名或别名或三字码查找机场对象（匹配优先：code->name->aliases->includes） ========== */
function airportByName(name){
  if(!name) return null;
  const key = name.toUpperCase();
  if(airportDB[key]) return airportDB[key];
  // try exact name match
  const found = airportsArr.find(a=> (a.name && a.name.toUpperCase() === key) || (a.code && a.code.toUpperCase()===key));
  if(found) return found;
  // includes in name or alias
  return airportsArr.find(a=>{
    if(a.name && a.name.toUpperCase().includes(key)) return true;
    if(a.code && a.code.toUpperCase().includes(key)) return true;
    if(Array.isArray(a.aliases) && a.aliases.some(x=>x.toUpperCase().includes(key))) return true;
    return false;
  }) || null;
}

/* ========== 计算航班状态（UTC+8） ==========
   返回 object: { state: "NOT_SCHEDULED"|"PREPARING"|"IN_FLIGHT"|"ARRIVED", progress: 0..1 }
*/
function computeFlightState(f){
  const now = nowBeijing();
  // weekday check: if weekdays provided and today not included -> NOT_SCHEDULED
  const dow = dayOfWeekStr(now);
  if(f.weekdays && f.weekdays.length && !f.weekdays.includes(dow)) {
    return {state: "NOT_SCHEDULED", progress: 0};
  }
  const depMin = hhmmToMinutes(f.depTime);
  const arrMin = hhmmToMinutes(f.arrTime);
  if(depMin==null || arrMin==null) return {state:"NOT_SCHEDULED", progress:0};

  // handle arrCross (#+1#)
  let arrAbs = arrMin + (f.arrCross||0)*24*60;
  // if arr <= dep, assume next day
  if(arrAbs <= depMin) arrAbs += 24*60;

  const nowMin = now.getHours()*60 + now.getMinutes();

  if(nowMin < depMin - PREPARE_WINDOW_MIN){
    return {state:"NOT_SCHEDULED", progress:0};
  } else if(nowMin >= depMin - PREPARE_WINDOW_MIN && nowMin < depMin){
    return {state:"PREPARING", progress:0};
  } else if(nowMin >= depMin && nowMin <= arrAbs){
    const p = (nowMin - depMin) / (arrAbs - depMin);
    return {state:"IN_FLIGHT", progress: Math.max(0, Math.min(1, p))};
  } else {
    return {state:"ARRIVED", progress:1};
  }
}

/* ========== 渲染机场（同心圆 + 标签） ========== */
function renderAirports(){
  // clear previous
  airportMarkers.forEach(m=>map.removeLayer(m));
  airportMarkers = [];
  airportsArr.forEach(ap=>{
    // create HTML for divIcon
    const lbl = settings.showAirportLabel ? `<div class="airport-label">${ap.name} (${ap.code})</div>` : "";
    const html = `<div class="airport-icon">
      <div class="airport-dot">
        <div class="ring1"></div><div class="ring2"></div><div class="core"></div>
      </div>
      ${lbl}
    </div>`;
    const icon = L.divIcon({className:"", html, iconSize:null});
    const mk = L.marker([ap.lat, ap.lon], {icon}).addTo(map);
    mk.on("click", ()=> showAirportCard(ap));
    airportMarkers.push(mk);
  });
}

/* ========== 渲染航班（只做标记/线路的创建与更新，动画在独立 loop 里处理） ========== */
function renderFlightsOnMap(){
  // remove existing flight markers & lines
  Object.values(markers).forEach(m=>map.removeLayer(m));
  Object.values(routeLines).forEach(l=>map.removeLayer(l));
  markers = {}; routeLines = {};

  const filterID = getFlightIDFromURL();
  const urlModeActive = Boolean(filterID) && (USE_URL_SINGLE_MODE_BY_DEFAULT || settings.urlSingleMode);

  flights.forEach(f=>{
    // apply url filter
    if(urlModeActive && filterID && f.flightNo.toUpperCase() !== filterID.toUpperCase()) return;

    const depA = airportByName(f.dep);
    const arrA = airportByName(f.arr);
    if(!depA || !arrA) return;

    const st = computeFlightState(f);
    if(st.state === "NOT_SCHEDULED") return;
    if(st.state === "PREPARING" && !settings.showPreparing) return;
    if(st.state === "ARRIVED") return; // do not show arrived

    // draw polyline (straight line between latlngs)
    const poly = L.polyline([[depA.lat, depA.lon], [arrA.lat, arrA.lon]], {color:"orange", weight:2, dashArray:"6 6"}).addTo(map);
    routeLines[f.flightNo] = poly;

    // plane marker: DivIcon with <img> that we rotate
    const imgHtml = `<img src="${PLANE_ICON}" class="plane-image" style="width:36px;height:36px;transform:rotate(0deg);">`;
    const labelHtml = settings.showFlightNo ? `<div class="flightNoLabel" style="font-size:12px;margin-top:4px">${f.flightNo}</div>` : "";
    const html = `<div style="display:flex;flex-direction:column;align-items:center">${imgHtml}${labelHtml}</div>`;
    const icon = L.divIcon({html, className:"plane-divicon", iconAnchor: [18,18]});
    // initial position: if IN_FLIGHT use interpolated latlng; if PREPARING use depA
    let initialLatLng;
    if(st.state === "IN_FLIGHT"){
      initialLatLng = interpolateLatLng(depA, arrA, st.progress);
    } else {
      initialLatLng = [depA.lat, depA.lon];
    }
    const marker = L.marker(initialLatLng, {icon, zIndexOffset: 1000}).addTo(map);
    marker._meta = {flight: f, dep: depA, arr: arrA, state: st, angle:0};
    marker.on("click", ()=> showInfoCardForFlight(f, depA, arrA, st));
    markers[f.flightNo] = marker;
  });

  // if URL single flight present, center & highlight
  if(filterID){
    const mm = markers[filterID.toUpperCase()] || Object.values(markers).find(m=>m._meta && m._meta.flight && m._meta.flight.flightNo.toUpperCase() === filterID.toUpperCase());
    if(mm){
      map.setView(mm.getLatLng(), Math.max(map.getZoom(), 4));
      // highlight polyline if present
      const pl = routeLines[filterID.toUpperCase()];
      if(pl) pl.setStyle({color:"#ffb347", weight:3});
    }
  }
}

/* interpolate lat/lng linearly (simple) */
function interpolateLatLng(a, b, t){
  const lat = a.lat + (b.lat - a.lat) * t;
  const lon = a.lon + (b.lon - a.lon) * t;
  return [lat, lon];
}

/* rotate img element in DivIcon to face heading (deg) */
function rotatePlaneImg(marker, deg){
  const el = marker.getElement();
  if(!el) return;
  const img = el.querySelector(".plane-image");
  if(img) img.style.transform = `rotate(${deg}deg)`;
}

/* compute bearing (deg) from point A to B */
function bearingDeg(aLat, aLon, bLat, bLon){
  const toRad = Math.PI/180, toDeg = 180/Math.PI;
  const lat1 = aLat*toRad, lat2 = bLat*toRad;
  const dLon = (bLon - aLon)*toRad;
  const y = Math.sin(dLon)*Math.cos(lat2);
  const x = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
  let brng = Math.atan2(y,x) * toDeg;
  brng = (brng + 360) % 360;
  return brng;
}

/* ========== 动画 / 更新循环 ========== */
function startAnimationLoop(){
  let last = performance.now();
  function loop(now){
    const dt = now - last;
    last = now;

    // update each marker toward computed target (based on current time)
    flights.forEach(f=>{
      const marker = markers[f.flightNo];
      if(!marker) return;
      const meta = marker._meta;
      const st = computeFlightState(f);
      // update meta.state
      meta.state = st;
      if(st.state === "IN_FLIGHT"){
        const target = interpolateLatLng(meta.dep, meta.arr, st.progress);
        const curr = marker.getLatLng();
        // lerp to target
        const nx = curr.lat + (target[0] - curr.lat) * SMOOTH_LERP;
        const ny = curr.lng + (target[1] - curr.lng) * SMOOTH_LERP;
        marker.setLatLng([nx, ny]);
        // heading toward a slightly ahead point
        const aheadP = interpolateLatLng(meta.dep, meta.arr, Math.min(1, st.progress + 0.02));
        const hd = bearingDeg(nx, ny, aheadP[0], aheadP[1]);
        // rotate smoothly (lerp angle)
        const prev = meta.angle || hd;
        let diff = (hd - prev + 540) % 360 - 180;
        const nd = prev + diff * 0.2;
        meta.angle = nd;
        rotatePlaneImg(marker, nd);
        // update card if it's opened for this flight
        const opened = infoCard.dataset.flight === f.flightNo;
        if(opened) updateInfoCardProgress(st);
      } else if(st.state === "PREPARING"){
        // keep at dep, optionally rotate toward arr
        marker.setLatLng([meta.dep.lat, meta.dep.lon]);
        const hd = bearingDeg(meta.dep.lat, meta.dep.lon, meta.arr.lat, meta.arr.lon);
        meta.angle = hd;
        rotatePlaneImg(marker, hd);
      } else {
        // other states: hide (shouldn't be in markers)
      }
    });

    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
}
function stopAnimationLoop(){ if(rafId) cancelAnimationFrame(rafId); }

/* ========== UI: info card for flight & airport ========== */
function showInfoCardForFlight(f, depA, arrA, st){
  infoCard.classList.remove("hidden");
  infoCard.dataset.flight = f.flightNo;
  const nextSeg = (f.ids||[]).filter(id=>id && id !== f.id).join(", ");
  const statusText = st.state === "IN_FLIGHT" ? `飞行中 ${Math.round(st.progress*100)}%` : (st.state === "PREPARING" ? "准备中" : (st.state==="ARRIVED"?"已到达":"未排班"));
  infoCard.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h3 style="margin:0">${f.flightNo}</h3>
      <div style="font-size:12px;color:${statusText.includes("飞行")?"#0b8a4a":"#6b7280"}">${statusText}</div>
    </div>
    <div style="font-size:13px;color:var(--muted)">${f.airline} · ${f.aircraft}</div>
    <div style="margin-top:8px">
      <div><b>出发：</b>${depA.name} (${f.depTime})</div>
      <div><b>到达：</b>${arrA.name} (${f.arrTime}${f.arrCross? ` (+${f.arrCross})`:""})</div>
    </div>
    <div style="margin-top:8px" id="progressWrap">
      <div style="height:8px;background:#eef6ff;border-radius:6px;overflow:hidden">
        <div id="progressFill" style="height:100%;background:linear-gradient(90deg,#0b66c3,#7fc5ff);width:${(st.progress||0)*100}%"></div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">注册/航班ID： ${f.id || (f.ids && f.ids[0]) || "-"}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">${nextSeg? `前/后序： ${nextSeg}` : ""}</div>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px">
      <button class="btn primary" id="zoomBtn">聚焦</button>
      <button class="btn ghost" id="closeCardBtn">关闭</button>
    </div>
  `;
  document.getElementById("zoomBtn").addEventListener("click", ()=> {
    const m = markers[f.flightNo];
    if(m) map.setView(m.getLatLng(), Math.max(map.getZoom(),4));
  });
  document.getElementById("closeCardBtn").addEventListener("click", ()=> {
    infoCard.classList.add("hidden"); delete infoCard.dataset.flight;
  });
}
function updateInfoCardProgress(st){
  const pf = document.getElementById("progressFill");
  if(pf) pf.style.width = `${(st.progress||0)*100}%`;
}
function showAirportCard(ap){
  infoCard.classList.remove("hidden");
  delete infoCard.dataset.flight;
  infoCard.innerHTML = `<h3>${ap.name} (${ap.code})</h3>
    ${ap.level? `<p><b>等级：</b>${ap.level}</p>`: ""}
    ${ap.runways? `<p><b>跑道：</b>${ap.runways}</p>`: ""}
    <p style="font-size:12px;color:var(--muted)">经纬：${ap.lat}, ${ap.lon}</p>
    <button class="btn ghost" id="closeCardBtn2">关闭</button>`;
  document.getElementById("closeCardBtn2").addEventListener("click", ()=> infoCard.classList.add("hidden"));
}

/* ========== 列表 & 搜索 ========== */
function populateFlightList(){
  flightListEl.innerHTML = "";
  flights.forEach(f=>{
    const st = computeFlightState(f);
    // show preparing only if setting true
    if(st.state === "NOT_SCHEDULED") return;
    if(st.state === "PREPARING" && !settings.showPreparing) return;
    if(st.state === "ARRIVED") return;

    const div = document.createElement("div");
    div.className = "flight-item";
    div.innerHTML = `<strong>${f.flightNo}</strong> ${f.dep} → ${f.arr} <span style="color:var(--muted)">[${st.state}]</span>`;
    div.addEventListener("click", ()=> {
      showInfoCardForFlight(f, airportByName(f.dep), airportByName(f.arr), st);
    });
    flightListEl.appendChild(div);
  });

  // mobile content copy
  if(mobileContent) mobileContent.innerHTML = flightListEl.innerHTML;
}
function doSearch(q){
  if(!q || !q.trim()){
    renderAll(); return;
  }
  q = q.trim().toUpperCase();
  // flight exact
  const f1 = flights.find(f => f.flightNo && f.flightNo.toUpperCase() === q);
  if(f1){
    // set URL param without reload
    const url = new URL(location);
    url.searchParams.set("flights_map", f1.flightNo);
    history.replaceState({}, "", url);
    renderAll();
    // focus when marker exists
    setTimeout(()=> {
      const mk = markers[f1.flightNo];
      if(mk) map.setView(mk.getLatLng(), Math.max(map.getZoom(), 4));
    }, 150);
    return;
  }
  // airport search by code/name/alias
  const ap = airportByName(q);
  if(ap){
    map.setView([ap.lat, ap.lon], Math.max(map.getZoom(), 4));
    return;
  }
  // registration search
  const f2 = flights.find(f => (f.id && f.id.toUpperCase() === q) || (f.ids && f.ids.some(id=>id.toUpperCase()===q)));
  if(f2){
    const url = new URL(location);
    url.searchParams.set("flights_map", f2.flightNo);
    history.replaceState({}, "", url);
    renderAll();
    return;
  }
  // fuzzy: contains in flightNo, dep, arr
  const cand = flights.filter(f => (f.flightNo && f.flightNo.toUpperCase().includes(q)) || (f.dep && f.dep.toUpperCase().includes(q)) || (f.arr && f.arr.toUpperCase().includes(q)));
  if(cand.length){
    sideBar.classList.remove("collapsed");
    flightListEl.innerHTML = "";
    cand.forEach(f=>{
      const st = computeFlightState(f);
      const div = document.createElement("div");
      div.className = "flight-item";
      div.innerHTML = `<strong>${f.flightNo}</strong> ${f.dep} → ${f.arr} <span style="color:var(--muted)">[${st.state}]</span>`;
      div.addEventListener("click", ()=> showInfoCardForFlight(f, airportByName(f.dep), airportByName(f.arr), st));
      flightListEl.appendChild(div);
    });
  } else {
    alert("未找到匹配项");
  }
}

/* ========== URL param helper ========== */
function getFlightIDFromURL(){ return new URLSearchParams(location.search).get("flights_map"); }

/* ========== 自动刷新控制 ========== */
let refreshTimer = null;
function setAutoRefresh(){
  if(refreshTimer) clearInterval(refreshTimer);
  if(settings.autoRefresh){
    refreshTimer = setInterval(async ()=>{
      await loadFlights();
      renderAll();
    }, settings.refreshInterval);
  }
}

/* ========== 主渲染入口 ========== */
async function renderAll(){
  // load data first if not loaded
  if(!airportsArr.length) await loadAirports();
  if(!flights.length) await loadFlights();

  renderAirports();
  renderFlightsOnMap();
  populateFlightList();
}

/* ========== 事件绑定 & 初始化 ========== */
async function init(){
  await loadAirports();
  await loadFlights();
  renderAll();
  setAutoRefresh();
  startAnimationLoop();

  // UI events
  document.getElementById("openSettings").addEventListener("click", ()=> sideBar.classList.remove("collapsed"));
  document.getElementById("closeSidebar").addEventListener("click", ()=> sideBar.classList.add("collapsed"));

  document.getElementById("optShowFlightNo").addEventListener("change", (e)=> {
    settings.showFlightNo = e.target.checked;
    localStorage.setItem("showFlightNo", settings.showFlightNo);
    renderAll();
  });
  document.getElementById("optShowAirportLabel").addEventListener("change", (e)=> {
    settings.showAirportLabel = e.target.checked;
    localStorage.setItem("showAirportLabel", settings.showAirportLabel);
    renderAll();
  });
  document.getElementById("optURLSingleMode").addEventListener("change", (e)=>{
    settings.urlSingleMode = e.target.checked;
    localStorage.setItem("urlSingleMode", settings.urlSingleMode);
    renderAll();
  });
  document.getElementById("optShowPreparing").addEventListener("change", (e)=>{
    settings.showPreparing = e.target.checked;
    localStorage.setItem("showPreparing", settings.showPreparing);
    renderAll();
  });
  document.getElementById("optAutoRefresh").addEventListener("change", (e)=>{
    settings.autoRefresh = e.target.checked;
    localStorage.setItem("autoRefresh", settings.autoRefresh);
    setAutoRefresh();
  });
  document.getElementById("applyRefresh").addEventListener("click", ()=>{
    const s = Math.max(10, Number(document.getElementById("refreshInterval").value || 180));
    settings.refreshInterval = s*1000;
    localStorage.setItem("refreshInterval", settings.refreshInterval);
    setAutoRefresh();
    alert("已应用自动刷新间隔 " + s + " 秒");
  });

  // search
  document.getElementById("searchBtn").addEventListener("click", ()=> doSearch(searchInput.value));
  document.getElementById("clearSearch").addEventListener("click", ()=>{
    searchInput.value = "";
    // remove flights_map param and re-render
    const url = new URL(location);
    url.searchParams.delete("flights_map");
    history.replaceState({}, "", url);
    renderAll();
  });
  searchInput.addEventListener("keydown", (e)=> { if(e.key === "Enter") doSearch(searchInput.value); });

  // mobile panel toggle
  if(mobileHandle) mobileHandle.addEventListener("click", ()=> mobilePanel.classList.toggle("collapsed"));

  // set UI controls initial state
  document.getElementById("optShowFlightNo").checked = settings.showFlightNo;
  document.getElementById("optShowAirportLabel").checked = settings.showAirportLabel;
  document.getElementById("optURLSingleMode").checked = settings.urlSingleMode;
  document.getElementById("optAutoRefresh").checked = settings.autoRefresh;
  document.getElementById("refreshInterval").value = Math.floor(settings.refreshInterval/1000);
}

/* start */
init();
