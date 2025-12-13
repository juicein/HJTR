// ================== 全局常量 & 工具 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png";

const LAYERS = {
  clean: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy;OpenStreetMap, &copy;CartoDB', subdomains: 'abcd', maxZoom: 19
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri', maxZoom: 17
  })
};

// 状态管理
let state = {
  // 设置
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showRouteLines: JSON.parse(localStorage.getItem("showRouteLines") || "true"), // 新增：全局航线开关
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"),
  
  // 运行时数据
  airportDB: {},
  flights: [], // 原始解析数据
  activeFlights: [], // 当前时刻在飞的航班
  
  // 地图对象存储
  markers: {}, // code -> L.marker (机场)
  flightLines: {}, // key -> L.polyline (全局虚线)
  flightMarkers: {}, // key -> L.marker (飞机)
  highlightLine: null, // 当前选中的高亮实线
  
  // 专注模式状态
  focusMode: false,
  focusFlight: null,
  mapRotationMode: false, // 是否开启地图旋转跟随
  followMode: 'follow', // 'follow' (跟随) or 'overview' (全览)
};

// 初始化地图
const map = L.map('map', { 
  zoomControl: false, 
  attributionControl: false,
  minZoom: 2,
  worldCopyJump: true,
  zoomAnimation: true
}).setView([35, 105], 4);

LAYERS.clean.addTo(map);

// ================== 时间系统 (核心) ==================

// 获取北京时间对象
function getBeijingTime() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + 3600000 * 8); // UTC+8
}

// 获取今天北京时间 00:00 的时间戳
function getBeijingTodayBase() {
  const bj = getBeijingTime();
  bj.setHours(0,0,0,0);
  return bj.getTime();
}

// 解析时间字符串 "HH:MM" 为分钟数
function timeToMin(str) {
  if (!str) return null;
  const p = str.split(":");
  return parseInt(p[0])*60 + parseInt(p[1]);
}

// ================== 数据加载与解析 ==================

async function loadData() {
  try {
    // 1. 加载机场
    if (Object.keys(state.airportDB).length === 0) {
      const apRes = await fetch(AIRPORTS_PATH);
      let apData = await apRes.json();
      if (!Array.isArray(apData)) apData = Object.values(apData); // 兼容旧格式
      
      state.airportDB = {};
      apData.forEach(ap => {
        // 确保有三字码
        const code = ap.code || (ap.name ? ap.name.slice(0,3).toUpperCase() : "UNK");
        // 修正等级权重
        let rank = 1;
        if(ap.level) {
          if(ap.level.includes("4F")) rank = 10;
          else if(ap.level.includes("4E")) rank = 8;
          else if(ap.level.includes("4D")) rank = 6;
          else rank = 4;
        }
        state.airportDB[code] = { ...ap, code, rank };
      });
      renderAirports();
    }

    // 2. 加载航班
    const fltText = await fetch(FLIGHT_DATA_PATH).then(r => r.text());
    state.flights = parseFlightData(fltText);
    
    // 立即渲染一次
    renderFlights();
    
  } catch (e) {
    console.error("数据加载失败:", e);
  }
}

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
    // 修复 Reg 解析，支持 <R-2102>
    const reg = getVal(/<\s*([^>]+)\s*>/);

    // 出发
    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const depName = depMatch ? depMatch[1].trim() : "";
    const depTimeRaw = depMatch ? depMatch[2].trim() : "";
    // #+1# 逻辑
    const depOffset = depMatch && depMatch[3] ? Number(depMatch[3].replace(/[^\d]/g,"")) : 0;

    // 到达
    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const arrName = arrMatch ? arrMatch[1].trim() : "";
    const arrTimeRaw = arrMatch ? arrMatch[2].trim() : "";
    const arrOffset = arrMatch && arrMatch[3] ? Number(arrMatch[3].replace(/[^\d]/g,"")) : 0;
    
    // 价格 (保留但暂不显示)
    const price = getVal(/§([^§]+)§/);

    if (flightNo && depName && arrName) {
      entries.push({ 
        flightNo, planeType, airline, reg, 
        dep: depName, depTimeRaw, depOffset, 
        arr: arrName, arrTimeRaw, arrOffset,
        raw: block 
      });
    }
  }
  return entries;
}

// ================== 渲染逻辑：机场 ==================

function renderAirports() {
  for (let code in state.airportDB) {
    if (state.markers[code]) continue;
    const ap = state.airportDB[code];
    if (!ap.lat || !ap.lng) continue;

    const isHighRank = ap.rank >= 8;
    // HTML 结构分离 Code 和 Name
    const html = `
      <div class="airport-marker ${isHighRank?'rank-high':''}">
        <div class="airport-dot"></div>
        <div class="airport-label">
          <span class="label-name">${ap.name}</span>
          <span class="label-code">${ap.code}</span>
        </div>
      </div>
    `;
    
    const icon = L.divIcon({ className: 'custom-ap-icon', html: html, iconAnchor: [0, 0] }); // Anchor handled by CSS centering
    const marker = L.marker([ap.lat, ap.lng], { icon }).addTo(map);
    marker.apData = ap;
    marker.on('click', () => showAirportCard(ap));
    state.markers[code] = marker;
  }
  updateAirportVis();
}

function updateAirportVis() {
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  
  // 获取所有可见机场并排序
  let visible = [];
  for (let code in state.markers) {
    const m = state.markers[code];
    const el = m.getElement();
    if (!el) continue;

    if (bounds.contains(m.getLatLng())) {
      const pt = map.latLngToLayerPoint(m.getLatLng());
      visible.push({ marker: m, pt, rank: m.apData.rank });
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }
  
  // 避让检测
  visible.sort((a,b) => b.rank - a.rank); // 高等级优先
  const accepted = [];
  const MIN_DIST = zoom < 5 ? 20 : 40; // 像素距离

  visible.forEach(item => {
    let clash = false;
    for (let acc of accepted) {
      const dx = item.pt.x - acc.pt.x;
      const dy = item.pt.y - acc.pt.y;
      if (Math.sqrt(dx*dx + dy*dy) < MIN_DIST) { clash = true; break; }
    }
    
    const el = item.marker.getElement();
    const lblName = el.querySelector('.label-name');
    const lblCode = el.querySelector('.label-code');

    if (clash) {
      el.classList.add('hidden'); // 碰撞隐藏
    } else {
      accepted.push(item);
      el.classList.remove('hidden');
      
      // 控制文字显隐
      if (lblName) lblName.style.display = state.showAirportName ? 'block' : 'none';
      if (lblCode) lblCode.style.display = state.showAirportCode ? 'block' : 'none';
      
      // 如果两个都没开，隐藏背景容器
      const labelContainer = el.querySelector('.airport-label');
      if (labelContainer) {
        labelContainer.style.display = (state.showAirportName || state.showAirportCode) ? 'block' : 'none';
      }
    }
  });
}

// ================== 渲染逻辑：航班 ==================

function renderFlights() {
  const now = getBeijingTime();
  // 计算今天 0点到现在经过的分钟数 (用于进度计算)
  // 注意：需要处理 offset (跨天)
  const todayBase = getBeijingTodayBase();
  const currentMinOffset = (now.getTime() - todayBase) / 60000;

  const searchVal = document.getElementById("searchInput").value.trim().toUpperCase();
  
  // 1. 筛选活跃航班
  state.activeFlights = [];
  
  // 临时存储需要绘制的 key，用于清理旧数据
  const activeKeys = new Set();
  
  // 飞机避让逻辑准备
  const planePositions = [];

  state.flights.forEach(f => {
    const depAp = getAirport(f.dep);
    const arrAp = getAirport(f.arr);
    if (!depAp || !arrAp) return;

    const tDep = timeToMin(f.depTimeRaw) + (f.depOffset * 24 * 60);
    const tArr = timeToMin(f.arrTimeRaw) + (f.arrOffset * 24 * 60);
    
    // 简单的飞行判定：当前时间在 起飞和到达之间
    // (这里简单化处理，只看今天的分钟数匹配。实际生产环境需要对比具体日期)
    // 假设 flight_data 里的航班每天都飞，或者今天就是起飞日
    
    let progress = (currentMinOffset - tDep) / (tArr - tDep);
    
    // 如果不在飞行中
    if (progress < 0 || progress > 1) {
       // 除非处于专注模式且正是这个航班 (模拟完成/未开始) - 暂简化为移除
       // 如果专注模式，且是这个航班，允许稍微越界显示
       if (state.focusMode && state.focusFlight && state.focusFlight.raw === f.raw) {
         // keep it
       } else {
         return; 
       }
    }
    
    // 搜索过滤
    let isMatch = true;
    if (searchVal) {
      isMatch = (f.flightNo.includes(searchVal)) || 
                (f.reg && f.reg.includes(searchVal)) ||
                (f.dep.includes(searchVal)) || 
                (f.arr.includes(searchVal));
    }
    if (!isMatch) return; // 搜索模式下只显示匹配项

    // 如果专注模式，只处理专注的航班
    if (state.focusMode && state.focusFlight && state.focusFlight.raw !== f.raw) return;

    const key = f.reg || (f.flightNo + f.depTimeRaw);
    activeKeys.add(key);
    
    // 坐标计算
    const lat1 = depAp.lat, lng1 = depAp.lng;
    const lat2 = arrAp.lat, lng2 = arrAp.lng;
    
    const curLat = lat1 + (lat2 - lat1) * progress;
    const curLng = lng1 + (lng2 - lng1) * progress;
    const angle = calcBearing(lat1, lng1, lat2, lng2);

    // --- 1. 绘制虚线 (全局) ---
    // 如果开启了显示所有航线，且不在专注模式(专注模式单独画)
    if (state.showRouteLines && !state.focusMode) {
      if (!state.flightLines[key]) {
        state.flightLines[key] = L.polyline([[lat1, lng1], [lat2, lng2]], {
          color: '#ff8c2b', weight: 1, dashArray: '4, 4', opacity: 0.6
        }).addTo(map);
        state.flightLines[key].on('click', () => { showFlightCard(f); highlightRoute(f, true); });
      }
    } else {
      // 关闭开关或专注模式下，移除虚线
      if (state.flightLines[key]) { map.removeLayer(state.flightLines[key]); delete state.flightLines[key]; }
    }

    // --- 2. 绘制飞机 ---
    if (state.showPlaneIcon) {
      // 拥挤检测 (仅在缩放小的时候)
      let showPlane = true;
      if (!state.focusMode && map.getZoom() < 6 && !searchVal) {
        const pt = map.latLngToLayerPoint([curLat, curLng]);
        for (let p of planePositions) {
           if (Math.abs(p.x - pt.x) < 20 && Math.abs(p.y - pt.y) < 20) {
             showPlane = false; break; 
           }
        }
        if (showPlane) planePositions.push(pt);
      }

      if (showPlane) {
        const planeHtml = `<img src="${PLANE_IMG}" class="plane-img" style="transform: rotate(${angle}deg);">`;
        const icon = L.divIcon({ 
          html: planeHtml, 
          className: 'plane-divicon', 
          iconSize: [32, 32], 
          iconAnchor: [16, 16] 
        });

        if (!state.flightMarkers[key]) {
          const m = L.marker([curLat, curLng], { icon, zIndexOffset: 1000 }).addTo(map);
          m.on('click', () => { showFlightCard(f); highlightRoute(f, true); });
          state.flightMarkers[key] = m;
        } else {
          const m = state.flightMarkers[key];
          m.setLatLng([curLat, curLng]);
          m.setIcon(icon);
          
          // 标签更新
          if (state.showFlightNo) {
            if(!m.getTooltip()) m.bindTooltip(f.flightNo, { permanent: true, direction: 'right', className: 'plane-tooltip' });
          } else {
            if(m.getTooltip()) m.unbindTooltip();
          }
        }

        // 专注模式更新逻辑
        if (state.focusMode && state.focusFlight && state.focusFlight.raw === f.raw) {
          updateFocusState(f, curLat, curLng, angle, progress);
        }
      } else {
         // 拥挤隐藏
         if (state.flightMarkers[key]) { map.removeLayer(state.flightMarkers[key]); delete state.flightMarkers[key]; }
      }
    }
  });

  // 清理消失的航班
  for (let k in state.flightMarkers) {
    if (!activeKeys.has(k)) {
      map.removeLayer(state.flightMarkers[k]);
      delete state.flightMarkers[k];
    }
  }
  for (let k in state.flightLines) {
    if (!activeKeys.has(k)) {
      map.removeLayer(state.flightLines[k]);
      delete state.flightLines[k];
    }
  }
}

// 高亮航线 (橙色实线)
function highlightRoute(f, show) {
  // 先移除旧的
  if (state.highlightLine) {
    map.removeLayer(state.highlightLine);
    state.highlightLine = null;
  }
  
  if (show) {
    const depAp = getAirport(f.dep);
    const arrAp = getAirport(f.arr);
    if (depAp && arrAp) {
      state.highlightLine = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
        color: '#ff6d00', // 鲜艳橙色
        weight: 3,
        opacity: 1
      }).addTo(map);
    }
  }
}

// ================== 交互逻辑 ==================

function getAirport(key) {
  if(!key) return null;
  const k = key.toUpperCase();
  if (state.airportDB[k]) return state.airportDB[k];
  // 模糊查找
  for (let c in state.airportDB) {
    const ap = state.airportDB[c];
    if (ap.name === key || ap.city === key || ap.aliases?.includes(key)) return ap;
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

// 显示航班卡片
function showFlightCard(f) {
  if (state.focusMode) return;
  const card = document.getElementById("infoCard");
  const depAp = getAirport(f.dep);
  const arrAp = getAirport(f.arr);
  
  // 生成卡片 HTML
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title-lg">${f.flightNo}</div>
        <div class="card-sub">${f.airline} · ${f.planeType} · ${f.reg}</div>
      </div>
      <button class="icon-btn" onclick="closeFlightCard()"><span class="material-symbols-rounded">close</span></button>
    </div>
    
    <div class="route-row" id="routeToggleArea">
      <div class="airport-display">
        <span class="ap-code">${depAp ? depAp.code : f.dep}</span>
        <span class="ap-name">${f.dep}</span>
        <div class="time-tag">${f.depTimeRaw}</div>
      </div>
      <div class="route-arrow">
        <span class="material-symbols-rounded" style="font-size:32px">flight_takeoff</span>
      </div>
      <div class="airport-display">
        <span class="ap-code">${arrAp ? arrAp.code : f.arr}</span>
        <span class="ap-name">${f.arr}</span>
        <div class="time-tag">${f.arrTimeRaw} ${f.arrOffset > 0 ? '+1' : ''}</div>
      </div>
    </div>

    <div class="action-row">
      <button class="btn btn-outline" id="btnPrevLeg"><span class="material-symbols-rounded">west</span>上一程</button>
      <button class="btn btn-primary" id="btnFocus"><span class="material-symbols-rounded">my_location</span>跟踪航班</button>
      <button class="btn btn-outline" id="btnNextLeg">下一程<span class="material-symbols-rounded">east</span></button>
    </div>
  `;
  card.classList.remove("hidden");
  
  // 事件绑定
  document.getElementById("btnFocus").onclick = () => enterFocusMode(f);
  document.getElementById("routeToggleArea").onclick = function() {
    this.querySelectorAll('.airport-display').forEach(el => el.classList.toggle('show-name'));
  };

  // 上下程逻辑 (根据 reg 和 时间排序)
  const legs = state.flights.filter(x => x.reg === f.reg).sort((a,b) => {
    // 简单按出发时间排序 (需考虑 +1 offset)
    const ta = timeToMin(a.depTimeRaw) + a.depOffset*1440;
    const tb = timeToMin(b.depTimeRaw) + b.depOffset*1440;
    return ta - tb;
  });
  const idx = legs.findIndex(x => x.raw === f.raw);
  
  document.getElementById("btnPrevLeg").onclick = () => {
    if(idx > 0) {
        showFlightCard(legs[idx-1]); 
        highlightRoute(legs[idx-1], true);
    } else alert("无前序航班记录");
  };
  document.getElementById("btnNextLeg").onclick = () => {
    if(idx < legs.length - 1) {
        showFlightCard(legs[idx+1]);
        highlightRoute(legs[idx+1], true);
    } else alert("无后续航班记录");
  };
}

function closeFlightCard() {
  document.getElementById("infoCard").classList.add("hidden");
  highlightRoute(null, false);
}

function showAirportCard(ap) {
  if (state.focusMode) return;
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title-lg">${ap.code} <small style="font-size:16px;color:var(--outline)">${ap.name}</small></div>
        <div class="card-sub">${ap.city || ''} ${ap.level ? '· '+ap.level : ''}</div>
      </div>
      <button class="icon-btn" onclick="document.getElementById('infoCard').classList.add('hidden')"><span class="material-symbols-rounded">close</span></button>
    </div>
    <div style="margin-top:8px; font-size:14px; color:var(--secondary);">
      <p><b>ICAO:</b> ${ap.ICAO || '-'}</p>
      <p><b>别名:</b> ${ap.aliases ? ap.aliases.join(", ") : '-'}</p>
      <p><b>跑道:</b> ${ap.runways || '-'}</p>
    </div>
  `;
  card.classList.remove("hidden");
  // 机场卡片不需要画线
  highlightRoute(null, false);
}

// ================== 专注模式 (Focus Mode) ==================

function enterFocusMode(f) {
  state.focusMode = true;
  state.focusFlight = f;
  state.followMode = 'follow'; // 默认跟随
  closeFlightCard();

  // UI 切换
  document.getElementById("topbar").classList.add("hidden");
  document.getElementById("layerControl").classList.add("hidden");
  document.getElementById("settingsPanel").classList.add("hidden");
  document.getElementById("focusOverlay").classList.remove("hidden");
  
  // 填充数据
  document.getElementById("focusFlightNo").innerText = f.flightNo;
  document.getElementById("focusDest").innerText = f.arr;
  const depAp = getAirport(f.dep);
  const arrAp = getAirport(f.arr);
  document.getElementById("focusDepCode").innerText = depAp ? depAp.code : "DEP";
  document.getElementById("focusArrCode").innerText = arrAp ? arrAp.code : "ARR";

  // 高亮实线
  highlightRoute(f, true);
  
  // 强制刷新渲染（会隐藏其他飞机）
  renderFlights();
  
  // 默认开启音乐 (但暂停状态，需用户点击)
  document.getElementById("musicPlayer").classList.add("hidden"); // 默认隐藏播放器，点按钮才出
}

function exitFocusMode() {
  state.focusMode = false;
  state.focusFlight = null;
  state.mapRotationMode = false;
  state.highlightLine = null;
  
  // 恢复地图旋转
  document.getElementById("map").style.transform = `rotate(0deg)`;
  document.getElementById("map").classList.remove("rotated-mode");
  map.invalidateSize(); // 重置尺寸

  // UI 恢复
  document.getElementById("focusOverlay").classList.add("hidden");
  document.getElementById("topbar").classList.remove("hidden");
  document.getElementById("layerControl").classList.remove("hidden");
  document.getElementById("musicPlayer").classList.add("hidden");
  
  // 停止音乐
  const audio = document.getElementById("bgMusic");
  audio.pause();

  map.setZoom(4);
  renderFlights();
}

function updateFocusState(f, lat, lng, angle, progress) {
  // 1. 地图视图控制
  if (state.followMode === 'follow') {
    if (state.mapRotationMode) {
      // 旋转地图：使飞机朝上 (减去 angle)
      // 注意：简单 CSS 旋转。
      const mapDiv = document.getElementById("map");
      mapDiv.classList.add("rotated-mode");
      mapDiv.style.transform = `rotate(${-angle}deg)`;
      map.setView([lat, lng], 8, { animate: false }); 
    } else {
      document.getElementById("map").style.transform = `rotate(0deg)`;
      document.getElementById("map").classList.remove("rotated-mode");
      map.panTo([lat, lng], { animate: true, duration: 1 });
    }
  } else {
    // Overview mode (不跟随中心，只在 updateFocusDashboard 更新)
  }

  // 2. 仪表盘数据
  const tArr = timeToMin(f.arrTimeRaw) + (f.arrOffset * 24 * 60);
  const now = getBeijingTime();
  const todayBase = getBeijingTodayBase();
  const nowMin = (now.getTime() - todayBase) / 60000;
  
  let remMin = Math.floor(tArr - nowMin);
  if (remMin < 0) remMin = 0;
  
  const hours = Math.floor(remMin / 60);
  const mins = remMin % 60;
  
  document.getElementById("focusTimeRem").innerHTML = `${hours}<small>h</small> ${mins}<small>min</small>`;
  
  // 估算距离 (假设 800km/h -> 13 km/min)
  const remDist = Math.floor(remMin * 13);
  document.getElementById("focusDistRem").innerHTML = `${remDist} <small>km</small>`;
  
  const pct = Math.max(0, Math.min(100, progress * 100));
  document.getElementById("focusProgressBar").style.width = `${pct}%`;
}


// ================== 音乐播放器 ==================
const PLAYLIST = [
  { title: "Pure", artist: "Cabin Ambience", url: "mock_pure.mp3" }, // 无法读取本地文件，使用占位
  { title: "Above Clouds", artist: "Chill Lo-Fi", url: "mock_clouds.mp3" },
  { title: "Night Flight", artist: "Jazz Vibes", url: "mock_night.mp3" }
];
let musicState = { idx: 0, playing: false, mode: 'loop' }; // loop, random

function initMusicPlayer() {
  const audio = document.getElementById("bgMusic");
  const playBtn = document.getElementById("musicPlayBtn");
  const titleEl = document.getElementById("musicTitle");
  const artistEl = document.getElementById("musicArtist");
  const listDiv = document.getElementById("playlistItems");

  // 初始化列表
  const renderList = () => {
    listDiv.innerHTML = PLAYLIST.map((s, i) => `
      <div class="playlist-item ${i===musicState.idx?'active':''}" onclick="playMusic(${i})">
        <span>${s.title}</span>
        <span style="opacity:0.6">${s.artist}</span>
      </div>
    `).join("");
  };
  renderList();

  window.playMusic = (idx) => {
    musicState.idx = idx;
    // 模拟资源 (实际使用请替换 URL)
    // 这里为了演示，我们假设 Pure.mp3 是有效的，或者使用在线资源
    // audio.src = PLAYLIST[idx].url; 
    // 由于没有真实 mp3，这里使用一个在线白噪音代替演示
    if(PLAYLIST[idx].title === "Pure") audio.src = "https://www.soundjay.com/transportation/airplane-cabin-1.mp3"; 
    else audio.src = "https://www.soundjay.com/nature/rain-01.mp3"; // 示例

    audio.play();
    musicState.playing = true;
    updatePlayerUI();
  };

  const updatePlayerUI = () => {
    const s = PLAYLIST[musicState.idx];
    titleEl.innerText = s.title;
    artistEl.innerText = s.artist;
    playBtn.innerHTML = musicState.playing ? 
      '<span class="material-symbols-rounded">pause</span>' : 
      '<span class="material-symbols-rounded">play_arrow</span>';
    renderList();
  };

  playBtn.onclick = () => {
    if (musicState.playing) { audio.pause(); musicState.playing = false; }
    else { if(!audio.src) playMusic(0); else audio.play(); musicState.playing = true; }
    updatePlayerUI();
  };

  document.getElementById("musicNextBtn").onclick = () => {
    let next = musicState.idx + 1;
    if (next >= PLAYLIST.length) next = 0;
    playMusic(next);
  };
  document.getElementById("musicPrevBtn").onclick = () => {
    let prev = musicState.idx - 1;
    if (prev < 0) prev = PLAYLIST.length - 1;
    playMusic(prev);
  };
  
  document.getElementById("musicToggleBtn").onclick = () => {
     document.getElementById("musicPlayer").classList.toggle("hidden");
  };
  document.getElementById("musicListBtn").onclick = () => document.getElementById("musicPlaylist").classList.remove("hidden");
  document.getElementById("playlistClose").onclick = () => document.getElementById("musicPlaylist").classList.add("hidden");
  
  // 搜索
  document.getElementById("musicSearch").oninput = (e) => {
    const v = e.target.value.toLowerCase();
    Array.from(listDiv.children).forEach((el, i) => {
      const txt = PLAYLIST[i].title.toLowerCase();
      el.style.display = txt.includes(v) ? 'flex' : 'none';
    });
  };
}


// ================== 初始化与事件监听 ==================

function initUI() {
  // 搜索 (防抖)
  let searchTimer;
  const doSearch = () => {
    renderFlights();
    document.getElementById("clearBtn").classList.remove("hidden");
  };
  
  document.getElementById("searchInput").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 500); // 500ms 防抖
  };
  document.getElementById("searchBtn").onclick = doSearch;
  document.getElementById("clearBtn").onclick = () => {
    document.getElementById("searchInput").value = "";
    document.getElementById("clearBtn").classList.add("hidden");
    renderFlights();
  };

  // 设置面板
  document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.toggle("hidden");
  document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");

  // 绑定开关
  const bindSw = (id, key, action) => {
    const el = document.getElementById(id);
    el.checked = state[key];
    el.onchange = () => {
      state[key] = el.checked;
      localStorage.setItem(key, JSON.stringify(state[key]));
      action();
    };
  };
  
  bindSw("sw_showAirportName", "showAirportName", updateAirportVis);
  bindSw("sw_showAirportCode", "showAirportCode", updateAirportVis);
  bindSw("sw_showFlightNo", "showFlightNo", renderFlights);
  bindSw("sw_showPlaneIcon", "showPlaneIcon", renderFlights);
  bindSw("sw_showRouteLines", "showRouteLines", renderFlights);

  // 图层切换 (普通模式)
  document.querySelectorAll("#layerControl .layer-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#layerControl .layer-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const type = btn.dataset.type;
      map.eachLayer(l => { if(l._url) map.removeLayer(l); }); // 清除底图
      LAYERS[type].addTo(map);
    };
  });

  // 专注模式按钮
  document.getElementById("exitFocusBtn").onclick = exitFocusMode;
  
  document.getElementById("focusRotateBtn").onclick = function() {
    state.mapRotationMode = !state.mapRotationMode;
    this.classList.toggle("filled", state.mapRotationMode);
    // 切换图标
    this.querySelector("span").innerText = state.mapRotationMode ? "navigation" : "explore";
    renderFlights(); // 触发一次位置更新
  };

  document.getElementById("focusViewBtn").onclick = function() {
    state.followMode = state.followMode === 'follow' ? 'overview' : 'follow';
    this.querySelector("span").innerText = state.followMode === 'follow' ? "center_focus_strong" : "map";
    
    if (state.followMode === 'overview' && state.focusFlight) {
       // Fit bounds
       const dep = getAirport(state.focusFlight.dep);
       const arr = getAirport(state.focusFlight.arr);
       if(dep && arr) map.fitBounds([[dep.lat, dep.lng], [arr.lat, arr.lng]], { padding: [50, 50] });
    }
  };

  // 专注模式内的图层切换
  document.getElementById("focusLayerBtn").onclick = () => {
     // 简单轮换
     const currentUrl = Object.values(LAYERS).find(l => map.hasLayer(l));
     map.eachLayer(l => { if(l._url) map.removeLayer(l); });
     if (currentUrl === LAYERS.clean) LAYERS.satellite.addTo(map);
     else LAYERS.clean.addTo(map);
  };

  // 地图事件
  map.on('zoomend moveend', updateAirportVis);
  map.on('zoomend', renderFlights); // 缩放时重新计算拥挤
  
  initMusicPlayer();
}

// 启动循环
function startLoop() {
  loadData();
  setInterval(renderFlights, 2000); // 动画/位置更新频率
  setInterval(loadData, 60000); // 数据刷新频率
}

initUI();
startLoop();
