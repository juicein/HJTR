// ================== 配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "IMG_4109.png";

// 配置：进入专注模式时是否自动播放音乐 (true/false)
const AUTO_PLAY_MUSIC_ON_FOCUS = true; 

// 音乐列表
const MP3_LIST = [
  { title: "Pure", src: "../music/Pure.m4a", artist: "Micki Miller", cover: "music/cover_pure.jpg" },
  { title: "冬", src: "music/燃冬.mp3", artist: "电影原声", cover: "" },
  { title: "Gen Feng", src: "music/Gen Wo Yi Qi Feng.mp3", artist: "Beach Boys", cover: "" },
  { title: "San", src: "music/San Fransisco.mp3", artist: "Beach Boys", cover: "" }
];

// 图层定义
const LAYERS = {
  clean: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy;OpenStreetMap', subdomains: 'abcd', maxZoom: 19, className: 'clean-tiles'
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy;Esri', maxZoom: 17
  })
};

// 状态管理
let state = {
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"),
  showAllLines: JSON.parse(localStorage.getItem("showAllLines") || "true"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
  activeLayer: localStorage.getItem("activeLayer") || 'clean',
  
  flights: [], sortedFlights: {}, airportDB: {},
  activeFlightKeys: new Set(), // 当前时刻应该显示的航班Key集合
  selectedFlightKey: null,
  focusMode: false,
  focusFlight: null,
  mapRotationMode: 'north',
  
  musicIndex: 0,
  playMode: 0, 
  isPlaying: false
};

let mapObjects = { 
  dashedLines: {}, 
  solidLine: null, 
  markers: {}, 
  airportMarkers: [],
  sensitivePolygon: null 
};

// 初始化地图
const map = L.map('map', { 
  zoomControl: false, attributionControl: false, minZoom: 2, worldCopyJump: true 
}).setView([35, 105], 4);
LAYERS[state.activeLayer].addTo(map);
document.querySelectorAll(`.layer-btn[data-type="${state.activeLayer}"]`).forEach(b => b.classList.add('active'));

// ================== 时间核心 ==================
function getBeijingTime() {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + 28800000);
}

// 获取北京时间的星期几 (0=SUN, 1=MON...)
function getBeijingDay() {
  return getBeijingTime().getDay();
}

function timeToMin(str) {
  if (!str) return 0;
  const p = str.split(":");
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

// ================== 数据与逻辑 ==================

async function loadData() {
  try {
    const apData = await fetch(AIRPORTS_PATH).then(r => r.json());
    state.airportDB = {};
    (Array.isArray(apData) ? apData : []).forEach(ap => {
      if(!ap.level) ap.level = "OTHER";
      const key = ap.code || "UNK";
      state.airportDB[key] = ap;
      if(ap.name) state.airportDB[ap.name] = ap;
    });

    const fltText = await fetch(FLIGHT_DATA_PATH).then(r => r.text());
    state.flights = parseFlightData(fltText);
    
    // 排序逻辑
    state.sortedFlights = {};
    state.flights.forEach(f => {
      if(f.reg && f.reg !== '<->') {
        if(!state.sortedFlights[f.reg]) state.sortedFlights[f.reg] = [];
        state.sortedFlights[f.reg].push(f);
      }
    });
    for(let reg in state.sortedFlights) {
      state.sortedFlights[reg].sort((a,b) => {
        let ta = timeToMin(a.depTimeRaw) + (a.depOffset*1440);
        let tb = timeToMin(b.depTimeRaw) + (b.depOffset*1440);
        return ta - tb;
      });
    }

    renderAirports();
    updateDisplaySettings(); 
    checkUrlParams(); 

    // 启动两个循环：
    // 1. 低频逻辑循环：每秒检查一次哪些航班应该出现/消失 (filter & create/remove DOM)
    setInterval(updateActiveFlightsList, 1000);
    // 2. 高频动画循环：每帧更新位置 (smooth animation)
    requestAnimationFrame(animationLoop);

    setTimeout(() => {
        updateAirportCollisions();
        updatePlaneCollisions();
    }, 500);

  } catch (e) { console.error("Load Error", e); }
}

function parseFlightData(raw) {
  const entries = [];
  const parts = raw.split("《航班结束》");
  
  // 星期映射表
  const DAY_MAP = { "SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6 };

  for (let block of parts) {
    block = block.trim();
    if (!block) continue;
    const getVal = (reg) => { const m = block.match(reg); return m ? m[1].trim() : ""; };
    
    // 解析星期 «MON,SUN»
    const daysMatch = block.match(/«([^»]+)»/);
    let allowedDays = [0,1,2,3,4,5,6]; // 默认每天
    if (daysMatch) {
        allowedDays = daysMatch[1].split(',').map(d => DAY_MAP[d.trim().toUpperCase()]).filter(d => d !== undefined);
    }

    const f = {
      raw: block,
      flightNo: getVal(/【\s*([^\]　]+)\s*】/),
      planeType: getVal(/〔\s*([^\]　]+)\s*〕/),
      airline: getVal(/『\s*([^』]+)\s*』/),
      reg: getVal(/<\s*([^>]+)\s*>/),
      allowedDays: allowedDays, // 存储允许飞行的星期数组
      dep: "", depTimeRaw: "", depOffset: 0,
      arr: "", arrTimeRaw: "", arrOffset: 0
    };
    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}(\#\+(\d+)\#)?/);
    if(depMatch) { f.dep = depMatch[1].trim(); f.depTimeRaw = depMatch[2].trim(); f.depOffset = depMatch[4]?parseInt(depMatch[4]):0; }
    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}(\#\+(\d+)\#)?/);
    if(arrMatch) { f.arr = arrMatch[1].trim(); f.arrTimeRaw = arrMatch[2].trim(); f.arrOffset = arrMatch[4]?parseInt(arrMatch[4]):0; }
    
    f.key = f.flightNo + "_" + f.dep + "_" + f.arr;
    entries.push(f);
  }
  return entries;
}

// ================== URL 参数处理 ==================
function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    let query = params.get("search") || params.get("q") || params.get("flights_map");
    if (query) {
        query = query.trim().toUpperCase();
        document.getElementById("searchInput").value = query;
        performSearch(query);
    }
}

// ================== 渲染 ==================

function renderAirports() {
  const processed = new Set();
  mapObjects.airportMarkers = []; 
  
  for (let code in state.airportDB) {
    const ap = state.airportDB[code];
    if (processed.has(ap.code) || !ap.lat || !ap.lng) continue;
    processed.add(ap.code);

    const html = `
      <div class="airport-marker-container">
        <div class="airport-dot"></div>
        <div class="airport-label">
          <span class="ap-name-span">${ap.name}</span>
          <span class="ap-code-span">${ap.code}</span>
        </div>
      </div>
    `;

    const icon = L.divIcon({ 
      className: '', html: html, iconSize: [0, 0], iconAnchor: [5, 5]
    });

    const marker = L.marker([ap.lat, ap.lng], { icon }).addTo(map);
    marker.on('click', () => showAirportCard(ap));
    marker.airportData = ap;
    mapObjects.airportMarkers.push(marker);
  }
}

function updateDisplaySettings() {
  document.body.classList.toggle('show-ap-name', state.showAirportName);
  document.body.classList.toggle('show-ap-code', state.showAirportCode);
  updateAirportCollisions();
}

// === 核心逻辑：高级机场碰撞检测 ===
function updateAirportCollisions() {
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    
    if (zoom >= 11) {
        mapObjects.airportMarkers.forEach(m => {
            const el = m.getElement();
            if(el) {
                const container = el.querySelector('.airport-marker-container');
                container.classList.remove('fully-hidden');
                container.classList.remove('label-hidden');
            }
        });
        return;
    }

    const levelWeight = {
        "4F": 10, "4E": 9, "4D": 8, "4C": 7, "3U": 6, 
        "3C": 5, "OTHER": 0, "UNKNOWN": 0
    };
    
    let visibleItems = [];
    mapObjects.airportMarkers.forEach(m => {
        const latLng = m.getLatLng();
        if(!bounds.contains(latLng)) return;
        const pt = map.latLngToContainerPoint(latLng);
        const lvl = m.airportData.level ? m.airportData.level.toUpperCase() : "OTHER";
        visibleItems.push({ marker: m, pt: pt, weight: levelWeight[lvl] || 0 });
    });

    visibleItems.sort((a, b) => b.weight - a.weight);

    const placedDots = []; 
    const dotRadius = 15; 

    // 1. 处理圆点
    visibleItems.forEach(item => {
        const container = item.marker.getElement().querySelector('.airport-marker-container');
        let clash = false;
        for (let placed of placedDots) {
            const dx = item.pt.x - placed.x;
            const dy = item.pt.y - placed.y;
            if (Math.sqrt(dx*dx + dy*dy) < dotRadius) { clash = true; break; }
        }
        if (clash) {
            container.classList.add('fully-hidden');
            item.isHidden = true; 
        } else {
            container.classList.remove('fully-hidden');
            placedDots.push(item.pt);
            item.isHidden = false;
        }
    });

    // 2. 处理标签
    if (state.showAirportName || state.showAirportCode) {
        const placedLabels = [];
        visibleItems.forEach(item => {
            if (item.isHidden) return;
            const container = item.marker.getElement().querySelector('.airport-marker-container');
            const w = 80; const h = 24;
            const rect = { l: item.pt.x - w/2, t: item.pt.y - h - 5, r: item.pt.x + w/2, b: item.pt.y - 5 };

            let labelClash = false;
            if (zoom < 9) {
                for (let r of placedLabels) {
                    if (!(rect.r < r.l || rect.l > r.r || rect.b < r.t || rect.t > r.b)) {
                        labelClash = true; break;
                    }
                }
            }
            if (labelClash) container.classList.add('label-hidden');
            else {
                container.classList.remove('label-hidden');
                placedLabels.push(rect);
            }
        });
    } else {
        visibleItems.forEach(item => {
            if(!item.isHidden) item.marker.getElement().querySelector('.airport-marker-container').classList.add('label-hidden');
        });
    }
}

// 飞机避让
function updatePlaneCollisions() {
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  
  if (zoom < 6) {
      const planes = [];
      for(let k in mapObjects.markers) {
          const m = mapObjects.markers[k];
          if(bounds.contains(m.getLatLng())) planes.push({m, pt: map.latLngToLayerPoint(m.getLatLng()), key: k});
      }
      const pAccepted = [];
      planes.forEach(p => {
          if(p.key === state.selectedFlightKey || (state.focusFlight && p.key === state.focusFlight.key)) { 
              pAccepted.push(p); return; 
          }
          let clash = false;
          for(let acc of pAccepted) {
              if(p.pt.distanceTo(acc.pt) < 30) { clash = true; break; }
          }
          const el = p.m.getElement();
          if(el) {
              if(clash) L.DomUtil.addClass(el, 'hidden');
              else { L.DomUtil.removeClass(el, 'hidden'); pAccepted.push(p); }
          }
      });
  } else {
      for(let k in mapObjects.markers) {
          const m = mapObjects.markers[k];
          const el = m.getElement();
          if(el) L.DomUtil.removeClass(el, 'hidden');
      }
  }
}

map.on('zoomend moveend', () => {
    updateAirportCollisions();
    updatePlaneCollisions();
});

// ================== 逻辑循环：计算哪些航班应该在天上 ==================

function updateActiveFlightsList() {
    const bjNow = getBeijingTime();
    const currentTs = bjNow.getTime();
    const todayMid = new Date(bjNow).setHours(0,0,0,0);
    const yesterdayMid = todayMid - 86400000;
    
    // 获取今天是星期几 (0-6)
    const todayDay = bjNow.getDay();
    // 获取昨天是星期几 (0-6)
    const yesterdayDay = (todayDay + 6) % 7; 

    const searchKey = document.getElementById("searchInput").value.trim().toUpperCase();
    const nextActiveKeys = new Set();

    state.flights.forEach(f => {
        // 搜索过滤
        let isMatch = true;
        if (searchKey) isMatch = (f.flightNo.includes(searchKey) || (f.reg && f.reg.includes(searchKey)));
        
        if (state.focusMode && state.focusFlight) {
            if (state.hideOtherWhenFilter && f.key !== state.focusFlight.key) return;
        } else {
            if (state.hideOtherWhenFilter && searchKey && !isMatch) return;
        }

        const depMin = timeToMin(f.depTimeRaw);
        const arrMin = timeToMin(f.arrTimeRaw);
        // 计算这一班的飞行时长（毫秒）
        let flightDurationMs = ((arrMin - depMin) * 60000) + ((f.arrOffset - f.depOffset) * 86400000);
        // 防止数据错误导致的负数
        if(flightDurationMs < 0) flightDurationMs += 86400000;

        let isActive = false;
        
        // --- 核心逻辑：检查“今天出发”的航班 ---
        if (f.allowedDays.includes(todayDay)) {
            const depTsToday = todayMid + depMin * 60000 + (f.depOffset * 86400000);
            const arrTsToday = depTsToday + flightDurationMs;
            
            if (currentTs >= depTsToday && currentTs <= arrTsToday) {
                isActive = true;
            }
        }

        // --- 核心逻辑：检查“昨天出发”但“跨到今天”的航班 ---
        // (例如周一 23:00 起飞，周二 02:00 到达，当前是周二 01:00)
        if (!isActive && f.allowedDays.includes(yesterdayDay)) {
            const depTsYest = yesterdayMid + depMin * 60000 + (f.depOffset * 86400000);
            const arrTsYest = depTsYest + flightDurationMs;

            if (currentTs >= depTsYest && currentTs <= arrTsYest) {
                isActive = true;
            }
        }

        if (isActive) {
            nextActiveKeys.add(f.key);
        }
    });

    // 1. 移除不再活跃的 Marker
    for (let k in mapObjects.markers) {
        if (!nextActiveKeys.has(k)) {
            map.removeLayer(mapObjects.markers[k]);
            delete mapObjects.markers[k];
            if (mapObjects.dashedLines[k]) {
                map.removeLayer(mapObjects.dashedLines[k]);
                delete mapObjects.dashedLines[k];
            }
        }
    }

    // 2. 创建新增的 Marker (初始位置在动画循环中更新，这里只管创建)
    nextActiveKeys.forEach(key => {
        if (!mapObjects.markers[key]) {
            const f = state.flights.find(x => x.key === key);
            if (!f) return;

            // 图标初始化
            const html = `<div class="plane-wrap"><img src="${PLANE_IMG}" style="width:30px; height:30px;"></div>`;
            const icon = L.divIcon({ html, className: 'plane-icon', iconSize: [30, 30], iconAnchor: [15, 15] });
            
            // 初始位置暂定为出发地 (马上会被动画循环修正)
            const depAp = getAirport(f.dep);
            if (!depAp) return;
            
            const m = L.marker([depAp.lat, depAp.lng], { icon, zIndexOffset: 1000 }).addTo(map);
            m.on('click', () => onPlaneClick(f));
            m.bindTooltip(f.flightNo, { permanent: true, direction: 'right', className: 'airport-label' });
            mapObjects.markers[key] = m;

            // 虚线初始化
            if (state.showAllLines && !state.focusMode) {
                const arrAp = getAirport(f.arr);
                if(arrAp) {
                    const line = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
                        color: '#ff8c2b', weight: 1, dashArray: '4, 4', opacity: 0.5, className: 'flight-line-dashed'
                    }).addTo(map);
                    mapObjects.dashedLines[key] = line;
                }
            }
        }
    });

    state.activeFlightKeys = nextActiveKeys;
    
    // 更新选中航班的实线
    updateSelectedSolidLine();
}

// 更新选中航班的实线
function updateSelectedSolidLine() {
    if (!state.selectedFlightKey && mapObjects.solidLine) {
        map.removeLayer(mapObjects.solidLine);
        mapObjects.solidLine = null;
    }
    if (state.selectedFlightKey) {
        const f = state.flights.find(x => x.key === state.selectedFlightKey);
        if (f) {
            const depAp = getAirport(f.dep);
            const arrAp = getAirport(f.arr);
            if(depAp && arrAp) {
                if (!mapObjects.solidLine) {
                    mapObjects.solidLine = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
                        color: '#ff6d00', weight: 3, opacity: 1, className: 'flight-line-solid'
                    }).addTo(map);
                } else {
                    mapObjects.solidLine.setLatLngs([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]]);
                }
            }
        }
    }
}

// ================== 动画循环：高频更新位置 (60FPS) ==================

function animationLoop() {
    const bjNow = getBeijingTime();
    const currentTs = bjNow.getTime();
    const todayMid = new Date(bjNow).setHours(0,0,0,0);
    const yesterdayMid = todayMid - 86400000;
    const todayDay = bjNow.getDay();
    const yesterdayDay = (todayDay + 6) % 7;

    state.activeFlightKeys.forEach(key => {
        const marker = mapObjects.markers[key];
        if (!marker) return;
        const f = state.flights.find(x => x.key === key);
        if (!f) return;

        const depAp = getAirport(f.dep);
        const arrAp = getAirport(f.arr);
        if(!depAp || !arrAp) return;

        // 计算进度 Progress
        const depMin = timeToMin(f.depTimeRaw);
        const arrMin = timeToMin(f.arrTimeRaw);
        let flightDurationMs = ((arrMin - depMin) * 60000) + ((f.arrOffset - f.depOffset) * 86400000);
        if(flightDurationMs < 0) flightDurationMs += 86400000;

        let depTs = 0;
        
        // 判定是今天的航班还是昨天的航班
        // 优先匹配“今天出发”的时间窗口
        if (f.allowedDays.includes(todayDay)) {
            let tryDep = todayMid + depMin * 60000 + (f.depOffset * 86400000);
            if (currentTs >= tryDep && currentTs <= tryDep + flightDurationMs) {
                depTs = tryDep;
            }
        }
        // 如果不是今天的，匹配“昨天出发”的时间窗口
        if (depTs === 0 && f.allowedDays.includes(yesterdayDay)) {
            let tryDep = yesterdayMid + depMin * 60000 + (f.depOffset * 86400000);
            if (currentTs >= tryDep && currentTs <= tryDep + flightDurationMs) {
                depTs = tryDep;
            }
        }

        if (depTs === 0) return; // 理论上不应发生，因为 activeList 已经筛选过了

        let progress = (currentTs - depTs) / flightDurationMs;
        if (progress < 0) progress = 0;
        if (progress > 1) progress = 1;

        // 计算位置
        const curPos = interpolate(depAp, arrAp, progress);
        const angle = calcBearing(depAp.lat, depAp.lng, arrAp.lat, arrAp.lng);

        // 高频更新位置
        marker.setLatLng(curPos);
        
        // 更新旋转角度 (不再使用 transition 以避免方向改变时的怪异动画)
        const wrap = marker.getElement().querySelector('.plane-wrap');
        if(wrap) {
            wrap.style.transform = `rotate(${angle}deg)`;
            // 确保没有 CSS transition 干扰平滑移动，
            // 可以在 CSS 中把 .plane-wrap 的 transition: transform 0.5s 去掉，或者在这里强制覆盖
            wrap.style.transition = 'none'; 
        }

        // 控制 Tooltip 显示
        const tip = marker.getTooltip();
        if(tip && tip.getElement()) {
            tip.getElement().style.display = state.showFlightNo ? 'block' : 'none';
        }

        // 专注模式跟随
        if(state.focusMode && state.focusFlight && state.focusFlight.key === key) {
            map.panTo(curPos, { animate: false }); // 每一帧都pan，animate设为false防止抖动
            updateFocusStats(f, progress);
            if(state.mapRotationMode === 'heading') {
                document.getElementById('map').style.transform = `rotate(${-angle}deg) scale(1.5)`;
            } else {
                document.getElementById('map').style.transform = `none`;
            }
        }
    });

    requestAnimationFrame(animationLoop);
}

function onPlaneClick(f) {
    if(state.focusMode) return;
    state.selectedFlightKey = f.key;
    updateSelectedSolidLine(); // 立即更新线
    openFlightCard(f);
}

// ================== 卡片交互与搜索 ==================

function getAirport(key) { return state.airportDB[key] || state.airportDB[key.toUpperCase()]; }

// 统一搜索逻辑
function performSearch(query) {
    if(!query) {
        updateActiveFlightsList();
        return;
    }

    let targetAp = null;
    const qUpper = query.toUpperCase();
    for (let key in state.airportDB) {
        const ap = state.airportDB[key];
        if (ap.code === qUpper || ap.name.indexOf(query) > -1) {
            targetAp = ap;
            break;
        }
    }

    if (targetAp) {
        map.setView([targetAp.lat, targetAp.lng], 10);
        showAirportCard(targetAp);
        document.getElementById("clearBtn").classList.remove("hidden");
        return;
    }

    updateActiveFlightsList(); // 触发一次过滤
    // 找到第一个匹配的航班打开卡片
    setTimeout(() => {
        const matchKey = Array.from(state.activeFlightKeys).find(k => k.includes(qUpper));
        if (matchKey) {
            const f = state.flights.find(x => x.key === matchKey);
            if(f) onPlaneClick(f);
        }
    }, 100);
}

function showAirportCard(ap) {
  if(state.focusMode) return;
  const card = document.getElementById("infoCard");
  
  card.innerHTML = `
    <div class="card-top">
      <div>
        <div class="card-title-row">
            <span class="card-main-title">${ap.name}</span>
            <span class="card-sub-code">${ap.code}</span>
        </div>
        <div class="airport-level-badge">飞行区等级: ${ap.level || '未知'}</div>
      </div>
      <button class="icon-btn" onclick="closeInfoCard()"><span class="material-symbols-rounded">close</span></button>
    </div>
    <div style="font-size:14px; color:#555; padding:0 8px;">
        <p><b>别名:</b> ${(ap.aliases||[]).join(', ')}</p>
        <p><b>ICAO:</b> ${ap.ICAO||'-'}</p>
        <p><b>跑道数:</b> ${ap.runways||1}</p>
    </div>
  `;
  card.classList.remove("hidden");
  state.selectedFlightKey = null; 
  updateSelectedSolidLine();
}

let routeDisplayMode = 'code';
function openFlightCard(f) {
  const card = document.getElementById("infoCard");
  const depAp = getAirport(f.dep);
  const arrAp = getAirport(f.arr);
  routeDisplayMode = 'code';

  const renderRoute = () => {
    const dTxt = routeDisplayMode === 'code' ? (depAp?depAp.code:f.dep) : (depAp?depAp.name:f.dep);
    const aTxt = routeDisplayMode === 'code' ? (arrAp?arrAp.code:f.arr) : (arrAp?arrAp.name:f.arr);
    
    // 处理 +1 天显示
    let arrTimeDisplay = f.arrTimeRaw;
    if (f.arrOffset > 0) {
        arrTimeDisplay += ` <small style="color:#ff6d00; font-weight:bold;">(+${f.arrOffset})</small>`;
    }

    return `
      <div class="ap-block"><div class="ap-code">${dTxt}</div><div class="ap-name-sub">出发</div><div class="time-lbl">${f.depTimeRaw}</div></div>
      <span class="material-symbols-rounded" style="font-size:32px;opacity:0.3">flight_takeoff</span>
      <div class="ap-block"><div class="ap-code">${aTxt}</div><div class="ap-name-sub">到达</div><div class="time-lbl">${arrTimeDisplay}</div></div>
    `;
  };

  const html = `
    <div class="card-top">
      <div>
        <div class="flight-big-no">${f.flightNo}</div>
        <div class="flight-meta-row">
          <span>${f.airline}</span>
          <div class="flight-meta-sep"></div>
          <span>${f.planeType||'机型未知'}</span>
          <div class="flight-meta-sep"></div>
          <span>${f.reg}</span>
        </div>
      </div>
      <button class="icon-btn" onclick="closeInfoCard()"><span class="material-symbols-rounded">close</span></button>
    </div>
    <div class="route-display" id="routeDisplayBox">${renderRoute()}</div>
    <div class="flight-actions">
      <button class="btn btn-tonal" onclick="switchLeg(this, '${f.reg}', -1)">上一程</button>
      <button class="btn btn-primary" onclick="enterFocusMode('${f.key}')">
        <span class="material-symbols-rounded">my_location</span> 跟踪
      </button>
      <button class="btn btn-tonal" onclick="switchLeg(this, '${f.reg}', 1)">下一程</button>
    </div>
  `;
  
  card.innerHTML = html;
  card.classList.remove("hidden");
  document.getElementById("routeDisplayBox").onclick = function() {
      routeDisplayMode = (routeDisplayMode === 'code' ? 'name' : 'code');
      this.innerHTML = renderRoute();
      this.animate([{opacity:0.5}, {opacity:1}], {duration:200});
  };
}

function closeInfoCard() {
    document.getElementById("infoCard").classList.add("hidden");
    state.selectedFlightKey = null;
    updateSelectedSolidLine();
}

window.switchLeg = (btn, reg, dir) => {
    const list = state.sortedFlights[reg];
    if(!list) return;
    const curr = list.findIndex(x => x.key === state.selectedFlightKey);
    const nextF = list[curr + dir];
    if(nextF) onPlaneClick(nextF);
    else {
        const oldTxt = btn.innerText;
        btn.innerText = "无记录";
        setTimeout(()=>btn.innerText = oldTxt, 1000);
    }
}

// ================== 专注模式与音乐联动 ==================

function enterFocusMode(key) {
    const f = state.flights.find(x => x.key === key);
    if(!f) return;
    
    state.focusMode = true;
    state.focusFlight = f;
    
    document.getElementById("topbar").classList.add("hidden");
    document.getElementById("layerControl").classList.add("hidden");
    document.getElementById("infoCard").classList.add("hidden");
    document.getElementById("focusOverlay").classList.remove("hidden");
    
    document.getElementById("focusFlightNo").innerText = f.flightNo;
    document.getElementById("focusDest").innerText = f.arr;
    const depAp = getAirport(f.dep); const arrAp = getAirport(f.arr);
    document.getElementById("focusDepCode").innerText = depAp?depAp.code:f.dep;
    document.getElementById("focusArrCode").innerText = arrAp?arrAp.code:f.arr;
    
    map.setZoom(8);
    updateActiveFlightsList(); 
    
    if (AUTO_PLAY_MUSIC_ON_FOCUS) {
        const audio = document.getElementById("bgMusic");
        if (audio.paused) {
            document.getElementById("miniPlayBtn").click(); 
        }
    }
}

function exitFocusMode() {
    state.focusMode = false;
    state.focusFlight = null;
    state.mapRotationMode = 'north';
    document.getElementById('map').style.transform = 'none';
    document.getElementById("rotIcon").innerText = "explore";
    
    document.getElementById("topbar").classList.remove("hidden");
    document.getElementById("layerControl").classList.remove("hidden");
    document.getElementById("focusOverlay").classList.add("hidden");
    document.getElementById("musicExpandCard").classList.add("hidden");
    
    map.setZoom(4);
    state.selectedFlightKey = null;
    updateActiveFlightsList();
    
    const audio = document.getElementById("bgMusic");
    if (!audio.paused) {
        audio.pause();
        state.isPlaying = false;
        document.getElementById("miniStatus").innerText = "Paused";
        document.getElementById("miniPlayBtn").innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
        document.getElementById("musicPlayLarge").innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
    }
}

function updateFocusStats(f, progress) {
    const tDep = timeToMin(f.depTimeRaw);
    const tArr = timeToMin(f.arrTimeRaw) + (f.arrOffset * 1440);
    const duration = tArr - tDep;
    const remainMin = Math.max(0, Math.floor(duration * (1 - progress)));
    
    const h = Math.floor(remainMin / 60);
    const m = remainMin % 60;
    
    document.getElementById("focusTimeRem").innerHTML = `${h}<small>h</small> ${m}<small>min</small>`;
    document.getElementById("focusDistRem").innerHTML = `${Math.floor(remainMin * 8)}<small>mi</small>`;
    document.getElementById("focusProgressBar").style.width = (progress * 100) + "%";
}

// ================== 音乐播放器 ==================

function initMusic() {
    const audio = document.getElementById("bgMusic");
    const cvs = document.getElementById("miniProgress");
    const ctx = cvs.getContext('2d');
    
    const loadSong = (idx) => {
        state.musicIndex = idx;
        const s = MP3_LIST[idx];
        audio.src = s.src;
        document.getElementById("miniTitle").innerText = s.title;
        document.getElementById("musicTitleLarge").innerText = s.title;
        document.querySelector(".music-artist-l").innerText = s.artist;
        
        const coverContainer = document.querySelector(".music-cover-large");
        if (s.cover) {
            coverContainer.innerHTML = `<img src="${s.cover}" class="music-cover-img" />`;
        } else {
            coverContainer.innerHTML = `<div class="cover-placeholder"><span class="material-symbols-rounded">album</span></div>`;
        }
        renderPlaylist();
    };
    
    const togglePlay = () => {
        if(audio.paused) {
            audio.play().catch(()=>{});
            state.isPlaying = true;
            document.getElementById("miniStatus").innerText = "Playing";
            document.getElementById("miniPlayBtn").innerHTML = '<span class="material-symbols-rounded">pause</span>';
            document.getElementById("musicPlayLarge").innerHTML = '<span class="material-symbols-rounded">pause</span>';
        } else {
            audio.pause();
            state.isPlaying = false;
            document.getElementById("miniStatus").innerText = "Paused";
            document.getElementById("miniPlayBtn").innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
            document.getElementById("musicPlayLarge").innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
        }
    };
    
    audio.ontimeupdate = () => {
        const pct = audio.currentTime / audio.duration;
        ctx.clearRect(0,0,32,32);
        ctx.beginPath(); ctx.arc(16,16,14,0,Math.PI*2); ctx.strokeStyle="rgba(0,0,0,0.1)"; ctx.lineWidth=3; ctx.stroke();
        ctx.beginPath(); ctx.arc(16,16,14,0,Math.PI*2*pct); ctx.strokeStyle="#006495"; ctx.lineWidth=3; ctx.stroke();
        document.getElementById("musicFill").style.width = (pct*100)+"%";
        document.getElementById("currTime").innerText = fmtTime(audio.currentTime);
        document.getElementById("totalTime").innerText = fmtTime(audio.duration||0);
    };
    
    audio.onended = () => {
        if(state.playMode === 0) {
            let next = state.musicIndex + 1;
            if(next >= MP3_LIST.length) next = 0;
            loadSong(next); audio.play();
        } else {
            let next = Math.floor(Math.random() * MP3_LIST.length);
            loadSong(next); audio.play();
        }
    };

    document.getElementById("miniPlayBtn").onclick = (e) => { e.stopPropagation(); togglePlay(); };
    document.getElementById("musicPlayLarge").onclick = togglePlay;
    document.getElementById("miniMusicPlayer").onclick = () => document.getElementById("musicExpandCard").classList.remove("hidden");
    document.getElementById("musicCollapseBtn").onclick = () => document.getElementById("musicExpandCard").classList.add("hidden");
    
    document.getElementById("musicNext").onclick = () => {
        let next = state.musicIndex + 1; 
        if(next >= MP3_LIST.length) next=0; 
        loadSong(next); audio.play();
        document.getElementById("miniPlayBtn").innerHTML = '<span class="material-symbols-rounded">pause</span>';
    };
    document.getElementById("musicPrev").onclick = () => {
        let prev = state.musicIndex - 1; 
        if(prev < 0) prev=MP3_LIST.length-1; 
        loadSong(prev); audio.play();
        document.getElementById("miniPlayBtn").innerHTML = '<span class="material-symbols-rounded">pause</span>';
    };
    
    const modeBtn = document.getElementById("musicModeBtn");
    modeBtn.onclick = () => {
        state.playMode = (state.playMode === 0 ? 1 : 0);
        modeBtn.innerHTML = state.playMode===0 ? '<span class="material-symbols-rounded">repeat</span>' : '<span class="material-symbols-rounded">shuffle</span>';
    };
    
    document.getElementById("musicListToggle").onclick = () => {
        document.getElementById("playlistOverlay").classList.remove("hidden");
    };
    document.getElementById("closePlaylistBtn").onclick = () => {
        document.getElementById("playlistOverlay").classList.add("hidden");
    };
    
    const renderPlaylist = (filter = "") => {
        const div = document.getElementById("playlistItems");
        div.innerHTML = "";
        MP3_LIST.forEach((s, i) => {
            if(filter && !s.title.toLowerCase().includes(filter.toLowerCase())) return;
            const item = document.createElement("div");
            item.className = "pl-item " + (i===state.musicIndex?'active':'');
            item.innerText = s.title;
            item.onclick = () => { 
                loadSong(i); audio.play(); 
                document.getElementById("playlistOverlay").classList.add("hidden");
                document.getElementById("miniPlayBtn").innerHTML = '<span class="material-symbols-rounded">pause</span>';
            };
            div.appendChild(item);
        });
    };
    document.getElementById("playlistSearchInput").oninput = (e) => { renderPlaylist(e.target.value.trim()); };
    loadSong(0);
}

const fmtTime = (s) => {
    const m = Math.floor(s/60);
    const sec = Math.floor(s%60);
    return `${m}:${sec<10?'0'+sec:sec}`;
};

// ================== 马赛克/遮盖层 ==================
function initSensitiveAreas() {
    const arunachalCoords = [
       [27.9, 91.5], [29.4, 93.0], [29.5, 95.5], [29.8, 96.0],
       [28.0, 97.5], [26.5, 92.0]
    ];
    mapObjects.sensitivePolygon = L.polygon(arunachalCoords, { 
        className: 'sensitive-mask', stroke: false, interactive: false 
    });
    updateSensitiveLayer();
}

function updateSensitiveLayer() {
    if (state.activeLayer === 'clean') {
        if (!map.hasLayer(mapObjects.sensitivePolygon)) map.addLayer(mapObjects.sensitivePolygon);
    } else {
        if (map.hasLayer(mapObjects.sensitivePolygon)) map.removeLayer(mapObjects.sensitivePolygon);
    }
}

// ================== 初始化 ==================
(function init() {
    const bindSw = (id, key, fn) => {
        const el = document.getElementById(id);
        el.checked = state[key];
        el.onchange = () => {
            state[key] = el.checked;
            localStorage.setItem(key, JSON.stringify(state[key]));
            if(fn) fn();
        };
    };
    bindSw("sw_showAirportName", "showAirportName", updateDisplaySettings);
    bindSw("sw_showAirportCode", "showAirportCode", updateDisplaySettings);
    bindSw("sw_showFlightNo", "showFlightNo", null);
    bindSw("sw_showPlaneIcon", "showPlaneIcon", null);
    bindSw("sw_showAllLines", "showAllLines", updateActiveFlightsList);
    bindSw("sw_hideOtherWhenFilter", "hideOtherWhenFilter", updateActiveFlightsList); 

    document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.toggle("hidden");
    document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");

    let searchTimer;
    const searchInput = document.getElementById("searchInput");
    searchInput.oninput = (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
             if(e.target.value.length === 0) updateActiveFlightsList();
        }, 500);
        
        if(e.target.value.length > 0) document.getElementById("clearBtn").classList.remove("hidden");
        else document.getElementById("clearBtn").classList.add("hidden");
    };
    
    document.getElementById("searchBtn").onclick = () => performSearch(searchInput.value.trim());
    searchInput.onkeydown = (e) => { if(e.key === 'Enter') performSearch(searchInput.value.trim()); };

    document.getElementById("clearBtn").onclick = () => { 
        searchInput.value = ""; 
        updateActiveFlightsList(); 
    };

    document.getElementById("focusRotationBtn").onclick = () => {
        state.mapRotationMode = (state.mapRotationMode === 'north' ? 'heading' : 'north');
        document.getElementById("rotIcon").innerText = state.mapRotationMode === 'north' ? "explore" : "compass_calibration";
    };
    
    const setLayer = (type) => {
        map.removeLayer(LAYERS.clean); map.removeLayer(LAYERS.satellite);
        LAYERS[type].addTo(map);
        state.activeLayer = type;
        localStorage.setItem("activeLayer", type);
        document.querySelectorAll(".layer-btn").forEach(b => b.classList.toggle("active", b.dataset.type === type));
        updateSensitiveLayer(); 
    };
    document.querySelectorAll(".layer-btn").forEach(b => b.onclick = () => setLayer(b.dataset.type));
    document.getElementById("focusLayerBtn").onclick = () => setLayer(state.activeLayer === 'clean' ? 'satellite' : 'clean');
    document.getElementById("exitFocusBtn").onclick = exitFocusMode;

    initSensitiveAreas();
    initMusic();
    loadData();
    
    window.interpolate = (p1, p2, f) => [ p1.lat + (p2.lat - p1.lat) * f, p1.lng + (p2.lng - p1.lng) * f ];
    window.calcBearing = (lat1, lon1, lat2, lon2) => {
        const toRad = d => d * Math.PI / 180;
        const toDeg = r => r * 180 / Math.PI;
        const y = Math.sin(toRad(lon2-lon1)) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) - Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lon2-lon1));
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    };
})();



// 阻止双指及以上的手势，防止捏合缩放
document.addEventListener('touchstart', function(event) {
    if (event.touches.length > 1) {
        event.preventDefault(); 
    }
}, { passive: false });

