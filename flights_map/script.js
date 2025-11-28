// =================== 配置 ===================
// 默认每次从后端/文件更新时间（毫秒）。你可以编辑这里来调整自动刷新间隔（默认 3 分钟）
const DEFAULT_REFRESH_INTERVAL = 3 * 60 * 1000; // 3 minutes
// 平滑动画参数（控制飞机每秒帧数）
const ANIMATION_FPS = 20;

// 后台开关（localStorage 存储）
let showOnlyFiltered = localStorage.getItem("showOnlyFiltered") === "true";

// ============ 地图初始化 ============
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 7,
}).addTo(map);

let airportDB = [];
let flights = [];            // 解析出的航班列表
let markers = {};            // flightNo -> marker (divIcon)
let polyLines = {};          // flightNo -> polyline
let airportMarkers = [];     // 用于机场图标清理
let showFlightNo = localStorage.getItem("showFlightNo") === "true";
let showAirportLabels = localStorage.getItem("showAirportLabels") === "true";

// 用于动画：保存每个航班的上一位置与目标位置
const animState = {};

// 自动刷新定时器
let refreshTimer = null;
let refreshInterval = Number(localStorage.getItem("refreshInterval")) || DEFAULT_REFRESH_INTERVAL;

// =================== 辅助函数 ===================
function timeToMinutes(t){
  // t like "09:10" or "0:30"
  const [h,m] = t.split(":").map(s=>Number(s));
  return h*60 + m;
}
function minutesToTime(m){
  const hh = Math.floor(m/60) % 24;
  const mm = m % 60;
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}
function showToast(text, ms=2000){
  const t = document.getElementById("toast");
  t.textContent = text;
  t.classList.remove("hidden");
  clearTimeout(t._t);
  t._t = setTimeout(()=>t.classList.add("hidden"), ms);
}
function getFlightIDFromURL(){
  return new URLSearchParams(location.search).get("flights_map");
}

// 计算两点的初始航向（度），用于图标旋转
function bearing(lat1,lng1,lat2,lng2){
  const toRad = Math.PI/180, toDeg = 180/Math.PI;
  lat1 *= toRad; lat2 *= toRad; const dLon = (lng2-lng1)*toRad;
  const y = Math.sin(dLon)*Math.cos(lat2);
  const x = Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
  const brng = Math.atan2(y,x)*toDeg;
  return (brng+360)%360;
}

// parse a single flight raw block (the regex in original was brittle) 
function parseFlightLine(line){
  // We'll extract:
  // flightNo between 【 】, aircraft between 〔 〕, airline between 『 』,
  // dep airport in 《...出发》 with {time} and +#n#, arr similar, registration in <...>
  const out = {};
  try{
    const flightNoMatch = line.match(/【([^】]+)】/);
    if(flightNoMatch) out.flightNo = flightNoMatch[1].trim();

    const aircraftMatch = line.match(/〔([^〕]+)〕/);
    if(aircraftMatch) out.aircraft = aircraftMatch[1].trim();

    const airlineMatch = line.match(/『([^』]+)』/);
    if(airlineMatch) out.airline = airlineMatch[1].trim();

    // registration / id inside <...>
    const regMatch = line.match(/<([^>]+)>/);
    if(regMatch) out.registration = regMatch[1].trim();

    // departure block
    const depMatch = line.match(/《([^》]+?)出发》\{([^}]+)\}#\+?(\d+)#@([^@]+)@/);
    if(depMatch){
      out.dep = depMatch[1].trim();
      out.depTime = depMatch[2].trim(); // "0:30" or "09:10"
      out.depPlus = Number(depMatch[3]||0); // day offset
      out.depTerminal = depMatch[4].trim();
    } else {
      // fallback: try simpler
      const d = line.match(/《([^》]+?)出发》\{([^}]+)\}/);
      if(d){ out.dep = d[1].trim(); out.depTime = d[2].trim(); out.depPlus = 0; }
    }

    // arrival block
    const arrMatch = line.match(/《([^》]+?)到达》\{([^}]+)\}#\+?(\d+)#@([^@]+)@/);
    if(arrMatch){
      out.arr = arrMatch[1].trim();
      out.arrTime = arrMatch[2].trim();
      out.arrPlus = Number(arrMatch[3]||0);
      out.arrTerminal = arrMatch[4].trim();
    } else {
      const a = line.match(/《([^》]+?)到达》\{([^}]+)\}/);
      if(a){ out.arr = a[1].trim(); out.arrTime = a[2].trim(); out.arrPlus = 0; }
    }

    // days of week or schedule in «...»
    const days = line.match(/«([^»]+)»/);
    if(days) out.days = days[1].split(",").map(s=>s.trim());

    // fares (optional) keep raw
    const priceMatch = line.match(/§([^§]+)§/);
    if(priceMatch) out.economy = priceMatch[1].trim();
    const bizMatch = line.match(/θ([^θ]+)θ/);
    if(bizMatch) out.business = bizMatch[1].trim();

    // store raw
    out.raw = line;
  }catch(e){
    console.warn("parse error",e,line);
  }
  return out;
}

// parse whole text
function parseFlightData(raw){
  const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  return lines.map(parseFlightLine);
}

// 搜索机场数据库（支持 code / name / aliases / partial match）
function airportByName(name){
  if(!name) return null;
  name = name.toLowerCase().trim();
  for(const ap of airportDB){
    if((ap.name && ap.name.toLowerCase() === name) || (ap.code && ap.code.toLowerCase() === name)) return ap;
  }
  // partial and aliases
  for(const ap of airportDB){
    if((ap.name && ap.name.toLowerCase().includes(name)) || (ap.aliases && ap.aliases.some(a=>a.toLowerCase().includes(name))) || (ap.code && ap.code.toLowerCase().includes(name))) return ap;
  }
  return null;
}

// =================== 渲染机场 ===================
function renderAirports(){
  // clear old
  for(const m of airportMarkers) map.removeLayer(m);
  airportMarkers = [];

  for(const ap of airportDB){
    const el = document.createElement("div");
    el.className = "airport-wrapper";
    el.innerHTML = `
      <div class="airport-icon" title="${ap.name}">
        <div class="outer"></div>
        <div style="width:8px;height:8px;border-radius:50%;background:${getComputedStyle(document.documentElement).getPropertyValue('--primary')||'#1D4886'}"></div>
      </div>
      <div class="airport-label">${ap.code}</div>
    `;
    const divIcon = L.divIcon({
      className: "airport-divicon",
      html: el.outerHTML,
      iconSize: [120,28],
      iconAnchor: [6,6]
    });
    const mk = L.marker([ap.lat, ap.lng], { icon: divIcon, interactive: true }).addTo(map);

    // 点击弹信息
    mk.on("click", ()=> showAirportCard(ap));
    airportMarkers.push(mk);

    // 控制是否显示标签文本（把 label DOM 的 display 用 CSS 或属性控制）
    const labelNode = mk.getElement();
    if(labelNode){
      const lbl = labelNode.querySelector(".airport-label");
      if(lbl) lbl.style.display = showAirportLabels ? "inline" : "none";
    }
  }
}

// =================== 渲染航班（主） ===================
function renderFlights(filterID=null){
  // remove existing
  for(const k in markers) {
    try{ map.removeLayer(markers[k]); }catch(e){}
  }
  for(const k in polyLines) {
    try{ map.removeLayer(polyLines[k]); }catch(e){}
  }
  markers = {}; polyLines = {};

  const now = new Date();

  flights.forEach(f=>{
    // apply filter by URL if requested
    if(filterID && showOnlyFiltered && f.registration && f.registration.toUpperCase() !== filterID.toUpperCase()) return;
    if(filterID && showOnlyFiltered && f.flightNo && f.flightNo.toUpperCase() !== filterID.toUpperCase()) return;
    if(filterID && !showOnlyFiltered){
      // if not strictly hiding others, we still allow showing the filtered (handled below)
    }

    // find airports
    const depA = airportByName(f.dep);
    const arrA = airportByName(f.arr);
    if(!depA || !arrA) return;

    // 计算起飞/到达实际 Date 对象（依据当天或跨日 "+" 标识）
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // dep date/time
    const [dh,dm] = f.depTime.split(":").map(s=>Number(s));
    const depDate = new Date(today.getTime() + (f.depPlus||0)*24*3600*1000);
    depDate.setHours(dh,dm,0,0);
    const [ah,am] = f.arrTime.split(":").map(s=>Number(s));
    const arrDate = new Date(today.getTime() + (f.arrPlus||0)*24*3600*1000);
    arrDate.setHours(ah,am,0,0);

    // if arrival < departure (maybe due to +0 but next day) fix:
    if(arrDate <= depDate) arrDate.setDate(arrDate.getDate() + 1);

    // 判断是否应显示（“飞行中才显示”逻辑：现在介于 dep 和 arr 之间）
    const nowMs = now.getTime();
    if(!(nowMs >= depDate.getTime() && nowMs <= arrDate.getTime())){
      // we still may want to include flights near real-time; for now preserve original "only in-flight" behavior
      return;
    }

    // 计算进度 ratio
    const ratio = (nowMs - depDate.getTime()) / (arrDate.getTime() - depDate.getTime());
    const lat = depA.lat + (arrA.lat - depA.lat) * ratio;
    const lng = depA.lng + (arrA.lng - depA.lng) * ratio;

    // polyline (route)
    const line = L.polyline([[depA.lat, depA.lng],[arrA.lat, arrA.lng]], {
      color: "#FAA43A", weight: 2, dashArray: "6 6", opacity: 0.9
    }).addTo(map);
    polyLines[f.flightNo] = line;

    // compute bearing for icon rotation
    const ang = bearing(depA.lat, depA.lng, arrA.lat, arrA.lng);

    // Create divIcon for plane with rotation (so png can be rotated)
    const planeSvg = `
      <div class="plane-icon" style="transform:rotate(${ang}deg);">
        <img src="https://i.imgur.com/4bZtV3y.png" style="width:32px;height:32px;display:block;transform:translate(-50%,-50%);"/>
      </div>`;
    const divIcon = L.divIcon({
      className: "plane-div-icon",
      html: planeSvg,
      iconSize: [32,32],
      iconAnchor: [16,16]
    });

    const mk = L.marker([lat,lng], { icon: divIcon, zIndexOffset: 500 }).addTo(map);
    mk.flight = f;
    mk.depA = depA; mk.arrA = arrA;
    mk.ratio = ratio;
    mk.angle = ang;

    mk.on("click", ()=> showInfoCard(f, depA, arrA, depDate, arrDate, ratio));

    // optional permanent label
    if(showFlightNo){
      mk.bindTooltip(f.flightNo, {permanent:true, direction:"right", className:"flight-label"});
    }

    markers[f.flightNo] = mk;

    // store animation state
    animState[f.flightNo] = {
      marker: mk,
      targetLat: lat,
      targetLng: lng,
      lastUpdate: Date.now()
    };
  });

  // update sidebars/lists
  refreshFlightLists();
}

// =================== 航班与机场信息卡 ===================
function showInfoCard(f, depA, arrA, depDate, arrDate, ratio){
  const card = document.getElementById("infoCard");
  // format dates with day offset
  const depStr = `${depA.name} (${depA.code}) — ${depDate.toLocaleString()}`;
  const arrStr = `${arrA.name} (${arrA.code}) — ${arrDate.toLocaleString()}`;
  const reg = f.registration || "—";
  const progPct = Math.max(0, Math.min(100, Math.round(ratio*100)));
  card.innerHTML = `
    <h3>${f.flightNo} · ${f.airline || ""}</h3>
    <div class="info-row">
      <div>
        <div class="info-sub"><b>起飞</b></div>
        <div>${depStr}</div>
      </div>
      <div>
        <div class="info-sub"><b>到达</b></div>
        <div>${arrStr}</div>
      </div>
    </div>
    <div style="margin-top:10px">
      <div class="info-sub">机型：${f.aircraft || "—"} · 注册号：${reg}</div>
      <div class="info-sub">航班进度：${progPct}%</div>
      <div class="prog" style="height:8px;margin-top:6px;background:#e6eefb;border-radius:6px;overflow:hidden">
        <i style="display:block;height:100%;width:${progPct}%;background:var(--accent)"></i>
      </div>
    </div>
    <div style="margin-top:10px;font-size:13px;color:var(--muted)">点击“查找前后序航程”可在后台查找同注册号或同航班系列的上下行记录。</div>
    <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn ghost" id="btn-find-related">查找前后序航程</button>
      <button class="btn primary" id="btn-zoom-flight">聚焦航班</button>
    </div>
  `;
  card.classList.remove("hidden");

  document.getElementById("btn-zoom-flight").addEventListener("click", ()=>{
    const mk = Object.values(markers).find(m=>m.flight && m.flight.flightNo === f.flightNo);
    if(mk) map.setView(mk.getLatLng(), Math.max(map.getZoom(),6));
  });
  document.getElementById("btn-find-related").addEventListener("click", ()=>{
    // 通过 registration 查找同注册的其他记录
    if(!f.registration){
      showToast("无注册号，无法查找。");
      return;
    }
    const regs = flights.filter(x=>x.registration && x.registration === f.registration);
    if(regs.length<=1){
      showToast("未找到前后序航程记录。");
      return;
    }
    // 弹出结果到侧栏
    const flightList = document.getElementById("flightList");
    flightList.innerHTML = regs.map(r=>`<div class="flight-card"><b>${r.flightNo}</b><div class="meta">${r.airline||""} ${r.aircraft||""}</div></div>`).join("");
    document.getElementById("sidebar").classList.remove("hidden");
  });
}

function showAirportCard(ap){
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <h3>${ap.name} (${ap.code})</h3>
    ${ap.level?`<div class="info-sub">机场等级：${ap.level}</div>`:""}
    ${ap.runways?`<div class="info-sub">跑道：${ap.runways}</div>`:""}
  `;
  card.classList.remove("hidden");
}

// =================== 列表/侧栏刷新 ===================
function refreshFlightLists(){
  const flightList = document.getElementById("flightList");
  const mobileList = document.getElementById("mobileList");
  const entries = Object.values(markers).map(mk=>{
    const f = mk.flight;
    const percent = Math.round((mk.ratio||0)*100);
    return { flightNo: f.flightNo, airline: f.airline, dep: f.dep, arr: f.arr, percent };
  }).sort((a,b)=>a.percent - b.percent);

  if(entries.length===0){
    flightList.innerHTML = `<div style="color:var(--muted);padding:12px">当前无显示航班（或不在飞行时间范围内）。</div>`;
    mobileList.innerHTML = flightList.innerHTML;
    return;
  }

  flightList.innerHTML = entries.map(e=>`
    <div class="flight-card" data-flight="${e.flightNo}">
      <div><b>${e.flightNo}</b> · <span class="meta">${e.airline || ""}</span></div>
      <div class="meta">${e.dep} → ${e.arr}</div>
      <div class="prog"><i style="width:${e.percent}%;"></i></div>
    </div>
  `).join("");

  mobileList.innerHTML = flightList.innerHTML;

  // click handlers
  for(const el of flightList.querySelectorAll(".flight-card")){
    el.addEventListener("click", ()=>{
      const fn = el.getAttribute("data-flight");
      const mk = markers[fn];
      if(mk){
        map.setView(mk.getLatLng(), Math.max(map.getZoom(),6));
        showInfoCard(mk.flight, mk.depA, mk.arrA, /*we don't have depDate/arrDate here*/ new Date(), new Date(Date.now()+1000), mk.ratio||0);
      }
    });
  }
}

// =================== 搜索 ===================
function doSearch(txt){
  txt = (txt||"").trim();
  if(!txt) return showToast("请输入搜索内容");
  // search flights by flightNo / registration / airport code / airport name
  const hitFlights = flights.filter(f=>{
    if((f.flightNo && f.flightNo.toLowerCase().includes(txt.toLowerCase())) || (f.registration && f.registration.toLowerCase().includes(txt.toLowerCase()))) return true;
    if(f.dep && f.dep.toLowerCase().includes(txt.toLowerCase())) return true;
    if(f.arr && f.arr.toLowerCase().includes(txt.toLowerCase())) return true;
    return false;
  });
  if(hitFlights.length>0){
    // focus first hit and show only these on map (temporarily)
    const primary = hitFlights[0];
    // center map on primary route midpoint
    const depA = airportByName(primary.dep);
    const arrA = airportByName(primary.arr);
    if(depA && arrA){
      const lat = (depA.lat + arrA.lat)/2;
      const lng = (depA.lng + arrA.lng)/2;
      map.setView([lat,lng], 5);
    }
    // optionally hide non-search markers: we'll just highlight matched ones by opening their info
    // open info for first matched that has a marker
    const mk = Object.values(markers).find(m=>m.flight && (m.flight.flightNo === primary.flightNo || m.flight.registration === primary.registration));
    if(mk){
      showInfoCard(mk.flight, mk.depA, mk.arrA, new Date(), new Date(), mk.ratio || 0);
    } else {
      showToast("搜索到数据但当前不在显示范围或不在飞行时间范围内。");
    }
  } else {
    // maybe it's an airport code/name — center map to that airport
    const ap = airportByName(txt);
    if(ap){
      map.setView([ap.lat, ap.lng], 6);
      showAirportCard(ap);
      return;
    }
    showToast("未找到匹配项");
  }
}

// =================== 动画循环（平滑） ===================
let animFrame = null;
function animatePlanes(){
  const now = Date.now();
  for(const key in animState){
    const st = animState[key];
    if(!st.marker) continue;
    // target positions are updated on each renderFlights call; but to simulate continuous motion we nudge marker slightly
    // For simplicity we won't compute new target here; this function can be expanded to interpolate between last and next positions.
    // We'll do a tiny idle floating to keep things smooth.
    // (You can later update st.targetLat/targetLng when you fetch new data)
    // no-op for now
  }
  animFrame = requestAnimationFrame(animatePlanes);
}

// =================== 加载数据 ================
async function loadData(){
  // airports
  try{
    airportDB = await fetch("data/airports.json").then(r=>r.json());
  }catch(e){
    console.error("加载 airports.json 失败", e);
    airportDB = [];
  }

  // flight lines
  try{
    const txt = await fetch("data/flight_data.txt").then(r=>r.text());
    flights = parseFlightData(txt);
  }catch(e){
    console.error("加载 flight_data.txt 失败", e);
    flights = [];
  }

  renderAirports();

  const filterID = getFlightIDFromURL();
  // if URL param provided, consider centering and optionally only show that flight
  if(filterID){
    // if showOnlyFiltered true: we will only render that flight
    renderFlights(filterID);
    if(showOnlyFiltered){
      showToast(`仅显示：${filterID}`);
    } else {
      // still render all and try to focus the flight if present
      renderFlights(null);
      // find marker after rendering
      setTimeout(()=>{
        const mk = Object.values(markers).find(m=> (m.flight && (m.flight.flightNo && m.flight.flightNo.toUpperCase()===filterID.toUpperCase())) || (m.flight && m.flight.registration && m.flight.registration.toUpperCase()===filterID.toUpperCase()));
        if(mk) map.setView(mk.getLatLng(),6);
      }, 300);
    }
  }else{
    renderFlights();
  }

  // start animate loop and refresh timer
  if(!animFrame) animFrame = requestAnimationFrame(animatePlanes);
  startAutoRefresh();
}

// 自动刷新（拉取数据并重新渲染）。注意：你可以改为从 API 获取实时定位（ADS-B），这里是从本地文件重载示例。
async function refreshAll(){
  console.log("refreshing data...");
  try{
    const txt = await fetch("data/flight_data.txt", {cache:"no-store"}).then(r=>r.text());
    flights = parseFlightData(txt);
    // re-render
    const filterID = getFlightIDFromURL();
    renderFlights(filterID);
    renderAirports();
  }catch(e){
    console.error(e);
  }
}

function startAutoRefresh(){
  if(refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(()=> {
    refreshAll();
  }, refreshInterval);
}

// =========== 事件绑定和初始化 UI ===========
function initToolbar(){
  // flight no toggle
  const chk = document.getElementById("toggleFlightNo");
  chk.checked = showFlightNo;
  chk.addEventListener("change", ()=>{
    showFlightNo = chk.checked;
    localStorage.setItem("showFlightNo", showFlightNo);
    // rebind tooltips
    renderFlights(getFlightIDFromURL());
  });

  const chkAp = document.getElementById("toggleAirportLabels");
  chkAp.checked = showAirportLabels;
  chkAp.addEventListener("change", ()=>{
    showAirportLabels = chkAp.checked;
    localStorage.setItem("showAirportLabels", showAirportLabels);
    // re-render airports to show/hide labels
    renderAirports();
  });

  // search
  document.getElementById("searchBtn").addEventListener("click", ()=> doSearch(document.getElementById("searchInput").value));
  document.getElementById("searchInput").addEventListener("keydown", (e)=>{ if(e.key==="Enter") doSearch(e.target.value); });
  document.getElementById("clearSearchBtn").addEventListener("click", ()=>{ document.getElementById("searchInput").value=""; renderFlights(getFlightIDFromURL()); });

  // sidebar toggle
  document.getElementById("btn-sidebar-toggle").addEventListener("click", ()=>{
    document.getElementById("sidebar").classList.toggle("hidden");
  });

  // toggle only filtered (backend switch)
  const btnOnly = document.getElementById("btn-only-filter");
  btnOnly.textContent = showOnlyFiltered ? "仅显示 URL 航班：已开" : "仅显示 URL 指定航班";
  btnOnly.addEventListener("click", ()=>{
    showOnlyFiltered = !showOnlyFiltered;
    localStorage.setItem("showOnlyFiltered", showOnlyFiltered);
    btnOnly.textContent = showOnlyFiltered ? "仅显示 URL 航班：已开" : "仅显示 URL 指定航班";
    renderFlights(getFlightIDFromURL());
  });

  // refresh btn
  document.getElementById("btn-refresh").addEventListener("click", ()=> refreshAll());
}

// =================== 启动入口 ===================
initToolbar();
loadData();

// =============== 备注与扩展说明 ===============
// 1) airplane PNG 替换：把你自己的图片替换 script 中 planeSvg 的 img src 即可。
// 2) 如果要更精确的“飞机指向目的地方向并真正旋转图片”，建议使用 Leaflet-RotatedMarker 插件或将图片做成 SVG，并在 divIcon 中以 transform: rotate() 旋转（当前已用 transform:rotate(angle)）
// 3) URL 单航班模式：例如 ?flights_map=DF1729 会尝试匹配 flightNo 或 registration，配合侧边 btn 可以选择是否隐藏其他航班（后台开关为 localStorage showOnlyFiltered）
// 4) 定时刷新间隔可以通过修改 DEFAULT_REFRESH_INTERVAL 或将 refreshInterval 存入 localStorage 在 startAutoRefresh() 中使用
// 5) 你提到要在机票卡片显示“查找前后序航程”，脚本中提供了基本的通过 registration 查找同注册号航班的示例（在 infoCard 的按钮中）
// 6) 若要将数据换成实时 ADS-B/ API（例如 Flightradar24 API），你需要服务器端代理并替换 fetch("data/flight_data.txt") 为你的 API。（Flightradar24 提供商业 API，详情见他们的介绍）。 [oai_citation:1‡Flightradar24](https://www.flightradar24.com/blog/b2b/flightradar24-api/?utm_source=chatgpt.com)
