// ================== 配置与全局 ==================
const refreshIntervalDefault = 180000; // 自动刷新默认间隔（毫秒） = 180000ms = 180s = 3分钟
let refreshIntervalMs = refreshIntervalDefault;

let airportList = [];     // 原始数组形式
let airportDB = {};       // map: code -> airport {name,code,lat,lng,...}
let flights = [];         // 解析后的航班列表
let map, airportLayerGroup, flightLayerGroup;
let markers = {};         // flightNo -> marker
let airportMarkers = {};  // code -> marker (DivIcon)
let polyLines = {};       // flightNo -> polyline

let showFlightNo = localStorage.getItem("showFlightNo") === "true";
let showAirportLabels = localStorage.getItem("showAirportLabels") === "true";
let singleFlightHideOthers = false; // UI 控制隐藏其他航班（后台开关）
let animationFrameHandles = {}; // flightNo -> handle

// 飞机图标（你可以替换成自己PNG）
// 使用 PNG 时需保证图像朝上（0deg）表示指向北，然后我们 rotate 角度
const planeIconUrl = "https://i.imgur.com/4bZtV3y.png";

// ================== 启动 ==================
window.addEventListener("load", init);

async function init() {
  initMap();
  bindToolbar();
  await loadData();
  startAutoRefresh();
  window.addEventListener("resize", onResize);
}

// ================== 地图初始化 ==================
function initMap() {
  map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);

  // 主底图及备用底图（解决部分网络导致的空白 PNG）
  const base = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 7,
    subdomains: ['a','b','c'],
    attribution: '&copy; OpenStreetMap contributors',
    errorTileUrl: '' // 可替换为本地占位图路径
  });
  base.addTo(map);

  // 备用图层（Carto）— 如果主图出现问题，可注释掉上面，使用下面
  // L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {maxZoom:19}).addTo(map);

  airportLayerGroup = L.layerGroup().addTo(map);
  flightLayerGroup = L.layerGroup().addTo(map);
}

// ================== 读取数据 ==================
async function loadData() {
  // 加载机场数据
  try {
    airportList = await fetch("./airports.json").then(r => r.json());
    // 统一生成 airportDB map；也规范字段名 lat,lng
    airportDB = {};
    airportList.forEach(ap => {
      // normalize lng field (allow 'lon' or 'lng')
      if (ap.lon && !ap.lng) ap.lng = ap.lon;
      airportDB[ap.code] = ap;
    });
  } catch (e) {
    console.error("加载 airports.json 失败：", e);
    airportList = [];
    airportDB = {};
  }

  // 加载 flight_data.txt
  try {
    const txt = await fetch("./flight_data.txt").then(r => r.text());
    flights = parseFlightData(txt);
  } catch (e) {
    console.error("加载 flight_data.txt 失败：", e);
    flights = [];
  }

  // 更新 UI 控件初始状态
  document.getElementById("toggleFlightNo").checked = showFlightNo;
  document.getElementById("toggleAirportLabels").checked = showAirportLabels;

  // 渲染地图元素
  renderAirports();
  renderFlights(true); // true = instant place, also builds internal states
  refreshSidePanel();
}

// ================== 解析航班原始格式（支持多行） ==================
function parseFlightData(raw) {
  const list = [];
  // 我们逐行解析，每一行代表一个航班条目（按你给的格式）
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  lines.forEach(line => {
    // 取航班号：【HA1608】
    const flightNoMatch = line.match(/【([^】]+)】/);
    const flightNo = flightNoMatch ? flightNoMatch[1] : "";

    // 机型：〔波音737-800〕
    const aircraftMatch = line.match(/〔([^〕]+)〕/);
    const aircraft = aircraftMatch ? aircraftMatch[1] : "";

    // 航空公司：『豪金航空』
    const airlineMatch = line.match(/『([^』]+)』/);
    const airline = airlineMatch ? airlineMatch[1] : "";

    // 出发机场名字：《拜科努尔出发》
    const depMatch = line.match(/《([^》]+)出发》/);
    const dep = depMatch ? depMatch[1] : "";

    // 到达机场名字：《上海到达》
    const arrMatch = line.match(/《([^》]+)到达》/);
    const arr = arrMatch ? arrMatch[1] : "";

    // 出发时间 {0:30}
    const depTimeMatch = line.match(/《[^》]+出发》\{([^}]+)\}/);
    const depTime = depTimeMatch ? normalizeTimeString(depTimeMatch[1]) : "";

    // 出发后的 +#n# （出发通常是 +#0#）
    const depPlusMatch = line.match(/《[^》]+出发》\{[^}]+\}\s*\+#(\d+)#/);
    const depPlus = depPlusMatch ? parseInt(depPlusMatch[1]) : 0;

    // 到达时间 {11:20}
    const arrTimeMatch = line.match(/《[^》]+到达》\{([^}]+)\}/);
    const arrTime = arrTimeMatch ? normalizeTimeString(arrTimeMatch[1]) : "";

    // 到达后的 +#n#
    const arrPlusMatch = line.match(/《[^》]+到达》\{[^}]+\}\s*\+#(\d+)#/);
    const arrPlus = arrPlusMatch ? parseInt(arrPlusMatch[1]) : 0;

    // 注册号 <DF1729>
    const regMatch = line.match(/<([^>]+)>/);
    const reg = regMatch ? regMatch[1] : "";

    // 票价（简单抓取第一对 §...§ 作为经济舱）
    const priceMatch = line.match(/§([^§]+)§/);
    const price = priceMatch ? priceMatch[1] : "";

    // 周期 «MON,TUE,...»
    const weekMatch = line.match(/«([^»]+)»/);
    const weekStr = weekMatch ? weekMatch[1] : "";

    // 保存原始行（方便点击查看）
    list.push({
      raw: line,
      flightNo, aircraft, airline,
      dep, arr, depTime, arrTime, depPlus, arrPlus,
      reg, price, weekStr
    });
  });

  return list;
}

// 小工具：把 0:30 或 00:30 规范成 00:30
function normalizeTimeString(t) {
  t = t.trim();
  const parts = t.split(':').map(s => s.trim());
  if (parts.length === 1) parts.push('00');
  return parts.map(p => p.padStart(2,'0')).join(':');
}

// ================== 时间计算：把航班的 dep/arr 转成 Date（基于当天） ==================
// 规则：传入 baseDate（默认 today at 00:00 local），然后加上 depPlus/arrPlus（天数偏移）
// 返回 {depDate, arrDate, durationMin}
function getDepArrDateTimes(flight, baseDate = new Date()) {
  // baseDate 到 00:00
  const baseMid = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
  const [dh, dm] = flight.depTime.split(':').map(Number);
  const [ah, am] = flight.arrTime.split(':').map(Number);

  const depDate = new Date(baseMid.getTime());
  depDate.setDate(baseMid.getDate() + (flight.depPlus || 0));
  depDate.setHours(dh, dm, 0, 0);

  const arrDate = new Date(baseMid.getTime());
  arrDate.setDate(baseMid.getDate() + (flight.arrPlus || 0));
  arrDate.setHours(ah, am, 0, 0);

  const durationMin = Math.round((arrDate - depDate) / 60000);

  return { depDate, arrDate, durationMin };
}

// ================== 渲染机场（同心圆） ==================
function renderAirports() {
  airportLayerGroup.clearLayers();
  airportMarkers = {};
  for (const code in airportDB) {
    const ap = airportDB[code];
    if (!ap.lat || !ap.lng) continue;
    // DivIcon
    const html = `<div class="airport-marker" title="${ap.name} (${ap.code})">
      <div class="outer"></div><div class="inner"></div>
    </div>`;
    const icon = L.divIcon({
      className: '',
      html,
      iconSize: [18,18],
      iconAnchor: [9,9]
    });
    const mk = L.marker([ap.lat, ap.lng], { icon }).addTo(airportLayerGroup);
    mk.on('click', () => showAirportCard(ap));

    // label (像谷歌地图上的标签，使用 tooltip 或自建 div)
    if (showAirportLabels) {
      const labelHtml = `<div class="airport-label">${ap.name} (${ap.code})</div>`;
      const labelIcon = L.divIcon({ className:'airport-text', html: labelHtml, iconAnchor: [-8, -8] });
      const labelMk = L.marker([ap.lat, ap.lng], { icon: labelIcon, interactive: false }).addTo(airportLayerGroup);
      ap._labelMarker = labelMk;
    }
    airportMarkers[code] = mk;
  }
}

// ================== 渲染航班（主流程） ==================
function renderFlights(initial = false) {
  // 清理 polylines/markers（但如果是动画我们尝试平滑更新；为简单我们先清理每次重建）
  for (const k in polyLines) { try { map.removeLayer(polyLines[k]); } catch(e){} }
  for (const k in markers) {
    cancelAnimationFrame(animationFrameHandles[k]);
    try { map.removeLayer(markers[k]); } catch(e){}
  }
  polyLines = {};
  markers = {};
  flightLayerGroup.clearLayers();

  const filterID = getFlightIDFromURL(); // 单航班 url param 优先
  singleFlightHideOthers = document.getElementById("toggleSingleMode").checked;

  const now = new Date();

  flights.forEach(f => {
    // 如果 URL 指定了单航班，且不匹配则跳过
    if (filterID && f.flightNo.toUpperCase() !== filterID.toUpperCase()) return;

    // 机场定位
    const depA = airportByName(f.dep);
    const arrA = airportByName(f.arr);
    if (!depA || !arrA) return;

    // 计算 dep/arr Date
    const { depDate, arrDate } = getDepArrDateTimes(f, now);

    // 只显示当前正在执行或即将起飞/到达的航班（你原来逻辑是“飞行中才显示”）
    // 这里：如果 now 在 depDate 到 arrDate 之间，视为在飞行中
    if (now < depDate || now > arrDate) {
      // 若你想显示即将起飞/刚到达的航班可放宽条件
      return;
    }

    // 计算当前位置比例
    const totalMS = arrDate - depDate;
    const passedMS = now - depDate;
    const ratio = Math.max(0, Math.min(1, passedMS / totalMS));

    // 线路 polyline（可高亮）
    const line = L.polyline([[depA.lat,depA.lng],[arrA.lat,arrA.lng]], {
      color: filterID || (singleFlightHideOthers && document.getElementById("toggleSingleMode").checked) ? '#ff6f00' : '#ffa94d',
      weight: (filterID ? 4 : 2),
      dashArray: "6 6",
      opacity: (filterID ? 1 : 0.9)
    }).addTo(flightLayerGroup);
    polyLines[f.flightNo] = line;

    // 计算飞机坐标
    const lat = depA.lat + (arrA.lat - depA.lat) * ratio;
    const lng = depA.lng + (arrA.lng - depA.lng) * ratio;

    // 计算航向角（从当前位置指向到达点）
    const bearing = computeBearing(lat,lng,arrA.lat,arrA.lng);

    // 创建 plane 图标（image inside marker to allow rotate）
    const planeHtml = `<img class="plane-icon" src="${planeIconUrl}" style="transform:rotate(${bearing}deg) translate(-50%,-50%);">`;
    const planeIcon = L.divIcon({
      className: 'plane-divicon',
      html: planeHtml,
      iconSize: [40,40],
      iconAnchor: [20,20]
    });
    const mk = L.marker([lat,lng], { icon: planeIcon }).addTo(flightLayerGroup);
    mk.flight = f;
    markers[f.flightNo] = mk;

    // tooltip label for flightNo (可切换)
    if (showFlightNo) {
      mk.bindTooltip(f.flightNo, { permanent: true, direction: 'right', className: 'flight-label' }).openTooltip();
    }

    // 点击飞机显示详细卡
    mk.on('click', () => {
      showInfoCard(f, depA, arrA, depDate, arrDate);
    });

    // 平滑动画：每秒更新位置与旋转（基于 requestAnimationFrame）
    animatePlane(f, mk, depA, arrA, depDate, arrDate);

    // 如果开启单航班且URL里有值，隐藏其他航班 => 在 map 层通过 setOpacity 或 remove layer 实现
    if ((filterID || singleFlightHideOthers) && filterID && f.flightNo.toUpperCase() !== filterID.toUpperCase()) {
      // 已通过上面 filter 跳过不添加
    }
  });
}

// ============ 飞机平滑动画（每秒重绘但内部用 rAF 保证每帧插值） ============
function animatePlane(flight, marker, depA, arrA, depDate, arrDate) {
  const start = depDate.getTime();
  const end = arrDate.getTime();
  const flightKey = flight.flightNo;

  function step() {
    const now = Date.now();
    const t = Math.max(0, Math.min(1, (now - start) / (end - start)));
    const lat = depA.lat + (arrA.lat - depA.lat) * t;
    const lng = depA.lng + (arrA.lng - depA.lng) * t;
    marker.setLatLng([lat, lng]);

    // rotate towards destination
    const bearing = computeBearing(lat, lng, arrA.lat, arrA.lng);
    const el = marker.getElement();
    if (el) {
      const img = el.querySelector('img.plane-icon');
      if (img) img.style.transform = `rotate(${bearing}deg) translate(-50%,-50%)`;
    }

    // 更新侧边面板与 infoCard 里同航班进度（如果打开）
    updateFlightProgressUI(flight, t);

    animationFrameHandles[flightKey] = requestAnimationFrame(step);
  }

  // cancel previous if any
  if (animationFrameHandles[flightKey]) cancelAnimationFrame(animationFrameHandles[flightKey]);
  animationFrameHandles[flightKey] = requestAnimationFrame(step);
}

// ================== 计算航向角（经纬度） ==================
function computeBearing(lat1, lon1, lat2, lon2) {
  // convert to radians
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  const brng = Math.atan2(y, x);
  return (toDeg(brng) + 360) % 360;
}

// ================== 工具：机场查找（支持 code / name / aliases） ==================
function airportByName(nameOrCode) {
  if (!nameOrCode) return null;
  // 先按 code 匹配（忽略大小写）
  const upper = nameOrCode.trim().toUpperCase();
  if (airportDB[upper]) return airportDB[upper];

  // 遍历匹配 name 或 aliases 或包含
  for (const code in airportDB) {
    const ap = airportDB[code];
    if (!ap) continue;
    if (ap.code && ap.code.toUpperCase() === upper) return ap;
    if (ap.name && ap.name.includes(nameOrCode)) return ap;
    if (ap.aliases && ap.aliases.some(a => a.includes(nameOrCode))) return ap;
  }
  return null;
}

// ================== URL: ?flights_map=XXX 获取 ==================
function getFlightIDFromURL() {
  try {
    return new URLSearchParams(location.search).get("flights_map");
  } catch (e) { return null; }
}

// ================== 信息卡（底部）以及机场卡 ==================
function showInfoCard(f, depA, arrA, depDate, arrDate) {
  const card = document.getElementById("infoCard");
  const { depDate: dd, arrDate: ad, durationMin } = getDepArrDateTimes(f, new Date());
  // 找同注册号的前后序航程（按 flights 数组中相同 reg 的条目）
  const sameReg = flights.filter(x => x.reg && x.reg === f.reg);
  // 排序（以 depTime）
  const ordered = sameReg.sort((a,b)=>{
    const ta = (a.depTime || '00:00'), tb = (b.depTime || '00:00');
    return ta.localeCompare(tb);
  });

  const idx = ordered.findIndex(x => x.flightNo === f.flightNo);
  const prev = idx>0 ? ordered[idx-1] : null;
  const next = idx>=0 && idx<ordered.length-1 ? ordered[idx+1] : null;

  const progressPercent = (() => {
    const now = new Date();
    const {depDate, arrDate} = getDepArrDateTimes(f, new Date());
    const t = (now - depDate)/(arrDate - depDate);
    return Math.round(Math.max(0, Math.min(1, t))*100);
  })();

  card.innerHTML = `
    <div style="display:flex; gap:12px; align-items:center;">
      <img src="${planeIconUrl}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;">
      <div>
        <h3 style="margin:0">${f.flightNo} · ${f.airline}</h3>
        <div style="font-size:13px;color:gray">${f.aircraft} · 注册:${f.reg || '—'}</div>
      </div>
    </div>
    <hr />
    <div><b>出发：</b> ${depA.name || f.dep} (${f.depTime})</div>
    <div><b>到达：</b> ${arrA.name || f.arr} (${f.arrTime})</div>
    <div style="margin-top:8px">
      <div style="height:8px;background:#eee;border-radius:6px;overflow:hidden">
        <div style="width:${progressPercent}%;height:100%;background:linear-gradient(90deg,#ff8a00,#ffd89b)"></div>
      </div>
      <div style="font-size:12px;color:gray;margin-top:6px;">进度：${progressPercent}% · 航程约 ${Math.abs(getDepArrDateTimes(f).durationMin)} 分钟</div>
    </div>
    <div style="margin-top:8px;font-size:13px">
      ${prev?`<div><b>前序：</b> ${prev.flightNo} ${prev.dep} → ${prev.arr} (${prev.depTime})</div>` : ''}
      ${next?`<div><b>后序：</b> ${next.flightNo} ${next.dep} → ${next.arr} (${next.depTime})</div>` : ''}
    </div>
    <div style="margin-top:8px; text-align:right;">
      <button id="zoomToFlightBtn">缩放到航线</button>
      <button id="showRawBtn">查看原始</button>
    </div>
  `;
  card.classList.remove("hidden");

  document.getElementById("zoomToFlightBtn").onclick = () => {
    // 缩放到航线
    const latlngs = [[depA.lat, depA.lng], [arrA.lat, arrA.lng]];
    map.fitBounds(latlngs, {padding:[60,60]});
  };
  document.getElementById("showRawBtn").onclick = () => {
    alert(f.raw);
  };
}

function showAirportCard(ap) {
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <h3>${ap.name} (${ap.code})</h3>
    ${ap.level?`<div>等级：${ap.level}</div>` : ''}
    ${ap.runways?`<div>跑道数：${ap.runways}</div>` : ''}
    <div style="margin-top:8px"><button id="centerAp">缩放至该机场</button></div>
  `;
  card.classList.remove("hidden");
  document.getElementById("centerAp").onclick = () => {
    map.setView([ap.lat, ap.lng], 8);
  };
}

// 更新侧边面板里的进度显示（如果该航班条目在面板中）
function updateFlightProgressUI(flight, t) {
  // 如果侧边面板里有对应 flight-card，则更新进度条
  const el = document.querySelector(`.flight-card[data-flight="${flight.flightNo}"]`);
  if (!el) return;
  const pct = Math.round(t*100);
  const bar = el.querySelector('.progress-inner');
  if (bar) bar.style.width = pct + '%';
  const txt = el.querySelector('.progress-txt');
  if (txt) txt.textContent = `${pct}%`;
}

// ============ 侧边面板渲染（当前视窗内航班） ============
function refreshSidePanel() {
  const body = document.getElementById("panelBody");
  body.innerHTML = '';

  // 在 map bounds 内的 flight markers
  const bounds = map.getBounds();
  const visibleFlights = [];
  for (const fn in markers) {
    const mk = markers[fn];
    if (!mk) continue;
    const latlng = mk.getLatLng();
    if (bounds.contains(latlng)) {
      visibleFlights.push(mk.flight);
    }
  }

  if (visibleFlights.length === 0) {
    body.innerHTML = '<div style="color:gray">当前视野内没有航班。</div>';
    return;
  }

  visibleFlights.sort((a,b)=> a.flightNo.localeCompare(b.flightNo));
  visibleFlights.forEach(f => {
    const div = document.createElement('div');
    div.className = 'flight-card';
    div.dataset.flight = f.flightNo;
    // 起降机场对象
    const depA = airportByName(f.dep), arrA = airportByName(f.arr);
    const progressPct = (() => {
      const now = new Date();
      const dt = getDepArrDateTimes(f);
      return Math.max(0, Math.min(100, Math.round((now - dt.depDate)/(dt.arrDate - dt.depDate)*100)));
    })();
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><b>${f.flightNo}</b> · ${f.airline}</div>
        <div style="font-size:13px;color:gray">${f.depTime} → ${f.arrTime}</div>
      </div>
      <div style="margin-top:6px"><small>${depA?depA.code: f.dep} → ${arrA?arrA.code: f.arr}</small></div>
      <div style="margin-top:8px;height:8px;background:#eee;border-radius:6px;overflow:hidden">
        <div class="progress-inner" style="width:${progressPct}%;height:100%;background:linear-gradient(90deg,#ff8a00,#ffd89b)"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:13px">
        <div class="progress-txt">${progressPct}%</div>
        <div><button class="focusBtn">缩放</button> <button class="rawBtn">原始</button></div>
      </div>
    `;
    body.appendChild(div);

    div.querySelector('.focusBtn').onclick = () => {
      // 缩放到该航线
      const dep = airportByName(f.dep), arr = airportByName(f.arr);
      if (dep && arr) map.fitBounds([[dep.lat,dep.lng],[arr.lat,arr.lng]], {padding:[70,70]});
    };
    div.querySelector('.rawBtn').onclick = () => alert(f.raw);
  });
}

// ================== 绑定工具栏与控件事件 ==================
function bindToolbar() {
  document.getElementById("toggleFlightNo").addEventListener("change", e => {
    showFlightNo = e.target.checked;
    localStorage.setItem("showFlightNo", showFlightNo);
    renderFlights();
  });

  document.getElementById("toggleAirportLabels").addEventListener("change", e => {
    showAirportLabels = e.target.checked;
    localStorage.setItem("showAirportLabels", showAirportLabels);
    renderAirports();
  });

  document.getElementById("toggleSingleMode").addEventListener("change", e => {
    singleFlightHideOthers = e.target.checked;
    renderFlights();
  });

  // 搜索：支持航班号 / 机场三字码 / 机场名 / 注册号
  const searchInput = document.getElementById("searchInput");
  document.getElementById("searchBtn").addEventListener("click", doSearch);
  document.getElementById("clearSearch").addEventListener("click", ()=>{
    searchInput.value = "";
    renderFlights();
    refreshSidePanel();
  });
  searchInput.addEventListener("keydown", (e)=>{ if (e.key === "Enter") doSearch(); });

  // 刷新设置
  document.getElementById("refreshSeconds").addEventListener("change", e => {
    const sec = Number(e.target.value);
    if (!isNaN(sec) && sec >= 10) {
      refreshIntervalMs = sec * 1000;
      startAutoRefresh();
    }
  });
  document.getElementById("btnRefresh").addEventListener("click", manualRefresh);

  // panel toggle
  document.getElementById("panelToggle").addEventListener("click", togglePanel);
  document.getElementById("panelHeader").addEventListener("click", togglePanel);

  // 当地图移动（缩放/拖动）时刷新侧边面板
  map.on('moveend', refreshSidePanel);

  // URL 单航班检查（初始）
  const urlFlight = getFlightIDFromURL();
  if (urlFlight) {
    // 高亮并仅显示该航班
    document.getElementById("toggleSingleMode").checked = true;
    singleFlightHideOthers = true;
  }
}

// 搜索实现
function doSearch() {
  const q = document.getElementById("searchInput").value.trim();
  if (!q) { renderFlights(); refreshSidePanel(); return; }

  // 1) 匹配航班号 / 注册号
  const qUpper = q.toUpperCase();
  const matchedFlights = flights.filter(f => (f.flightNo && f.flightNo.toUpperCase().includes(qUpper)) || (f.reg && f.reg.toUpperCase().includes(qUpper)));
  if (matchedFlights.length > 0) {
    // 将地图移到第一个匹配并高亮（并隐藏其他）
    const first = matchedFlights[0];
    document.getElementById("toggleSingleMode").checked = true;
    singleFlightHideOthers = true;
    renderFlights();
    // 等待一点时间，让渲染完成再缩放
    setTimeout(()=> {
      const mk = markers[first.flightNo];
      if (mk) map.setView(mk.getLatLng(), 6);
      showInfoCard(first, airportByName(first.dep), airportByName(first.arr), ...Object.values(getDepArrDateTimes(first)));
    }, 200);
    return;
  }

  // 2) 匹配机场三字码或名称或 alias
  // 找到机场
  for (const code in airportDB) {
    const ap = airportDB[code];
    if (!ap) continue;
    if (ap.code && ap.code.toUpperCase() === qUpper || (ap.name && ap.name.includes(q)) || (ap.aliases && ap.aliases.some(a => a.includes(q)))) {
      // 缩放到机场并高亮在该机场出发或到达的航班
      map.setView([ap.lat, ap.lng], 6);
      // show flights that involve this airport
      const results = flights.filter(f => (f.dep && f.dep.includes(ap.name)) || (f.arr && f.arr.includes(ap.name)) || f.dep === ap.code || f.arr === ap.code);
      if (results.length > 0) {
        document.getElementById("toggleSingleMode").checked = false;
        singleFlightHideOthers = false;
        renderFlights();
        // highlight these - we will just open side panel
        refreshSidePanel();
        return;
      } else {
        alert("未在航班数据中找到涉及此机场的航班（请检查机场名与flight_data.txt格式）");
        return;
      }
    }
  }

  alert("未找到匹配项（支持：航班号、注册号、三字码、机场名或别名）");
}

// 手动刷新：重新加载 flight_data.txt（如果你是前端直接调用，有时可以从后端更新）
async function manualRefresh() {
  try {
    const txt = await fetch("./flight_data.txt", {cache: "no-store"}).then(r=>r.text());
    flights = parseFlightData(txt);
    renderFlights();
    refreshSidePanel();
  } catch (e) {
    console.error("刷新失败：", e);
    alert("刷新失败，请检查 flight_data.txt 是否可访问（浏览器控制台有错误）");
  }
}

// 自动刷新机制
let autoRefreshHandle = null;
function startAutoRefresh() {
  if (autoRefreshHandle) clearInterval(autoRefreshHandle);
  autoRefreshHandle = setInterval(() => {
    manualRefresh();
  }, refreshIntervalMs);
}

// 重新计算布局（响应式）
function onResize() {
  // 对移动端/平板进行面板适配
  if (window.innerWidth < 700) {
    document.getElementById("sidePanel").classList.add('panel-closed');
  } else {
    document.getElementById("sidePanel").classList.remove('panel-closed');
  }
}

// 切换侧边面板展开/收起
function togglePanel() {
  const p = document.getElementById("sidePanel");
  p.classList.toggle('panel-closed');
}

// ================== 辅助：在页面上查找某个航班并高亮（外部调用） ==================
function focusFlight(flightNo) {
  const mk = markers[flightNo];
  if (mk) {
    map.setView(mk.getLatLng(), 6);
    mk.openPopup && mk.openPopup();
  } else {
    alert('未找到航班：' + flightNo);
  }
}

// ========== 公共暴露（必要时在控制台调用） ==========
window.FlightMap = {
  refresh: manualRefresh,
  focusFlight,
  getFlights: () => flights,
  getAirports: () => airportDB
};
