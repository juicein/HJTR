/* ===========================
   主脚本 — 抽象航班地图（单页）
   说明：把本文件和 index.html、style.css、airports.json、flight_data.txt 放在同一目录运行（例如用静态服务器）。
   =========================== */

/* ====== 配置 ====== */
const AUTO_REFRESH_DEFAULT_MS = 180000; // 默认3分钟（可在侧栏修改）
const SMOOTH_ANIMATION_FPS = 60; // 平滑动画帧率目标
const PLANE_ICON_URL = "https://i.imgur.com/4bZtV3y.png"; // 临时飞机图标 (你可以换成你的PNG)
const USE_URL_SINGLE_MODE_BY_DEFAULT = true; // 如需默认只显示 URL 指定单航班，保留 true

/* 状态存储 */
let airports = [];       // 从 airports.json 读取的机场数据（含 x,y）
let flights = [];        // 解析后的航班数组
let planesState = {};    // 飞机运行时状态（position, target, progress）
let refreshTimer = null;
let rafId = null;
let autoRefreshEnabled = true;
let refreshIntervalMs = AUTO_REFRESH_DEFAULT_MS;
let showFlightNo = localStorage.getItem("showFlightNo") === "true";
let showAirportLabel = localStorage.getItem("showAirportLabel") === "true";
let onlySingleMode = localStorage.getItem("onlySingleMode") === "true";

/* SVG Elements */
const svg = document.getElementById("worldSvg");
const airportsLayer = document.getElementById("airportsLayer");
const routesLayer = document.getElementById("routesLayer");
const planesLayer = document.getElementById("planesLayer");
const infoCard = document.getElementById("infoCard");

/* DOM controls */
const optShowFlightNo = document.getElementById("optShowFlightNo");
const optShowAirportLabel = document.getElementById("optShowAirportLabel");
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

/* URL 参数读取 */
function getFlightIDFromURL(){ return new URLSearchParams(location.search).get("flights_map"); }

/* ====== 初始化入口 ====== */
async function init(){
  // 恢复设定
  optShowFlightNo.checked = showFlightNo;
  optShowAirportLabel.checked = showAirportLabel;
  optAutoRefresh.checked = autoRefreshEnabled;
  refreshIntervalInput.value = refreshIntervalMs/1000;
  optShowFlightNo.addEventListener("change", ()=>{ showFlightNo = optShowFlightNo.checked; localStorage.setItem("showFlightNo", showFlightNo); renderAll();});
  optShowAirportLabel.addEventListener("change", ()=>{ showAirportLabel = optShowAirportLabel.checked; localStorage.setItem("showAirportLabel", showAirportLabel); renderAll();});
  optAutoRefresh.addEventListener("change", ()=>{ autoRefreshEnabled = optAutoRefresh.checked; setAutoRefresh();});
  document.getElementById("applyRefresh").addEventListener("click", ()=>{ refreshIntervalMs = Math.max(10000, Number(refreshIntervalInput.value)*1000); setAutoRefresh(); });

  openSettingsBtn.addEventListener("click", ()=>{ sideBar.classList.remove("collapsed"); });
  closeSidebarBtn.addEventListener("click", ()=>{ sideBar.classList.add("collapsed"); });

  mobileHandle.addEventListener("click", ()=>{ mobilePanel.classList.toggle("collapsed"); });

  searchBtn.addEventListener("click", ()=>{ doSearch(searchInput.value.trim()); });
  clearSearchBtn.addEventListener("click", ()=>{ searchInput.value=""; renderAll(); });
  searchInput.addEventListener("keydown", (e)=>{ if(e.key === "Enter") searchBtn.click() });

  // 读取机场与航班数据
  await loadAirportData();
  await loadFlightData(); // 解析文本文件

  // 初次渲染
  renderAll();
  populateFlightList();

  // 自动刷新
  setAutoRefresh();
  // 启动动画循环
  startAnimationLoop();
}

/* ====== 数据加载 ====== */
async function loadAirportData(){
  // 请把 airports.json 放在同目录下
  try{
    const res = await fetch("./airports.json");
    airports = await res.json();
    // normalize: ensure x,y in 0..1000/0..600 (SVG viewbox)
    airports.forEach(a=>{
      if(typeof a.x !== "number"){ a.x = a.lon ? (a.lon%360+360)%360/360*1000 : Math.random()*900+50; }
      if(typeof a.y !== "number"){ a.y = a.lat ? (90 - a.lat)/180*600 : Math.random()*400+100; }
      // normalize aliases array
      if(!Array.isArray(a.aliases)) a.aliases = a.aliases ? [a.aliases] : [];
    });
  }catch(err){
    console.error("加载 airports.json 失败：",err);
    airports = [];
  }
}

async function loadFlightData(){
  try{
    const txt = await fetch("./flight_data.txt").then(r=>r.text());
    flights = parseFlightData(txt);
    // 保存原始 originalText for dedupe/reference
    flights.forEach(f=> f._raw = f._raw || f.rawText || "");
    // init planesState for flights currently flying
    flights.forEach(f=>{
      planesState[f.flightNo] = planesState[f.flightNo] || {progress:0, x:0, y:0, heading:0};
    });
  }catch(err){
    console.error("加载 flight_data.txt 失败：", err);
    flights = [];
  }
}

/* ====== 解析航班原始格式 ======
   支持格式类似：
   【HA1608】〈〉«MON,TUE...»〔波音737-800〕『豪金航空』《拜科努尔出发》{0:30}#+0#@T1航站楼@《上海到达》{11:20}#+0#@T1航站楼@ §1150元§θ3100元θ △8888元△<DF1729>《航班结束》
   说明：
   - 星期字段在 «...»，包含 MON,TUE...（大写或小写）
   - 跨日由 #+1# 表示，#+0# 表示同日（默认为0）
   - 前后序航班以 <> 包围
   - 提取机型、航空公司、起降、时间、航班ID（尖括号里的）
*/
function parseFlightData(raw){
  const out = [];
  const lines = raw.split("\n").map(s=>s.trim()).filter(Boolean);
  for(let rawLine of lines){
    // attempt to extract flightNo between 【】
    const flightNoMatch = rawLine.match(/【(.*?)】/);
    const flightNo = flightNoMatch ? flightNoMatch[1].trim() : null;
    // weekdays
    const dowMatch = rawLine.match(/«([^»]+)»/);
    const weekdayStr = dowMatch ? dowMatch[1].trim() : "";
    const weekdays = weekdayStr ? weekdayStr.split(",").map(s=>s.trim().toUpperCase()) : [];
    // aircraft
    const acMatch = rawLine.match(/〔([^〕]+)〕/);
    const aircraft = acMatch ? acMatch[1].trim() : "";
    // airline
    const airlineMatch = rawLine.match(/『([^』]+)』/);
    const airline = airlineMatch ? airlineMatch[1].trim() : "";
    // departure
    const depMatch = rawLine.match(/《([^》]+)出发》\{([^}]*)\}([^\s#@<{<]*)/);
    const dep = depMatch ? depMatch[1].trim() : "";
    const depTime = depMatch ? depMatch[2].trim() : "";
    const depCross = rawLine.includes("#{+1#}") ? 1 : ( (rawLine.includes("#+1#")) ? 1 : 0 );
    // arrival
    const arrMatch = rawLine.match(/《([^》]+)到达》\{([^}]*)\}([^\s#@<{<]*)/);
    const arr = arrMatch ? arrMatch[1].trim() : "";
    const arrTime = arrMatch ? arrMatch[2].trim() : "";
    // cross day detection better: search #+1# near arrival
    const arrCrossMatch = rawLine.match(/到达\}([^#]*)#\+(\d)#/);
    const arrCross = arrCrossMatch ? Number(arrCrossMatch[1] ? arrCrossMatch[1].match(/\+(\d)/) && arrCrossMatch[1] : (arrCrossMatch[2] || 0)) : (rawLine.includes("#+1#") ? 1 : 0);
    // price / misc ignored
    // tail / registration in <>
    const regMatch = rawLine.match(/<([^>]+)>/g);
    let id = null;
    if(regMatch && regMatch.length>0){
      // pick last one as next-flight id maybe; but pick first as registration if format like <DF1729>
      id = regMatch[0].replace(/[<>]/g,"");
    }
    // previous/next segment id if present (we'll collect all)
    const segIds = (rawLine.match(/<([^>]+)>/g) || []).map(s=>s.replace(/[<>]/g,""));

    // days-of-week normalization: accept MON/TUE/WED/THU/FRI/SAT/SUN or Chinese names
    const days = weekdays.map(d=>{
      const dd = d.toUpperCase();
      const map = {MON:"MON",TUE:"TUE",WED:"WED",THU:"THU",FRI:"FRI",SAT:"SAT",SUN:"SUN",
                   "MONDAY":"MON","TUESDAY":"TUE","WEDNESDAY":"WED","THURSDAY":"THU","FRIDAY":"FRI","SATURDAY":"SAT","SUNDAY":"SUN",
                   "周一":"MON","周二":"TUE","周三":"WED","周四":"THU","周五":"FRI","周六":"SAT","周日":"SUN",
                   "星期一":"MON","星期二":"TUE","星期三":"WED","星期四":"THU","星期五":"FRI","星期六":"SAT","星期日":"SUN"};
      return map[dd]||dd;
    });

    out.push({
      rawText: rawLine,
      flightNo,
      weekdays: days,
      aircraft,
      airline,
      dep, depTime, depCross,
      arr, arrTime, arrCross,
      ids: segIds,
      id,
    });
  }
  return out;
}

/* ====== 日期与时间帮助函数 ====== */
function nowInBeijing() {
  // 东八区时间（你要求按照东八区时间设计）
  const d = new Date();
  // compute offset to UTC and then shift to UTC+8
  const utc = d.getTime() + (d.getTimezoneOffset()*60000);
  const beijing = new Date(utc + 3600000*8);
  return beijing;
}
function hhmmToMinutes(t){
  if(!t) return null;
  const m = t.split(":").map(Number);
  return m[0]*60 + (m[1]||0);
}
function minutesToHHMM(min){
  const hh = Math.floor(min/60)%24;
  const mm = Math.floor(min%60);
  return String(hh).padStart(2,"0")+":"+String(mm).padStart(2,"0");
}
function dayOfWeekStr(dateObj){
  // return MON,TUE...
  const arr = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  return arr[dateObj.getUTCDay()];
}

/* ====== 查找机场 ====== */
function findAirportByName(name){
  if(!name) return null;
  name = name.toLowerCase();
  return airports.find(a=>{
    if(a.name && a.name.toLowerCase() === name) return true;
    if(a.code && a.code.toLowerCase() === name) return true;
    if(a.aliases && a.aliases.some(x => x.toLowerCase() === name)) return true;
    // includes
    if(a.name && a.name.toLowerCase().includes(name)) return true;
    return false;
  }) || null;
}

/* ====== 渲染（机场、航线、飞机） ====== */
function clearSvgLayers(){
  airportsLayer.innerHTML = "";
  routesLayer.innerHTML = "";
  planesLayer.innerHTML = "";
}

function renderAll(){
  clearSvgLayers();
  renderAirports();
  renderRoutesAndPlanes();
}

/* 把机场渲染到 airportsLayer（同心圆 + label） */
function renderAirports(){
  airports.forEach(ap=>{
    const g = document.createElementNS("http://www.w3.org/2000/svg","g");
    g.classList.add("airport");
    g.setAttribute("data-code", ap.code || "");
    g.setAttribute("transform", `translate(${ap.x},${ap.y})`);
    // outer circles
    const outer = document.createElementNS("http://www.w3.org/2000/svg","circle");
    outer.setAttribute("class","circleOuter");
    outer.setAttribute("r",14);
    g.appendChild(outer);
    const mid = document.createElementNS("http://www.w3.org/2000/svg","circle");
    mid.setAttribute("class","circleMid");
    mid.setAttribute("r",8);
    g.appendChild(mid);
    const core = document.createElementNS("http://www.w3.org/2000/svg","circle");
    core.setAttribute("class","circleCore");
    core.setAttribute("r",5);
    g.appendChild(core);

    // label (三字码 + 名称)
    if(showAirportLabel){
      const label = document.createElementNS("http://www.w3.org/2000/svg","text");
      label.setAttribute("x", 12);
      label.setAttribute("y", -10);
      label.setAttribute("class","label");
      label.textContent = `${ap.name} (${ap.code})`;
      g.appendChild(label);
    }

    g.addEventListener("click", ()=>{ showAirportCard(ap); });
    airportsLayer.appendChild(g);
  });
}

/* 根据当前时间与航班定义判断航班状态与是否今天开行：
   返回状态： "NOT_SCHEDULED", "PREPARING", "IN_FLIGHT", "ARRIVED" 以及 progress 0..1
*/
function computeFlightState(f){
  const now = nowInBeijing();
  // day-of-week check (if weekdays empty, treat as daily)
  const dow = dayOfWeekStr(now);
  if(f.weekdays && f.weekdays.length>0 && !f.weekdays.includes(dow)){
    return {state:"NOT_SCHEDULED"};
  }
  const depMin = hhmmToMinutes(f.depTime);
  const arrMin = hhmmToMinutes(f.arrTime);
  if(depMin == null || arrMin == null) return {state:"NOT_SCHEDULED"};
  // handle cross-day
  let arrOffset = (f.arrCross || 0);
  // compute absolute minutes from today's 00:00
  const nowMin = now.getHours()*60 + now.getMinutes();
  let depAbs = depMin;
  let arrAbs = arrMin + arrOffset*24*60;
  // if arrAbs <= depAbs then assume arrives next day
  if(arrAbs <= depAbs) arrAbs += 24*60;
  // determine state
  if(nowMin < depAbs - 30){ // before prepare window (30min)
    return {state:"NOT_PREPARING"}; // not showing
  } else if(nowMin >= depAbs - 30 && nowMin < depAbs){
    return {state:"PREPARING", progress:0};
  } else if(nowMin >= depAbs && nowMin <= arrAbs){
    const progress = (nowMin - depAbs) / (arrAbs - depAbs);
    return {state:"IN_FLIGHT", progress};
  } else {
    return {state:"ARRIVED", progress:1};
  }
}

/* 渲染航线与飞机（只渲染 IN_FLIGHT 状态的飞机；PREPARING/ARRIVED/NOT_SCHEDULED 可以在列表中显示） */
function renderRoutesAndPlanes(){
  const urlFlight = getFlightIDFromURL();
  const showOnlyURL = urlFlight && (USE_URL_SINGLE_MODE_BY_DEFAULT || onlySingleMode);
  flights.forEach(f=>{
    // find airports
    const depA = findAirportByName(f.dep);
    const arrA = findAirportByName(f.arr);
    if(!depA || !arrA) return; // 无机场信息则跳过

    const st = computeFlightState(f);
    // if only single mode and not this flight skip
    if(showOnlyURL && urlFlight && f.flightNo.toUpperCase() !== urlFlight.toUpperCase()) return;

    // we only draw route if state === IN_FLIGHT
    if(st.state === "IN_FLIGHT"){
      // draw route line
      const line = document.createElementNS("http://www.w3.org/2000/svg","path");
      const d = `M ${depA.x} ${depA.y} Q ${(depA.x+arrA.x)/2} ${(depA.y+arrA.y)/2 - 60} ${arrA.x} ${arrA.y}`;
      line.setAttribute("d", d);
      line.setAttribute("class", "routeLine");
      line.setAttribute("data-flight", f.flightNo);
      routesLayer.appendChild(line);

      // plane (pos along the quadratic curve)
      const pos = pointAlongQuad(depA, arrA, st.progress);
      const grp = document.createElementNS("http://www.w3.org/2000/svg","g");
      grp.setAttribute("transform", `translate(${pos.x},${pos.y})`);
      grp.setAttribute("data-flight", f.flightNo);
      grp.classList.add("plane");

      // compute heading angle to face toward arrival
      const aheadPos = pointAlongQuad(depA, arrA, Math.min(1, st.progress + 0.02));
      const angle = Math.atan2(aheadPos.y - pos.y, aheadPos.x - pos.x) * 180 / Math.PI;

      grp.setAttribute("data-angle", angle);
      grp.style.transform = `rotate(${angle}deg)`;

      // use image inside svg via foreignObject or image tag
      const img = document.createElementNS("http://www.w3.org/2000/svg","image");
      img.setAttribute("href", PLANE_ICON_URL);
      img.setAttribute("class","planeIcon");
      img.setAttribute("x",-14); img.setAttribute("y",-14); img.setAttribute("width",28); img.setAttribute("height",28);
      grp.appendChild(img);

      // label
      if(showFlightNo){
        const label = document.createElementNS("http://www.w3.org/2000/svg","text");
        label.setAttribute("x", 18);
        label.setAttribute("y", 6);
        label.setAttribute("font-size", 11);
        label.setAttribute("fill", "#0b1726");
        label.textContent = f.flightNo;
        grp.appendChild(label);
      }

      grp.addEventListener("click", ()=>{ showInfoCardForFlight(f, depA, arrA, st); });

      planesLayer.appendChild(grp);

      // update runtime planesState for animation
      planesState[f.flightNo] = {
        x: pos.x, y: pos.y, heading: angle, progress: st.progress, dep:depA, arr:arrA, flight: f
      };
    }
  });

  // If URL single flight mode, pan / focus to that flight
  const urlF = getFlightIDFromURL();
  if(urlF){
    const p = planesState[urlF.toUpperCase()] || Object.values(planesState).find(s=>s.flight && s.flight.flightNo.toUpperCase()===urlF.toUpperCase());
    if(p){
      // simulate pan by applying a small transform (we keep it simple: set viewBox center)
      centerSvgOn(p.x, p.y);
      // highlight route
      const routeEl = routesLayer.querySelector(`[data-flight="${p.flight.flightNo}"]`);
      if(routeEl) routeEl.classList.add("routeHighlight");
    }
  }
}

/* 把 svg center 移动到指定点（通过修改 viewBox） */
function centerSvgOn(x,y){
  const vb = svg.viewBox.baseVal;
  const w = vb.width, h = vb.height;
  let nx = x - w/2, ny = y - h/2;
  // clamp
  nx = Math.max(0, Math.min(nx, 1000 - w));
  ny = Math.max(0, Math.min(ny, 600 - h));
  svg.setAttribute("viewBox", `${nx} ${ny} ${w} ${h}`);
}

/* 二次贝塞尔曲线在 t 处点位（近似） */
function pointAlongQuad(a,b,t){
  // control point above midpoint for nice arc
  const cx = (a.x + b.x)/2;
  const cy = (a.y + b.y)/2 - 60;
  const x = (1-t)*(1-t)*a.x + 2*(1-t)*t*cx + t*t*b.x;
  const y = (1-t)*(1-t)*a.y + 2*(1-t)*t*cy + t*t*b.y;
  return {x,y};
}

/* 显示机场卡片 */
function showAirportCard(ap){
  infoCard.classList.remove("hidden");
  infoCard.innerHTML = `<h3>${ap.name} (${ap.code})</h3>
    ${ap.level?`<p><b>机场等级：</b>${ap.level}</p>`:""}
    ${ap.runways?`<p><b>跑道：</b>${ap.runways}</p>`:""}
    <p style="font-size:12px;color:var(--muted)">坐标：x=${Math.round(ap.x)} y=${Math.round(ap.y)}</p>
    <p><button class="btn secondary" onclick="hideInfoCard()">关闭</button></p>`;
}

/* 显示航班卡片，含前后序航段信息 */
function showInfoCardForFlight(f, depA, arrA, st){
  infoCard.classList.remove("hidden");
  const nextSegments = (f.ids || []).filter(id=>id && id !== f.id);
  const statusText = st.state === "IN_FLIGHT" ? `飞行中 ${Math.round(st.progress*100)}%` : (st.state==="PREPARING" ? "准备中" : (st.state==="ARRIVED"?"已到达":"未开行"));
  infoCard.innerHTML = `
    <h3>${f.flightNo} — ${f.airline || ""}</h3>
    <p><b>机型：</b>${f.aircraft || "-"}</p>
    <p><b>注册/航班ID：</b>${f.id || (f.ids&&f.ids[0]) || "-"}</p>
    <p><b>出发：</b>${depA.name} (${f.depTime})</p>
    <p><b>到达：</b>${arrA.name} (${f.arrTime})</p>
    <p><b>进度：</b> ${statusText}</p>
    <div class="progressBar"><div class="fill" style="width:${(st.progress||0)*100}%"></div></div>
    <p style="margin-top:8px">${nextSegments.length?`前后序航段： ${nextSegments.join(", ")}`:""}</p>
    <p><button class="btn primary" onclick="zoomToFlight('${f.flightNo}')">聚焦此航班</button>
       <button class="btn ghost" onclick="hideInfoCard()">关闭</button></p>
  `;
}

/* 隐藏卡片 */
function hideInfoCard(){ infoCard.classList.add("hidden"); }

/* 聚焦航班（调整 viewBox 并高亮） */
function zoomToFlight(flightNo){
  const st = planesState[flightNo];
  if(st){ centerSvgOn(st.x, st.y); }
}

/* 填充侧栏航班列表（当前所有 flights 的状态） */
function populateFlightList(){
  flightListEl.innerHTML = "";
  flights.forEach(f=>{
    const st = computeFlightState(f);
    const item = document.createElement("div");
    item.classList.add("flight-item");
    item.innerHTML = `<strong>${f.flightNo}</strong> ${f.dep}→${f.arr} <span style="color:var(--muted)">[${st.state}]</span>`;
    item.addEventListener("click", ()=>{ showInfoCardForFlight(f, findAirportByName(f.dep), findAirportByName(f.arr), st); });
    flightListEl.appendChild(item);
  });

  // 手机版
  mobileContent.innerHTML = flightListEl.innerHTML;
}

/* 搜索功能：支持航班号、机场三字码/别名/部分名称、注册号 */
function doSearch(q){
  if(!q){ renderAll(); return; }
  q = q.trim().toLowerCase();
  // try matching flightNo
  const flight = flights.find(f => f.flightNo && f.flightNo.toLowerCase() === q);
  if(flight){
    // show only this flight
    // set URL param (does not reload) and re-render
    const url = new URL(location);
    url.searchParams.set("flights_map", flight.flightNo);
    history.replaceState({}, "", url);
    renderAll();
    // focus
    setTimeout(()=>{ const st = planesState[flight.flightNo]; if(st) centerSvgOn(st.x, st.y); }, 120);
    return;
  }
  // airport search
  const ap = findAirportByName(q);
  if(ap){
    centerSvgOn(ap.x, ap.y);
    // highlight airport (simple effect: create temp circle)
    const tmp = document.createElementNS("http://www.w3.org/2000/svg","circle");
    tmp.setAttribute("cx", ap.x); tmp.setAttribute("cy", ap.y); tmp.setAttribute("r", 22);
    tmp.setAttribute("fill", "none"); tmp.setAttribute("stroke", "#ffb347"); tmp.setAttribute("stroke-width",4);
    airportsLayer.appendChild(tmp);
    setTimeout(()=> tmp.remove(), 1500);
    return;
  }
  // search by registration or id
  const f2 = flights.find(f=> (f.id && f.id.toLowerCase() === q) || (f.ids && f.ids.some(id=>id.toLowerCase()===q)));
  if(f2){
    const url = new URL(location);
    url.searchParams.set("flights_map", f2.flightNo);
    history.replaceState({}, "", url);
    renderAll();
    return;
  }

  // fuzzy match flightNo contains or airport contains
  const candidates = flights.filter(f=> (f.flightNo && f.flightNo.toLowerCase().includes(q)) || (f.dep && f.dep.toLowerCase().includes(q)) || (f.arr && f.arr.toLowerCase().includes(q)));
  if(candidates.length>0){
    // show list in sideBar
    sideBar.classList.remove("collapsed");
    flightListEl.innerHTML = "";
    candidates.forEach(f=>{
      const st = computeFlightState(f);
      const item = document.createElement("div");
      item.classList.add("flight-item");
      item.innerHTML = `<strong>${f.flightNo}</strong> ${f.dep}→${f.arr} <span style="color:var(--muted)">[${st.state}]</span>`;
      item.addEventListener("click", ()=>{ showInfoCardForFlight(f, findAirportByName(f.dep), findAirportByName(f.arr), st); });
      flightListEl.appendChild(item);
    });
  } else {
    alert("未找到匹配项");
  }
}

/* 启动/停止动画循环（平滑飞机移动）*/
function startAnimationLoop(){
  let lastTime = performance.now();
  function loop(now){
    const dt = now - lastTime;
    lastTime = now;
    // animate planes movement: for each planesState entry, smooth towards target computed from computeFlightState
    flights.forEach(f=>{
      const st = computeFlightState(f);
      if(st.state === "IN_FLIGHT"){
        const depA = findAirportByName(f.dep);
        const arrA = findAirportByName(f.arr);
        if(!depA||!arrA) return;
        const target = pointAlongQuad(depA, arrA, st.progress);
        const state = planesState[f.flightNo] || {x:target.x, y:target.y, heading:0, progress:st.progress};
        // lerp towards target for smooth movement
        const lerp = 0.08; // 调整平滑速率
        state.x += (target.x - state.x) * lerp;
        state.y += (target.y - state.y) * lerp;
        state.progress = st.progress;
        const ahead = pointAlongQuad(depA, arrA, Math.min(1, st.progress+0.01));
        const angle = Math.atan2(ahead.y - state.y, ahead.x - state.x) * 180/Math.PI;
        state.heading += (angle - (state.heading||0)) * 0.2;
        planesState[f.flightNo] = state;
      }
    });

    // update DOM elements positions
    const planeEls = planesLayer.querySelectorAll("[data-flight]");
    planeEls.forEach(el=>{
      const fn = el.getAttribute("data-flight");
      const st = planesState[fn];
      if(!st) return;
      el.setAttribute("transform", `translate(${st.x},${st.y})`);
      el.style.transform = `rotate(${st.heading}deg)`;
    });

    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
}
function stopAnimationLoop(){
  if(rafId) cancelAnimationFrame(rafId);
}

/* 自动刷新控制 */
function setAutoRefresh(){
  if(refreshTimer) clearInterval(refreshTimer);
  if(autoRefreshEnabled){
    refreshTimer = setInterval(async ()=>{
      await loadFlightData();
      renderAll();
      populateFlightList();
    }, refreshIntervalMs);
  }
}

/* UI helper：渲染/隐藏侧栏（已经有） */
window.addEventListener("resize", ()=>{ /* 可扩展：根据尺寸自动折叠侧栏 */ });

/* 启动 */
init();

/* 调试辅助函数（全局，方便 console 调用） */
window.renderAll = renderAll;
window.hideInfoCard = hideInfoCard;
window.zoomToFlight = zoomToFlight;
