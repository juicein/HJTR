// ================== 配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png";

// 配置：进入专注模式时是否自动播放音乐 (true/false)
const AUTO_PLAY_MUSIC_ON_FOCUS = true; 

// 音乐列表 (支持 cover 属性，没有则显示默认)
const MP3_LIST = [
  { title: "Pure", src: "../music/Pure.m4a", artist: "Micki Miller", cover: "music/cover_pure.jpg" }, // 示例封面
  { title: "冬", src: "music/燃冬.mp3", artist: "电影原声", cover: "" },
  { title: "Gen  Feng", src: "music/Gen Wo Yi Qi Feng.mp3", artist: "Beach Boys", cover: "" },
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
  selectedFlightKey: null,
  focusMode: false,
  focusFlight: null,
  mapRotationMode: 'north',
  
  musicIndex: 0,
  playMode: 0, // 0: loop, 1: shuffle
  isPlaying: false
};

let mapObjects = { 
  dashedLines: {}, 
  solidLine: null, 
  markers: {}, 
  airportMarkers: [],
  sensitivePolygon: null // 马赛克层
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
      // 确保有 level 数据，没有则默认为 "OTHER"
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
    renderFlights(); 
    checkUrlParams(); // 检查 URL 是否有搜索请求

    // 强制执行一次碰撞检测
    setTimeout(() => {
        updateAirportCollisions();
        updatePlaneCollisions();
    }, 500);

  } catch (e) { console.error("Load Error", e); }
}

function parseFlightData(raw) {
  const entries = [];
  const parts = raw.split("《航班结束》");
  for (let block of parts) {
    block = block.trim();
    if (!block) continue;
    const getVal = (reg) => { const m = block.match(reg); return m ? m[1].trim() : ""; };
    const f = {
      raw: block,
      flightNo: getVal(/【\s*([^\]　]+)\s*】/),
      planeType: getVal(/〔\s*([^\]　]+)\s*〕/),
      airline: getVal(/『\s*([^』]+)\s*』/),
      reg: getVal(/<\s*([^>]+)\s*>/),
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
    // 支持 ?search=XXX 或 ?flights_map=XXX (根据用户需求)
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
      className: '', 
      html: html, 
      iconSize: [0, 0],
      iconAnchor: [5, 5]
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
// 1. 根据机场等级 (4F > 4E...) 排序
// 2. 隐藏互相遮挡的点
// 3. 放大到一定程度全部显示
function updateAirportCollisions() {
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    
    // 如果缩放很大，全部显示，不计算碰撞
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

    // 机场等级权重映射
    const levelWeight = {
        "4F": 10, "4E": 9, "4D": 8, "4C": 7, "3U": 6, 
        "3C": 5, "OTHER": 0, "UNKNOWN": 0
    };
    
    // 收集屏幕内的标记
    let visibleItems = [];
    mapObjects.airportMarkers.forEach(m => {
        const latLng = m.getLatLng();
        if(!bounds.contains(latLng)) return;
        
        const pt = map.latLngToContainerPoint(latLng);
        const lvl = m.airportData.level ? m.airportData.level.toUpperCase() : "OTHER";
        visibleItems.push({
            marker: m,
            pt: pt,
            weight: levelWeight[lvl] || 0,
            origLevel: lvl
        });
    });

    // 排序：权重大的在前 (先显示高等级)
    visibleItems.sort((a, b) => b.weight - a.weight);

    const placedDots = []; // 存放已放置的圆点位置 {x, y}
    const dotRadius = 15;  // 避让半径 (像素)，圆点之间不能小于这个距离

    // 1. 处理圆点 (Dot) 的碰撞
    visibleItems.forEach(item => {
        const container = item.marker.getElement().querySelector('.airport-marker-container');
        
        // 检查是否与已放置的高优圆点冲突
        let clash = false;
        for (let placed of placedDots) {
            const dx = item.pt.x - placed.x;
            const dy = item.pt.y - placed.y;
            if (Math.sqrt(dx*dx + dy*dy) < dotRadius) {
                clash = true;
                break;
            }
        }

        if (clash) {
            // 冲突了，直接隐藏整个物体 (Dot + Label)
            container.classList.add('fully-hidden');
            item.isHidden = true; 
        } else {
            // 不冲突，显示圆点
            container.classList.remove('fully-hidden');
            placedDots.push(item.pt);
            item.isHidden = false;
        }
    });

    // 2. 处理标签 (Label) 的碰撞 (只针对未被完全隐藏的机场)
    if (state.showAirportName || state.showAirportCode) {
        const placedLabels = []; // 存放已放置的 Label 矩形
        
        visibleItems.forEach(item => {
            if (item.isHidden) return; // 如果圆点都被藏了，标签也不用算了
            
            const container = item.marker.getElement().querySelector('.airport-marker-container');
            
            // 简单估算 Label 矩形 (根据是否显示文字和代码)
            // 假设宽 80px 高 20px，位于点右侧或居中
            const w = 80; const h = 24;
            // 居中稍微靠上
            const rect = {
                l: item.pt.x - w/2, t: item.pt.y - h - 5,
                r: item.pt.x + w/2, b: item.pt.y - 5
            };

            let labelClash = false;
            // 只有缩放比较小的时候才大量隐藏标签，防止文字满屏
            if (zoom < 9) {
                for (let r of placedLabels) {
                    if (!(rect.r < r.l || rect.l > r.r || rect.b < r.t || rect.t > r.b)) {
                        labelClash = true;
                        break;
                    }
                }
            }

            if (labelClash) {
                container.classList.add('label-hidden');
            } else {
                container.classList.remove('label-hidden');
                placedLabels.push(rect);
            }
        });
    } else {
        // 如果开关关闭，隐藏所有标签
        visibleItems.forEach(item => {
            if(!item.isHidden) {
                item.marker.getElement().querySelector('.airport-marker-container').classList.add('label-hidden');
            }
        });
    }
}

// 飞机避让与图标更新
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

function renderFlights() {
  const bjNow = getBeijingTime();
  const bjMid = new Date(bjNow).setHours(0,0,0,0);
  const nowTs = bjNow.getTime();
  const searchKey = document.getElementById("searchInput").value.trim().toUpperCase();

  // 清除旧线
  for(let k in mapObjects.dashedLines) { map.removeLayer(mapObjects.dashedLines[k]); }
  mapObjects.dashedLines = {};
  if (!state.selectedFlightKey && mapObjects.solidLine) {
      map.removeLayer(mapObjects.solidLine);
      mapObjects.solidLine = null;
  }

  state.flights.forEach(f => {
    const depAp = getAirport(f.dep);
    const arrAp = getAirport(f.arr);
    if (!depAp || !arrAp) return;

    const depMin = timeToMin(f.depTimeRaw);
    const arrMin = timeToMin(f.arrTimeRaw);
    let depTs = bjMid + depMin * 60000 + (f.depOffset * 86400000);
    let arrTs = bjMid + arrMin * 60000 + (f.arrOffset * 86400000);

    let progress = (nowTs - depTs) / (arrTs - depTs);
    if(progress < 0 || progress > 1) {
        const yDep = depTs - 86400000; const yArr = arrTs - 86400000;
        if(nowTs >= yDep && nowTs <= yArr) {
            progress = (nowTs - yDep) / (yArr - yDep);
            depTs = yDep; arrTs = yArr;
        }
    }
    const isFlying = (progress > 0.001 && progress < 0.999);
    
    let isMatch = true;
    if (searchKey) isMatch = (f.flightNo.includes(searchKey) || (f.reg && f.reg.includes(searchKey)));
    
    if (state.focusMode && state.focusFlight) {
        if (state.hideOtherWhenFilter && f.key !== state.focusFlight.key) return;
    } else {
        if (state.hideOtherWhenFilter && searchKey && !isMatch) return;
    }
    
    if (!isFlying) return; 

    // 绘制航线
    if (state.showAllLines && !state.focusMode) {
        const line = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
            color: '#ff8c2b', weight: 1, dashArray: '4, 4', opacity: 0.5, className: 'flight-line-dashed'
        }).addTo(map);
        mapObjects.dashedLines[f.key] = line;
    }

    if (state.selectedFlightKey === f.key && !state.focusMode) {
        if (!mapObjects.solidLine) {
            mapObjects.solidLine = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
                color: '#ff6d00', weight: 3, opacity: 1, className: 'flight-line-solid'
            }).addTo(map);
        } else {
            mapObjects.solidLine.setLatLngs([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]]);
        }
    }

    if (state.showPlaneIcon) {
      const curPos = interpolate(depAp, arrAp, progress);
      const angle = calcBearing(depAp.lat, depAp.lng, arrAp.lat, arrAp.lng);
      
      const html = `<div class="plane-wrap" style="transform: rotate(${angle}deg); transition: transform 0.5s;">
                      <img src="${PLANE_IMG}" style="width:30px; height:30px;">
                    </div>`;
      const icon = L.divIcon({ html, className: 'plane-icon', iconSize: [30, 30], iconAnchor: [15, 15] });

      if (!mapObjects.markers[f.key]) {
        const m = L.marker(curPos, { icon, zIndexOffset: 1000 }).addTo(map);
        m.on('click', () => onPlaneClick(f));
        m.bindTooltip(f.flightNo, { permanent: true, direction: 'right', className: 'airport-label' });
        mapObjects.markers[f.key] = m;
      } else {
        const m = mapObjects.markers[f.key];
        m.setLatLng(curPos);
        const wrap = m.getElement().querySelector('.plane-wrap');
        if(wrap) wrap.style.transform = `rotate(${angle}deg)`;
        
        if(state.focusMode && state.focusFlight && state.focusFlight.key === f.key) {
            map.panTo(curPos, { animate: true, duration: 1 });
            updateFocusStats(f, progress);
            if(state.mapRotationMode === 'heading') {
                document.getElementById('map').style.transform = `rotate(${-angle}deg) scale(1.5)`;
            } else {
                document.getElementById('map').style.transform = `none`;
            }
        }
      }
      
      const tip = mapObjects.markers[f.key].getTooltip();
      if(tip && tip.getElement()) {
          tip.getElement().style.display = state.showFlightNo ? 'block' : 'none';
      }
    }
  });

  if (state.focusMode && state.focusFlight) {
      const f = state.flights.find(x => x.key === state.focusFlight.key);
      if(!f) { /* 航班结束处理 */ }
  }
}

function onPlaneClick(f) {
    if(state.focusMode) return;
    state.selectedFlightKey = f.key;
    renderFlights();
    openFlightCard(f);
}

// ================== 卡片交互与搜索 ==================

function getAirport(key) { return state.airportDB[key] || state.airportDB[key.toUpperCase()]; }

// 统一搜索逻辑
function performSearch(query) {
    if(!query) {
        renderFlights();
        return;
    }

    // 1. 优先尝试匹配机场 (三字码 或 名称)
    // 遍历所有机场
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
        // 找到了机场，聚焦并打开卡片
        map.setView([targetAp.lat, targetAp.lng], 10);
        showAirportCard(targetAp);
        document.getElementById("clearBtn").classList.remove("hidden");
        return;
    }

    // 2. 如果没找到机场，则按航班号搜索
    // 过滤逻辑已经在 renderFlights 中处理 (isMatch)，这里只需要打开第一个匹配的卡片
    renderFlights();
    const matchFlight = state.flights.find(f => f.flightNo.toUpperCase() === qUpper);
    if (matchFlight) {
        onPlaneClick(matchFlight); // 打开航班卡片
    }
}

function showAirportCard(ap) {
  if(state.focusMode) return;
  const card = document.getElementById("infoCard");
  
  // 更新后的UI布局
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
  renderFlights();
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
    return `
      <div class="ap-block"><div class="ap-code">${dTxt}</div><div class="ap-name-sub">出发</div><div class="time-lbl">${f.depTimeRaw}</div></div>
      <span class="material-symbols-rounded" style="font-size:32px;opacity:0.3">flight_takeoff</span>
      <div class="ap-block"><div class="ap-code">${aTxt}</div><div class="ap-name-sub">到达</div><div class="time-lbl">${f.arrTimeRaw}</div></div>
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
    renderFlights();
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
    renderFlights(); 
    
    // 音乐联动：进入专注模式自动播放
    if (AUTO_PLAY_MUSIC_ON_FOCUS) {
        const audio = document.getElementById("bgMusic");
        if (audio.paused) {
            document.getElementById("miniPlayBtn").click(); // 触发播放逻辑
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
    renderFlights();
    
    // 音乐联动：退出专注模式自动暂停
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

// ================== 音乐播放器 (含封面) ==================

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
        
        // 设置大封面
        const coverContainer = document.querySelector(".music-cover-large");
        if (s.cover) {
            coverContainer.innerHTML = `<img src="${s.cover}" class="music-cover-img" />`;
        } else {
            // 默认图标
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
    
    document.getElementById("playlistSearchInput").oninput = (e) => {
        renderPlaylist(e.target.value.trim());
    };

    loadSong(0);
}

const fmtTime = (s) => {
    const m = Math.floor(s/60);
    const sec = Math.floor(s%60);
    return `${m}:${sec<10?'0'+sec:sec}`;
};

// ================== 马赛克/遮盖层 ==================
function initSensitiveAreas() {
    // 地区大致多边形 (需要更精确可自行调整坐标)
    const arunachalCoords = [
       [27.9, 91.5], [29.4, 93.0], [29.5, 95.5], [29.8, 96.0],
       [28.0, 97.5], [26.5, 92.0], 
      [27.9, 91.5], [29.4, 93.0], [29.5, 95.5], [29.8, 96.0],
       [28.0, 97.5], [26.5, 92.0],
      [27.9, 91.5], [29.4, 93.0], [29.5, 95.5], [29.8, 96.0],
       [28.0, 97.5], [26.5, 92.0]
    ];
    
    // 创建多边形，样式类名 'sensitive-mask' 在CSS中控制颜色
    // 注意：fillColor 在这里设置无效，因为 CSS class 会覆盖它，这样才能适配 Dark Mode
    mapObjects.sensitivePolygon = L.polygon(arunachalCoords, { 
        className: 'sensitive-mask',
        stroke: false,
        interactive: false // 允许点击穿透
      fillOpacity: 1 
    });

    updateSensitiveLayer(); // 初始化时判断一次
}








function updateSensitiveLayer() {
    // 逻辑：只有在 'clean' (白地图) 且非卫星图时显示遮盖
    // 如果需要显示马赛克，将其添加到地图；否则移除
    if (state.activeLayer === 'clean') {
        if (!map.hasLayer(mapObjects.sensitivePolygon)) {
            map.addLayer(mapObjects.sensitivePolygon);
        }
    } else {
        if (map.hasLayer(mapObjects.sensitivePolygon)) {
            map.removeLayer(mapObjects.sensitivePolygon);
        }
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
    bindSw("sw_showFlightNo", "showFlightNo", renderFlights);
    bindSw("sw_showPlaneIcon", "showPlaneIcon", renderFlights);
    bindSw("sw_showAllLines", "showAllLines", renderFlights);
    bindSw("sw_hideOtherWhenFilter", "hideOtherWhenFilter", renderFlights); 

    document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.toggle("hidden");
    document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");

    // 搜索事件
    let searchTimer;
    const searchInput = document.getElementById("searchInput");
    searchInput.oninput = (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
             // 仅当输入为空时恢复默认视图，输入内容时走 performSearch
             if(e.target.value.length === 0) renderFlights();
        }, 500);
        
        if(e.target.value.length > 0) document.getElementById("clearBtn").classList.remove("hidden");
        else document.getElementById("clearBtn").classList.add("hidden");
    };
    
    // 绑定搜索按钮点击
    document.getElementById("searchBtn").onclick = () => performSearch(searchInput.value.trim());
    // 绑定回车键
    searchInput.onkeydown = (e) => { if(e.key === 'Enter') performSearch(searchInput.value.trim()); };

    document.getElementById("clearBtn").onclick = () => { 
        searchInput.value = ""; 
        renderFlights(); 
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
        updateSensitiveLayer(); // 切换图层时检查马赛克
    };
    document.querySelectorAll(".layer-btn").forEach(b => b.onclick = () => setLayer(b.dataset.type));
    document.getElementById("focusLayerBtn").onclick = () => setLayer(state.activeLayer === 'clean' ? 'satellite' : 'clean');
    document.getElementById("exitFocusBtn").onclick = exitFocusMode;

    initSensitiveAreas();
    initMusic();
    loadData();
    setInterval(renderFlights, 2000);
    
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

