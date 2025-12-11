// ================== 全局配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG_SRC = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png"; 

// 自动刷新
let refreshIntervalSec = Number(localStorage.getItem("refreshIntervalSec") || 180);

// 设置
let settings = {
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"), 
};

// ================== 地图初始化 ==================

// 1. 定义图层
const layerClean = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 19
});

const layerSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri',
  maxZoom: 17
});

// 默认底图 (纯净版)
const map = L.map('map', { 
  worldCopyJump: true, 
  minZoom: 2,
  zoomControl: false, // 禁用默认缩放控件，用手势或我们自己的UI
  layers: [layerClean] 
}).setView([35, 105], 4); // 中国中心

let currentLayer = "clean"; // 'clean' or 'satellite'

// ================== 数据存储 ==================
let airportDB = {}; // Object: code -> data
let airportList = []; // Array for proximity search
let flights = [];
let airportMarkers = {}; // code -> L.Marker
let flightMarkers = {};
let flightLines = {};
let highlightedKey = null; 

// ================== 核心功能：机场聚合逻辑 ==================

// 判断机场重要等级 (4F > 4E > Others)
function getAirportRank(ap) {
  // 如果JSON有 level 字段
  if (ap.level) {
    if (ap.level.includes("4F")) return 10;
    if (ap.level.includes("4E")) return 8;
    if (ap.level.includes("4D")) return 6;
  }
  // 备用：根据跑道数量
  if (ap.runways > 2) return 9;
  // 默认低权重
  return 1;
}

// 核心函数：根据缩放与密度显示/隐藏机场
function updateAirportVisibility() {
  const currentZoom = map.getZoom();
  const bounds = map.getBounds();
  
  // 1. 筛选在视野内的机场
  const visibleCandidates = airportList.filter(ap => {
    const lat = ap.lat || ap.latitude;
    const lng = ap.lon || ap.lng || ap.longitude;
    if (!lat || !lng) return false;
    return bounds.contains([lat, lng]);
  });

  // 2. 按重要性排序 (高的在前面)
  visibleCandidates.sort((a, b) => getAirportRank(b) - getAirportRank(a));

  const shownAirports = [];
  const pixelThreshold = 40; // 两个图标如果在屏幕上小于40px，就认为重叠

  // 清除所有现有显示状态 (先全部设为不可见，或者我们在遍历时决定)
  // 为了性能，我们直接操作DOM display或者add/remove layer
  // 这里采用简单的 add/remove layer 策略比较慢，建议操作 CSS class 或 opacity
  
  // 3. 碰撞检测
  for (let ap of visibleCandidates) {
    const lat = ap.lat || ap.latitude;
    const lng = ap.lon || ap.lng || ap.longitude;
    const point = map.latLngToContainerPoint([lat, lng]);
    const code = ap.code;

    let isOverlapping = false;
    for (let shown of shownAirports) {
      const shownPoint = shown.point;
      const dist = Math.sqrt(Math.pow(point.x - shownPoint.x, 2) + Math.pow(point.y - shownPoint.y, 2));
      if (dist < pixelThreshold) {
        isOverlapping = true;
        break;
      }
    }

    // 始终显示非常重要的机场 (Zoom < 5 时只看4F)
    const rank = getAirportRank(ap);
    let shouldShow = false;

    if (currentZoom < 5) {
      if (rank >= 10 && !isOverlapping) shouldShow = true; 
    } else if (currentZoom < 8) {
      if (rank >= 6 && !isOverlapping) shouldShow = true;
    } else {
      // 放大后尽可能显示，但也避让
      if (!isOverlapping) shouldShow = true;
    }
    
    // 如果没有被遮挡，就显示并记录
    if (shouldShow) {
      shownAirports.push({ code: code, point: point });
      if (airportMarkers[code]) {
         airportMarkers[code].getElement().style.display = ""; // Show
         airportMarkers[code].getElement().classList.remove("hidden-marker");
      }
    } else {
      if (airportMarkers[code] && airportMarkers[code].getElement()) {
        airportMarkers[code].getElement().style.display = "none"; // Hide
      }
    }
  }
}

// ================== 标准工具函数 ==================
function timeStrToMinutes(t) {
  if (!t) return null;
  const parts = t.split(":").map(s=>s.trim());
  if (parts.length < 2) return null;
  return Number(parts[0])*60 + Number(parts[1]);
}
function beijingNowDate() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset()*60000;
  return new Date(utc + 8*3600*1000);
}
function beijingTodayMidnight() {
  const bj = beijingNowDate();
  const mid = new Date(bj.getTime());
  mid.setHours(0,0,0,0);
  return mid;
}
function nowBeijingTotalMinutes() {
  return Math.floor(beijingNowDate().getTime() / 60000);
}
function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = d => d*Math.PI/180;
  const toDeg = r => r*180/Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2-λ1)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
  return (toDeg(Math.atan2(y,x)) + 360 + 90) % 360;
}
function formatDateOffset(offset) {
  const d = beijingTodayMidnight();
  d.setDate(d.getDate() + (offset||0));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ================== 数据解析 ==================
function parseFlightData(raw) {
  const entries = [];
  const parts = raw.split("《航班结束》");
  for (let block of parts) {
    block = block.trim();
    if (!block) continue;
    const getVal = (reg) => { const m = block.match(reg); return m ? m[1].trim() : ""; };
    const flightNo = getVal(/【\s*([^\]　]+)\s*】/);
    if (!flightNo) continue; 
    
    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    
    entries.push({
      flightNo, 
      planeType: getVal(/〔\s*([^\]　]+)\s*〕/), 
      airline: getVal(/『\s*([^』]+)\s*』/), 
      reg: getVal(/<\s*([^>]+)\s*>/),
      dep: depMatch ? depMatch[1].trim() : "", 
      depTimeRaw: depMatch ? depMatch[2].trim() : "", 
      depOffset: Number(depMatch && depMatch[3] ? depMatch[3].replace(/[^\d]/g,"") : "0"),
      arr: arrMatch ? arrMatch[1].trim() : "", 
      arrTimeRaw: arrMatch ? arrMatch[2].trim() : "", 
      arrOffset: Number(arrMatch && arrMatch[3] ? arrMatch[3].replace(/[^\d]/g,"") : "0"),
      raw: block
    });
  }
  return entries;
}

function airportByName(name) {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  // 1. Try code match directly
  if (airportDB[key.toUpperCase()]) return airportDB[key.toUpperCase()];
  // 2. Loop
  for (let code in airportDB) {
    const a = airportDB[code];
    if (a.name && a.name.toLowerCase() === key) return a;
    if (a.city && a.city.toLowerCase() === key) return a;
    if (a.aliases && a.aliases.some(ali => ali.toLowerCase() === key)) return a;
  }
  return null;
}

// ================== 渲染逻辑 ==================

function renderAllAirports() {
  // 清除旧的
  for (let code in airportMarkers) {
    map.removeLayer(airportMarkers[code]);
  }
  airportMarkers = {};
  airportList = []; // 重置列表

  for (let code in airportDB) {
    const ap = airportDB[code];
    const lat = ap.lat || ap.latitude;
    const lng = ap.lon || ap.lng || ap.longitude;
    if (!lat || !lng) continue;

    airportList.push(ap); // 加入列表用于计算

    // 创建 Marker，默认都加上，通过 updateAirportVisibility 控制显示隐藏
    // 样式优化：小圆点 + 文字分离
    const rank = getAirportRank(ap);
    const isMajor = rank >= 8;
    const dotClass = isMajor ? "airport-dot major" : "airport-dot";
    
    const html = `
      <div class="airport-marker-group">
        <div class="${dotClass}"></div>
        <div class="airport-label-box" style="display:${settings.showAirportName?'block':'none'}">
          <div>${ap.name||''}</div>
          <div style="font-size:10px;font-weight:400;opacity:0.8;display:${settings.showAirportCode?'block':'none'}">${ap.code||''}</div>
        </div>
      </div>
    `;
    const icon = L.divIcon({ className: "airport-icon-container", html, iconAnchor: [5, 5] }); // Center the dot
    const mk = L.marker([lat, lng], { icon }).addTo(map);
    
    // 把原始数据绑定在 marker 对象上方便调用
    mk.airportData = ap;
    mk.on("click", () => showAirportCard(ap));
    
    airportMarkers[code] = mk;
  }
  
  // 初始计算一次可见性
  updateAirportVisibility();
}

function computeProgress(f) {
  const depMin = timeStrToMinutes(f.depTimeRaw);
  const arrMin = timeStrToMinutes(f.arrTimeRaw);
  if (depMin === null || arrMin === null) return null;
  const base = beijingTodayMidnight().getTime()/60000;
  const depT = base + depMin + (f.depOffset||0)*1440;
  const arrT = base + arrMin + (f.arrOffset||0)*1440;
  if (arrT <= depT) return null;
  const now = nowBeijingTotalMinutes();
  return (now - depT) / (arrT - depT);
}

function renderFlights() {
  const filterVal = document.getElementById("searchInput").value.trim().toLowerCase();
  
  flights.forEach(f => {
    const idKey = f.reg || (f.flightNo + f.dep);
    const prog = computeProgress(f);
    
    // 强制删除逻辑：不在天上
    if (prog === null || prog <= 0.001 || prog >= 0.999) {
      if (flightLines[idKey]) { map.removeLayer(flightLines[idKey]); delete flightLines[idKey]; }
      if (flightMarkers[idKey]) { map.removeLayer(flightMarkers[idKey]); delete flightMarkers[idKey]; }
      return;
    }

    // 搜索过滤
    let isMatch = true;
    if (filterVal) {
      isMatch = (f.flightNo||"").toLowerCase().includes(filterVal) || 
                (f.reg||"").toLowerCase().includes(filterVal) || 
                (f.dep||"").toLowerCase().includes(filterVal) ||
                (f.arr||"").toLowerCase().includes(filterVal);
    }
    if (settings.hideOtherWhenFilter && filterVal && !isMatch) {
       // Hide if filter is on and no match
       if (flightLines[idKey]) map.removeLayer(flightLines[idKey]);
       if (flightMarkers[idKey]) map.removeLayer(flightMarkers[idKey]);
       return;
    }

    const depA = airportByName(f.dep);
    const arrA = airportByName(f.arr);
    if (!depA || !arrA) return;

    const depLat = depA.lat||depA.latitude, depLng = depA.lon||depA.longitude;
    const arrLat = arrA.lat||arrA.latitude, arrLng = arrA.lon||arrA.longitude;

    // Line
    if (!flightLines[idKey]) {
      const line = L.polyline([[depLat, depLng], [arrLat, arrLng]], { 
        color: "var(--text-sec)", weight: 2, dashArray: "4 6", opacity: 0.6 
      }).addTo(map);
      line.on("click", () => showFlightCard(f, depA, arrA));
      flightLines[idKey] = line;
    } else {
       if (!map.hasLayer(flightLines[idKey])) flightLines[idKey].addTo(map);
    }

    // Plane
    if (settings.showPlaneIcon) {
      const angle = bearingBetween(depLat, depLng, arrLat, arrLng);
      const curLat = depLat + (arrLat - depLat) * prog;
      const curLng = depLng + (arrLng - depLng) * prog;
      
      const planeHtml = `<div style="transform: rotate(${angle}deg); transition: all 1s linear;"><img src="${PLANE_IMG_SRC}" style="width:32px;height:32px;display:block;"></div>`;
      const icon = L.divIcon({ html: planeHtml, className: "", iconSize: [32,32], iconAnchor: [16,16] });

      if (!flightMarkers[idKey]) {
        const mk = L.marker([curLat, curLng], { icon }).addTo(map);
        mk.on("click", () => showFlightCard(f, depA, arrA));
        flightMarkers[idKey] = mk;
      } else {
        if (!map.hasLayer(flightMarkers[idKey])) flightMarkers[idKey].addTo(map);
        flightMarkers[idKey].setLatLng([curLat, curLng]);
        flightMarkers[idKey].setIcon(icon); // Update rotation
      }
      
      // Label
      if (settings.showFlightNo) {
        flightMarkers[idKey].bindTooltip(f.flightNo, { permanent: true, direction: "right", className: "airport-label-box" });
      } else {
        flightMarkers[idKey].unbindTooltip();
      }
    }
  });
}

// ================== UI 交互：卡片与专注模式 ==================

function showFlightCard(f, depA, arrA) {
  const card = document.getElementById("infoCard");
  const prog = computeProgress(f);
  const pct = Math.floor(Math.max(0, Math.min(1, prog)) * 100);
  
  card.innerHTML = `
    <div>
      <div class="card-flight-title">${f.flightNo || "N/A"}</div>
      <div class="card-sub">${f.airline} · ${f.planeType} · ${f.reg||""}</div>
    </div>
    <div class="card-route">
      <div>
        <div class="card-city">${depA.name || f.dep}</div>
        <div class="card-time">${f.depTimeRaw}</div>
      </div>
      <div style="font-size:20px; color:var(--text-sec)">✈</div>
      <div style="text-align:right">
        <div class="card-city">${arrA.name || f.arr}</div>
        <div class="card-time">${f.arrTimeRaw}</div>
      </div>
    </div>
    <div class="card-progress-row">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;color:var(--text-sec)">
        <span>已飞行 ${pct}%</span>
        <span>${formatDateOffset(f.arrOffset)}</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${pct}%"></div>
      </div>
    </div>
    <div class="card-actions">
      <button class="btn-action btn-secondary" onclick="document.getElementById('infoCard').classList.add('hidden')">关闭</button>
      <button class="btn-action btn-primary" id="btnFocusMode">🔭 跟踪/专注</button>
    </div>
  `;
  
  card.classList.remove("hidden");
  
  // 绑定专注模式按钮
  document.getElementById("btnFocusMode").onclick = () => {
    enterFocusMode(f, depA, arrA);
  };
}

function showAirportCard(ap) {
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <div class="card-flight-title">${ap.name} (${ap.code})</div>
    <div class="card-sub">${ap.city || ""}</div>
    <div style="margin-top:16px; font-size:14px; color:var(--text-sec)">
      ${ap.level ? `<p>等级: ${ap.level}</p>` : ''}
      ${ap.runways ? `<p>跑道: ${ap.runways}</p>` : ''}
    </div>
    <div class="card-actions">
      <button class="btn-action btn-secondary" onclick="document.getElementById('infoCard').classList.add('hidden')">关闭</button>
    </div>
  `;
  card.classList.remove("hidden");
}

// ================== 专注模式核心 ==================
let focusTimer = null;

function enterFocusMode(f, depA, arrA) {
  const overlay = document.getElementById("focusOverlay");
  const img = document.getElementById("focusPlaneImg");
  const audio = document.getElementById("focusAudio");
  
  // 设置基本信息
  img.src = PLANE_IMG_SRC;
  document.getElementById("focusFlightNo").innerText = `${f.airline} ${f.flightNo} (Reg: ${f.reg})`;
  
  document.getElementById("focusDepCode").innerText = depA.code || "DEP";
  document.getElementById("focusDepCity").innerText = depA.city || depA.name;
  document.getElementById("focusDepTime").innerText = f.depTimeRaw;
  
  document.getElementById("focusArrCode").innerText = arrA.code || "ARR";
  document.getElementById("focusArrCity").innerText = arrA.city || arrA.name;
  document.getElementById("focusArrTime").innerText = f.arrTimeRaw;

  // 显示覆盖层
  overlay.classList.remove("hidden");
  
  // 播放音频 (需要用户交互后才能自动播放，如果浏览器阻止，需要提示)
  // 这里假设用户点击了按钮，已经是交互行为了
  audio.play().catch(e => console.log("Audio autoplay blocked", e));

  // 启动模拟数据循环
  if (focusTimer) clearInterval(focusTimer);
  
  focusTimer = setInterval(() => {
    // 1. 更新进度
    const prog = computeProgress(f);
    if (!prog || prog >= 1) {
      document.getElementById("statRemain").innerText = "已到达";
      return;
    }
    const pct = Math.floor(prog * 100);
    document.getElementById("focusProgressBar").style.width = pct + "%";
    
    // 2. 模拟剩余时间
    const nowM = nowBeijingTotalMinutes();
    const arrM = timeStrToMinutes(f.arrTimeRaw) + (f.arrOffset||0)*1440 + beijingTodayMidnight().getTime()/60000;
    const diff = Math.max(0, arrM - nowM);
    const h = Math.floor(diff/60);
    const m = Math.floor(diff%60);
    document.getElementById("statRemain").innerText = `${h}h ${m}m`;

    // 3. 模拟实时数据波动 (假数据)
    // 巡航阶段(20%-80%) 高度较高，起降较低
    let baseAlt = 0;
    let baseSpd = 0;
    
    if (prog < 0.2) { // Climb
      baseAlt = 1000 + (prog/0.2) * 8000;
      baseSpd = 300 + (prog/0.2) * 500;
    } else if (prog > 0.8) { // Descend
      baseAlt = 9000 - ((prog-0.8)/0.2) * 9000;
      baseSpd = 800 - ((prog-0.8)/0.2) * 500;
    } else { // Cruise
      baseAlt = 9000;
      baseSpd = 850;
    }
    
    // 加一点随机扰动
    const finalAlt = Math.floor(baseAlt + Math.random()*50 - 25);
    const finalSpd = Math.floor(baseSpd + Math.random()*10 - 5);
    
    document.getElementById("statAlt").innerText = finalAlt;
    document.getElementById("statSpeed").innerText = finalSpd;

  }, 1000);
}

document.getElementById("exitFocusBtn").onclick = () => {
  document.getElementById("focusOverlay").classList.add("hidden");
  const audio = document.getElementById("focusAudio");
  audio.pause();
  if (focusTimer) clearInterval(focusTimer);
};

// ================== 系统初始化 ==================
async function loadData() {
  try {
    const res = await fetch(AIRPORTS_PATH);
    const rawList = await res.json();
    airportDB = {};
    if (Array.isArray(rawList)) {
      rawList.forEach(a => {
        const key = a.code || (a.name ? a.name.substring(0,3).toUpperCase() : "XXX");
        airportDB[key] = a;
      });
    } else {
      airportDB = rawList;
    }
    renderAllAirports();
  } catch(e) { console.error(e); }

  try {
    const txt = await fetch(FLIGHT_DATA_PATH).then(r=>r.text());
    flights = parseFlightData(txt);
    renderFlights();
  } catch(e) { console.error(e); }
}

// 监听地图缩放，优化机场显示
map.on('zoomend moveend', () => {
  updateAirportVisibility();
});

// UI Event Listeners
document.getElementById("searchBtn").onclick = () => renderFlights();
document.getElementById("searchInput").onkeydown = (e) => { if (e.key === "Enter") renderFlights(); };
document.getElementById("clearBtn").onclick = () => { document.getElementById("searchInput").value=""; renderFlights(); };

document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.toggle("hidden");
document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");

// 图层切换逻辑
document.getElementById("layerBtn").onclick = () => {
  if (currentLayer === "clean") {
    map.removeLayer(layerClean);
    map.addLayer(layerSatellite);
    currentLayer = "satellite";
  } else {
    map.removeLayer(layerSatellite);
    map.addLayer(layerClean);
    currentLayer = "clean";
  }
};

// Settings Switches
const bindSwitch = (id, key, callback) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = settings[key];
  el.onchange = () => {
    settings[key] = el.checked;
    localStorage.setItem(key, JSON.stringify(settings[key]));
    if (callback) callback();
  };
};

bindSwitch("sw_showAirportName", "showAirportName", renderAllAirports);
bindSwitch("sw_showAirportCode", "showAirportCode", renderAllAirports);
bindSwitch("sw_showFlightNo", "showFlightNo", renderFlights);
bindSwitch("sw_showPlaneIcon", "showPlaneIcon", renderFlights);
bindSwitch("sw_hideOtherWhenFilter", "hideOtherWhenFilter", renderFlights);

// Start
loadData();
setInterval(loadData, refreshIntervalSec * 1000); // Auto Refresh Data
setInterval(renderFlights, 5000); // Animation update
