// ============ 配置 ============
// 刷新间隔（毫秒），可修改
const REFRESH_INTERVAL = 180000; // 默认 3 分钟
// 飞机图标 URL（可替换）
const PLANE_ICON_URL = "https://i.imgur.com/4bZtV3y.png";
// 飞行平滑帧速 (ms) 用以 requestAnimationFrame 里插值
const FRAME_INTERVAL = 1000; // 每秒更新位置（你可以改为 200ms 实现更平滑）

// ============ 地图初始化 ============
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 }).addTo(map);

let airportDB = {};
let flights = [];        // 解析后的航班数组
let markers = {};        // 机位 marker keyed by flightNo|reg
let airportMarkers = {}; // 所有机场 marker keyed by code
let polyLines = {};
let animationTimer = null;
let lastRenderTime = 0;

let showFlightNo = localStorage.getItem("showFlightNo") === "true";
let showAirportLabels = (localStorage.getItem("showAirportLabels") === "true");

// DOM refs
const infoCard = document.getElementById("infoCard");
const statusText = document.getElementById("statusText");
const flightListEl = document.getElementById("flightList");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const clearSearch = document.getElementById("clearSearch");
const toggleFlightNoEl = document.getElementById("toggleFlightNo");
const toggleAirportLabelsEl = document.getElementById("toggleAirportLabels");
const refreshBtn = document.getElementById("refreshBtn");
const refreshIntervalLabel = document.getElementById("refreshIntervalLabel");

// init toggles state
toggleFlightNoEl.checked = showFlightNo;
toggleAirportLabelsEl.checked = showAirportLabels;
refreshIntervalLabel.textContent = (REFRESH_INTERVAL/1000) + "s";

// ============ 读取数据 ============
async function loadData() {
  try {
    statusText.textContent = "加载 airport 数据…";
    const airportResp = await fetch("../data/airports.json");
    airportDB = await airportResp.json();

    statusText.textContent = "加载 flight 数据…";
    const txt = await fetch("../data/flight_data.txt").then(r => r.text());
    flights = parseFlightData(txt);

    statusText.textContent = `解析完成：${flights.length} 条航班`;
    renderAirportMarkers(); // 先绘制所有机场
    renderFlights(true);

    // 自动刷新定时器
    setInterval(()=> {
      statusText.textContent = `自动刷新：${new Date().toLocaleTimeString()}`;
      // 重新读取 flight_data.txt（假设文件会更新）
      fetch("../data/flight_data.txt").then(r=>r.text()).then(t=>{
        flights = parseFlightData(t);
        renderFlights();
      });
    }, REFRESH_INTERVAL);

  } catch (err) {
    console.error(err);
    statusText.textContent = "加载数据失败，请检查控制台。";
  }
}

// ============ 解析新版航班格式 ============
/*
  支持提取字段：
  - flightNo: 【...】
  - aircraftModel: 〔...〕
  - airline: 『...』
  - dep / arr: 《...出发》 / 《...到达》
  - depTime / arrTime: {HH:MM}
  - depOffset / arrOffset: #+1# 等（跨日标识）
  - depTerminal / arrTerminal: @T1...（紧跟在时间后面的 @T1 字段）
  - prices: §...§ / θ...θ / △...△ （三种舱位）
  - reg: <DF1729>
  - id: registration if provided (reg)
  - raw: 原始字符串
*/
function parseFlightData(raw) {
  const list = [];
  // 把多行拆成条目。假设每条以 "【" 开头或以 "《航班结束》" 结束，我们用正则抓取每个条目
  // 简化：抓取所有以 【开头直到<航班结束> 或下一个 【 的块
  const entryRe = /【[\s\S]*?(?:《航班结束》|$)/g;
  let m;
  while ((m = entryRe.exec(raw)) !== null) {
    const block = m[0];
    const flightNo = (block.match(/【(.*?)】/)||[])[1] || "";
    const aircraftModel = (block.match(/〔(.*?)〕/)||[])[1] || "";
    const airline = (block.match(/『(.*?)』/)||[])[1] || "";

    // dep & arr names
    const depName = (block.match(/《(.*?)出发》/)||[])[1] || "";
    const arrName = (block.match(/《(.*?)到达》/)||[])[1] || "";

    // times and offsets and terminals for dep/arr
    const depTimeMatch = block.match(/《.*?出发》\s*\{([0-2]?\d:[0-5]\d)\}/);
    const arrTimeMatch = block.match(/《.*?到达》\s*\{([0-2]?\d:[0-5]\d)\}/);
    const depTime = depTimeMatch ? depTimeMatch[1] : "";
    const arrTime = arrTimeMatch ? arrTimeMatch[1] : "";

    const depOffsetMatch = block.match(/《.*?出发》[\s\S]*?\}([^@\s]*)/);
    const arrOffsetMatch = block.match(/《.*?到达》[\s\S]*?\}([^@\s]*)/);
    // 尝试从匹配片段抓取 #+1# 或 #+0#
    const depOffset = depOffsetMatch && /#\+?(-?\d+)#/.test(depOffsetMatch[1]) ? Number((depOffsetMatch[1].match(/#\+?(-?\d+)#/)||[])[1]) : 0;
    const arrOffset = arrOffsetMatch && /#\+?(-?\d+)#/.test(arrOffsetMatch[1]) ? Number((arrOffsetMatch[1].match(/#\+?(-?\d+)#/)||[])[1]) : 0;

    // terminals
    const depTerminal = (block.match(/《.*?出发》[\s\S]*?\@([^\s@#]+)/) || [,,])[1] || "";
    const arrTerminal = (block.match(/《.*?到达》[\s\S]*?\@([^\s@#]+)/) || [,,])[1] || "";

    // prices
    const price1 = (block.match(/§(.*?)§/)||[])[1] || "";
    const price2 = (block.match(/θ(.*?)θ/)||[])[1] || "";
    const price3 = (block.match(/△(.*?)△/)||[])[1] || "";

    // registration / id
    const reg = (block.match(/<([^>]+)>/)||[])[1] || "";

    // determine id key (reg优先)
    const id = reg || flightNo || "";

    // push
    list.push({
      raw: block,
      flightNo,
      aircraftModel,
      airline,
      dep: depName,
      arr: arrName,
      depTime,
      arrTime,
      depOffset: Number.isFinite(depOffset) ? depOffset : 0,
      arrOffset: Number.isFinite(arrOffset) ? arrOffset : 0,
      depTerminal,
      arrTerminal,
      prices: { p1: price1, p2: price2, p3: price3 },
      reg,
      id
    });
  }
  return list;
}

// ============ 工具函数 ============
function timeToMinutesHhmm(t) {
  if (!t) return null;
  const [h,m] = t.split(":").map(s=>Number(s));
  return h*60 + (m||0);
}
function getFlightIDFromURL() { return new URLSearchParams(location.search).get("flights_map"); }
function airportByName(name) {
  if (!name) return null;
  name = name.trim();
  // airportDB is array or object — support both
  if (Array.isArray(airportDB)) {
    for (let a of airportDB) {
      if ((a.name && a.name === name) || (a.code && a.code === name) || (a.aliases && a.aliases.includes(name)) ) return a;
      // fuzzy includes
      if (a.name && a.name.includes(name)) return a;
    }
  } else {
    for (let code in airportDB) {
      const a = airportDB[code];
      if (!a) continue;
      if (a.code === name || a.name === name) return a;
      if (a.aliases && a.aliases.includes(name)) return a;
      if (a.city && a.city === name) return a;
      if (a.name && a.name.includes(name)) return a;
    }
  }
  // try case-insensitive search over name/code/aliases
  const lname = name.toLowerCase();
  if (Array.isArray(airportDB)) {
    for (let a of airportDB) {
      if ((a.code && a.code.toLowerCase() === lname) || (a.name && a.name.toLowerCase().includes(lname))) return a;
      if (a.aliases) {
        for (let al of a.aliases) if (al.toLowerCase() === lname) return a;
      }
    }
  } else {
    for (let code in airportDB) {
      const a = airportDB[code];
      if (!a) continue;
      if ((a.code && a.code.toLowerCase() === lname) || (a.name && a.name.toLowerCase().includes(lname))) return a;
      if (a.aliases) for (let al of a.aliases) if (al.toLowerCase() === lname) return a;
    }
  }
  return null;
}

// rotate icon direction helper
function bearingBetween(lat1, lon1, lat2, lon2){
  // returns degrees from N
  const y = Math.sin((lon2-lon1)*Math.PI/180) * Math.cos(lat2*Math.PI/180);
  const x = Math.cos(lat1*Math.PI/180)*Math.sin(lat2*Math.PI/180) - Math.sin(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.cos((lon2-lon1)*Math.PI/180);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  brng = (brng + 360) % 360;
  return brng;
}

// create plane icon with rotation applied via CSS transform on img element in marker
function createPlaneIcon(angle=0, size=32) {
  // use a DivIcon with an img inside so we can rotate
  const html = `<img src="${PLANE_ICON_URL}" style="width:${size}px;height:${size}px;transform:rotate(${angle}deg);">`;
  return L.divIcon({ className: 'plane-icon', html, iconSize: [size,size], iconAnchor: [size/2, size/2] });
}

// ============ 绘制机场（常态化显示） ============
function renderAirportMarkers(){
  // clear existing
  for (let k in airportMarkers) {
    try { map.removeLayer(airportMarkers[k]); } catch(e){}
  }
  airportMarkers = {};

  const arr = Array.isArray(airportDB) ? airportDB : Object.values(airportDB);
  arr.forEach(a=>{
    if (!a.lat && !a.lon && !a.lng) return;
    const lat = a.lat || a.lat;
    const lng = a.lon || a.lng || a.lng;
    const code = a.code || (a.name && a.name.slice(0,3).toUpperCase()) || "";
    // build a divIcon with concentric small circles via inline SVG for nicer concentric visuals
    const svg = `
      <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="20" fill="rgba(255,255,255,0.9)" stroke="rgba(0,0,0,0.06)" stroke-width="2"/>
        <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(0,0,0,0.03)" stroke-width="1"/>
        <text x="32" y="34" text-anchor="middle" font-size="12" font-family="Arial" fill="black">${code}</text>
      </svg>`;
    const icon = L.divIcon({
      className: 'airport-circle',
      html: svg,
      iconSize: [40,40],
      iconAnchor: [20,20]
    });
    const mk = L.marker([lat, lng], {icon}).addTo(map);
    mk.on("click", ()=>showAirportCard(a));
    mk.airport = a;
    airportMarkers[a.code || a.name] = mk;

    // label (separate) for name and code if enabled
    if (showAirportLabels) {
      const label = L.marker([lat + 0.06, lng], { // small offset to avoid overlap
        icon: L.divIcon({className:'airport-label', html:`<div style="font-size:12px;font-weight:700;">${a.name} <span style="opacity:0.8">(${a.code})</span></div>`})
      }).addTo(map);
      airportMarkers[(a.code||a.name)+"_lbl"] = label;
    }
  });
}

// show or hide airport labels (re-render markers)
function toggleAirportLabels(show){
  showAirportLabels = !!show;
  localStorage.setItem("showAirportLabels", showAirportLabels);
  renderAirportMarkers();
}

// ============ 渲染航班（含动画） ============
function renderFlights(initial=false) {
  const filterID = getFlightIDFromURL();
  statusText.textContent = `渲染航班（共 ${flights.length} 条）`;
  // remove existing flight markers & polylines
  for (let k in markers) try{ map.removeLayer(markers[k]) }catch(e){}
  for (let k in polyLines) try{ map.removeLayer(polyLines[k]) }catch(e){}
  markers = {}; polyLines = {};
  flightListEl.innerHTML = "";

  // ensure airport markers exist
  renderAirportMarkers();

  // iterate flights
  flights.forEach((f, idx) => {
    // if filterID present and not match flightNo or reg then skip (but still allow highlighting option to hide others)
    const urlID = filterID ? filterID.toUpperCase() : null;
    const idMatches = urlID ? ( (f.flightNo && f.flightNo.toUpperCase() === urlID) || (f.reg && f.reg.toUpperCase() === urlID) || (f.id && f.id.toUpperCase() === urlID) ) : true;
    if (filterID && !idMatches) return;

    // find airports
    const depA = airportByName(f.dep);
    const arrA = airportByName(f.arr);
    if (!depA || !arrA) {
      // still add to list with missing info
      const el = makeFlightListItem(f, idx, depA, arrA);
      flightListEl.appendChild(el);
      return;
    }

    // compute dep/arr absolute minutes using 东八区规则；考虑跨日偏移（depOffset/arrOffset）
    const depMin = timeToMinutesHhmm(f.depTime);
    const arrMin = timeToMinutesHhmm(f.arrTime);
    if (depMin === null || arrMin === null) return;

    // convert to minutes since day 0: take today as base in local east-8 reference: simplify by using Date in local system but treat times as E8
    // Simpler approach: compute flight window length in minutes accounting for offset
    const startMin = depMin + (f.depOffset||0)*24*60;
    const endMin = arrMin + (f.arrOffset||0)*24*60;
    if (endMin <= startMin) {
      // if end <= start, assume arrival next day
      // but respect arrOffset if provided
      if (!f.arrOffset) {
        // set arr next day
        // Note: keep simple: add 24h
        // (This covers malformed data)
        // endMin = startMin + Math.max(30, (arrMin+24*60 - depMin));
      }
    }

    // determine "now" relative minutes in east+8 timezone
    // We'll treat system local time as baseline, but interpret times as east+8 by converting local to UTC offset
    const now = new Date();
    // convert now to minutes since today's midnight in UTC+8:
    const utc = now.getTime() + (now.getTimezoneOffset()*60000);
    const tz8 = new Date(utc + 8*3600000);
    const nowMinutesDay = tz8.getHours()*60 + tz8.getMinutes();
    // compute candidate absolute now minute for comparison: consider possibility of now being in window crossing midnight
    // We'll check two windows for this flight: base day (depOffset applied) and base day +/-24h to find if 'now' falls within.
    let inWindow = false;
    let ratio = 0;
    // try base day start at day0 = 0 (where depOffset already applied)
    // compute diff between nowMinutesDay and startMin modulo 24h
    // For simplicity, compute windowStartAbsolute = startMin (modulo weeks)
    // Check if nowMinutesDay (plus possible day offset) in [startMin, endMin]
    const candidates = [0, -24*60, 24*60];
    let chosenNowAbs = null;
    for (let d of candidates) {
      const nowAbs = nowMinutesDay + d;
      if (nowAbs >= startMin && nowAbs <= endMin) {
        inWindow = true;
        ratio = (nowAbs - startMin) / (endMin - startMin);
        chosenNowAbs = nowAbs;
        break;
      }
    }

    if (!inWindow) return; // only show flights that are currently in-flight

    // position interpolation
    const lat = depA.lat + (arrA.lat - depA.lat) * ratio;
    const lng = depA.lon + (arrA.lon - depA.lon) * ratio;

    // draw polyline
    const line = L.polyline([[depA.lat, depA.lon],[arrA.lat, arrA.lon]], {
      color:"orange", weight:2, dashArray:"6 6", opacity: 0.8
    }).addTo(map);
    polyLines[f.flightNo + "_" + idx] = line;

    // compute bearing for rotation
    const brng = bearingBetween(depA.lat, depA.lon, arrA.lat, arrA.lon);

    // plane marker (divIcon so can rotate)
    const icon = createPlaneIcon(brng, 36);
    const mk = L.marker([lat, lng], {icon}).addTo(map);
    mk.flight = f;
    mk.idx = idx;
    mk.on("click",()=>showInfoCard(f, depA, arrA, idx));
    markers[f.flightNo + "_" + (f.reg||idx)] = mk;

    // flight label
    if (showFlightNo) {
      mk.bindTooltip(f.flightNo || f.reg, {permanent:true, direction:"right", className:"flight-label"});
    }

    // add airport small markers for dep and arr (non-duplicated)
    addAirportMarkerIfMissing(depA);
    addAirportMarkerIfMissing(arrA);

    // push item into left panel
    const el = makeFlightListItem(f, idx, depA, arrA);
    flightListEl.appendChild(el);
  });

  // if URL filter specified, zoom to single flight if exists
  const urlID = getFlightIDFromURL();
  if (urlID) {
    // find marker that matches
    for (let key in markers) {
      const mk = markers[key];
      const f = mk.flight;
      if (!f) continue;
      if (f.flightNo.toUpperCase() === urlID.toUpperCase() || (f.reg && f.reg.toUpperCase() === urlID.toUpperCase())) {
        map.setView(mk.getLatLng(), 5, {animate:true});
        mk.openTooltip && mk.openTooltip();
      }
    }
  }

  // start animation loop for smooth update
  startAnimationLoop();
}

// helper to add airport marker only if not exists
function addAirportMarkerIfMissing(a){
  if (!a) return;
  const key = a.code || a.name;
  if (airportMarkers[key]) return;
  // create a simple dot marker (reuse renderAirportMarkers would create all)
  renderAirportMarkers();
}

// create left panel item
function makeFlightListItem(f, idx, depA, arrA){
  const div = document.createElement("div");
  div.className = "flight-item";
  const depTxt = depA ? `${depA.name} (${depA.code})` : f.dep || "未知";
  const arrTxt = arrA ? `${arrA.name} (${arrA.code})` : f.arr || "未知";
  div.innerHTML = `
    <h4>${f.flightNo || ""} ${f.reg?` · ${f.reg}`:""}</h4>
    <p>${depTxt} → ${arrTxt}</p>
    <p>${f.depTime || ""} - ${f.arrTime || ""} ${f.depOffset||f.arrOffset?`(跨日:${f.arrOffset||0})`:""}</p>
    <p style="opacity:0.9">${f.airline || ""} ${f.aircraftModel?`· ${f.aircraftModel}`:""} ${f.prices.p1?`· ${f.prices.p1}`:""}</p>
  `;
  div.addEventListener("click", ()=>{
    // find corresponding marker and open card, center map
    for (let k in markers) {
      const mk = markers[k];
      if (mk && mk.flight === f) {
        map.panTo(mk.getLatLng(), {animate:true});
        showInfoCard(f, depA, arrA, idx);
        return;
      }
    }
    // if no marker (e.g., missing airports) just show card
    showInfoCard(f, depA, arrA, idx);
  });
  return div;
}

// ============ 信息卡片 ============
function showInfoCard(f, depA, arrA, idx){
  const prevIdx = (idx-1+flights.length)%flights.length;
  const nextIdx = (idx+1)%flights.length;
  infoCard.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h3 style="margin:0">${f.flightNo || ""} ${f.reg?`· ${f.reg}`:""}</h3>
      <div>
        <button class="btn ghost" id="prevBtn">上一程</button>
        <button class="btn ghost" id="nextBtn">下一程</button>
      </div>
    </div>
    <p style="margin:8px 0;"><b>${f.airline || ""}</b> · ${f.aircraftModel || ""}</p>
    <p style="margin:6px 0;"><b>航程：</b>${f.dep || ""} → ${f.arr || ""}</p>
    <p style="margin:6px 0;"><b>时间：</b>${formatTimeWithOffset(f.depTime,f.depOffset)} → ${formatTimeWithOffset(f.arrTime,f.arrOffset)} （东八区）</p>
    <p style="margin:6px 0;"><b>航站楼：</b>${f.depTerminal||"-"} → ${f.arrTerminal||"-"}</p>
    <p style="margin:6px 0;"><b>票价：</b>${f.prices.p1||"-"} / ${f.prices.p2||"-"} / ${f.prices.p3||"-"}</p>
    <p style="margin:6px 0;"><b>原始：</b><small style="opacity:0.8">${escapeHtml(f.raw).slice(0,180)}${f.raw.length>180?"...":""}</small></p>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="btn primary" id="centerFlight">定位</button>
      <button class="btn ghost" id="copyRaw">复制原始</button>
      <button class="btn secondary" id="closeCard">关闭</button>
    </div>
  `;
  infoCard.classList.remove("hidden");

  // button handlers
  document.getElementById("closeCard").onclick = ()=> infoCard.classList.add("hidden");
  document.getElementById("centerFlight").onclick = ()=>{
    // center to marker if exists
    for (let k in markers) {
      const mk = markers[k];
      if (mk && mk.flight === f) {
        map.setView(mk.getLatLng(), 5, {animate:true});
        return;
      }
    }
  };
  document.getElementById("copyRaw").onclick = ()=>{
    navigator.clipboard && navigator.clipboard.writeText(f.raw || "");
    alert("已复制原始文本");
  };
  document.getElementById("prevBtn").onclick = ()=>{
    const prev = flights[prevIdx];
    if (prev) showInfoCard(prev, airportByName(prev.dep), airportByName(prev.arr), prevIdx);
  };
  document.getElementById("nextBtn").onclick = ()=>{
    const next = flights[nextIdx];
    if (next) showInfoCard(next, airportByName(next.dep), airportByName(next.arr), nextIdx);
  };
}

// small helper
function formatTimeWithOffset(t, offset) {
  if (!t) return "-";
  return `${t}${(offset && offset!==0) ? ` (+${offset}d)` : ""}`;
}
function escapeHtml(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// ============ 动画循环：每秒更新飞机位置 ============
function startAnimationLoop(){
  if (animationTimer) return;
  function step(){
    lastRenderTime = Date.now();
    // update every marker position based on current time and its flight window
    for (let k in markers) {
      const mk = markers[k];
      const f = mk.flight;
      if (!f) continue;
      const depA = airportByName(f.dep);
      const arrA = airportByName(f.arr);
      if (!depA || !arrA) continue;
      const depMin = timeToMinutesHhmm(f.depTime);
      const arrMin = timeToMinutesHhmm(f.arrTime);
      const startMin = depMin + (f.depOffset||0)*24*60;
      const endMin = arrMin + (f.arrOffset||0)*24*60;
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset()*60000);
      const tz8 = new Date(utc + 8*3600000);
      const nowMinutesDay = tz8.getHours()*60 + tz8.getMinutes() + tz8.getSeconds()/60;
      // check candidates with +/-24h
      const candidates = [0, -24*60, 24*60];
      let found=false, ratio=0;
      for (let d of candidates) {
        const nowAbs = nowMinutesDay + d;
        if (nowAbs >= startMin && nowAbs <= endMin) {
          found=true;
          ratio = (nowAbs - startMin) / (endMin - startMin);
          break;
        }
      }
      if (!found) {
        // hide marker if out of window
        try { mk.setOpacity(0.0); } catch(e){}
        continue;
      }
      // show and interpolate
      try { mk.setOpacity(1.0); } catch(e){}
      const lat = depA.lat + (arrA.lat - depA.lat) * ratio;
      const lng = depA.lon + (arrA.lon - depA.lon) * ratio;
      // rotate toward destination slowly (bearing)
      const brng = bearingBetween(depA.lat, depA.lon, arrA.lat, arrA.lon);
      // replace icon with rotated img (cheap but effective)
      const html = `<img src="${PLANE_ICON_URL}" style="width:36px;height:36px;transform:rotate(${brng}deg);">`;
      mk.setIcon(L.divIcon({className:'plane-icon', html, iconSize:[36,36], iconAnchor:[18,18]}));
      mk.setLatLng([lat, lng]);
    }
    // schedule next update
    animationTimer = setTimeout(()=> requestAnimationFrame(step), FRAME_INTERVAL);
  }
  requestAnimationFrame(step);
}

// ============ 搜索 / 清除 / UI 交互 ============
searchBtn.addEventListener("click", ()=>{
  const q = (searchInput.value || "").trim();
  if (!q) return alert("请输入查询内容");
  // try search by flightNo/reg/code/alias/name
  const ql = q.toLowerCase();
  // try to find flights that match
  const found = flights.filter(f=>{
    return (f.flightNo && f.flightNo.toLowerCase().includes(ql)) ||
           (f.reg && f.reg.toLowerCase().includes(ql)) ||
           (f.dep && f.dep.toLowerCase().includes(ql)) ||
           (f.arr && f.arr.toLowerCase().includes(ql)) ||
           (f.airline && f.airline.toLowerCase().includes(ql));
  });
  if (found.length === 0) return alert("未找到匹配航班");
  // reuse render: zoom to first match and show card
  const target = found[0];
  // find marker for target
  for (let k in markers) {
    const mk = markers[k];
    if (mk && mk.flight === target) {
      map.setView(mk.getLatLng(), 5, {animate:true});
      showInfoCard(target, airportByName(target.dep), airportByName(target.arr), flights.indexOf(target));
      return;
    }
  }
  // otherwise, show info card directly
  showInfoCard(target, airportByName(target.dep), airportByName(target.arr), flights.indexOf(target));
});
clearSearch.addEventListener("click", ()=> {
  searchInput.value = "";
});

// toggle flight label
toggleFlightNoEl.addEventListener("change", ()=>{
  showFlightNo = toggleFlightNoEl.checked;
  localStorage.setItem("showFlightNo", showFlightNo);
  // re-render flights to update tooltips
  renderFlights();
});
toggleAirportLabelsEl.addEventListener("change", ()=>{
  toggleAirportLabels(toggleAirportLabelsEl.checked);
});

// refresh button
refreshBtn.addEventListener("click", ()=>{
  statusText.textContent = "手动刷新…";
  fetch("../data/flight_data.txt").then(r=>r.text()).then(t=>{
    flights = parseFlightData(t);
    renderFlights();
    statusText.textContent = `手动刷新完成：${new Date().toLocaleTimeString()}`;
  });
});

// ============ 小工具 ============
// convert "HH:MM" to minutes
function timeToMinutesHhmm(t) {
  if (!t) return 0;
  const [h,m] = t.split(":").map(Number);
  return h*60 + (m||0);
}

// show airport card (reuse)
function showAirportCard(ap){
  const card = document.getElementById("infoCard");
  card.innerHTML=`
    <h3>${ap.name} (${ap.code})</h3>
    ${ap.level?`<p><b>机场等级：</b>${ap.level}</p>`:""}
    ${ap.runways?`<p><b>跑道数量：</b>${ap.runways}</p>`:""}
    <p style="margin-top:8px;"><small>别名：${(ap.aliases||[]).join(", ")}</small></p>
    <div style="margin-top:10px;"><button class="btn secondary" id="closeCard2">关闭</button></div>
  `;
  card.classList.remove("hidden");
  document.getElementById("closeCard2").onclick = ()=> card.classList.add("hidden");
}

// 启动加载
loadData();
