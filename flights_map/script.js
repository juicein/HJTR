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

const LAYERS = {
  clean: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy;OpenStreetMap, &copy;CartoDB', subdomains: 'abcd', maxZoom: 19
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy;Esri', maxZoom: 17
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
  
  flights: [], sortedFlights: {}, airportDB: {},
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
  airportMarkers: [] 
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

    renderAirports(); // 渲染所有机场
    updateDisplaySettings(); // 应用开关状态
    renderFlights(); 
    updateCollisions(); // 仅用于飞机

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

// 简单粗暴：渲染所有机场，不进行复杂的等级过滤
function renderAirports() {
  const processed = new Set();
  
  for (let code in state.airportDB) {
    const ap = state.airportDB[code];
    if (processed.has(ap.code) || !ap.lat || !ap.lng) continue;
    processed.add(ap.code);

    // MD3 Style Marker HTML
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
      iconSize: [0, 0], // 让 CSS 控制布局
      iconAnchor: [5, 5] // 中心对齐圆点
    });

    const marker = L.marker([ap.lat, ap.lng], { icon }).addTo(map);
    marker.on('click', () => showAirportCard(ap));
    mapObjects.airportMarkers.push(marker);
  }
}

// 通过 body class 控制显隐，性能最高
function updateDisplaySettings() {
  document.body.classList.toggle('show-ap-name', state.showAirportName);
  document.body.classList.toggle('show-ap-code', state.showAirportCode);
  updateCollisions(); // 重新计算飞机避让
}

// 飞机避让与图标更新
function updateCollisions() {
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  
  // 飞机避让
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
        if(f.key !== state.focusFlight.key) return;
    } else {
        if (state.hideOtherWhenFilter && searchKey && !isMatch) return;
        if (!isFlying) return;
    }

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
        m.bindTooltip(f.flightNo, { permanent: true, direction: 'right', className: 'airport-label' }); // 复用Label样式
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
      if(tip && tip.getElement()) tip.getElement().style.display = state.showFlightNo ? 'block' : 'none';
    }
  });
}

function onPlaneClick(f) {
    if(state.focusMode) return;
    state.selectedFlightKey = f.key;
    renderFlights();
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
