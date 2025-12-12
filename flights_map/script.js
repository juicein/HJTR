// ================== 配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png";
const MP3_LIST = [
  { title: "Pure", src: "music/Pure.mp3", artist: "Micki Miller" },
  { title: "燃冬", src: "music/燃冬.mp3", artist: "电影原声" },
  { title: "Gen Wo Yi Qi Feng", src: "music/Gen Wo Yi Qi Feng.mp3", artist: "Beach Boys" },
  { title: "San Fransisco", src: "music/San Fransisco.mp3", artist: "Beach Boys" }
];

// 地图源：使用 CartoDB No Labels (无国界线)
const LAYERS = {
  clean: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy;OpenStreetMap, &copy;CartoDB', subdomains: 'abcd', maxZoom: 19
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy;Esri', maxZoom: 17
  })
};

let state = {
  // 设置 (默认值调整)
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"),
  showAllLines: JSON.parse(localStorage.getItem("showAllLines") || "true"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
  activeLayer: localStorage.getItem("activeLayer") || 'clean', // 记忆图层
  
  // 运行时
  flights: [], sortedFlights: {}, airportDB: {},
  selectedFlightKey: null, // 当前高亮（打开卡片）的航班
  focusMode: false,
  focusFlight: null,
  mapRotationMode: 'north', // 'north' | 'heading'
  
  // 音乐
  musicIndex: 0,
  playMode: 0, // 0:loop, 1:shuffle
  isPlaying: false
};

let mapObjects = { 
  dashedLines: {}, // 虚线集合
  solidLine: null, // 实线（单条）
  markers: {}, 
  airportMarkers: {} 
};

// 初始化地图
const map = L.map('map', { 
  zoomControl: false, attributionControl: false, minZoom: 2, worldCopyJump: true 
}).setView([35, 105], 4);
LAYERS[state.activeLayer].addTo(map);

// 更新图层按钮状态
document.querySelectorAll(`.layer-btn[data-type="${state.activeLayer}"]`).forEach(b => b.classList.add('active'));

// ================== 时间核心 ==================
function getBeijingTime() {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + 28800000); // UTC+8
}
function timeToMin(str) {
  if (!str) return 0;
  const p = str.split(":");
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

// ================== 数据与逻辑 ==================

async function loadData() {
  try {
    // 加载机场
    const apData = await fetch(AIRPORTS_PATH).then(r => r.json());
    state.airportDB = {};
    const rankMap = { "4F": 10, "4E": 8, "4D": 6, "4C": 4 };
    (Array.isArray(apData) ? apData : []).forEach(ap => {
      ap.rankValue = rankMap[ap.level] || 1;
      const key = ap.code || "UNK";
      state.airportDB[key] = ap;
      if(ap.name) state.airportDB[ap.name] = ap;
    });

    // 加载航班
    const fltText = await fetch(FLIGHT_DATA_PATH).then(r => r.text());
    state.flights = parseFlightData(fltText);
    
    // 排序逻辑 (用于上下程)
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
    renderFlights(); 
    updateCollisions();

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

// ================== 渲染 ==================

function renderAirports() {
  for (let code in state.airportDB) {
    const ap = state.airportDB[code];
    if (ap.code !== code || mapObjects.airportMarkers[code]) continue;
    
    // 修复：name 和 code 同一行
    const html = `
      <div class="airport-marker rank-${ap.level}">
        <div class="airport-dot"></div>
        <div class="airport-text" style="display:${state.showAirportName?'flex':'none'}">
          <span class="ap-name-span">${ap.name}</span>
          <span class="ap-code-span" style="display:${state.showAirportCode?'inline':'none'}">${ap.code}</span>
        </div>
      </div>`;
    
    const icon = L.divIcon({ className: '', html: html, iconAnchor: [5, 5] });
    const marker = L.marker([ap.lat, ap.lng], { icon }).addTo(map);
    marker.apData = ap;
    marker.on('click', () => showAirportCard(ap));
    mapObjects.airportMarkers[code] = marker;
  }
}

// 智能避让：机场 & 飞机
function updateCollisions() {
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  
  // A. 机场避让
  // 规则：Zoom > 7 全部显示；否则按等级显示
  const forceShowAllAp = (zoom > 7);
  const apVisible = [];
  
  // 重置 map class 用于 CSS 辅助
  if(forceShowAllAp) map.getContainer().classList.add('map-zoomed-in');
  else map.getContainer().classList.remove('map-zoomed-in');

  for(let k in mapObjects.airportMarkers) {
    const m = mapObjects.airportMarkers[k];
    const el = m.getElement();
    if(!el) continue;
    
    if(!bounds.contains(m.getLatLng())) {
      L.DomUtil.addClass(el, 'hidden'); continue;
    }
    L.DomUtil.removeClass(el, 'hidden');
    
    // 强制显示模式：跳过碰撞计算
    if(forceShowAllAp) {
       // 确保文字显示状态正确
       const txt = el.querySelector('.airport-text');
       if(txt) txt.style.display = (state.showAirportName || state.showAirportCode) ? 'flex' : 'none';
       continue;
    }
    apVisible.push({ m, pt: map.latLngToLayerPoint(m.getLatLng()), rank: m.apData.rankValue });
  }

  if(!forceShowAllAp) {
    apVisible.sort((a,b) => b.rank - a.rank); // 4F 先
    const accepted = [];
    apVisible.forEach(item => {
      let clash = false;
      for(let acc of accepted) {
        const d = item.pt.distanceTo(acc.pt);
        if(d < 40) { clash = true; break; }
      }
      const el = item.m.getElement();
      const txt = el.querySelector('.airport-text');
      if(clash) {
         // 冲突：隐藏整个点 (或者只隐藏文字? 需求是 "不显示了") -> 隐藏
         L.DomUtil.addClass(el, 'hidden');
      } else {
         L.DomUtil.removeClass(el, 'hidden');
         accepted.push(item);
         if(txt) txt.style.display = (state.showAirportName || state.showAirportCode) ? 'flex' : 'none';
      }
    });
  }
  
  // B. 飞机图标大小与避让 (缩小时隐藏拥挤飞机)
  const planeSize = Math.max(20, zoom * 5);
  document.documentElement.style.setProperty('--plane-size', planeSize + 'px');
  
  if (zoom < 6) {
      const planes = [];
      for(let k in mapObjects.markers) {
          const m = mapObjects.markers[k];
          if(bounds.contains(m.getLatLng())) planes.push({m, pt: map.latLngToLayerPoint(m.getLatLng()), key: k});
      }
      const pAccepted = [];
      planes.forEach(p => {
          // 如果是高亮飞机，必须显示
          if(p.key === state.selectedFlightKey) { pAccepted.push(p); return; }
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
      // 放大后显示所有飞机
      for(let k in mapObjects.markers) {
          const m = mapObjects.markers[k];
          const el = m.getElement();
          if(el) L.DomUtil.removeClass(el, 'hidden');
      }
  }
}

map.on('zoomend moveend', updateCollisions);

function renderFlights() {
  const bjNow = getBeijingTime();
  const bjMid = new Date(bjNow).setHours(0,0,0,0);
  const nowTs = bjNow.getTime();

  const searchKey = document.getElementById("searchInput").value.trim().toUpperCase();

  // 清除所有虚线 (重新绘制)
  for(let k in mapObjects.dashedLines) { map.removeLayer(mapObjects.dashedLines[k]); }
  mapObjects.dashedLines = {};

  // 实线逻辑：只在有选中航班时存在
  if (!state.selectedFlightKey && mapObjects.solidLine) {
      map.removeLayer(mapObjects.solidLine);
      mapObjects.solidLine = null;
  }

  state.flights.forEach(f => {
    const depAp = getAirport(f.dep);
    const arrAp = getAirport(f.arr);
    if (!depAp || !arrAp) return;

    // 时间进度计算 (含跨日修正)
    const depMin = timeToMin(f.depTimeRaw);
    const arrMin = timeToMin(f.arrTimeRaw);
    let depTs = bjMid + depMin * 60000 + (f.depOffset * 86400000);
    let arrTs = bjMid + arrMin * 60000 + (f.arrOffset * 86400000);

    let progress = (nowTs - depTs) / (arrTs - depTs);
    // 检查昨天的班次
    if(progress < 0 || progress > 1) {
        const yDep = depTs - 86400000; const yArr = arrTs - 86400000;
        if(nowTs >= yDep && nowTs <= yArr) {
            progress = (nowTs - yDep) / (yArr - yDep);
            depTs = yDep; arrTs = yArr;
        }
    }

    const isFlying = (progress > 0.001 && progress < 0.999);
    
    // 搜索过滤
    let isMatch = true;
    if (searchKey) isMatch = (f.flightNo.includes(searchKey) || (f.reg && f.reg.includes(searchKey)));
    
    // 专注模式过滤
    if (state.focusMode && state.focusFlight) {
        if(f.key !== state.focusFlight.key) return; // 专注模式下只处理这一个
    } else {
        // 普通模式过滤
        if (state.hideOtherWhenFilter && searchKey && !isMatch) return;
        if (!isFlying) return; // 不在飞的不显示
    }

    // A. 虚线 (所有正在飞的，且开关开启)
    if (state.showAllLines && !state.focusMode) {
        const line = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
            color: '#ff8c2b', weight: 1, dashArray: '4, 4', opacity: 0.5, className: 'flight-line-dashed'
        }).addTo(map);
        mapObjects.dashedLines[f.key] = line;
    }

    // B. 实线 (仅高亮且选中时)
    if (state.selectedFlightKey === f.key && !state.focusMode) {
        if (!mapObjects.solidLine) {
            mapObjects.solidLine = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
                color: '#ff6d00', weight: 3, opacity: 1, className: 'flight-line-solid'
            }).addTo(map);
        } else {
            mapObjects.solidLine.setLatLngs([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]]);
        }
    }

    // C. 飞机图标
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
        // 标签
        m.bindTooltip(f.flightNo, { permanent: true, direction: 'right', className: 'airport-text' });
        mapObjects.markers[f.key] = m;
      } else {
        const m = mapObjects.markers[f.key];
        m.setLatLng(curPos);
        // 只更新角度，不重新创建DOM以保持平滑
        const wrap = m.getElement().querySelector('.plane-wrap');
        if(wrap) wrap.style.transform = `rotate(${angle}deg)`;
        
        // 专注模式：地图跟随 + 旋转
        if(state.focusMode && state.focusFlight && state.focusFlight.key === f.key) {
            map.panTo(curPos, { animate: true, duration: 1 });
            updateFocusStats(f, progress);
            
            if(state.mapRotationMode === 'heading') {
                const mapDiv = document.getElementById('map');
                mapDiv.style.transform = `rotate(${-angle}deg) scale(1.5)`; // 旋转并放大防止灰边
                // 反向旋转图标保持直立 (可选，或者让图标跟地图一起转)
                // 这里我们让图标跟着地图转，即始终机头向上
            } else {
                document.getElementById('map').style.transform = `none`;
            }
        }
      }
      
      // 更新标签显隐
      const tip = mapObjects.markers[f.key].getTooltip();
      if(tip && tip.getElement()) tip.getElement().style.display = state.showFlightNo ? 'block' : 'none';

    }
  });
}

function onPlaneClick(f) {
    if(state.focusMode) return; // 专注模式下点击无效
    state.selectedFlightKey = f.key;
    renderFlights(); // 触发实线绘制
    openFlightCard(f);
}

// ================== 卡片交互 ==================

function getAirport(key) { return state.airportDB[key] || state.airportDB[key.toUpperCase()]; }

function showAirportCard(ap) {
  if(state.focusMode) return;
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <div class="card-top">
      <div>
        <div class="flight-big-no">${ap.name}</div>
        <div class="flight-meta-row">
            <span>${ap.code}</span> <div class="flight-meta-sep"></div> 
            <span>${ap.level}</span>
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
  // 此时高亮线会在 renderFlights 中被清理 (因为 selectedFlightKey 没变但 solidLine 逻辑关联的是 card?) 
  // 修正：选中机场不应清除选中航班，但逻辑上互斥
  state.selectedFlightKey = null; 
  renderFlights();
}

// 切换显示模式的状态
let routeDisplayMode = 'code'; // code | name

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
  
  // 绑定点击切换 Code/Name
  document.getElementById("routeDisplayBox").onclick = function() {
      routeDisplayMode = (routeDisplayMode === 'code' ? 'name' : 'code');
      this.innerHTML = renderRoute();
      // 添加淡入动画
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
    if(nextF) {
        onPlaneClick(nextF);
    } else {
        const oldTxt = btn.innerText;
        btn.innerText = "无记录";
        setTimeout(()=>btn.innerText = oldTxt, 1000);
    }
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
    
    // 填充顶部数据
    document.getElementById("focusFlightNo").innerText = f.flightNo;
    document.getElementById("focusDest").innerText = f.arr;
    const depAp = getAirport(f.dep); const arrAp = getAirport(f.arr);
    document.getElementById("focusDepCode").innerText = depAp?depAp.code:f.dep;
    document.getElementById("focusArrCode").innerText = arrAp?arrAp.code:f.arr;
    
    map.setZoom(8);
    // 隐藏其他飞机的线条等
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
    document.getElementById("focusDistRem").innerHTML = `${Math.floor(remainMin * 8)}<small>mi</small>`;
    document.getElementById("focusProgressBar").style.width = (progress * 100) + "%";
}

// ================== 音乐播放器 ==================

function initMusic() {
    const audio = document.getElementById("bgMusic");
    const cvs = document.getElementById("miniProgress");
    const ctx = cvs.getContext('2d');
    
    // 加载歌曲
    const loadSong = (idx) => {
        state.musicIndex = idx;
        const s = MP3_LIST[idx];
        audio.src = s.src;
        document.getElementById("miniTitle").innerText = s.title;
        document.getElementById("musicTitleLarge").innerText = s.title;
        document.querySelector(".music-artist-l").innerText = s.artist;
        renderPlaylist();
    };
    
    // 播放控制
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
    
    // 进度条绘制
    audio.ontimeupdate = () => {
        const pct = audio.currentTime / audio.duration;
        // Mini Circle
        ctx.clearRect(0,0,32,32);
        ctx.beginPath(); ctx.arc(16,16,14,0,Math.PI*2); ctx.strokeStyle="rgba(0,0,0,0.1)"; ctx.lineWidth=3; ctx.stroke();
        ctx.beginPath(); ctx.arc(16,16,14,0,Math.PI*2*pct); ctx.strokeStyle="#006495"; ctx.lineWidth=3; ctx.stroke();
        
        // Large Bar
        document.getElementById("musicFill").style.width = (pct*100)+"%";
        document.getElementById("currTime").innerText = fmtTime(audio.currentTime);
        document.getElementById("totalTime").innerText = fmtTime(audio.duration||0);
    };
    
    audio.onended = () => {
        if(state.playMode === 0) { // Loop List
            let next = state.musicIndex + 1;
            if(next >= MP3_LIST.length) next = 0;
            loadSong(next); audio.play();
        } else { // Shuffle (Simple logic: Random)
            let next = Math.floor(Math.random() * MP3_LIST.length);
            loadSong(next); audio.play();
        }
    };

    // 绑定事件
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
    
    // 模式切换
    const modeBtn = document.getElementById("musicModeBtn");
    modeBtn.onclick = () => {
        state.playMode = (state.playMode === 0 ? 1 : 0);
        modeBtn.innerHTML = state.playMode===0 ? '<span class="material-symbols-rounded">repeat</span>' : '<span class="material-symbols-rounded">shuffle</span>';
    };
    
    // 列表显示
    document.getElementById("musicListToggle").onclick = () => {
        document.getElementById("playlistOverlay").classList.toggle("hidden");
    };
    
    const renderPlaylist = () => {
        const div = document.getElementById("playlistItems");
        div.innerHTML = "";
        MP3_LIST.forEach((s, i) => {
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

    loadSong(0);
}

const fmtTime = (s) => {
    const m = Math.floor(s/60);
    const sec = Math.floor(s%60);
    return `${m}:${sec<10?'0'+sec:sec}`;
};

// ================== 初始化 ==================
(function init() {
    // 绑定设置开关
    const bindSw = (id, key, fn) => {
        const el = document.getElementById(id);
        el.checked = state[key];
        el.onchange = () => {
            state[key] = el.checked;
            localStorage.setItem(key, JSON.stringify(state[key]));
            if(fn) fn();
        };
    };
    bindSw("sw_showAirportName", "showAirportName", updateCollisions);
    bindSw("sw_showAirportCode", "showAirportCode", updateCollisions);
    bindSw("sw_showFlightNo", "showFlightNo", renderFlights);
    bindSw("sw_showPlaneIcon", "showPlaneIcon", renderFlights);
    bindSw("sw_showAllLines", "showAllLines", renderFlights);
    bindSw("sw_hideOtherWhenFilter", "hideOtherWhenFilter", renderFlights);

    document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.toggle("hidden");
    document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");

    // 搜索
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

    // 专注模式：地图控制
    document.getElementById("focusRotationBtn").onclick = () => {
        state.mapRotationMode = (state.mapRotationMode === 'north' ? 'heading' : 'north');
        document.getElementById("rotIcon").innerText = state.mapRotationMode === 'north' ? "explore" : "compass_calibration";
        // 逻辑在 renderFlights 中执行
    };
    
    // 图层记忆
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
    
    // 辅助插值
    window.interpolate = (p1, p2, f) => [ p1.lat + (p2.lat - p1.lat) * f, p1.lng + (p2.lng - p1.lng) * f ];
    window.calcBearing = (lat1, lon1, lat2, lon2) => {
        const toRad = d => d * Math.PI / 180;
        const toDeg = r => r * 180 / Math.PI;
        const y = Math.sin(toRad(lon2-lon1)) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) - Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lon2-lon1));
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    };
})();
