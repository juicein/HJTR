// ================== 配置与状态 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png";
const MP3_LIST = [
  { title: "Pure.mp3", src: "music/Pure.mp3", art: "https://via.placeholder.com/60/FF5722/FFF?text=Pure" },
  { title: "燃冬.mp3", src: "music/燃冬.mp3", art: "https://via.placeholder.com/60/2196F3/FFF?text=Winter" },
  { title: "Gen Wo Yi Qi Feng.mp3", src: "music/Gen Wo Yi Qi Feng.mp3", art: "https://via.placeholder.com/60/4CAF50/FFF?text=Feng" },
  { title: "San Fransisco.mp3", src: "music/San Fransisco.mp3", art: "https://via.placeholder.com/60/9C27B0/FFF?text=SF" }
];

// 底图：使用 CartoDB Positron No Labels (无国界线干扰)
const LAYERS = {
  clean: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17 })
};

let state = {
  // 设置读取
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"),
  showAllLines: JSON.parse(localStorage.getItem("showAllLines") || "false"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
  activeLayer: localStorage.getItem("activeLayer") || "clean",
  
  // 数据与状态
  airportDB: {},
  flights: [],
  sortedFlights: {},
  
  selectedFlightKey: null, 
  focusMode: false,
  focusFlight: null,
  
  musicIndex: 0,
  musicMode: 0, // 0: Loop List, 1: Shuffle, 2: Loop Single (可选)
  isMapRotated: false
};

let mapObjects = { lines: {}, markers: {}, airportMarkers: {} };

// 初始化地图
const map = L.map('map', { 
  zoomControl: false, attributionControl: false, minZoom: 2, worldCopyJump: true 
}).setView([35, 105], 4);

// 加载记忆的图层
(LAYERS[state.activeLayer] || LAYERS.clean).addTo(map);
document.querySelector(`.layer-btn[data-type="${state.activeLayer}"]`).classList.add('active');

// ================== 时间与工具 ==================
function getBeijingTime() {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + 8 * 3600000);
}
function getBeijingMidnight() { const b = getBeijingTime(); b.setHours(0,0,0,0); return b.getTime(); }
function timeToMin(str) { if(!str) return 0; const p = str.split(":"); return parseInt(p[0])*60 + parseInt(p[1]); }
function interpolate(p1, p2, f) { return [ p1.lat + (p2.lat - p1.lat) * f, p1.lng + (p2.lng - p1.lng) * f ]; }
function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI/180; const toDeg = r => r * 180/Math.PI;
  const y = Math.sin(toRad(lon2-lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) - Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lon2-lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ================== 数据逻辑 ==================
async function loadData() {
  try {
    const apRes = await fetch(AIRPORTS_PATH);
    const apData = await apRes.json();
    state.airportDB = {};
    (Array.isArray(apData) ? apData : []).forEach(ap => {
      // 修复等级判定: 4F/4E -> Hub(Primary Color), 4C/4D -> Mid(Primary Color), 其他 -> Small(Gray)
      let rVal = 1; // Small
      let rClass = 'rank-small';
      if(ap.level) {
        if(ap.level.includes("4F") || ap.level.includes("4E")) { rVal = 10; rClass = 'rank-hub'; }
        else if(ap.level.includes("4D") || ap.level.includes("4C")) { rVal = 6; rClass = 'rank-mid'; }
      }
      ap.rankValue = rVal;
      ap.rankClass = rClass;
      state.airportDB[ap.code || "UNK"] = ap;
      if(ap.name) state.airportDB[ap.name] = ap;
    });

    const fltText = await fetch(FLIGHT_DATA_PATH).then(r => r.text());
    state.flights = parseFlightData(fltText);
    
    // 上下程排序
    state.sortedFlights = {};
    state.flights.forEach(f => {
      if(f.reg && f.reg !== '<->') {
        if(!state.sortedFlights[f.reg]) state.sortedFlights[f.reg] = [];
        state.sortedFlights[f.reg].push(f);
      }
    });
    for(let r in state.sortedFlights) {
      state.sortedFlights[r].sort((a,b) => (timeToMin(a.depTimeRaw)+(a.depOffset*1440)) - (timeToMin(b.depTimeRaw)+(b.depOffset*1440)));
    }

    renderAirports();
    renderFlights();
    updateCollisions();

  } catch (e) { console.error(e); }
}

function parseFlightData(raw) {
  const entries = [];
  const parts = raw.split("《航班结束》");
  for (let block of parts) {
    block = block.trim(); if (!block) continue;
    const getVal = (reg) => { const m = block.match(reg); return m ? m[1].trim() : ""; };
    const f = {
      raw: block,
      flightNo: getVal(/【\s*([^\]　]+)\s*】/),
      planeType: getVal(/〔\s*([^\]　]+)\s*〕/),
      airline: getVal(/『\s*([^』]+)\s*』/),
      reg: getVal(/<\s*([^>]+)\s*>/),
      dep:"", depTimeRaw:"", depOffset:0, arr:"", arrTimeRaw:"", arrOffset:0
    };
    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}(\#\+(\d+)\#)?/);
    if(depMatch) { f.dep=depMatch[1].trim(); f.depTimeRaw=depMatch[2].trim(); f.depOffset=depMatch[4]?parseInt(depMatch[4]):0; }
    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}(\#\+(\d+)\#)?/);
    if(arrMatch) { f.arr=arrMatch[1].trim(); f.arrTimeRaw=arrMatch[2].trim(); f.arrOffset=arrMatch[4]?parseInt(arrMatch[4]):0; }
    f.key = f.flightNo + "_" + f.dep + "_" + f.arr;
    entries.push(f);
  }
  return entries;
}

// ================== 渲染逻辑 ==================

function renderAirports() {
  for (let code in state.airportDB) {
    const ap = state.airportDB[code];
    if (ap.code !== code) continue; 
    if (!ap.lat || !ap.lng) continue;
    if (mapObjects.airportMarkers[code]) continue;

    const html = `
      <div class="airport-marker ${ap.rankClass}">
        <div class="airport-dot"></div>
        <div class="airport-text" style="display:${state.showAirportName?'block':'none'}">
          <span class="ap-name-span">${ap.name}</span>
          <span class="ap-code-span" style="display:${state.showAirportCode?'inline':'none'};opacity:0.6;margin-left:4px">${ap.code}</span>
        </div>
      </div>`;
    const icon = L.divIcon({ className: 'custom-ap-icon', html: html, iconAnchor: [5, 5] });
    const marker = L.marker([ap.lat, ap.lng], { icon }).addTo(map);
    marker.apData = ap;
    marker.on('click', () => showAirportCard(ap));
    mapObjects.airportMarkers[code] = marker;
  }
}

// 机场智能避让 (修复：放大时必须显示所有重要机场)
function updateCollisions() {
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  
  // 阈值：放大时阈值极小，几乎允许重叠；缩小时阈值大，隐藏密集点
  const pixelThresh = zoom >= 7 ? 5 : (zoom < 5 ? 40 : 25);
  
  const visible = [];
  for(let k in mapObjects.airportMarkers) {
    const m = mapObjects.airportMarkers[k];
    const el = m.getElement();
    
    // 如果不在视野内，隐藏
    if(!bounds.contains(m.getLatLng())) {
      if(el) L.DomUtil.addClass(el, 'hidden');
      continue;
    }
    
    visible.push({ marker: m, pt: map.latLngToLayerPoint(m.getLatLng()), rank: m.apData.rankValue, el: el });
  }

  // 排序：重要机场(4E/4F)优先，其次中型
  visible.sort((a,b) => b.rank - a.rank);

  const accepted = [];
  visible.forEach(item => {
    if(!item.el) return;
    
    let clash = false;
    // 只有在 Zoom < 8 时才启用避让，Zoom >= 8 全部显示
    if (zoom < 8) {
        for(let acc of accepted) {
          const dx = item.pt.x - acc.pt.x;
          const dy = item.pt.y - acc.pt.y;
          if(Math.sqrt(dx*dx + dy*dy) < pixelThresh) {
            clash = true; break;
          }
        }
    }

    if(clash) {
      L.DomUtil.addClass(item.el, 'hidden');
    } else {
      L.DomUtil.removeClass(item.el, 'hidden');
      accepted.push(item);
      
      // 更新文字显隐
      const txt = item.el.querySelector('.airport-text');
      const nm = item.el.querySelector('.ap-name-span');
      const cd = item.el.querySelector('.ap-code-span');
      if(txt) txt.style.display = (state.showAirportName||state.showAirportCode) ? 'block' : 'none';
      if(nm) nm.style.display = state.showAirportName ? 'inline' : 'none';
      if(cd) cd.style.display = state.showAirportCode ? 'inline' : 'none';
    }
  });

  updatePlaneClustering(); // 同时更新飞机聚合
}
map.on('zoomend moveend', updateCollisions);

// 飞机聚合逻辑 (新增需求：缩小时隐藏部分飞机)
function updatePlaneClustering() {
    const zoom = map.getZoom();
    const pixelThresh = 30; // 飞机聚合距离
    const activePlanes = [];

    // 收集所有当前显示的飞机Marker
    for(let k in mapObjects.markers) {
        const m = mapObjects.markers[k];
        if(!m._icon) continue; // 尚未渲染
        activePlanes.push({ key: k, marker: m, pt: map.latLngToLayerPoint(m.getLatLng()) });
    }

    // 如果 Zoom 足够大，全部显示
    if(zoom >= 6) {
        activePlanes.forEach(p => L.DomUtil.removeClass(p.marker._icon, 'hidden'));
        return;
    }

    // 简单贪婪聚合
    const accepted = [];
    activePlanes.forEach(p => {
        let clash = false;
        for(let acc of accepted) {
            const dx = p.pt.x - acc.pt.x;
            const dy = p.pt.y - acc.pt.y;
            if(Math.sqrt(dx*dx + dy*dy) < pixelThresh) {
                clash = true; break;
            }
        }
        if(clash) {
            L.DomUtil.addClass(p.marker._icon, 'hidden');
        } else {
            L.DomUtil.removeClass(p.marker._icon, 'hidden');
            accepted.push(p);
        }
    });
}

function getAirport(key) { return state.airportDB[key] || state.airportDB[key.toUpperCase()]; }

// 核心：航班渲染
function renderFlights() {
  const bjMid = getBeijingMidnight();
  const nowTs = getBeijingTime().getTime();
  const searchKey = document.getElementById("searchInput").value.trim().toUpperCase();

  state.flights.forEach(f => {
    const depAp = getAirport(f.dep); const arrAp = getAirport(f.arr);
    if (!depAp || !arrAp) return;

    // 计算进度 (含跨日修正)
    const depTs = bjMid + timeToMin(f.depTimeRaw)*60000 + (f.depOffset*86400000);
    const arrTs = bjMid + timeToMin(f.arrTimeRaw)*60000 + (f.arrOffset*86400000);
    let progress = -1;
    if (nowTs >= depTs && nowTs <= arrTs) progress = (nowTs - depTs) / (arrTs - depTs);
    else {
      // 检查昨日班次
      const yDep = depTs - 86400000; const yArr = arrTs - 86400000;
      if (nowTs >= yDep && nowTs <= yArr) progress = (nowTs - yDep) / (yArr - yDep);
    }

    const isFlying = (progress > 0.001 && progress < 0.999);
    
    // 专注模式过滤：只处理专注的航班
    if(state.focusMode) {
       if(!state.focusFlight || f.key !== state.focusFlight.key) {
           removeFlightAssets(f.key);
           return; 
       }
    }

    // 普通模式过滤
    let isMatch = true;
    if (searchKey) isMatch = (f.flightNo.includes(searchKey) || (f.reg && f.reg.includes(searchKey)));
    
    // 显隐逻辑
    const shouldShow = isFlying && (state.focusMode || !state.hideOtherWhenFilter || isMatch);

    // 绘制航线 (修复：只显示正在飞行的航班的虚线，高亮实线由卡片控制)
    // 虚线
    if (shouldShow && (state.showAllLines || isMatch)) {
        if (!mapObjects.lines[f.key]) {
            const l = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
                color: '#ff8c2b', weight: 1, dashArray: '4, 4', opacity: 0.6
            }).addTo(map);
            l.on('click', () => { selectFlight(f); openFlightCard(f); });
            mapObjects.lines[f.key] = l;
        }
    } else {
        if (mapObjects.lines[f.key]) { map.removeLayer(mapObjects.lines[f.key]); delete mapObjects.lines[f.key]; }
    }

    // 绘制实线高亮 (仅当卡片打开且选中该航班时)
    const isSelected = (state.selectedFlightKey === f.key);
    if (isSelected && mapObjects.lines[f.key]) {
        mapObjects.lines[f.key].setStyle({ color: '#ff6d00', weight: 3, dashArray: null, opacity: 1, className: 'flight-line-highlight' });
        mapObjects.lines[f.key].bringToFront();
    } else if (mapObjects.lines[f.key]) {
        mapObjects.lines[f.key].setStyle({ color: '#ff8c2b', weight: 1, dashArray: '4, 4', opacity: 0.6, className: '' });
    }

    // 绘制飞机
    if (shouldShow && state.showPlaneIcon) {
        const curPos = interpolate(depAp, arrAp, progress);
        const angle = calcBearing(depAp.lat, depAp.lng, arrAp.lat, arrAp.lng);
        const html = `<div class="plane-icon-div ${state.focusMode?'focused':''}" style="transform: rotate(${angle}deg);">
                        <img src="${PLANE_IMG}" style="width:100%; height:100%;">
                      </div>`;
        const icon = L.divIcon({ html, className: 'plane-div', iconSize: [30, 30], iconAnchor: [15, 15] });

        if (!mapObjects.markers[f.key]) {
            const m = L.marker(curPos, { icon, zIndexOffset: 1000 }).addTo(map);
            if(!state.focusMode) {
                m.on('click', () => { selectFlight(f); openFlightCard(f); });
            }
            m.bindTooltip(f.flightNo, { permanent: true, direction: 'right', className: 'airport-text' });
            mapObjects.markers[f.key] = m;
        } else {
            const m = mapObjects.markers[f.key];
            m.setLatLng(curPos);
            m.setIcon(icon);
            
            // 专注模式：跟随与旋转
            if(state.focusMode && state.focusFlight && state.focusFlight.key === f.key) {
                map.panTo(curPos, { animate: true, duration: 1 });
                updateFocusStats(f, progress);
                
                // 地图旋转逻辑 (仿罗盘)
                if(state.isMapRotated) {
                    const rot = -angle;
                    document.getElementById('mapWrap').style.transform = `rotate(${rot}deg)`;
                    // 反转图标防止倒置
                    // 这里简化处理：地图转了，图标也跟着转，视觉上是机头朝上
                    // 需要反向旋转Marker内部的图标吗？不用，因为CSS旋转是针对容器的
                } else {
                    document.getElementById('mapWrap').style.transform = `rotate(0deg)`;
                }
            }
        }
        
        // 更新Tooltip显隐
        const tip = mapObjects.markers[f.key].getTooltip();
        if(tip && tip.getElement()) tip.getElement().style.display = (state.showFlightNo && !state.focusMode) ? 'block' : 'none';

    } else {
        removeFlightAssets(f.key);
    }
  });
}

function removeFlightAssets(key) {
    if (mapObjects.lines[key]) { map.removeLayer(mapObjects.lines[key]); delete mapObjects.lines[key]; }
    if (mapObjects.markers[key]) { map.removeLayer(mapObjects.markers[key]); delete mapObjects.markers[key]; }
}

function selectFlight(f) {
    state.selectedFlightKey = f.key;
    renderFlights(); 
}

// ================== UI 交互 ==================

function showAirportCard(ap) {
    const card = document.getElementById("infoCard");
    card.innerHTML = `
      <div class="card-row">
        <div class="flight-title">${ap.name}</div>
        <button class="icon-btn" onclick="closeInfoCard()"><span class="material-symbols-rounded">close</span></button>
      </div>
      <div style="color:#555;font-size:14px;margin-top:8px">
        <p><b>代码:</b> ${ap.code} / ${ap.ICAO||'-'}</p>
        <p><b>别名:</b> ${(ap.aliases||[]).join(' ')}</p>
        <p><b>等级:</b> ${ap.level||'-'}</p>
        <p><b>跑道:</b> ${ap.runways||1}</p>
      </div>`;
    card.classList.remove("hidden");
}

function openFlightCard(f) {
  const card = document.getElementById("infoCard");
  const depAp = getAirport(f.dep); const arrAp = getAirport(f.arr);
  
  // 上下程逻辑
  let prevBtn = '<button class="btn btn-tonal" disabled>无前序</button>';
  let nextBtn = '<button class="btn btn-tonal" disabled>无后序</button>';
  if(f.reg && state.sortedFlights[f.reg]) {
      const list = state.sortedFlights[f.reg];
      const idx = list.findIndex(x => x.key === f.key);
      if(idx > 0) prevBtn = `<button class="btn btn-tonal" onclick="switchFlight('${list[idx-1].key}')">上一程</button>`;
      if(idx < list.length-1) nextBtn = `<button class="btn btn-tonal" onclick="switchFlight('${list[idx+1].key}')">下一程</button>`;
  }

  card.innerHTML = `
    <div class="card-row">
      <div class="flight-title">${f.flightNo}</div>
      <div class="flight-detail-right">
        <div style="font-size:14px;font-weight:bold">${f.airline}</div>
        <div style="font-size:12px;color:grey;margin-top:2px">${f.reg} · ${f.planeType}</div>
      </div>
      <button class="icon-btn" onclick="closeInfoCard()"><span class="material-symbols-rounded">close</span></button>
    </div>

    <div class="route-display">
      <div class="route-node" onclick="toggleApName(this)">
        <div class="ap-code">${depAp ? depAp.code : f.dep}</div>
        <div class="ap-name-full">${f.dep}</div>
        <div class="time-lbl">${f.depTimeRaw}</div>
      </div>
      <span class="material-symbols-rounded" style="color:var(--md-sys-color-outline);font-size:24px">arrow_forward</span>
      <div class="route-node" onclick="toggleApName(this)">
        <div class="ap-code">${arrAp ? arrAp.code : f.arr}</div>
        <div class="ap-name-full">${f.arr}</div>
        <div class="time-lbl">${f.arrTimeRaw}${f.arrOffset>0?'+1':''}</div>
      </div>
    </div>

    <div class="flight-actions">
      ${prevBtn}
      <button class="btn btn-primary" onclick="enterFocusMode('${f.key}')">
        <span class="material-symbols-rounded">my_location</span> 跟踪
      </button>
      ${nextBtn}
    </div>
  `;
  card.classList.remove("hidden");
}

window.toggleApName = (el) => {
    const code = el.querySelector('.ap-code');
    const name = el.querySelector('.ap-name-full');
    if(code.style.display === 'none') {
        code.style.display = 'block'; name.style.display = 'none';
    } else {
        code.style.display = 'none'; name.style.display = 'block';
    }
};

window.closeInfoCard = () => {
    document.getElementById("infoCard").classList.add("hidden");
    state.selectedFlightKey = null; // 清除高亮
    renderFlights();
};

window.switchFlight = (k) => {
    const f = state.flights.find(x => x.key === k);
    if(f) { selectFlight(f); openFlightCard(f); }
};

// ================== 专注模式 ==================

function enterFocusMode(key) {
    const f = state.flights.find(x => x.key === key);
    if(!f) return;
    
    state.focusMode = true;
    state.focusFlight = f;
    closeInfoCard(); // 关闭卡片

    // UI 切换
    document.getElementById("topbar").classList.add("hidden");
    document.getElementById("layerControl").classList.add("hidden");
    document.getElementById("focusOverlay").classList.remove("hidden");

    // 填充顶部
    document.getElementById("focusFlightNo").innerText = f.flightNo;
    document.getElementById("focusDest").innerText = f.arr;
    
    // 填充底部
    const depAp = getAirport(f.dep); const arrAp = getAirport(f.arr);
    document.getElementById("focusDepCode").innerText = depAp?depAp.code:f.dep;
    document.getElementById("focusArrCode").innerText = arrAp?arrAp.code:f.arr;

    map.setZoom(8);
    initMusicPlayer();
    renderFlights(); // 立即触发清理其他飞机
}

document.getElementById("exitFocusBtn").onclick = () => {
    state.focusMode = false;
    state.focusFlight = null;
    state.isMapRotated = false;
    document.getElementById('mapWrap').style.transform = `rotate(0deg)`; // Reset rotation
    
    document.getElementById("topbar").classList.remove("hidden");
    document.getElementById("layerControl").classList.remove("hidden");
    document.getElementById("focusOverlay").classList.add("hidden");
    
    document.getElementById("bgMusic").pause();
    map.setZoom(4);
    renderFlights();
};

function updateFocusStats(f, progress) {
    const tDep = timeToMin(f.depTimeRaw);
    const tArr = timeToMin(f.arrTimeRaw) + (f.arrOffset * 1440);
    const totalMin = tArr - tDep;
    const remMin = Math.max(0, Math.floor(totalMin * (1 - progress)));
    
    const h = Math.floor(remMin / 60);
    const m = remMin % 60;
    document.getElementById("focusTimeRem").innerHTML = `${h}<small>h</small> ${m}<small>min</small>`;
    
    // 距离 Mock
    const dist = Math.floor(remMin * 8.5);
    document.getElementById("focusDistRem").innerHTML = `${dist}<small>mi</small>`;
    document.getElementById("focusProgressBar").style.width = (progress * 100) + "%";
}

// ================== 音乐播放器 (升级版) ==================

function initMusicPlayer() {
    const audio = document.getElementById("bgMusic");
    const playBtn = document.getElementById("musicPlay");
    const modeBtn = document.getElementById("musicModeBtn");
    const modeIcon = document.getElementById("musicModeIcon");
    const imgEl = document.getElementById("albumImg");
    
    // 抽屉切换
    const playerEl = document.getElementById("musicPlayer");
    document.getElementById("musicToggle").onclick = () => {
        playerEl.classList.toggle("collapsed-mobile");
    };
    
    const loadTrack = (idx) => {
        state.musicIndex = idx;
        const track = MP3_LIST[idx];
        audio.src = track.src;
        document.getElementById("musicTitle").innerText = track.title;
        document.getElementById("musicStatus").innerText = "Ready";
        imgEl.src = track.art || "";
        updatePlaylistUI();
    };

    const nextTrack = () => {
        if(state.musicMode === 1) { // Shuffle
            let next = Math.floor(Math.random() * MP3_LIST.length);
            loadTrack(next);
        } else { // Loop List
            let next = state.musicIndex + 1;
            if(next >= MP3_LIST.length) next = 0;
            loadTrack(next);
        }
        audio.play();
        playBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>';
        document.getElementById("musicStatus").innerText = "Playing";
    };

    // 绑定按钮
    playBtn.onclick = () => {
        if(audio.paused) {
            audio.play().catch(()=>{});
            playBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>';
            document.getElementById("musicStatus").innerText = "Playing";
        } else {
            audio.pause();
            playBtn.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
            document.getElementById("musicStatus").innerText = "Paused";
        }
    };
    document.getElementById("musicNext").onclick = nextTrack;
    document.getElementById("musicPrev").onclick = () => {
        let prev = state.musicIndex - 1;
        if(prev < 0) prev = MP3_LIST.length - 1;
        loadTrack(prev); audio.play();
        playBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>';
    };

    // 模式切换 Loop -> Shuffle
    modeBtn.onclick = () => {
        state.musicMode = (state.musicMode + 1) % 2;
        modeIcon.innerText = state.musicMode === 0 ? "repeat" : "shuffle";
    };

    // 自动播放下一首
    audio.onended = nextTrack;
    
    // 播放列表
    const listEl = document.getElementById("playlistItems");
    listEl.innerHTML = "";
    MP3_LIST.forEach((t, i) => {
        const d = document.createElement("div");
        d.className = "playlist-item";
        d.innerText = t.title;
        d.onclick = () => { loadTrack(i); audio.play(); document.getElementById("playlistPopup").classList.add("hidden"); playBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>'; };
        listEl.appendChild(d);
    });
    
    document.getElementById("musicListBtn").onclick = () => document.getElementById("playlistPopup").classList.toggle("hidden");

    loadTrack(0);
    audio.play().catch(()=>{});
    playBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>';
    document.getElementById("musicStatus").innerText = "Playing";
}

function updatePlaylistUI() {
    document.querySelectorAll(".playlist-item").forEach((el, i) => {
        if(i === state.musicIndex) el.classList.add("active"); else el.classList.remove("active");
    });
}

// ================== 其他事件绑定 ==================
(function init() {
    const bindSw = (id, k, fn) => {
        const el = document.getElementById(id);
        el.checked = state[k];
        el.onchange = () => { state[k]=el.checked; localStorage.setItem(k, state[k]); if(fn) fn(); };
    };
    bindSw("sw_showAirportName", "showAirportName", updateCollisions);
    bindSw("sw_showAirportCode", "showAirportCode", updateCollisions);
    bindSw("sw_showFlightNo", "showFlightNo", renderFlights);
    bindSw("sw_showPlaneIcon", "showPlaneIcon", renderFlights);
    bindSw("sw_showAllLines", "showAllLines", renderFlights);
    bindSw("sw_hideOtherWhenFilter", "hideOtherWhenFilter", renderFlights);

    document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.remove("hidden");
    document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");

    let dbounce;
    document.getElementById("searchInput").oninput = (e) => {
        clearTimeout(dbounce);
        dbounce = setTimeout(() => {
            renderFlights();
            const val = e.target.value.trim().toUpperCase();
            if(val) {
                const f = state.flights.find(x => x.flightNo.includes(val) || (x.reg&&x.reg.includes(val)));
                if(f) { selectFlight(f); openFlightCard(f); }
            }
        }, 500);
    };

    // 地图旋转
    document.getElementById("rotateMapBtn").onclick = () => {
        state.isMapRotated = !state.isMapRotated;
        const btn = document.getElementById("rotateMapBtn");
        btn.classList.toggle("active");
        if(state.focusMode) renderFlights(); // 重新触发旋转逻辑
        else {
             // 非专注模式不旋转，或提示
             alert("请先进入跟踪模式以启用机头跟随");
             state.isMapRotated = false;
             btn.classList.remove("active");
        }
    };

    // 图层切换 (支持记忆)
    const setLayer = (type) => {
        map.removeLayer(LAYERS.clean); map.removeLayer(LAYERS.satellite);
        LAYERS[type].addTo(map);
        state.activeLayer = type;
        localStorage.setItem("activeLayer", type);
        document.querySelectorAll(".layer-btn").forEach(b => b.classList.remove("active"));
        document.querySelector(`.layer-btn[data-type="${type}"]`)?.classList.add("active");
    };
    document.querySelectorAll(".layer-btn[data-type]").forEach(b => b.onclick = () => setLayer(b.dataset.type));
    document.getElementById("focusLayerBtn").onclick = () => {
        setLayer(state.activeLayer === 'clean' ? 'satellite' : 'clean');
    };

    loadData();
    setInterval(renderFlights, 2000);
})();
