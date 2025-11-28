// ============ 常量 & 状态 ============
const TIMEZONE_OFFSET_HOURS = 8; // 东八区
let airportDB = {}; // keyed by code
let flights = [];   // flight objects
let markers = {};   // by flightNo -> marker object
let flightMeta = {}; // store animated state: { marker, currLatLng, targetLatLng, animId }
let airportMarkers = []; // keep refs to airport marker layers
let polyLines = {}; // flightNo -> polyline

// UI & settings
let showFlightNo = localStorage.getItem("showFlightNo") === "true";
let refreshInterval = parseInt(localStorage.getItem("refreshInterval") || "180", 10); // seconds
let refreshTimer = null;
let showAirportLabel = JSON.parse(localStorage.getItem("showAirportLabel") || "true");
let showAirportMarker = JSON.parse(localStorage.getItem("showAirportMarker") || "true");
let showAllFlights = JSON.parse(localStorage.getItem("showAllFlights") || "true");
let followSingleFlight = JSON.parse(localStorage.getItem("followSingleFlight") || "true");

// ============ 初始化 Leaflet 地图 ============
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 }).addTo(map);

// ============ DOM 绑定 ============
const infoCard = document.getElementById('infoCard');
const toggleFlightNoEl = document.getElementById('toggleFlightNo');
const toggleAirportLabelEl = document.getElementById('toggleAirportLabel');
const toggleAirportMarkerEl = document.getElementById('toggleAirportMarker');
const toggleShowAllFlightsEl = document.getElementById('toggleShowAllFlights');
const refreshIntervalEl = document.getElementById('refreshInterval');
const flightListInner = document.getElementById('flightListInner');
const globalSearch = document.getElementById('globalSearch');
const searchBtn = document.getElementById('searchBtn');
const clearSearch = document.getElementById('clearSearch');
const openSidebar = document.getElementById('openSidebar');
const closeSidebar = document.getElementById('closeSidebar');
const sidebar = document.getElementById('sidebar');

toggleFlightNoEl.checked = showFlightNo;
toggleAirportLabelEl.checked = showAirportLabel;
toggleAirportMarkerEl.checked = showAirportMarker;
toggleShowAllFlightsEl.checked = showAllFlights;
refreshIntervalEl.value = refreshInterval;

// 侧栏开关
openSidebar.addEventListener('click', ()=> sidebar.classList.remove('closed'));
closeSidebar.addEventListener('click', ()=> sidebar.classList.add('closed'));

// 事件：开关保存并 rerender
toggleFlightNoEl.addEventListener('change', ()=> {
  showFlightNo = toggleFlightNoEl.checked;
  localStorage.setItem("showFlightNo", showFlightNo);
  renderFlights();
});
toggleAirportLabelEl.addEventListener('change', ()=> {
  showAirportLabel = toggleAirportLabelEl.checked;
  localStorage.setItem("showAirportLabel", showAirportLabel);
  renderAirports(); // toggle labels
});
toggleAirportMarkerEl.addEventListener('change', ()=>{
  showAirportMarker = toggleAirportMarkerEl.checked;
  localStorage.setItem("showAirportMarker", showAirportMarker);
  renderAirports();
});
toggleShowAllFlightsEl.addEventListener('change', ()=>{
  showAllFlights = toggleShowAllFlightsEl.checked;
  localStorage.setItem("showAllFlights", showAllFlights);
  renderFlights();
});
refreshIntervalEl.addEventListener('change', ()=>{
  const v = parseInt(refreshIntervalEl.value || "180", 10);
  refreshInterval = Math.max(10, v);
  localStorage.setItem("refreshInterval", refreshInterval);
  restartAutoRefresh();
});

// 搜索
searchBtn.addEventListener('click', ()=> {
  const q = globalSearch.value.trim();
  if(!q) return renderFlights();
  searchFlights(q);
});
clearSearch.addEventListener('click', ()=> {
  globalSearch.value = "";
  renderFlights();
});

// URL 单航班支持
function getFlightIDFromURL(){
  return new URLSearchParams(location.search).get("flights_map");
}

// ============ 加载数据 ============
async function loadData(){
  // 机场 JSON 必须为数组，内部对象至少需要： name, code, lat, lng, aliases (array)、level、runways
  // 我将 airports.json 读作数组并转成以 code 为 key 的对象
  const apList = await fetch("./data/airports.json").then(r => r.json());
  // 允许两种键名 lat/lng 或 lat/lon，转换并以 code 为 key
  airportDB = {};
  apList.forEach(a=>{
    const lat = a.lat || a.latitude;
    const lng = a.lng || a.lon || a.longitude;
    airportDB[a.code] = {
      name: a.name,
      code: a.code,
      city: a.city || a.name,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      aliases: a.aliases || [],
      level: a.level,
      runways: a.runways
    };
  });

  // 加载航班原始文本并解析
  const txt = await fetch("./data/flight_data.txt").then(r => r.text());
  flights = parseFlightData(txt); // 返回数组
  // 预处理 flights：统一字段名、解析跨日信息等
  flights = flights.map(parseFlightObject);

  initToolbar();
  renderAirports();
  renderFlights();
  restartAutoRefresh();
}

// ============ 解析航班原始格式 ============
// 你的原始格式样例：
// 【HA1608】〈〉«MON,TUE,...»〔波音737-800〕『豪金航空』《拜科努尔出发》{0:30}#+0#@T1航站楼@《上海到达》{11:20}#+0#@T1航站楼@ §1150元§θ3100元θ △8888元△<DF1729>《航班结束》
function parseFlightData(raw){
  const list = [];
  // 我们用更宽松的解析正则：提取：【flightNo】 ... <reg> 《出发》{depTime}(#+n#)? ... 《到达》{arrTime}(#+n#)?
  // 注意：示例中你用中文标点，解析时尽量兼容。
  const re = /【\s*([^\]】]+)\s*】([\s\S]*?)<([^>]+)>/g;
  let m;
  // step1: 找到每条以【】开始并以 <...>（注册号或ID）结尾的记录
  while((m = re.exec(raw)) !== null){
    const flightNo = m[1].trim();
    const body = m[2];
    const reg = m[3].trim(); // <DF1729> 中的 DF1729
    // 从 body 中抽取出发地/到达地和时间
    // 出发：《xxx出发》{hh:mm} (#+n# 可选)
    const depMatch = /《([^》]+?)出发》\{([^}]+)\}(?:#\+?(\d+)#)?/i.exec(body);
    const arrMatch = /《([^》]+?)到达》\{([^}]+)\}(?:#\+?(\d+)#)?/i.exec(body);
    // 某些数据可能写成 《上海到达》 或 《上海 到达》 等，尽量容错
    const dep = depMatch ? depMatch[1].trim() : "";
    const depTime = depMatch ? depMatch[2].trim() : "";
    const depPlus = depMatch && depMatch[3] ? parseInt(depMatch[3],10) : 0;
    const arr = arrMatch ? arrMatch[1].trim() : "";
    const arrTime = arrMatch ? arrMatch[2].trim() : "";
    const arrPlus = arrMatch && arrMatch[3] ? parseInt(arrMatch[3],10) : 0;

    // 机型、航空公司、周次：尝试提取
    const aircraftMatch = /〔([^〕]+)〕/.exec(body);
    const airlineMatch = /『([^』]+)』/.exec(body);
    const daysMatch = /«([^»]+)»/.exec(body);

    list.push({
      flightNo,
      dep,
      depTime,
      depPlus,
      arr,
      arrTime,
      arrPlus,
      reg,
      aircraft: aircraftMatch ? aircraftMatch[1] : "",
      airline: airlineMatch ? airlineMatch[1] : "",
      days: daysMatch ? daysMatch[1].split(",").map(s=>s.trim()) : []
    });
  }
  return list;
}

// 标准化 flight 对象（将时间解析成分钟 / Date 处理时使用东八区）
function parseFlightObject(f){
  // 把 "0:30" 或 "00:30" 转为 "HH:MM"
  function normalizeTime(t){
    if(!t) return "";
    const parts = t.split(":").map(s=>s.trim());
    if(parts.length===1) parts.unshift("0");
    const hh = parts[0].padStart(2,"0");
    const mm = (parts[1]||"0").padStart(2,"0");
    return `${hh}:${mm}`;
  }
  return {
    flightNo: f.flightNo,
    dep: f.dep,
    arr: f.arr,
    depTime: normalizeTime(f.depTime),
    arrTime: normalizeTime(f.arrTime),
    depPlus: f.depPlus || 0, // 跨天偏移
    arrPlus: f.arrPlus || 0,
    reg: f.reg,
    aircraft: f.aircraft,
    airline: f.airline,
    days: f.days
  };
}

// ============ 工具函数 ============
function timeStrToMinutesLocal(t, plusDays=0){
  // t is "HH:MM" in local timezone target (we treat it as East+8)
  if(!t) return null;
  const [hh,mm] = t.split(":").map(Number);
  return hh*60 + mm + plusDays*24*60;
}
function minutesToTimeStr(mins){
  mins = ((mins % (24*60)) + 24*60) % (24*60);
  const h = Math.floor(mins/60).toString().padStart(2,"0");
  const m = (mins%60).toString().padStart(2,"0");
  return `${h}:${m}`;
}
function distanceLatLng(a,b){
  // Haversine in km
  function toRad(d){ return d * Math.PI/180; }
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat/2), sinDLon = Math.sin(dLon/2);
  const c = 2*Math.atan2(Math.sqrt(sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon), Math.sqrt(1 - (sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon)));
  return R*c;
}
function bearingBetween(a,b){
  // return bearing degrees from a to b
  const toRad = d=>d*Math.PI/180;
  const toDeg = r=>r*180/Math.PI;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const dLon = toRad(b.lng - a.lng);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
  return (toDeg(Math.atan2(y,x)) + 360) % 360;
}

// 查找机场（支持 code、name、aliases、city 部分匹配）
function airportByName(name){
  if(!name) return null;
  name = name.trim().toLowerCase();
  for (let code in airportDB){
    const a = airportDB[code];
    if (a.code.toLowerCase() === name) return a;
    if ((a.name||"").toLowerCase().includes(name)) return a;
    if ((a.city||"").toLowerCase().includes(name)) return a;
    if ((a.aliases||[]).some(x=>x.toLowerCase().includes(name))) return a;
  }
  return null;
}

// ============ 渲染机场同心圈与标签 ============
function clearAirportMarkers(){
  airportMarkers.forEach(m => map.removeLayer(m));
  airportMarkers = [];
}
function renderAirports(){
  clearAirportMarkers();
  if(!showAirportMarker) return;
  for (let code in airportDB){
    const a = airportDB[code];
    if(!a.lat || !a.lng) continue;
    const html = `
      <div class="airport-icon-wrap">
        <div class="airport-circle" style="background:rgba(0,115,199,0.18); border:2px solid rgba(0,115,199,0.28)"></div>
        ${showAirportLabel? `<div class="airport-label">${a.code} ${a.name}</div>` : ''}
      </div>
    `.trim();
    const icon = L.divIcon({ className: '', html, iconAnchor:[12,12] });
    const m = L.marker([a.lat,a.lng], { icon }).addTo(map);
    m.on('click', ()=> showAirportCard(a));
    airportMarkers.push(m);
  }
}

// ============ 核心：渲染航班（只渲染当前“飞行中”航班） ============
function renderFlights(){
  // 清理
  for(let k in markers) {
    if(markers[k]) map.removeLayer(markers[k]);
  }
  for(let k in polyLines) {
    if(polyLines[k]) map.removeLayer(polyLines[k]);
  }
  markers = {}; polyLines = {};
  flightMeta = {};

  const filterID = getFlightIDFromURL();
  const now = new Date();
  // 将现在转为东八区分钟数（我们显示以东八区为标准）
  // 这里假设 flight times 存的是东八区时间字符串
  const nowMin = now.getUTCHours()*60 + now.getUTCMinutes() + TIMEZONE_OFFSET_HOURS*60;
  // normalize to day's minutes (0..∞)
  // 我们只显示“飞行中”的航班： nowMin >= depMin && nowMin <= arrMin
  flights.forEach(f=>{
    // 查机场
    const depA = airportByName(f.dep);
    const arrA = airportByName(f.arr);
    if(!depA || !arrA) return;

    // skip if filtering single flight and not match
    if(filterID && f.flightNo.toUpperCase() !== filterID.toUpperCase()) {
      if(!showAllFlights) return; // hide non-matching
    }

    // 计算 dep/arr mins (在同一天或跨日)
    const depMin = timeStrToMinutesLocal(f.depTime, f.depPlus);
    const arrMin = timeStrToMinutesLocal(f.arrTime, f.arrPlus);
    // handle if arr < dep (跨日) - we've considered depPlus/arrPlus but just in case:
    const adjustedArrMin = (arrMin < depMin) ? arrMin + 24*60 : arrMin;

    if(!(nowMin >= depMin && nowMin <= adjustedArrMin)) return; // 只显示飞行中

    const ratio = (nowMin - depMin) / (adjustedArrMin - depMin);
    const lat = depA.lat + (arrA.lat - depA.lat)*ratio;
    const lng = depA.lng + (arrA.lng - depA.lng)*ratio;

    // 航线 polyline
    const line = L.polyline([[depA.lat,depA.lng],[arrA.lat,arrA.lng]], { color: "#ff8c00", weight:2, dashArray:"6 6" }).addTo(map);
    polyLines[f.flightNo] = line;

    // plane icon as DivIcon with img so we can rotate via CSS
    const planeUrl = "https://i.imgur.com/4bZtV3y.png"; // 替换为你自己的 png
    const bearing = bearingBetween({lat,lng},{lat:arrA.lat,lng:arrA.lng});
    const iconHtml = `<img src="${planeUrl}" class="plane-icon" style="transform:rotate(${bearing}deg)"/>`;
    const icon = L.divIcon({ className:'plane-divicon', html:iconHtml, iconAnchor:[18,18], popupAnchor:[0,-18] });

    // add marker
    const mk = L.marker([lat,lng], { icon }).addTo(map);
    mk.flight = f;
    mk.depA = depA; mk.arrA = arrA;
    mk.on('click', ()=> showInfoCard(f,depA,arrA));
    markers[f.flightNo] = mk;

    // tooltip flight label (persistent if enabled)
    if(showFlightNo){
      mk.bindTooltip(f.flightNo, {permanent:true, direction:"right", className:"flight-label"});
    }

    // store meta for animation
    flightMeta[f.flightNo] = {
      marker: mk,
      currLatLng: L.latLng(lat,lng),
      targetLatLng: L.latLng(lat,lng),
      animId: null
    };

    // add small clickable airport markers (we add only once - airports render separately)
    // add to flight list in sidebar
  });

  renderFlightList();
  // 如果URL有单航班则移动并高亮
  const urlFlight = getFlightIDFromURL();
  if(urlFlight){
    highlightSingleFlight(urlFlight.toUpperCase());
  }
}

// ============ 航班列表（侧栏） ============
function renderFlightList(){
  flightListInner.innerHTML = "";
  const visibleFlights = Object.keys(markers).sort();
  if(visibleFlights.length === 0) {
    flightListInner.innerHTML = `<div class="muted">当前无飞行中航班</div>`;
    return;
  }
  visibleFlights.forEach(fn=>{
    const f = markers[fn].flight;
    const el = document.createElement('div');
    el.className = 'flight-item';
    const dep = markers[fn].depA.code + " → " + markers[fn].arrA.code;
    const now = new Date();
    const nowMin = now.getUTCHours()*60 + now.getUTCMinutes() + TIMEZONE_OFFSET_HOURS*60;
    const depMin = timeStrToMinutesLocal(f.depTime, f.depPlus);
    const arrMin = timeStrToMinutesLocal(f.arrTime, f.arrPlus);
    const adjustedArr = (arrMin < depMin) ? arrMin + 24*60 : arrMin;
    const progressPct = Math.max(0, Math.min(100, Math.round( (nowMin - depMin)/(adjustedArr - depMin) * 100 )));
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:700">${f.flightNo} <small class="muted">${f.airline || ""}</small></div>
          <div style="font-size:12px">${dep} <small class="muted">${f.depTime} → ${f.arrTime}</small></div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700">${progressPct}%</div>
          <div style="font-size:12px">${f.reg || ""}</div>
        </div>
      </div>
    `;
    el.addEventListener('click', ()=>{
      // 点击侧栏飞行项 将地图移动到该航班并打开 info card
      const mk = markers[fn];
      if(!mk) return;
      map.panTo(mk.getLatLng());
      showInfoCard(f, mk.depA, mk.arrA);
    });
    flightListInner.appendChild(el);
  });
}

// ============ 展示信息卡 ============
function showInfoCard(f, depA, arrA){
  const now = new Date();
  const nowMin = now.getUTCHours()*60 + now.getUTCMinutes() + TIMEZONE_OFFSET_HOURS*60;
  const depMin = timeStrToMinutesLocal(f.depTime, f.depPlus);
  const arrMin = timeStrToMinutesLocal(f.arrTime, f.arrPlus);
  const adjustedArr = (arrMin < depMin) ? arrMin + 24*60 : arrMin;
  const progressPct = Math.max(0, Math.min(100, Math.round( (nowMin - depMin)/(adjustedArr - depMin) * 100 )));
  infoCard.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div style="flex:1">
        <h3 style="margin:0">${f.flightNo} <small class="muted">${f.airline || ''}</small></h3>
        <div style="font-size:14px;margin-top:6px">
          <div><strong>机型：</strong>${f.aircraft || '未知'}</div>
          <div><strong>注册号：</strong>${f.reg || '—'}</div>
          <div><strong>出发：</strong>${depA.name} (${depA.code}) — ${f.depTime} ${f.depPlus?`+${f.depPlus}天`:''}</div>
          <div><strong>到达：</strong>${arrA.name} (${arrA.code}) — ${f.arrTime} ${f.arrPlus?`+${f.arrPlus}天`:''}</div>
        </div>
      </div>
      <div style="width:220px">
        <div style="font-size:12px" class="card-row"><small class="muted">航线进度</small></div>
        <div class="progress" style="margin-top:6px"><span style="width:${progressPct}%;"></span></div>
        <div style="margin-top:8px;font-size:13px"><strong>${progressPct}%</strong> 已飞</div>
      </div>
    </div>
  `;
  infoCard.classList.remove('hidden');
}

// 机场卡
function showAirportCard(a){
  infoCard.innerHTML = `
    <h3>${a.name} (${a.code})</h3>
    ${a.level?`<p><b>等级：</b>${a.level}</p>`:''}
    ${a.runways?`<p><b>跑道：</b>${a.runways}</p>`:''}
  `;
  infoCard.classList.remove('hidden');
}

// ============ 搜索功能（航班号、机场、注册号） ============
function searchFlights(q){
  q = q.trim();
  if(!q) return renderFlights();
  // 优先识别航班号（字母+数字）
  const qUpper = q.toUpperCase();
  // 如果形如 HA1234 -> 高亮该航班并只显示它（可通过侧栏开关控制）
  const flightMatch = flights.find(f=>f.flightNo.toUpperCase() === qUpper);
  if(flightMatch){
    // 将 URL 改为 ?flights_map=...
    const params = new URLSearchParams(location.search);
    params.set('flights_map', flightMatch.flightNo);
    history.replaceState(null, '', location.pathname + '?' + params.toString());
    renderFlights();
    if(followSingleFlight) highlightSingleFlight(flightMatch.flightNo);
    return;
  }
  // 匹配机场 code/name/aliases
  const ap = airportByName(q);
  if(ap){
    // 缩放到机场并高亮所有有关航班（起/到）
    map.setView([ap.lat,ap.lng], 6);
    // Filter flights to those whose dep or arr matches this airport
    // set globalSearch but do renderFlights with showAllFlights true
    // We'll simply pan & highlight markers near this airport
    renderFlights();
    // flash airport marker
    L.circleMarker([ap.lat,ap.lng], { radius:18, color:'#ff4d4f', weight:3 }).addTo(map).bindTooltip(`${ap.code}`).openTooltip();
    return;
  }
  // 注册号搜索（reg）
  const regMatch = flights.find(f=> (f.reg||'').toUpperCase() === qUpper );
  if(regMatch){
    const params = new URLSearchParams(location.search);
    params.set('flights_map', regMatch.flightNo);
    history.replaceState(null, '', location.pathname + '?' + params.toString());
    renderFlights();
    if(followSingleFlight) highlightSingleFlight(regMatch.flightNo);
    return;
  }
  // 否则进行模糊匹配航班号/机场名
  const candidates = flights.filter(f=>{
    return (f.flightNo||'').toLowerCase().includes(q.toLowerCase()) ||
           (f.airline||'').toLowerCase().includes(q.toLowerCase()) ||
           (f.dep||'').toLowerCase().includes(q.toLowerCase()) ||
           (f.arr||'').toLowerCase().includes(q.toLowerCase());
  });
  if(candidates.length>0){
    // 显示第一个候选的航班
    const f = candidates[0];
    const params = new URLSearchParams(location.search);
    params.set('flights_map', f.flightNo);
    history.replaceState(null, '', location.pathname + '?' + params.toString());
    renderFlights();
    if(followSingleFlight) highlightSingleFlight(f.flightNo);
    return;
  }
  alert('未找到匹配结果');
}

// ============ 单航班高亮与聚焦 ============
function highlightSingleFlight(flightNo){
  const mk = markers[flightNo];
  if(!mk) {
    // 如果当前飞行表中没找到，仍然尝试 renderFlights（可能被过滤）
    renderFlights();
    return;
  }
  // 隐藏或淡出其他航班（由设置决定）
  if(!showAllFlights){
    for(const k in markers){
      if(k !== flightNo) {
        const m = markers[k];
        if(m) m.setOpacity(0.15);
        if(polyLines[k]) polyLines[k].setStyle({opacity:0.12});
      } else {
        markers[k].setOpacity(1);
        if(polyLines[k]) polyLines[k].setStyle({opacity:1, color:'#ff4d4f', weight:3});
      }
    }
  }
  // 缩放到该航班
  map.setView(mk.getLatLng(), 5);
  // 将 infoCard 打开
  showInfoCard(mk.flight, mk.depA, mk.arrA);
}

// ============ 平滑移动动画 & 定期更新位置 ============
// animateMarkerTo(marker, fromLatLng, toLatLng, durationMs)
function animateMarkerTo(meta, toLatLng, durationMs=3000){
  // meta: { marker, currLatLng, targetLatLng, animId }
  if(!meta || !meta.marker) return;
  if(meta.animId) cancelAnimationFrame(meta.animId);
  const start = performance.now();
  const from = meta.currLatLng;
  const to = toLatLng;
  function step(now){
    const t = Math.min(1, (now - start) / durationMs);
    const lat = from.lat + (to.lat - from.lat) * t;
    const lng = from.lng + (to.lng - from.lng) * t;
    meta.marker.setLatLng([lat,lng]);
    // rotate to face destination
    const b = bearingBetween({lat,lng}, {lat:meta.marker.arrA.lat, lng:meta.marker.arrA.lng});
    const img = meta.marker._icon && meta.marker._icon.querySelector && meta.marker._icon.querySelector('img.plane-icon');
    if(img) img.style.transform = `rotate(${b}deg)`;
    if(t < 1) {
      meta.animId = requestAnimationFrame(step);
    } else {
      meta.currLatLng = to;
      meta.animId = null;
    }
  }
  meta.animId = requestAnimationFrame(step);
}

// 更新所有航班位置（调用 renderFlights 中的算法或单独计算下一次目标）
function updateFlightPositions(){
  const now = new Date();
  const nowMin = now.getUTCHours()*60 + now.getUTCMinutes() + TIMEZONE_OFFSET_HOURS*60;
  for(const fn in flightMeta){
    const meta = flightMeta[fn];
    const f = meta.marker.flight;
    const depA = meta.marker.depA;
    const arrA = meta.marker.arrA;
    const depMin = timeStrToMinutesLocal(f.depTime, f.depPlus);
    const arrMin = timeStrToMinutesLocal(f.arrTime, f.arrPlus);
    const adjustedArr = (arrMin < depMin) ? arrMin + 24*60 : arrMin;
    if(!(nowMin >= depMin && nowMin <= adjustedArr)) {
      // 不在飞行中，移除 marker
      if(meta.marker) map.removeLayer(meta.marker);
      continue;
    }
    const ratio = (nowMin - depMin) / (adjustedArr - depMin);
    const targetLat = depA.lat + (arrA.lat - depA.lat)*ratio;
    const targetLng = depA.lng + (arrA.lng - depA.lng)*ratio;
    const toLatLng = L.latLng(targetLat, targetLng);
    meta.targetLatLng = toLatLng;
    // 平滑动画：持续 duration 是刷新间隔的一小段（例如2.8秒），也可以根据距离动态变长
    animateMarkerTo(meta, toLatLng, 1200);
    // 更新 polyline style if highlighted
    if(polyLines[fn]){
      polyLines[fn].setStyle({opacity:1});
    }
    // Keep tooltip flight label visibility
    if(showFlightNo && meta.marker.getTooltip && !meta.marker.getTooltip()) {
      meta.marker.bindTooltip(f.flightNo, {permanent:true,direction:'right', className:'flight-label'});
    }
  }
  // 更新侧栏列表 progress 等
  renderFlightList();
}

// 定时刷新（会重新解析数据文件并更新 flights）
// 注：你如需从远程接口获取，请把 fetch 路径替换为远程 API
async function refreshAll(){
  // 重新读取 flight_data.txt（假设源会更新）
  try{
    const txt = await fetch("./data/flight_data.txt", {cache:"no-store"}).then(r => r.text());
    const newFlights = parseFlightData(txt).map(parseFlightObject);
    // 这里简单替换 flights（复杂场景可做 diff）
    flights = newFlights;
    // 重新 renderFlights 会重新构建 markers；但我们为平滑移动保留先前 marker 并在 updateFlightPositions 中移动
    renderFlights();
    // update positions immediately
    updateFlightPositions();
  }catch(e){
    console.error("刷新失败", e);
  }
}

function restartAutoRefresh(){
  if(refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(()=> {
    // 每次间隔到点做 update（也可调用 refreshAll 以重新拉取数据）
    refreshAll();
  }, refreshInterval * 1000);
}

// 启动 periodic animation tick（每秒更新目标位置并平滑）
setInterval(()=> {
  updateFlightPositions();
}, 1000);

// init toolbar placeholder (已在 DOM 绑定中实现)
function initToolbar(){
  // 隐藏 infoCard 点击地图关闭
  map.on('click', ()=> infoCard.classList.add('hidden'));
  // 显示初始 toggle 设置
  toggleFlightNoEl.checked = showFlightNo;
  toggleAirportLabelEl.checked = showAirportLabel;
  toggleAirportMarkerEl.checked = showAirportMarker;
  refreshIntervalEl.value = refreshInterval;
}

// ============ 启动加载 ============
loadData().catch(e => console.error(e));
