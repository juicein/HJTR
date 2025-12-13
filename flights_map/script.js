// ================== 全局配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png";

// 图层配置
const LAYERS = {
  clean: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: 'Map data &copy; OSM, CartoDB',
    subdomains: 'abcd', maxZoom: 19
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri', maxZoom: 17
  })
};

// 状态管理
let state = {
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  showRouteLines: JSON.parse(localStorage.getItem("showRouteLines") || "true"), // 新增：全局航线虚线
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
  
  airportDB: {},
  flights: [],
  activeLayer: 'clean',
  focusFlight: null,
  focusMode: false,
  mapHeading: 0, // 0 = North Up, 1 = Heading Up
  
  // 音乐播放器状态
  musicPlaying: false,
  currentTrackIdx: 0,
  musicList: [],
  musicMode: 0 // 0: loop list, 1: random, 2: single
};

// 运行时对象存储
let mapObjects = {
  markers: {}, // key: airportCode
  flightLines: {}, // key: uniqueKey (虚线)
  flightMarkers: {}, // key: uniqueKey (飞机)
  highlightLine: null // 当前高亮实线
};

// 初始化地图
const map = L.map('map', { 
  zoomControl: false, 
  attributionControl: false,
  minZoom: 2,
  worldCopyJump: true,
  // 禁用默认的惯性拖拽，防止旋转时错乱
  inertia: true 
}).setView([35, 105], 4);

LAYERS.clean.addTo(map);

// ================== 工具函数：时间与计算 ==================

// 获取绝对的北京时间对象
function getBeijingTime() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + 3600000 * 8); // UTC+8
}

// 获取当前北京时间距离当天0点的分钟数 (处理跨天需要更复杂的逻辑，这里简化为今日分钟)
// 修正：为了处理跨天，我们统一用绝对时间戳比较
function getBeijingTimestamp() {
  return getBeijingTime().getTime();
}

function parseTimeStr(timeStr, dayOffset = 0) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  const now = getBeijingTime();
  // 构造当天的这个时间
  const t = new Date(now);
  t.setHours(h, m, 0, 0);
  
  // 如果带有 dayOffset (例如 +1)，加一天
  if (dayOffset > 0) {
    t.setDate(t.getDate() + dayOffset);
  }
  return t.getTime();
}

// 距离计算 (简易)
function getDist(lat1, lng1, lat2, lng2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const y = Math.sin(toRad(lon2-lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) - Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lon2-lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ================== 核心逻辑：数据加载与解析 ==================

async function loadData() {
  try {
    const apRes = await fetch(AIRPORTS_PATH);
    const apData = await apRes.json();
    state.airportDB = {};
    
    // 兼容数组或对象格式
    const list = Array.isArray(apData) ? apData : Object.values(apData);
    list.forEach(ap => {
      const code = ap.code || (ap.name ? ap.name.slice(0,3).toUpperCase() : "UNK");
      let rank = 1;
      if(ap.level) {
        if(ap.level.includes("4F")) rank = 10;
        else if(ap.level.includes("4E")) rank = 8;
        else if(ap.level.includes("4D")) rank = 6;
        else if(ap.level.includes("4C")) rank = 4;
      }
      ap.rank = rank;
      // 修复 ICAO 字段读取 (如果是 ICAO 键)
      ap.icao = ap.ICAO || ap.icao || ""; 
      state.airportDB[code] = ap;
    });

    const fltText = await fetch(FLIGHT_DATA_PATH).then(r => r.text());
    state.flights = parseFlightData(fltText);

    renderAirports();
    renderFlights();
    updateCollisions(); 

  } catch (e) {
    console.error("加载失败:", e);
  }
}

function parseFlightData(raw) {
  const entries = [];
  const parts = raw.split("《航班结束》");
  for (let block of parts) {
    block = block.trim();
    if (!block) continue;
    const getVal = (reg) => { const m = block.match(reg); return m ? m[1].trim() : ""; };
    
    const flightNo = getVal(/【\s*([^\]　]+)\s*】/);
    const planeType = getVal(/〔\s*([^\]　]+)\s*〕/);
    const airline = getVal(/『\s*([^』]+)\s*』/);
    
    // 修复 Reg 提取: 优先取 <R-xxxx> 或 <DFxxxx>
    let reg = getVal(/<\s*(R-[^>]+)\s*>/); 
    if(!reg) reg = getVal(/<\s*([^>]+)\s*>/); // fallback to catch DFxxxx

    // 出发
    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}\s*(#\+(\d+)#)?/i);
    const depName = depMatch ? depMatch[1].trim() : "";
    const depTimeRaw = depMatch ? depMatch[2].trim() : "";
    const depDayOff = depMatch && depMatch[4] ? parseInt(depMatch[4]) : 0;

    // 到达
    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}\s*(#\+(\d+)#)?/i);
    const arrName = arrMatch ? arrMatch[1].trim() : "";
    const arrTimeRaw = arrMatch ? arrMatch[2].trim() : "";
    const arrDayOff = arrMatch && arrMatch[4] ? parseInt(arrMatch[4]) : 0;

    if(flightNo && depName && arrName) {
      entries.push({ 
        flightNo, planeType, airline, reg, 
        dep: depName, depTimeRaw, depDayOff,
        arr: arrName, arrTimeRaw, arrDayOff,
        raw: block 
      });
    }
  }
  return entries;
}

// ================== 渲染逻辑 ==================

function renderAirports() {
  for (let code in state.airportDB) {
    if (mapObjects.markers[code]) continue;

    const ap = state.airportDB[code];
    const lat = ap.lat || ap.latitude;
    const lng = ap.lon || ap.lng || ap.longitude;
    if (!lat || !lng) continue;

    const isHighRank = (ap.rank >= 8);
    const html = `
      <div class="airport-marker ${isHighRank?'rank-high':''}">
        <div class="airport-dot"></div>
        <div class="airport-text" style="display:none">
          <span class="ap-name">${ap.name}</span>
          <span class="ap-code" style="display:none">${code}</span>
        </div>
      </div>
    `;
    
    const icon = L.divIcon({ className: 'custom-airport-icon', html: html, iconSize: [0,0] });
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    marker.apData = ap;
    marker.on('click', () => showAirportInfo(ap));
    mapObjects.markers[code] = marker;
  }
}

// 核心渲染循环
function renderFlights() {
  const nowTs = getBeijingTimestamp();
  
  // 搜索过滤
  const searchVal = document.getElementById("searchInput").value.trim().toUpperCase();

  state.flights.forEach(f => {
    // 唯一键
    const key = f.reg + "_" + f.flightNo + "_" + f.dep;
    const depAp = getAirport(f.dep);
    const arrAp = getAirport(f.arr);

    if (!depAp || !arrAp) { removeFlight(key); return; }

    // 时间计算 (绝对时间戳)
    // 假设 flight_data 中的时间是 "今天的时刻"，加上偏移量
    const tDep = parseTimeStr(f.depTimeRaw, f.depDayOff);
    const tArr = parseTimeStr(f.arrTimeRaw, f.arrDayOff);
    
    // 如果起飞时间比现在晚太多（比如明天），或者已经到达很久，这里简化逻辑：
    // 只显示 "现在正在飞" 的。 即 tDep <= now <= tArr
    // 为了模拟，如果 tDep 在未来但很近，也可以显示在机场。
    
    // 计算进度
    let progress = 0;
    const totalDuration = tArr - tDep;
    if (totalDuration > 0) {
      progress = (nowTs - tDep) / totalDuration;
    }

    // 状态判定
    const isActive = (progress >= 0 && progress <= 1);
    
    // 如果不活跃，移除
    if (!isActive) {
      removeFlight(key);
      // 专注模式检测
      if (state.focusMode && state.focusFlight && state.focusFlight.raw === f.raw) {
         // 到达了，退出专注? 或者停在终点。这里简单处理为Alert
         // exitFocusMode(); 
      }
      return;
    }

    // 过滤逻辑
    let isMatch = true;
    if (searchVal) {
      isMatch = (f.flightNo.includes(searchVal) || 
                 (f.reg && f.reg.includes(searchVal)) || 
                 depAp.name.includes(searchVal) || arrAp.name.includes(searchVal));
    }

    if (state.hideOtherWhenFilter && searchVal && !isMatch && !state.focusMode) {
      removeFlight(key);
      return;
    }

    // 坐标计算
    const depLat = depAp.lat || depAp.latitude;
    const depLng = depAp.lon || depAp.lng || depAp.longitude;
    const arrLat = arrAp.lat || arrAp.latitude;
    const arrLng = arrAp.lon || arrAp.lng || arrAp.longitude;

    const curLat = depLat + (arrLat - depLat) * progress;
    const curLng = depLng + (arrLng - depLng) * progress;
    const angle = calcBearing(depLat, depLng, arrLat, arrLng);

    // 1. 绘制/更新虚线 (大地图航线)
    // 逻辑：如果全局开关开启，且不在专注模式(或专注模式允许)，显示
    if (state.showRouteLines && !state.focusMode) {
       if (!mapObjects.flightLines[key]) {
         const line = L.polyline([[depLat, depLng], [arrLat, arrLng]], {
           color: '#72777f', weight: 1, dashArray: '4, 4', opacity: 0.5, interactive: false
         }).addTo(map);
         mapObjects.flightLines[key] = line;
       }
    } else {
       // 开关关闭，移除虚线
       if(mapObjects.flightLines[key]) { map.removeLayer(mapObjects.flightLines[key]); delete mapObjects.flightLines[key]; }
    }

    // 2. 绘制/更新飞机
    if (state.showPlaneIcon) {
      // 专注模式下，如果不是当前关注的飞机，且开启了过滤，则不显示
      if (state.focusMode && state.focusFlight && state.focusFlight.raw !== f.raw) {
        if(mapObjects.flightMarkers[key]) { map.removeLayer(mapObjects.flightMarkers[key]); delete mapObjects.flightMarkers[key]; }
        return;
      }

      if (!mapObjects.flightMarkers[key]) {
        const iconHtml = `<img src="${PLANE_IMG}" style="transform: rotate(${angle}deg); width: ${state.focusMode?64:32}px; height: ${state.focusMode?64:32}px;">`;
        const icon = L.divIcon({ html: iconHtml, className: 'plane-divicon', iconSize: [32,32], iconAnchor: [16,16] });
        const m = L.marker([curLat, curLng], { icon, zIndexOffset: 1000 }).addTo(map);
        
        // 绑定 Tooltip (航班号)
        if (state.showFlightNo) {
           m.bindTooltip(f.flightNo, { direction: 'right', permanent: true, className: 'airport-text' });
        }
        
        m.on('click', () => {
          openFlightCard(f);
          highlightRoute(depLat, depLng, arrLat, arrLng);
        });
        
        // 保存数据
        m.flightData = f;
        mapObjects.flightMarkers[key] = m;

      } else {
        const m = mapObjects.flightMarkers[key];
        m.setLatLng([curLat, curLng]);
        
        // 更新图标角度 (如果需要)
        const img = m.getElement().querySelector('img');
        if(img) img.style.transform = `rotate(${angle}deg)`;
        
        // 专注模式更新
        if (state.focusMode && state.focusFlight && state.focusFlight.raw === f.raw) {
           updateFocusView(curLat, curLng, angle, progress, f);
        }
      }
    }
  });
}

function removeFlight(key) {
  if (mapObjects.flightLines[key]) { map.removeLayer(mapObjects.flightLines[key]); delete mapObjects.flightLines[key]; }
  if (mapObjects.flightMarkers[key]) { map.removeLayer(mapObjects.flightMarkers[key]); delete mapObjects.flightMarkers[key]; }
}

function highlightRoute(lat1, lng1, lat2, lng2) {
  // 移除旧的高亮
  if (mapObjects.highlightLine) {
    map.removeLayer(mapObjects.highlightLine);
    mapObjects.highlightLine = null;
  }
  // 添加新的橙色实线
  mapObjects.highlightLine = L.polyline([[lat1, lng1], [lat2, lng2]], {
    color: 'var(--md-sys-color-orange)',
    weight: 3,
    opacity: 1
  }).addTo(map);
}

function clearHighlight() {
  if (mapObjects.highlightLine) {
    map.removeLayer(mapObjects.highlightLine);
    mapObjects.highlightLine = null;
  }
}

// 智能避让与显示控制
function updateCollisions() {
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  
  // 1. 机场避让
  const visibleAps = [];
  for (let code in mapObjects.markers) {
    const m = mapObjects.markers[code];
    const el = m.getElement();
    if (!el) continue;
    
    // 显示状态更新 (根据设置)
    const txtEl = el.querySelector('.airport-text');
    const nameEl = el.querySelector('.ap-name');
    const codeEl = el.querySelector('.ap-code');
    
    if (state.showAirportName || state.showAirportCode) {
      txtEl.style.display = 'block';
      nameEl.style.display = state.showAirportName ? 'inline' : 'none';
      codeEl.style.display = state.showAirportCode ? 'inline' : 'none';
      // 如果都开，加点间距
      if(state.showAirportName && state.showAirportCode) codeEl.style.marginLeft = '4px';
      else codeEl.style.marginLeft = '0';
    } else {
      txtEl.style.display = 'none';
    }

    if (bounds.contains(m.getLatLng())) {
      visibleAps.push({ m, pt: map.latLngToLayerPoint(m.getLatLng()), rank: m.apData.rank });
      el.classList.remove('hidden-marker');
    } else {
      el.classList.add('hidden-marker');
    }
  }

  // 排序：高等级优先
  visibleAps.sort((a,b) => b.rank - a.rank);
  
  const acceptedAps = [];
  const AP_MIN_DIST = zoom < 5 ? 30 : 50;

  visibleAps.forEach(item => {
    let clash = false;
    for(let acc of acceptedAps) {
      const d = item.pt.distanceTo(acc.pt);
      if(d < AP_MIN_DIST) { clash = true; break; }
    }
    if(clash) item.m.getElement().classList.add('hidden-marker');
    else {
      item.m.getElement().classList.remove('hidden-marker');
      acceptedAps.push(item);
    }
  });

  // 2. 飞机避让 (仅在缩小且非专注模式下)
  // 逻辑：如果两个飞机太近，隐藏其中一个 (优先保留有 tooltip 的或者随机)
  if (!state.focusMode && zoom < 6) {
    const visiblePlanes = [];
    for(let k in mapObjects.flightMarkers) {
      const m = mapObjects.flightMarkers[k];
      visiblePlanes.push({ k, m, pt: map.latLngToLayerPoint(m.getLatLng()) });
    }
    
    const acceptedPlanes = [];
    const PLANE_MIN_DIST = 20; // px
    
    visiblePlanes.forEach(item => {
       let clash = false;
       for(let acc of acceptedPlanes) {
         if(item.pt.distanceTo(acc.pt) < PLANE_MIN_DIST) { clash = true; break; }
       }
       if(clash) {
         // 隐藏
         item.m.setOpacity(0);
         item.m.closeTooltip();
       } else {
         item.m.setOpacity(1);
         if(state.showFlightNo) item.m.openTooltip();
         acceptedPlanes.push(item);
       }
    });
  } else {
    // 恢复所有显示
    for(let k in mapObjects.flightMarkers) {
      const m = mapObjects.flightMarkers[k];
      m.setOpacity(1);
      if(state.showFlightNo) m.openTooltip();
    }
  }
}

map.on('zoomend moveend', updateCollisions);


// ================== UI 交互 ==================

function getAirport(query) {
  if(!query) return null;
  const q = query.toUpperCase();
  if(state.airportDB[q]) return state.airportDB[q];
  for(let k in state.airportDB) {
    const a = state.airportDB[k];
    if(a.name.includes(query) || (a.city && a.city.includes(query)) || (a.aliases && a.aliases.includes(query))) return a;
  }
  return null;
}

// 搜索防抖
let searchTimer = null;
document.getElementById("searchInput").addEventListener('input', (e) => {
  const val = e.target.value;
  document.getElementById("clearBtn").classList.toggle("hidden", !val);
  if(searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    renderFlights();
  }, 500);
});

document.getElementById("clearBtn").onclick = () => {
  document.getElementById("searchInput").value = "";
  renderFlights();
  document.getElementById("clearBtn").classList.add("hidden");
};

// 航班卡片
function openFlightCard(f) {
  if(state.focusMode) return;
  
  const card = document.getElementById("infoCard");
  const depAp = getAirport(f.dep);
  const arrAp = getAirport(f.arr);
  
  // 查找上下程
  let prevLeg = null, nextLeg = null;
  if(f.reg) {
     // 简单逻辑：在所有航班中找同一个 Reg，按时间排序
     const sameReg = state.flights.filter(x => x.reg === f.reg);
     sameReg.sort((a,b) => parseTimeStr(a.depTimeRaw) - parseTimeStr(b.depTimeRaw));
     const idx = sameReg.findIndex(x => x.raw === f.raw);
     if(idx > 0) prevLeg = sameReg[idx-1];
     if(idx < sameReg.length - 1) nextLeg = sameReg[idx+1];
  }

  card.innerHTML = `
    <div class="card-flight-header">
      <div>
        <div class="flight-big-no">${f.flightNo}</div>
        <div class="flight-sub">${f.airline} · ${f.planeType} · ${f.reg}</div>
      </div>
      <button class="icon-btn small" onclick="closeFlightCard()"><span class="material-symbols-rounded">close</span></button>
    </div>
    <div class="route-row">
      <div style="text-align:left">
        <div class="ap-code">${depAp ? (depAp.code||depAp.name) : f.dep}</div>
        <div class="ap-time">${f.depTimeRaw}</div>
      </div>
      <span class="material-symbols-rounded" style="color:#aaa">flight_takeoff</span>
      <div style="text-align:right">
        <div class="ap-code">${arrAp ? (arrAp.code||arrAp.name) : f.arr}</div>
        <div class="ap-time">${f.arrTimeRaw}</div>
      </div>
    </div>
    <div class="action-row">
      <button class="btn btn-outline" ${!prevLeg?'disabled':''} onclick='switchCardFlight(${JSON.stringify(prevLeg)})'>前序</button>
      <button class="btn btn-primary" onclick='enterFocusMode(${JSON.stringify(f)})'><span class="material-symbols-rounded">my_location</span> 跟踪</button>
      <button class="btn btn-outline" ${!nextLeg?'disabled':''} onclick='switchCardFlight(${JSON.stringify(nextLeg)})'>后序</button>
    </div>
  `;
  card.classList.remove("hidden");
}

window.closeFlightCard = () => {
  document.getElementById("infoCard").classList.add("hidden");
  clearHighlight();
};

window.switchCardFlight = (f) => {
  if(f) {
      openFlightCard(f);
      // 重新高亮
      const depAp = getAirport(f.dep);
      const arrAp = getAirport(f.arr);
      if(depAp && arrAp) {
          highlightRoute(depAp.lat||depAp.latitude, depAp.lon||depAp.longitude, arrAp.lat||arrAp.latitude, arrAp.lon||arrAp.longitude);
      }
  }
};

function showAirportInfo(ap) {
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <div class="card-flight-header">
       <h3>${ap.name}</h3>
       <button class="icon-btn small" onclick="closeFlightCard()"><span class="material-symbols-rounded">close</span></button>
    </div>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:14px;">
      <div><strong>IATA:</strong> ${ap.code}</div>
      <div><strong>ICAO:</strong> ${ap.icao||'-'}</div>
      <div><strong>等级:</strong> ${ap.level||'-'}</div>
      <div><strong>跑道:</strong> ${ap.runways||'-'}</div>
      <div style="grid-column: span 2; color:#666; font-size:12px;">别名: ${(ap.aliases||[]).join(', ')}</div>
    </div>
  `;
  card.classList.remove("hidden");
}


// ================== 专注模式 (Focus Mode) ==================

window.enterFocusMode = (f) => {
  // 只有对象传进来，可能丢失 raw 方法中的字符串引用，重新在 state.flights 找一个最匹配的
  const target = state.flights.find(x => x.flightNo === f.flightNo && x.dep === f.dep) || f;
  
  state.focusMode = true;
  state.focusFlight = target;

  document.getElementById("topbar").classList.add("hidden");
  document.getElementById("layerControl").classList.add("hidden");
  document.getElementById("infoCard").classList.add("hidden");
  document.getElementById("settingsPanel").classList.add("hidden");
  document.getElementById("focusOverlay").classList.remove("hidden");
  
  // 播放引擎声
  const audio = document.getElementById("cabinAudio");
  audio.volume = 0.4;
  audio.play().catch(e=>console.log("Auto-play prevented"));

  // 填充数据
  document.getElementById("focusFlightNo").innerText = target.flightNo;
  document.getElementById("focusDest").innerText = target.arr;
  const depAp = getAirport(target.dep);
  const arrAp = getAirport(target.arr);
  
  // 存储全名以便点击切换
  const depEl = document.getElementById("focusDepCode");
  const arrEl = document.getElementById("focusArrCode");
  depEl.innerText = depAp ? depAp.code : "DEP";
  arrEl.innerText = arrAp ? arrAp.code : "ARR";
  depEl.dataset.code = depAp ? depAp.code : "DEP";
  depEl.dataset.name = depAp ? depAp.name : target.dep;
  arrEl.dataset.code = arrAp ? arrAp.code : "ARR";
  arrEl.dataset.name = arrAp ? arrAp.name : target.arr;
  depEl.dataset.show = "code";
  arrEl.dataset.show = "code";

  map.setZoom(7);
  clearHighlight(); // 专注模式不需要橙色高亮，有自己的 UI
  renderFlights(); // 立即触发重绘
  
  // 自动打开音乐播放器 (默认关闭，这里提供按钮手动打开)
  // document.getElementById("musicPlayerCard").classList.remove("hidden");
}

document.getElementById("exitFocusBtn").onclick = () => {
  state.focusMode = false;
  state.focusFlight = null;
  state.mapHeading = 0;
  rotateMap(0); // 恢复北向

  document.getElementById("topbar").classList.remove("hidden");
  document.getElementById("layerControl").classList.remove("hidden");
  document.getElementById("focusOverlay").classList.add("hidden");
  document.getElementById("musicPlayerCard").classList.add("hidden");
  document.getElementById("cabinAudio").pause();
  
  map.setZoom(4);
  renderFlights();
};

function updateFocusView(lat, lng, angle, progress, f) {
  // 1. 移动中心
  map.panTo([lat, lng], { animate: true, duration: 1.5 });

  // 2. 地图旋转 (如果开启了机头向上)
  if (state.mapHeading === 1) {
    rotateMap(-angle);
  } else {
    rotateMap(0);
  }

  // 3. 更新仪表盘
  const tArr = parseTimeStr(f.arrTimeRaw, f.arrDayOff);
  const now = getBeijingTimestamp();
  let remMs = tArr - now;
  if(remMs < 0) remMs = 0;
  
  const h = Math.floor(remMs / 3600000);
  const m = Math.floor((remMs % 3600000) / 60000);
  
  document.getElementById("focusTimeRem").innerHTML = `${h} <small>h</small> ${m} <small>min</small>`;
  
  // 估算剩余距离 (假设均速 800km/h)
  const distKm = Math.floor((remMs / 3600000) * 800);
  document.getElementById("focusDistRem").innerHTML = `${distKm} <small>km</small>`;
  
  document.getElementById("focusProgressBar").style.width = (progress * 100) + "%";
}

// 切换显示 Code / Name
document.getElementById("routeTextClickArea").onclick = () => {
  const els = [document.getElementById("focusDepCode"), document.getElementById("focusArrCode")];
  els.forEach(el => {
    if(el.dataset.show === "code") {
      el.innerText = el.dataset.name;
      el.dataset.show = "name";
    } else {
      el.innerText = el.dataset.code;
      el.dataset.show = "code";
    }
  });
};

// 专注模式：地图控制
document.getElementById("focusLayerBtn").onclick = () => {
   // 简单的 toggle: clean <-> satellite
   const next = state.activeLayer === 'clean' ? 'satellite' : 'clean';
   map.removeLayer(LAYERS[state.activeLayer]);
   LAYERS[next].addTo(map);
   state.activeLayer = next;
};

document.getElementById("focusHeadingBtn").onclick = () => {
   state.mapHeading = state.mapHeading === 0 ? 1 : 0;
   const icon = document.getElementById("focusHeadingIcon");
   if(state.mapHeading === 1) {
     icon.innerText = "navigation"; // 机头向上图标
     icon.style.color = "var(--md-sys-color-primary)";
   } else {
     icon.innerText = "explore"; // 北向图标
     icon.style.color = "inherit";
     rotateMap(0);
   }
   renderFlights(); // 触发一次更新以应用旋转
};

function rotateMap(deg) {
  const pane = map.getPane('mapPane');
  const container = map.getContainer(); // 获取最外层容器
  
  if (deg !== 0) {
    // 旋转 mapPane
    pane.style.transform += ` rotate(${deg}deg)`;
    // 关键：为了不让标签也跟着旋转变歪，Leaflet 的 marker 是在 markerPane 里的。
    // 如果只旋转 mapPane (TilePane)，markerPane 可能会错位或者也跟着转。
    // 简单的 CSS 旋转整个 #map div 是最稳妥的视觉效果，虽然交互会反向。
    
    // 采用方案：旋转整个容器，但需要容器足够大以覆盖黑边
    container.style.transform = `rotate(${deg}deg)`;
    container.classList.add('map-rotated-container');
    
    // 反向旋转 UI 元素 (Marker 图标) 保持直立? 
    // 不，机头向上模式下，文字倒着也是正常的导航显示。
    
  } else {
    container.style.transform = `none`;
    container.classList.remove('map-rotated-container');
  }
}


// ================== 音乐播放器 (Mock Logic) ==================

const MOCK_PLAYLIST = [
  { title: "Pure", artist: "Cathay Pacific", src: "Pure.mp3", cover: "" },
  { title: "Sky Full of Stars", artist: "Coldplay", src: "", cover: "" },
  { title: "Cornfield Chase", artist: "Hans Zimmer", src: "", cover: "" },
  { title: "Wonderwall", artist: "Oasis", src: "", cover: "" }
];

function initMusicPlayer() {
  state.musicList = MOCK_PLAYLIST;
  const audio = document.getElementById("musicPlayerAudio");
  
  // 渲染列表
  const listEl = document.getElementById("musicListContainer");
  listEl.innerHTML = "";
  state.musicList.forEach((track, i) => {
    const div = document.createElement("div");
    div.className = "music-item";
    div.innerText = `${i+1}. ${track.title} - ${track.artist}`;
    div.onclick = () => playTrack(i);
    listEl.appendChild(div);
  });
  
  // 绑定事件
  document.getElementById("musicToggleBtn").onclick = () => {
    document.getElementById("musicPlayerCard").classList.remove("hidden");
  };
  document.getElementById("closeMusicBtn").onclick = () => {
    document.getElementById("musicPlayerCard").classList.add("hidden");
  };
  document.getElementById("btnMusicList").onclick = () => {
    document.getElementById("musicListView").classList.toggle("hidden");
  };
  document.getElementById("btnPlayToggle").onclick = () => {
    if(audio.paused) audio.play(); else audio.pause();
  };
  document.getElementById("btnPlayNext").onclick = () => playTrack((state.currentTrackIdx + 1) % state.musicList.length);
  document.getElementById("btnPlayPrev").onclick = () => playTrack((state.currentTrackIdx - 1 + state.musicList.length) % state.musicList.length);
  
  // 播放状态监听
  audio.onplay = () => {
    state.musicPlaying = true;
    document.getElementById("btnPlayToggle").innerHTML = '<span class="material-symbols-rounded">pause</span>';
  };
  audio.onpause = () => {
    state.musicPlaying = false;
    document.getElementById("btnPlayToggle").innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
  };
  audio.ontimeupdate = () => {
    const pct = (audio.currentTime / audio.duration) * 100 || 0;
    document.getElementById("musicProgress").style.width = pct + "%";
  };
  audio.onended = () => {
    // 简易循环
    playTrack((state.currentTrackIdx + 1) % state.musicList.length);
  };
  
  // 加载第一首 (Pure) 但不自动播
  loadTrack(0);
}

function loadTrack(idx) {
  state.currentTrackIdx = idx;
  const track = state.musicList[idx];
  document.getElementById("trackTitle").innerText = track.title;
  document.getElementById("trackArtist").innerText = track.artist;
  
  // 模拟音频源 (这里实际上只会尝试加载 Pure.mp3，其他的会失败或需要真实路径)
  // 如果是 Mock，我们就不真正设置 src 除非文件存在
  if(track.src) document.getElementById("musicPlayerAudio").src = track.src;
  
  // 高亮列表
  const items = document.querySelectorAll(".music-item");
  items.forEach((el, i) => el.classList.toggle("active", i === idx));
}

function playTrack(idx) {
  loadTrack(idx);
  document.getElementById("musicPlayerAudio").play().catch(e => console.log("需用户交互才能播放"));
}


// ================== 初始化与设置 ==================

function init() {
  // 绑定开关
  const bindSw = (id, key, cb) => {
    const el = document.getElementById(id);
    el.checked = state[key];
    el.onchange = () => {
      state[key] = el.checked;
      localStorage.setItem(key, JSON.stringify(state[key]));
      // 强制触发渲染
      if (key === 'showFlightNo') {
        // 特殊处理 tooltip
        for(let k in mapObjects.flightMarkers) {
           const m = mapObjects.flightMarkers[k];
           if(state.showFlightNo) m.openTooltip(); else m.closeTooltip();
        }
      }
      renderFlights();
      updateCollisions();
      if(cb) cb();
    };
  };

  bindSw("sw_showAirportName", "showAirportName");
  bindSw("sw_showAirportCode", "showAirportCode");
  bindSw("sw_showFlightNo", "showFlightNo");
  bindSw("sw_showRouteLines", "showRouteLines");
  bindSw("sw_showPlaneIcon", "showPlaneIcon");
  bindSw("sw_hideOtherWhenFilter", "hideOtherWhenFilter");

  document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.remove("hidden");
  document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");

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

  initMusicPlayer();
  
  // 启动循环
  loadData();
  setInterval(() => {
    renderFlights();
    // 只有在非专注模式下才频繁做碰撞检测，专注模式下可能性能优先
    if(!state.focusMode) updateCollisions();
  }, 2000); 
  
  // 数据定时刷新 (60s)
  setInterval(loadData, 60000);
}

init();
