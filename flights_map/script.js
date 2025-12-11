// ================== 全局配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png";

// 图层配置
const LAYERS = {
  // 纯净底图 (Positron No Labels 类似风格) - 使用 CartoDB
  clean: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy;OpenStreetMap, &copy;CartoDB',
    subdomains: 'abcd',
    maxZoom: 19
  }),
  // 卫星图 (Esri)
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 17
  })
};

// 状态管理
let state = {
  refreshInterval: Number(localStorage.getItem("refreshInterval") || 180),
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
  
  // 运行时数据
  airportDB: {},
  flights: [],
  activeLayer: 'clean',
  focusFlight: null, // 当前专注的航班对象
  focusMode: false,
};

// 运行时对象存储
let mapObjects = {
  markers: {}, // key: airportCode
  flightLines: {}, // key: reg
  flightMarkers: {}, // key: reg
};

// 初始化地图
const map = L.map('map', { 
  zoomControl: false, 
  attributionControl: false,
  minZoom: 2,
  worldCopyJump: true
}).setView([35, 105], 4); // 中国中心

// 添加默认底图
LAYERS.clean.addTo(map);

// ================== 核心逻辑：数据加载 ==================

async function loadData() {
  try {
    // 加载机场
    const apRes = await fetch(AIRPORTS_PATH);
    let apData = await apRes.json();
    if (Array.isArray(apData)) {
      // 转换数组为对象，便于查找
      state.airportDB = {};
      apData.forEach(ap => {
        const code = ap.code || (ap.name ? ap.name.slice(0,3).toUpperCase() : "UNK");
        // 解析等级，用于避让逻辑 (4F=10, 4E=8, 4D=6...)
        let rank = 1;
        if(ap.level) {
          if(ap.level.includes("4F")) rank = 10;
          else if(ap.level.includes("4E")) rank = 8;
          else if(ap.level.includes("4D")) rank = 6;
          else if(ap.level.includes("4C")) rank = 4;
        }
        ap.rank = rank;
        state.airportDB[code] = ap;
      });
    } else {
        state.airportDB = apData;
    }

    // 加载航班
    const fltText = await fetch(FLIGHT_DATA_PATH).then(r => r.text());
    state.flights = parseFlightData(fltText);

    // 渲染
    renderAirports();
    renderFlights();
    updateCollisions(); // 初始避让计算

  } catch (e) {
    console.error("数据加载失败:", e);
  }
}

// 解析器 (保持原有逻辑)
function parseFlightData(raw) {
  const entries = [];
  const parts = raw.split("《航班结束》");
  for (let block of parts) {
    block = block.trim();
    if (!block) continue;
    const getVal = (reg) => { const m = block.match(reg); return m ? m[1].trim() : ""; };
    
    // 基础信息
    const flightNo = getVal(/【\s*([^\]　]+)\s*】/);
    const planeType = getVal(/〔\s*([^\]　]+)\s*〕/);
    const airline = getVal(/『\s*([^』]+)\s*』/);
    const reg = getVal(/<\s*([^>]+)\s*>/);

    // 出发
    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const depName = depMatch ? depMatch[1].trim() : "";
    const depTimeRaw = depMatch ? depMatch[2].trim() : "";
    const depOffset = depMatch && depMatch[3] ? Number(depMatch[3].replace(/[^\d]/g,"")) : 0;

    // 到达
    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const arrName = arrMatch ? arrMatch[1].trim() : "";
    const arrTimeRaw = arrMatch ? arrMatch[2].trim() : "";
    const arrOffset = arrMatch && arrMatch[3] ? Number(arrMatch[3].replace(/[^\d]/g,"")) : 0;

    entries.push({ flightNo, planeType, airline, reg, dep: depName, depTimeRaw, depOffset, arr: arrName, arrTimeRaw, arrOffset, raw: block });
  }
  return entries;
}

// ================== 核心逻辑：智能渲染与避让 ==================

// 渲染所有机场 (创建 Marker，但显隐由 updateCollisions 控制)
function renderAirports() {
  for (let code in state.airportDB) {
    if (mapObjects.markers[code]) continue; // 已存在

    const ap = state.airportDB[code];
    const lat = ap.lat || ap.latitude;
    const lng = ap.lon || ap.lng || ap.longitude;
    if (!lat || !lng) continue;

    // HTML 结构：点 + 文字
    const isHighRank = (ap.rank >= 8);
    const html = `
      <div class="airport-marker ${isHighRank?'rank-high':''}">
        <div class="airport-dot"></div>
        <div class="airport-text" style="display:${state.showAirportName?'block':'none'}">
          <span style="font-weight:700">${ap.name}</span>
          <span style="display:${state.showAirportCode?'inline':'none'};opacity:0.6;margin-left:4px">${code}</span>
        </div>
      </div>
    `;
    
    const icon = L.divIcon({ className: 'custom-airport-icon', html: html, iconAnchor: [6, 6] });
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    
    // 绑定数据到 marker 对象以便后续检索
    marker.apData = ap;
    marker.on('click', () => showAirportInfo(ap));
    mapObjects.markers[code] = marker;
  }
}

// 避让算法：在地图移动/缩放时调用
function updateCollisions() {
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  
  // 1. 获取视野内的所有机场
  const visibleMarkers = [];
  for (let code in mapObjects.markers) {
    const m = mapObjects.markers[code];
    const latLng = m.getLatLng();
    if (bounds.contains(latLng)) {
      visibleMarkers.push({ 
        marker: m, 
        point: map.latLngToLayerPoint(latLng), // 转为屏幕像素坐标
        rank: m.apData.rank || 1 
      });
    } else {
      // 视野外的直接隐藏 DOM (通过 class)
      L.DomUtil.addClass(m.getElement(), 'hidden-marker');
    }
  }

  // 2. 按重要性排序 (4F在前)
  visibleMarkers.sort((a, b) => b.rank - a.rank);

  // 3. 碰撞检测
  const accepted = [];
  const MIN_DIST = zoom < 5 ? 25 : 45; // 像素阈值，缩放越小阈值越小

  visibleMarkers.forEach(item => {
    let collision = false;
    for (let acc of accepted) {
      const dx = item.point.x - acc.point.x;
      const dy = item.point.y - acc.point.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < MIN_DIST) {
        collision = true;
        break;
      }
    }

    const el = item.marker.getElement();
    if (collision) {
      // 发生碰撞，且当前项 Rank 较低（因为已排序），隐藏
      if (el) L.DomUtil.addClass(el, 'hidden-marker');
    } else {
      if (el) {
        L.DomUtil.removeClass(el, 'hidden-marker');
        // 更新文字显示设置
        const txt = el.querySelector('.airport-text');
        if (txt) txt.style.display = (state.showAirportName || state.showAirportCode) ? 'block' : 'none';
      }
      accepted.push(item);
    }
  });

  // 4. 调整飞机图标大小
  const planeSize = Math.max(24, Math.min(64, zoom * 8)); // 动态大小
  document.documentElement.style.setProperty('--plane-size', planeSize + 'px');
}

// 监听地图事件触发避让
map.on('zoomend moveend', updateCollisions);


// ================== 核心逻辑：航班渲染与计算 ==================

function getBeijingTime() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + 3600000 * 8); // UTC+8
}

function timeToMin(str) {
  if (!str) return null;
  const p = str.split(":");
  return parseInt(p[0])*60 + parseInt(p[1]);
}

function renderFlights() {
  const now = getBeijingTime();
  const todayMid = new Date(now).setHours(0,0,0,0);
  const nowMin = (now.getTime() - todayMid) / 60000; // 今天已过分钟数

  // 过滤
  const searchVal = document.getElementById("searchInput").value.trim().toUpperCase();
  const urlId = new URLSearchParams(location.search).get("flights_map");
  const filterKey = searchVal || (urlId && urlId !== "ALL" ? urlId : null);

  state.flights.forEach(f => {
    const key = f.reg || (f.flightNo + f.dep + f.arr);
    
    // 1. 查找坐标
    const depAp = getAirport(f.dep);
    const arrAp = getAirport(f.arr);
    
    // 垃圾数据清理
    if (!depAp || !arrAp) { removeFlight(key); return; }

    // 2. 进度计算
    const tDep = timeToMin(f.depTimeRaw) + (f.depOffset * 24 * 60);
    const tArr = timeToMin(f.arrTimeRaw) + (f.arrOffset * 24 * 60);
    
    if (tDep === null || tArr === null) { removeFlight(key); return; }
    
    // 全局总分钟 (处理跨天)
    // 简单逻辑：假设当天数据。如果是真实环境需要对比日期。
    // 这里沿用你的逻辑：判断是否在天上
    // 为了模拟演示，如果 nowMin < tDep (还没飞) 或 > tArr (到了)，都隐藏
    // *除非是专注模式，我们可能会模拟进度*
    
    let progress = (nowMin - tDep) / (tArr - tDep);

    // 强制清理不再飞行的 (补丁)
    if (progress <= 0.001 || progress >= 0.999) {
      removeFlight(key);
      // 如果正在专注这个航班且它结束了，退出专注
      if (state.focusMode && state.focusFlight && state.focusFlight.raw === f.raw) {
        exitFocusMode();
        alert("航班已到达或尚未起飞");
      }
      return;
    }

    // 3. 过滤逻辑
    let isMatch = true;
    if (filterKey) {
      isMatch = (f.flightNo && f.flightNo.includes(filterKey)) || 
                (f.reg && f.reg.includes(filterKey)) ||
                (f.dep && f.dep.includes(filterKey)) || 
                (f.arr && f.arr.includes(filterKey));
    }
    if (state.hideOtherWhenFilter && filterKey && !isMatch) {
      removeFlight(key);
      return;
    }

    // 4. 绘制航线
    const depLat = depAp.lat || depAp.latitude;
    const depLng = depAp.lon || depAp.lng || depAp.longitude;
    const arrLat = arrAp.lat || arrAp.latitude;
    const arrLng = arrAp.lon || arrAp.lng || arrAp.longitude;

    if (!mapObjects.flightLines[key]) {
      const line = L.polyline([[depLat, depLng], [arrLat, arrLng]], {
        color: isMatch ? 'var(--md-sys-color-primary)' : '#ff8c2b',
        weight: isMatch ? 2 : 1,
        dashArray: '4, 4',
        opacity: 0.7
      }).addTo(map);
      line.on('click', () => openFlightCard(f));
      mapObjects.flightLines[key] = line;
    } else {
      // 更新样式
      const l = mapObjects.flightLines[key];
      if(isMatch) { l.setStyle({color: 'var(--md-sys-color-primary)', weight: 2}); }
      else { l.setStyle({color: '#ff8c2b', weight: 1}); }
    }

    // 5. 绘制飞机
    if (state.showPlaneIcon) {
      const curLat = depLat + (arrLat - depLat) * progress;
      const curLng = depLng + (arrLng - depLng) * progress;
      const angle = calcBearing(depLat, depLng, arrLat, arrLng);

      const planeHtml = `<img src="${PLANE_IMG}" class="plane-img" style="transform: rotate(${angle}deg); width: 32px; height: 32px;">`;
      const icon = L.divIcon({ 
        html: planeHtml, 
        className: 'plane-divicon', 
        iconSize: [32, 32], 
        iconAnchor: [16, 16] 
      });

      if (!mapObjects.flightMarkers[key]) {
        const m = L.marker([curLat, curLng], { icon }).addTo(map);
        m.bindTooltip(f.flightNo, { direction: 'right', permanent: state.showFlightNo, className: 'airport-text' });
        m.on('click', () => openFlightCard(f));
        mapObjects.flightMarkers[key] = m;
      } else {
        const m = mapObjects.flightMarkers[key];
        m.setLatLng([curLat, curLng]);
        m.setIcon(icon);
        // 如果正在专注该航班，移动地图中心
        if (state.focusMode && state.focusFlight && state.focusFlight.raw === f.raw) {
           map.panTo([curLat, curLng], { animate: true, duration: 1 });
           updateFocusDashboard(f, progress);
        }
      }
    } else {
      if (mapObjects.flightMarkers[key]) { map.removeLayer(mapObjects.flightMarkers[key]); delete mapObjects.flightMarkers[key]; }
    }
  });
}

function removeFlight(key) {
  if (mapObjects.flightLines[key]) { map.removeLayer(mapObjects.flightLines[key]); delete mapObjects.flightLines[key]; }
  if (mapObjects.flightMarkers[key]) { map.removeLayer(mapObjects.flightMarkers[key]); delete mapObjects.flightMarkers[key]; }
}

function getAirport(nameOrCode) {
  // 简化版模糊搜索
  if(!nameOrCode) return null;
  const key = nameOrCode.toUpperCase();
  if (state.airportDB[key]) return state.airportDB[key]; // 直接代码匹配
  
  for(let c in state.airportDB) {
    const a = state.airportDB[c];
    if (a.name.includes(nameOrCode) || c === key || (a.city && a.city.includes(nameOrCode))) return a;
  }
  return null;
}

function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const y = Math.sin(toRad(lon2-lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) - Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lon2-lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}


// ================== UI 交互逻辑 ==================

// 1. 信息卡片
function openFlightCard(f) {
  if (state.focusMode) return; // 专注模式下不弹卡片

  const card = document.getElementById("infoCard");
  const depAp = getAirport(f.dep);
  const arrAp = getAirport(f.arr);
  
  const depCode = depAp ? (depAp.code || depAp.name) : f.dep;
  const arrCode = arrAp ? (arrAp.code || arrAp.name) : f.arr;

  card.innerHTML = `
    <div class="card-flight-header">
      <div>
        <div class="flight-big-no">${f.flightNo}</div>
        <div class="flight-sub">${f.airline} · ${f.planeType} · ${f.reg}</div>
      </div>
      <button class="icon-btn" onclick="document.getElementById('infoCard').classList.add('hidden')">
        <span class="material-symbols-rounded">close</span>
      </button>
    </div>
    
    <div class="route-row">
      <div style="text-align:left">
        <div class="airport-code-lg">${depCode}</div>
        <div class="route-time">${f.depTimeRaw}</div>
      </div>
      <div class="route-arrow">
        <span class="material-symbols-rounded">flight_takeoff</span>
      </div>
      <div style="text-align:right">
        <div class="airport-code-lg">${arrCode}</div>
        <div class="route-time">${f.arrTimeRaw}</div>
      </div>
    </div>

    <div class="action-row">
      <button class="btn btn-outline" id="btnPrevLeg">上一程</button>
      <button class="btn btn-primary" id="btnTrackFlight">
        <span class="material-symbols-rounded">my_location</span> 跟踪航班
      </button>
      <button class="btn btn-outline" id="btnNextLeg">下一程</button>
    </div>
  `;
  
  card.classList.remove("hidden");

  // 绑定事件
  document.getElementById("btnTrackFlight").onclick = () => enterFocusMode(f);
  // 上一程下一程逻辑保留原有的排序逻辑（略，需自行复制原代码中的 sort 逻辑）
}

function showAirportInfo(ap) {
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <h3>${ap.name} <small>${ap.code||''}</small></h3>
    <p>等级: ${ap.level || '未知'}</p>
    <p>城市: ${ap.city || '-'}</p>
    <button class="btn btn-tonal" style="width:100%" onclick="document.getElementById('infoCard').classList.add('hidden')">关闭</button>
  `;
  card.classList.remove("hidden");
}

// 2. 专注模式 / 跟踪模式 (番茄钟风格)
function enterFocusMode(flight) {
  state.focusMode = true;
  state.focusFlight = flight;

  // UI 切换
  document.getElementById("topbar").classList.add("hidden");
  document.getElementById("layerControl").classList.add("hidden");
  document.getElementById("infoCard").classList.add("hidden");
  document.getElementById("settingsPanel").classList.add("hidden");
  document.getElementById("focusOverlay").classList.remove("hidden");

  // 播放音频
  const audio = document.getElementById("cabinAudio");
  audio.volume = 0.3;
  audio.play().catch(e => console.log("Audio play failed (interaction needed)", e));

  // 填充静态数据
  document.getElementById("focusFlightNo").innerText = flight.flightNo;
  document.getElementById("focusDest").innerText = flight.arr;
  
  const depAp = getAirport(flight.dep);
  const arrAp = getAirport(flight.arr);
  document.getElementById("focusDepCode").innerText = depAp ? (depAp.code || "DEP") : "DEP";
  document.getElementById("focusArrCode").innerText = arrAp ? (arrAp.code || "ARR") : "ARR";

  // 地图视觉调整
  map.setZoom(8); // 拉近
  // 在 renderFlights 中会不断 panTo 飞机位置
  
  // 立即触发一次更新
  renderFlights();
}

function exitFocusMode() {
  state.focusMode = false;
  state.focusFlight = null;

  // UI 还原
  document.getElementById("topbar").classList.remove("hidden");
  document.getElementById("layerControl").classList.remove("hidden");
  document.getElementById("focusOverlay").classList.add("hidden");

  // 停止音频
  document.getElementById("cabinAudio").pause();
  
  map.setZoom(4); // 还原视野
}

function updateFocusDashboard(f, progress) {
  // 计算剩余时间
  const tArr = timeToMin(f.arrTimeRaw) + (f.arrOffset * 24 * 60);
  const now = getBeijingTime();
  const todayMid = new Date(now).setHours(0,0,0,0);
  const nowMin = (now.getTime() - todayMid) / 60000;
  
  let remMin = Math.floor(tArr - nowMin);
  if (remMin < 0) remMin = 0;

  // 估算剩余距离 (英里) - 简单算法：假设每分钟飞 8 英里
  const remDist = Math.floor(remMin * 8.5); 

  document.getElementById("focusTimeRem").innerHTML = `${remMin} <small>min</small>`;
  document.getElementById("focusDistRem").innerHTML = `${remDist} <small>mi</small>`;

  // 进度条
  const pct = Math.max(0, Math.min(100, progress * 100));
  document.getElementById("focusProgressBar").style.width = `${pct}%`;
}


// 3. 设置与图层
function initUI() {
  // 搜索
  const doSearch = () => {
    const val = document.getElementById("searchInput").value;
    const p = new URLSearchParams(location.search);
    if(val) p.set("flights_map", val); else p.delete("flights_map");
    history.replaceState(null, "", "?"+p.toString());
    renderFlights();
  };
  document.getElementById("searchBtn").onclick = doSearch;
  document.getElementById("searchInput").onkeydown = (e) => e.key==='Enter' && doSearch();
  document.getElementById("clearBtn").onclick = () => {
    document.getElementById("searchInput").value = "";
    doSearch();
  };

  // 设置面板
  document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.toggle("hidden");
  document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");

  // 专注模式退出
  document.getElementById("exitFocusBtn").onclick = exitFocusMode;

  // 图层切换
  document.querySelectorAll(".layer-btn").forEach(btn => {
    btn.onclick = () => {
      const type = btn.dataset.type;
      if (type === state.activeLayer) return;
      
      map.removeLayer(LAYERS[state.activeLayer]);
      LAYERS[type].addTo(map);
      state.activeLayer = type;
      
      document.querySelectorAll(".layer-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
  });

  // 开关绑定
  const bindSw = (id, key, callback) => {
    const el = document.getElementById(id);
    el.checked = state[key];
    el.onchange = () => {
      state[key] = el.checked;
      localStorage.setItem(key, JSON.stringify(state[key]));
      if (callback) callback();
    };
  };

  bindSw("sw_showAirportName", "showAirportName", updateCollisions);
  bindSw("sw_showAirportCode", "showAirportCode", updateCollisions);
  bindSw("sw_showFlightNo", "showFlightNo", renderFlights);
  bindSw("sw_showPlaneIcon", "showPlaneIcon", renderFlights);
  bindSw("sw_hideOtherWhenFilter", "hideOtherWhenFilter", renderFlights);
  
  const refInp = document.getElementById("input_refreshInterval");
  refInp.value = state.refreshInterval;
  refInp.onchange = () => {
    state.refreshInterval = Number(refInp.value);
    localStorage.setItem("refreshInterval", state.refreshInterval);
    startLoop();
  };
}

// 循环刷新
let loopTimer = null;
function startLoop() {
  if (loopTimer) clearInterval(loopTimer);
  loadData();
  // 每30秒平滑移动一次飞机，数据可以每 state.refreshInterval 加载一次
  // 这里简化：每 5 秒重新计算一下位置（插值）
  setInterval(renderFlights, 2000); 
  // 真正的数据重载
  loopTimer = setInterval(loadData, state.refreshInterval * 1000);
}

// 启动
initUI();
startLoop();

