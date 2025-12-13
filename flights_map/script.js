// ================== 配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png";

// 马赛克/中国大陆合规配置 (预留)
const ENABLE_MOSAIC = false; // 需要时改为 true
// 马赛克区域 (示例: 仅为代码结构演示，不代表特定政治立场)
const RESTRICTED_AREAS = [
    // 格式: [Lat, Lng]
    // { center: [23.5, 121], size: [2, 1] } 
];

const MP3_LIST = [
  { title: "Pure", src: "music/Pure.mp3", artist: "Micki Miller" },
  { title: "燃冬", src: "music/燃冬.mp3", artist: "电影原声" },
  { title: "Gen Wo Yi Qi Feng", src: "music/Gen Wo Yi Qi Feng.mp3", artist: "Beach Boys" },
  { title: "San Fransisco", src: "music/San Fransisco.mp3", artist: "Beach Boys" },
  { title: "Night Flight", src: "music/night.mp3", artist: "Jazz Vibes" }
];

// 图层定义 (使用无界线底图)
const LAYERS = {
  clean: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy;OpenStreetMap, &copy;CartoDB', subdomains: 'abcd', maxZoom: 19,
    className: 'leaflet-layer-clean' // 用于CSS反色
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy;Esri', maxZoom: 17,
    className: 'leaflet-layer-satellite'
  })
};

let state = {
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"),
  showAllLines: JSON.parse(localStorage.getItem("showAllLines") || "true"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
  activeLayer: localStorage.getItem("activeLayer") || 'clean',
  
  airportDB: {},
  flights: [], 
  sortedFlights: {},
  
  markers: {}, // code -> L.marker (机场)
  flightMarkers: {}, // key -> L.marker (飞机)
  dashedLines: {},
  solidLine: null,
  
  selectedFlightKey: null,
  focusMode: false,
  focusFlight: null,
  mapRotationMode: 'north',
  
  musicIndex: 0,
  playMode: 0, // 0: loop, 1: random
  isPlaying: false
};

// 初始化地图
const map = L.map('map', { 
  zoomControl: false, attributionControl: false, minZoom: 2, worldCopyJump: true 
}).setView([35, 105], 4);

LAYERS[state.activeLayer].addTo(map);
document.querySelectorAll(`.layer-btn[data-type="${state.activeLayer}"]`).forEach(b => b.classList.add('active'));

// 预留: 渲染马赛克区域
function renderRestrictedArea() {
    if(!ENABLE_MOSAIC) return;
    RESTRICTED_AREAS.forEach(area => {
        // 简单矩形逻辑
        const bounds = [
            [area.center[0] - area.size[0], area.center[1] - area.size[1]],
            [area.center[0] + area.size[0], area.center[1] + area.size[1]]
        ];
        L.rectangle(bounds, {color: "#e0e0e0", stroke: false, fillOpacity: 0.8}).addTo(map);
    });
}
renderRestrictedArea();

// ================== 时间 ==================
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

// ================== 数据加载与逻辑 ==================

async function loadData() {
  try {
    // 1. 加载机场
    const apData = await fetch(AIRPORTS_PATH).then(r => r.json());
    state.airportDB = {};
    (Array.isArray(apData) ? apData : []).forEach(ap => {
       // 确保 code 存在
       const code = ap.code || (ap.name ? ap.name.slice(0,3).toUpperCase() : "UNK");
       
       // 等级权重计算 (移植自参考代码)
       let rank = 1;
       if(ap.level) {
          if(ap.level.includes("4F")) rank = 10;
          else if(ap.level.includes("4E")) rank = 8;
          else if(ap.level.includes("4D")) rank = 6;
          else rank = 4;
       }
       state.airportDB[code] = { ...ap, code, rank };
    });

    // 2. 加载航班
    const fltText = await fetch(FLIGHT_DATA_PATH).then(r => r.text());
    state.flights = parseFlightData(fltText);
    
    // 3. 上下程排序
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

// ================== 机场渲染 (核心移植部分) ==================

function renderAirports() {
  for (let code in state.airportDB) {
    if(state.markers[code]) continue;
    const ap = state.airportDB[code];
    if (!ap.lat || !ap.lng) continue;

    const isHighRank = ap.rank >= 8;
    // HTML 结构: 分离 Code 和 Name，由 CSS body class 控制显隐
    const html = `
      <div class="airport-marker ${isHighRank?'rank-high':''}">
        <div class="airport-dot"></div>
        <div class="airport-label">
          <span class="label-name">${ap.name}</span>
          <span class="label-code">${ap.code}</span>
        </div>
      </div>
    `;

    const icon = L.divIcon({ 
      className: '', 
      html: html, 
      iconSize: [0, 0], 
      iconAnchor: [0, 0] // CSS 处理居中
    });

    const marker = L.marker([ap.lat, ap.lng], { icon }).addTo(map);
    marker.apData = ap;
    marker.on('click', () => showAirportCard(ap));
    state.markers[code] = marker;
  }
  updateAirportVis();
}

// 机场避让与显示逻辑
function updateAirportVis() {
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  
  // 1. 全局开关类名处理
  document.body.classList.toggle('show-ap-name', state.showAirportName);
  document.body.classList.toggle('show-ap-code', state.showAirportCode);
  document.body.classList.toggle('no-ap-labels', !state.showAirportName && !state.showAirportCode);

  // 2. 收集可见机场
  let visible = [];
  for (let code in state.markers) {
    const m = state.markers[code];
    const el = m.getElement();
    if (!el) continue;

    if (bounds.contains(m.getLatLng())) {
      const pt = map.latLngToLayerPoint(m.getLatLng());
      visible.push({ marker: m, pt, rank: m.apData.rank });
      // 先全部移除隐藏类，下面算法决定谁加上
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  // 3. 避让算法 (等级高优先)
  visible.sort((a,b) => b.rank - a.rank); 
  const accepted = [];
  const MIN_DIST = zoom < 5 ? 20 : 40; // 像素

  visible.forEach(item => {
    let clash = false;
    for (let acc of accepted) {
      const dx = item.pt.x - acc.pt.x;
      const dy = item.pt.y - acc.pt.y;
      if (Math.sqrt(dx*dx + dy*dy) < MIN_DIST) { clash = true; break; }
    }
    
    const el = item.marker.getElement();
    if (clash) {
      el.classList.add('hidden'); // 碰撞则隐藏
    } else {
      accepted.push(item);
      el.classList.remove('hidden');
    }
  });
}

function updateDisplaySettings() {
  updateAirportVis();
  renderFlights();
}

map.on('zoomend moveend', updateAirportVis);

// ================== 航班渲染 ==================

function renderFlights() {
  const bjNow = getBeijingTime();
  const bjMid = new Date(bjNow).setHours(0,0,0,0);
  const nowTs = bjNow.getTime();
  const searchKey = document.getElementById("searchInput").value.trim().toUpperCase();

  // 清理
  for(let k in state.dashedLines) { map.removeLayer(state.dashedLines[k]); }
  state.dashedLines = {};
  if (!state.selectedFlightKey && state.solidLine) {
      map.removeLayer(state.solidLine); state.solidLine = null;
  }

  // 存活的飞机 key
  const activeKeys = new Set();
  const planePoints = []; // 飞机避让

  state.flights.forEach(f => {
    // 1. 专注模式过滤：如果开启了"过滤其他"且在专注模式，非当前航班直接跳过
    if (state.focusMode && state.hideOtherWhenFilter) {
        if (!state.focusFlight || f.key !== state.focusFlight.key) return;
    }

    const depAp = getAirport(f.dep);
    const arrAp = getAirport(f.arr);
    if (!depAp || !arrAp) return;

    // 时间进度计算
    const depMin = timeToMin(f.depTimeRaw);
    const arrMin = timeToMin(f.arrTimeRaw);
    let depTs = bjMid + depMin * 60000 + (f.depOffset * 86400000);
    let arrTs = bjMid + arrMin * 60000 + (f.arrOffset * 86400000);

    let progress = (nowTs - depTs) / (arrTs - depTs);
    // 简单跨天修正
    if(progress < 0 || progress > 1) {
        const yDep = depTs - 86400000; const yArr = arrTs - 86400000;
        if(nowTs >= yDep && nowTs <= yArr) {
            progress = (nowTs - yDep) / (yArr - yDep);
            depTs = yDep; arrTs = yArr;
        }
    }
    
    const isFlying = (progress > 0.001 && progress < 0.999);
    
    // 搜索逻辑
    let isMatch = true;
    if (searchKey) isMatch = (f.flightNo.includes(searchKey) || (f.reg && f.reg.includes(searchKey)));
    
    // 普通模式下，非飞行中不显示
    if (!state.focusMode) {
        if (state.hideOtherWhenFilter && searchKey && !isMatch) return;
        if (!isFlying) return;
    } else {
        // 专注模式：非当前专注航班，则按普通逻辑(飞才显)；如果是当前航班，允许稍微越界以保持连接
        if (state.focusFlight && f.key !== state.focusFlight.key) {
           if(!isFlying) return;
        }
    }
    
    activeKeys.add(f.key);
    
    // 位置计算
    const curPos = interpolate(depAp, arrAp, progress);
    const angle = calcBearing(depAp.lat, depAp.lng, arrAp.lat, arrAp.lng);

    // 绘制航线 (虚线)
    if (state.showAllLines && !state.focusMode) {
        const line = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
            color: '#ff8c2b', weight: 1, dashArray: '4, 4', opacity: 0.5
        }).addTo(map);
        state.dashedLines[f.key] = line;
    }
    
    // 绘制高亮实线
    if (state.selectedFlightKey === f.key && !state.focusMode) {
        if (!state.solidLine) {
            state.solidLine = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
                color: '#ff6d00', weight: 3, opacity: 1
            }).addTo(map);
        } else {
            state.solidLine.setLatLngs([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]]);
        }
    }

    // 绘制飞机
    if (state.showPlaneIcon) {
      // 简单飞机避让 (专注模式不避让)
      let showPlane = true;
      if (!state.focusMode && map.getZoom() < 6 && !searchKey) {
          const pt = map.latLngToLayerPoint(curPos);
          for(let p of planePoints) {
              if(Math.abs(p.x - pt.x) < 20 && Math.abs(p.y - pt.y) < 20) { showPlane=false; break; }
          }
          if(showPlane) planePoints.push(pt);
      }
      
      if (!showPlane) {
          if (state.flightMarkers[f.key]) { map.removeLayer(state.flightMarkers[f.key]); delete state.flightMarkers[f.key]; }
          return;
      }

      const html = `<div class="plane-wrap" style="transform: rotate(${angle}deg); transition: transform 0.5s;">
                      <img src="${PLANE_IMG}" style="width:30px; height:30px;">
                    </div>`;
      const icon = L.divIcon({ html, className: 'plane-icon', iconSize: [30, 30], iconAnchor: [15, 15] });

      if (!state.flightMarkers[f.key]) {
        const m = L.marker(curPos, { icon, zIndexOffset: 1000 }).addTo(map);
        m.on('click', () => onPlaneClick(f));
        m.bindTooltip(f.flightNo, { permanent: true, direction: 'right', className: 'airport-label' });
        state.flightMarkers[f.key] = m;
      } else {
        const m = state.flightMarkers[f.key];
        m.setLatLng(curPos);
        const wrap = m.getElement().querySelector('.plane-wrap');
        if(wrap) wrap.style.transform = `rotate(${angle}deg)`;
        
        // 专注模式核心更新
        if(state.focusMode && state.focusFlight && state.focusFlight.key === f.key) {
            updateFocusStats(f, progress);
            if(state.mapRotationMode === 'heading') {
                document.getElementById('map').style.transform = `rotate(${-angle}deg) scale(1.5)`;
                map.setView(curPos, 8, {animate: false});
            } else {
                document.getElementById('map').style.transform = `none`;
                map.panTo(curPos, { animate: true, duration: 1 });
            }
        }
      }
      // 控制飞机标签
      const tip = state.flightMarkers[f.key].getTooltip();
      if(tip && tip.getElement()) tip.getElement().style.display = state.showFlightNo ? 'flex' : 'none';
    }
  });

  // 清理
  for(let k in state.flightMarkers) {
      if(!activeKeys.has(k)) { map.removeLayer(state.flightMarkers[k]); delete state.flightMarkers[k]; }
  }
}

function onPlaneClick(f) {
    if(state.focusMode) return;
    state.selectedFlightKey = f.key;
    renderFlights();
    openFlightCard(f);
}

// ================== 卡片与工具 ==================

function getAirport(key) { return state.airportDB[key] || state.airportDB[key.toUpperCase()]; }
function getAirportName(key) { const ap = getAirport(key); return ap ? ap.name : key; }

function showAirportCard(ap) {
  if(state.focusMode) return;
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <div class="card-top">
      <div>
        <div class="flight-big-no">${ap.name}</div>
        <div class="flight-meta-row">
            <span>${ap.code}</span> <div class="flight-meta-sep"></div> 
            <span>${ap.level || '未知等级'}</span>
        </div>
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

function openFlightCard(f) {
  const card = document.getElementById("infoCard");
  const depAp = getAirport(f.dep); const arrAp = getAirport(f.arr);
  const html = `
    <div class="card-top">
      <div>
        <div class="flight-big-no">${f.flightNo}</div>
        <div class="flight-meta-row">
          <span>${f.airline}</span><div class="flight-meta-sep"></div><span>${f.planeType}</span>
        </div>
      </div>
      <button class="icon-btn" onclick="closeInfoCard()"><span class="material-symbols-rounded">close</span></button>
    </div>
    <div class="route-display">
      <div class="ap-block"><div class="ap-code">${depAp?depAp.code:f.dep}</div><div class="ap-name-sub">${depAp?depAp.name:f.dep}</div><div class="time-lbl">${f.depTimeRaw}</div></div>
      <span class="material-symbols-rounded" style="font-size:32px;opacity:0.3">flight_takeoff</span>
      <div class="ap-block"><div class="ap-code">${arrAp?arrAp.code:f.arr}</div><div class="ap-name-sub">${arrAp?arrAp.name:f.arr}</div><div class="time-lbl">${f.arrTimeRaw}</div></div>
    </div>
    <div class="flight-actions">
      <button class="btn btn-primary" onclick="enterFocusMode('${f.key}')">
        <span class="material-symbols-rounded">my_location</span> 跟踪
      </button>
    </div>
  `;
  card.innerHTML = html;
  card.classList.remove("hidden");
}

function closeInfoCard() {
    document.getElementById("infoCard").classList.add("hidden");
    state.selectedFlightKey = null;
    renderFlights();
}

// ================== 专注模式 ==================

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
}

function updateFocusStats(f, progress) {
    const tDep = timeToMin(f.depTimeRaw);
    const tArr = timeToMin(f.arrTimeRaw) + (f.arrOffset * 1440);
    const duration = tArr - tDep;
    const remainMin = Math.max(0, Math.floor(duration * (1 - progress)));
    
    const h = Math.floor(remainMin / 60);
    const m = remainMin % 60;
    
    document.getElementById("focusTimeRem").innerHTML = `${h}<small>h</small> ${m}<small>min</small>`;
    document.getElementById("focusDistRem").innerHTML = `${Math.floor(remainMin * 13)}<small>km</small>`;
    document.getElementById("focusProgressBar").style.width = (progress * 100) + "%";
}

// ================== 音乐播放器 (带搜索) ==================

function initMusic() {
    const audio = document.getElementById("bgMusic");
    const cvs = document.getElementById("miniProgress");
    const ctx = cvs.getContext('2d');
    
    // 当前显示的播放列表（用于搜索过滤）
    let currentPlaylist = [...MP3_LIST];

    const loadSong = (idx) => {
        state.musicIndex = idx;
        const s = MP3_LIST[idx]; // 注意：这里始终用原始列表的索引
        audio.src = s.src;
        document.getElementById("miniTitle").innerText = s.title;
        document.getElementById("musicTitleLarge").innerText = s.title;
        document.querySelector(".music-artist-l").innerText = s.artist;
        // 高亮当前
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
    
    // 播放列表渲染与搜索
    const renderPlaylist = () => {
        const div = document.getElementById("playlistItems");
        div.innerHTML = "";
        currentPlaylist.forEach((s) => {
            // 在原始列表中的索引
            const originalIndex = MP3_LIST.findIndex(x => x.src === s.src);
            const item = document.createElement("div");
            item.className = "pl-item " + (originalIndex === state.musicIndex ? 'active' : '');
            item.innerHTML = `<span>${s.title}</span><span style="opacity:0.6;font-size:12px">${s.artist}</span>`;
            item.onclick = () => { 
                loadSong(originalIndex); audio.play(); 
                document.getElementById("playlistOverlay").classList.add("hidden");
                document.getElementById("miniPlayBtn").innerHTML = '<span class="material-symbols-rounded">pause</span>';
            };
            div.appendChild(item);
        });
    };

    // 搜索事件
    document.getElementById("playlistSearchInput").oninput = (e) => {
        const val = e.target.value.toLowerCase();
        currentPlaylist = MP3_LIST.filter(s => s.title.toLowerCase().includes(val) || s.artist.toLowerCase().includes(val));
        renderPlaylist();
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

    // 绑定按钮
    document.getElementById("miniPlayBtn").onclick = (e) => { e.stopPropagation(); togglePlay(); };
    document.getElementById("musicPlayLarge").onclick = togglePlay;
    document.getElementById("miniMusicPlayer").onclick = () => document.getElementById("musicExpandCard").classList.remove("hidden");
    document.getElementById("musicCollapseBtn").onclick = () => document.getElementById("musicExpandCard").classList.add("hidden");
    
    document.getElementById("musicListToggle").onclick = () => document.getElementById("playlistOverlay").classList.remove("hidden");
    document.getElementById("closePlaylistBtn").onclick = () => document.getElementById("playlistOverlay").classList.add("hidden");

    document.getElementById("musicNext").onclick = () => {
        let next = state.musicIndex + 1; 
        if(next >= MP3_LIST.length) next=0; 
        loadSong(next); audio.play();
    };
    document.getElementById("musicPrev").onclick = () => {
        let prev = state.musicIndex - 1; 
        if(prev < 0) prev=MP3_LIST.length-1; 
        loadSong(prev); audio.play();
    };
    
    loadSong(0);
}

const fmtTime = (s) => {
    const m = Math.floor(s/60);
    const sec = Math.floor(s%60);
    return `${m}:${sec<10?'0'+sec:sec}`;
};

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
    bindSw("sw_showAirportName", "showAirportName", updateAirportVis);
    bindSw("sw_showAirportCode", "showAirportCode", updateAirportVis);
    bindSw("sw_showFlightNo", "showFlightNo", renderFlights);
    bindSw("sw_showPlaneIcon", "showPlaneIcon", renderFlights);
    bindSw("sw_showAllLines", "showAllLines", renderFlights);
    bindSw("sw_hideOtherWhenFilter", "hideOtherWhenFilter", renderFlights);

    document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.toggle("hidden");
    document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");

    let searchTimer;
    document.getElementById("searchInput").oninput = (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(renderFlights, 500);
        if(e.target.value.length > 0) document.getElementById("clearBtn").classList.remove("hidden");
        else document.getElementById("clearBtn").classList.add("hidden");
    };
    document.getElementById("clearBtn").onclick = () => { 
        document.getElementById("searchInput").value = ""; 
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
    };
    document.querySelectorAll(".layer-btn").forEach(b => b.onclick = () => setLayer(b.dataset.type));
    document.getElementById("focusLayerBtn").onclick = () => setLayer(state.activeLayer === 'clean' ? 'satellite' : 'clean');
    document.getElementById("exitFocusBtn").onclick = exitFocusMode;

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
