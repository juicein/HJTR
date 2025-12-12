// ================== 配置与状态 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";
const PLANE_IMG = "https://img.mcwfmtr.cc/i/2025/12/01/5dp56s.png";
const MP3_LIST = [
  { title: "Pure.mp3", src: "../music/Pure.m4a" },
  { title: "燃冬.mp3", src: "music/燃冬.mp3" },
  { title: "Gen Wo Yi Qi Feng.mp3", src: "music/Gen Wo Yi Qi Feng.mp3" },
  { title: "San Fransisco.mp3", src: "music/San Fransisco.mp3" }
];

const LAYERS = {
  clean: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17 })
};

let state = {
  // 设置 (默认值调整)
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"),
  showAllLines: JSON.parse(localStorage.getItem("showAllLines") || "true"), // 新增：显示所有虚线
  hideOtherWhenFilter: false,
  
  // 数据
  airportDB: {},
  flights: [], // 原始航班列表
  sortedFlights: {}, // 按注册号分组排序 { "R-2102": [f1, f2...] }
  
  // 运行时
  selectedFlightKey: null, // 当前高亮
  focusMode: false,
  focusFlight: null,
  musicIndex: 0,
  isPlaying: false
};

let mapObjects = { lines: {}, markers: {}, airportMarkers: {} };

// 初始化地图
const map = L.map('map', { 
  zoomControl: false, attributionControl: false, minZoom: 2, worldCopyJump: true 
}).setView([35, 105], 4);
LAYERS.clean.addTo(map);

// ================== 时间核心 (强制北京时间) ==================

// 获取当前北京时间对象
function getBeijingTime() {
  // 创建一个以北京时间为基准的 Date 对象
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const bjOffset = 8 * 60 * 60 * 1000;
  return new Date(utc + bjOffset);
}

// 获取北京时间当天的 00:00 时间戳
function getBeijingMidnight() {
  const bjNow = getBeijingTime();
  bjNow.setHours(0, 0, 0, 0);
  return bjNow.getTime();
}

// 将 "HH:mm" 解析为分钟数
function timeToMin(str) {
  if (!str) return 0;
  const p = str.split(":");
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

// ================== 数据解析 ==================

async function loadData() {
  try {
    // 加载机场
    const apRes = await fetch(AIRPORTS_PATH);
    let apData = await apRes.json();
    state.airportDB = {};
    
    // 展平数组并计算等级权重
    const rankMap = { "4F": 10, "4E": 8, "4D": 6, "4C": 4 };
    (Array.isArray(apData) ? apData : []).forEach(ap => {
      // 修复 aliases 和 ICAO 读取
      ap.rankValue = rankMap[ap.level] || 1;
      const key = ap.code || "UNK";
      state.airportDB[key] = ap;
      // 同时建立中文名索引
      if(ap.name) state.airportDB[ap.name] = ap;
    });

    // 加载航班
    const fltText = await fetch(FLIGHT_DATA_PATH).then(r => r.text());
    state.flights = parseFlightData(fltText);
    
    // 预处理：按注册号分组并排序，用于上下程查找
    state.sortedFlights = {};
    state.flights.forEach(f => {
      if(f.reg && f.reg !== '<->') {
        if(!state.sortedFlights[f.reg]) state.sortedFlights[f.reg] = [];
        state.sortedFlights[f.reg].push(f);
      }
    });
    // 对每架飞机的航班按起飞时间排序 (处理 +1 天的逻辑比较复杂，这里简化按 DepTime 排序)
    for(let reg in state.sortedFlights) {
      state.sortedFlights[reg].sort((a,b) => {
        let ta = timeToMin(a.depTimeRaw) + (a.depOffset*1440);
        let tb = timeToMin(b.depTimeRaw) + (b.depOffset*1440);
        return ta - tb;
      });
    }

    renderAirports();
    renderFlights(); // 立即渲染一次
    updateCollisions();

  } catch (e) { console.error("Data Load Error", e); }
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
      reg: getVal(/<\s*([^>]+)\s*>/), // 获取注册号
      dep: "", depTimeRaw: "", depOffset: 0,
      arr: "", arrTimeRaw: "", arrOffset: 0
    };

    // 解析出发: {0:30}#+0# 或 {5:30}
    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}(\#\+(\d+)\#)?/);
    if(depMatch) {
      f.dep = depMatch[1].trim();
      f.depTimeRaw = depMatch[2].trim();
      f.depOffset = depMatch[4] ? parseInt(depMatch[4]) : 0;
    }

    // 解析到达
    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}(\#\+(\d+)\#)?/);
    if(arrMatch) {
      f.arr = arrMatch[1].trim();
      f.arrTimeRaw = arrMatch[2].trim();
      f.arrOffset = arrMatch[4] ? parseInt(arrMatch[4]) : 0;
    }
    
    // 生成唯一Key
    f.key = f.flightNo + "_" + f.dep + "_" + f.arr;
    entries.push(f);
  }
  return entries;
}

// ================== 地图渲染逻辑 ==================

function renderAirports() {
  // 清理旧标记 (如果重新加载)
  // 此处略，假设只加载一次
  for (let code in state.airportDB) {
    const ap = state.airportDB[code];
    if (ap.code !== code) continue; // 避免通过名字索引重复创建
    
    if (!ap.lat || !ap.lng) continue;

    // 构造 Marker
    const html = `
      <div class="airport-marker rank-${ap.level}">
        <div class="airport-dot"></div>
        <div class="airport-text" style="display:${state.showAirportName?'block':'none'}">
          <span class="ap-name-span">${ap.name}</span>
          <span class="ap-code-span" style="display:${state.showAirportCode?'inline':'none'};opacity:0.6;margin-left:4px">${ap.code}</span>
        </div>
      </div>`;
    
    const icon = L.divIcon({ className: 'custom-ap-icon', html: html, iconAnchor: [5, 5] }); // Center anchor
    const marker = L.marker([ap.lat, ap.lng], { icon }).addTo(map);
    marker.apData = ap;
    marker.on('click', () => showAirportCard(ap));
    mapObjects.airportMarkers[code] = marker;
  }
}

// 智能避让 (4F > 4E > 4D > 4C)
function updateCollisions() {
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  const pixelThresh = zoom < 5 ? 30 : 50;
  
  const visible = [];
  // 收集视野内的点
  for(let k in mapObjects.airportMarkers) {
    const m = mapObjects.airportMarkers[k];
    if(bounds.contains(m.getLatLng())) {
      visible.push({ marker: m, pt: map.latLngToLayerPoint(m.getLatLng()), rank: m.apData.rankValue });
    } else {
      L.DomUtil.addClass(m.getElement(), 'hidden');
    }
  }
  
  // 按权重降序
  visible.sort((a,b) => b.rank - a.rank);
  
  const accepted = [];
  visible.forEach(item => {
    let clash = false;
    for(let acc of accepted) {
      const dx = item.pt.x - acc.pt.x;
      const dy = item.pt.y - acc.pt.y;
      if(Math.sqrt(dx*dx + dy*dy) < pixelThresh) {
        clash = true; break;
      }
    }
    
    const el = item.marker.getElement();
    if(!el) return;
    
    const txtEl = el.querySelector('.airport-text');
    const nameEl = el.querySelector('.ap-name-span');
    const codeEl = el.querySelector('.ap-code-span');

    if(clash) {
      // 冲突：隐藏整个标记
      L.DomUtil.addClass(el, 'hidden');
    } else {
      L.DomUtil.removeClass(el, 'hidden');
      accepted.push(item);
      
      // 强制刷新内部文字显隐
      if(txtEl) txtEl.style.display = (state.showAirportName || state.showAirportCode) ? 'block' : 'none';
      if(nameEl) nameEl.style.display = state.showAirportName ? 'inline' : 'none';
      if(codeEl) codeEl.style.display = state.showAirportCode ? 'inline' : 'none';
    }
  });
  
  // 飞机图标大小
  document.documentElement.style.setProperty('--plane-size', Math.max(20, zoom * 6) + 'px');
}

map.on('zoomend moveend', updateCollisions);

// 渲染航班 (核心循环)
function renderFlights() {
  const bjNow = getBeijingTime();
  const bjMid = getBeijingMidnight(); // 今天0点时间戳
  const nowTs = bjNow.getTime(); // 当前时间戳

  // 搜索过滤
  const searchKey = document.getElementById("searchInput").value.trim().toUpperCase();

  state.flights.forEach(f => {
    // 坐标
    const depAp = getAirport(f.dep);
    const arrAp = getAirport(f.arr);
    if (!depAp || !arrAp) return;

    // 计算实际起飞到达时间戳 (考虑跨日)
    // 逻辑：假设航班每天都有。我们需要检查 "昨天出发的", "今天出发的"
    // 简单起见：以 "今天" 的调度为基准计算，加上 Offset
    // 如果 Dep 23:00, Offset 0 => Today 23:00.
    // 如果 Dep 00:30, Offset 0 => Today 00:30.
    
    const depMin = timeToMin(f.depTimeRaw);
    const arrMin = timeToMin(f.arrTimeRaw);
    const depTs = bjMid + depMin * 60000 + (f.depOffset * 86400000);
    const arrTs = bjMid + arrMin * 60000 + (f.arrOffset * 86400000);

    // 计算进度
    let progress = -1;
    
    // 正常情况: Dep <= Now <= Arr
    if (nowTs >= depTs && nowTs <= arrTs) {
      progress = (nowTs - depTs) / (arrTs - depTs);
    } 
    // 跨日修正：如果现在是凌晨 01:00，但这个航班是昨晚 23:00 起飞的 (即 DepTs 在未来?)
    // 实际上 flight_data 是相对调度的。
    // 如果现在没匹配上，检查 "昨天的班次" 是否还在飞
    else {
        const yDepTs = depTs - 86400000;
        const yArrTs = arrTs - 86400000;
        if (nowTs >= yDepTs && nowTs <= yArrTs) {
             progress = (nowTs - yDepTs) / (yArrTs - yDepTs);
        }
    }

    // 状态判定
    const isFlying = (progress > 0.001 && progress < 0.999);
    
    // 过滤可见性
    let isMatch = true;
    if (searchKey) {
      isMatch = (f.flightNo.includes(searchKey) || (f.reg && f.reg.includes(searchKey)) || f.dep.includes(searchKey) || f.arr.includes(searchKey));
    }
    
    const shouldShow = isFlying && (!state.hideOtherWhenFilter || isMatch);
    
    // 绘制线条 (Show All Lines 开关)
    const lineKey = f.key;
    if (state.showAllLines || isMatch || state.selectedFlightKey === f.key) {
        if (!mapObjects.lines[lineKey]) {
            const line = L.polyline([[depAp.lat, depAp.lng], [arrAp.lat, arrAp.lng]], {
                color: '#ff8c2b', weight: 1, dashArray: '4, 4', opacity: 0.6
            }).addTo(map);
            line.on('click', () => { selectFlight(f); openFlightCard(f); });
            mapObjects.lines[lineKey] = line;
        }
        // 高亮处理
        const line = mapObjects.lines[lineKey];
        if (state.selectedFlightKey === f.key) {
            line.setStyle({ color: '#ff6d00', weight: 3, dashArray: null, opacity: 1 });
            line.bringToFront();
        } else {
            line.setStyle({ color: '#ff8c2b', weight: 1, dashArray: '4, 4', opacity: 0.6 });
        }
    } else {
        if (mapObjects.lines[lineKey]) { map.removeLayer(mapObjects.lines[lineKey]); delete mapObjects.lines[lineKey]; }
    }

    // 绘制飞机
    if (shouldShow && state.showPlaneIcon) {
      const curPos = interpolate(depAp, arrAp, progress);
      const angle = calcBearing(depAp.lat, depAp.lng, arrAp.lat, arrAp.lng);
      
      const html = `<div style="transform: rotate(${angle}deg); transition: all 1s linear;">
                      <img src="${PLANE_IMG}" style="width:100%; height:100%;">
                    </div>`;
      const icon = L.divIcon({ html, className: 'plane-icon', iconSize: [30, 30], iconAnchor: [15, 15] });

      if (!mapObjects.markers[lineKey]) {
        const m = L.marker(curPos, { icon, zIndexOffset: 1000 }).addTo(map);
        m.bindTooltip(f.flightNo, { permanent: true, direction: 'right', className: 'airport-text flight-label-tip' });
        m.on('click', () => { selectFlight(f); openFlightCard(f); });
        mapObjects.markers[lineKey] = m;
      } else {
        const m = mapObjects.markers[lineKey];
        m.setLatLng(curPos);
        m.setIcon(icon);
        // 专注模式跟随
        if(state.focusMode && state.focusFlight && state.focusFlight.key === f.key) {
            map.panTo(curPos, { animate: true, duration: 1 });
            updateFocusStats(f, progress);
        }
      }
      
      // 标签开关逻辑
      const tip = mapObjects.markers[lineKey].getTooltip();
      if(tip) {
        tip.getElement() ? (tip.getElement().style.display = state.showFlightNo ? 'block' : 'none') : null;
      }
      
    } else {
      // 移除飞机
      if (mapObjects.markers[lineKey]) { map.removeLayer(mapObjects.markers[lineKey]); delete mapObjects.markers[lineKey]; }
    }
  });
}

function selectFlight(f) {
    state.selectedFlightKey = f.key;
    renderFlights(); // 触发重绘以应用高亮
}

// ================== UI 交互 ==================

function getAirport(key) { return state.airportDB[key] || state.airportDB[key.toUpperCase()]; }

// 卡片显示
function showAirportCard(ap) {
    const card = document.getElementById("infoCard");
    card.innerHTML = `
      <div class="card-row">
        <div class="flight-title">${ap.name} <small style="font-size:16px;color:grey">${ap.code}</small></div>
        <button class="icon-btn" onclick="document.getElementById('infoCard').classList.add('hidden')">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>
      <div style="margin-top:10px; font-size:14px; color:#555">
        <p><b>别名:</b> ${(ap.aliases||[]).join(', ') || '-'}</p>
        <p><b>等级:</b> ${ap.level || '-'}</p>
        <p><b>ICAO:</b> ${ap.ICAO || '-'}</p>
        <p><b>跑道:</b> ${ap.runways || 1}</p>
      </div>
    `;
    card.classList.remove("hidden");
}

function openFlightCard(f) {
  const card = document.getElementById("infoCard");
  const depAp = getAirport(f.dep);
  const arrAp = getAirport(f.arr);
  
  // 查找上下程
  let prevBtn = '<button class="btn btn-tonal" disabled>无前序</button>';
  let nextBtn = '<button class="btn btn-tonal" disabled>无后序</button>';
  
  if (state.sortedFlights[f.reg]) {
    const list = state.sortedFlights[f.reg];
    const idx = list.findIndex(item => item.key === f.key);
    if(idx > 0) {
        prevBtn = `<button class="btn btn-tonal" onclick="switchFlight('${list[idx-1].key}')">上一程</button>`;
    }
    if(idx < list.length - 1) {
        nextBtn = `<button class="btn btn-tonal" onclick="switchFlight('${list[idx+1].key}')">下一程</button>`;
    }
  }

  card.innerHTML = `
    <div class="card-row">
      <div class="flight-title">${f.flightNo}</div>
      <div style="text-align:right">
        <div style="font-size:12px;color:grey">${f.airline}</div>
        <div style="font-size:12px;font-weight:bold">${f.reg}</div>
      </div>
      <button class="icon-btn" onclick="document.getElementById('infoCard').classList.add('hidden')">
        <span class="material-symbols-rounded">close</span>
      </button>
    </div>
    
    <div class="route-display">
      <div style="text-align:center">
        <div class="ap-code">${depAp ? depAp.code : f.dep}</div>
        <div class="time-lbl">${f.depTimeRaw}</div>
      </div>
      <span class="material-symbols-rounded" style="color:var(--md-sys-color-outline)">arrow_forward</span>
      <div style="text-align:center">
        <div class="ap-code">${arrAp ? arrAp.code : f.arr}</div>
        <div class="time-lbl">${f.arrTimeRaw}${f.arrOffset>0?' +1':''}</div>
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

window.switchFlight = (key) => {
    // Helper helper global
    const f = state.flights.find(x => x.key === key);
    if(f) { selectFlight(f); openFlightCard(f); }
};

// ================== 专注模式与音乐 ==================

function enterFocusMode(key) {
    const f = state.flights.find(x => x.key === key);
    if(!f) return;
    state.focusMode = true;
    state.focusFlight = f;
    
    // UI 切换
    document.getElementById("topbar").classList.add("hidden");
    document.getElementById("layerControl").classList.add("hidden");
    document.getElementById("infoCard").classList.add("hidden");
    document.getElementById("focusOverlay").classList.remove("hidden");
    
    // 数据填充
    document.getElementById("focusFlightNo").innerText = f.flightNo;
    document.getElementById("focusDest").innerText = f.arr;
    const depAp = getAirport(f.dep); const arrAp = getAirport(f.arr);
    document.getElementById("focusDepCode").innerText = depAp?depAp.code:f.dep;
    document.getElementById("focusArrCode").innerText = arrAp?arrAp.code:f.arr;
    
    map.setZoom(7);
    
    // 初始化音乐
    initMusicPlayer();
}

function exitFocusMode() {
    state.focusMode = false;
    state.focusFlight = null;
    document.getElementById("topbar").classList.remove("hidden");
    document.getElementById("layerControl").classList.remove("hidden");
    document.getElementById("focusOverlay").classList.add("hidden");
    map.setZoom(4);
    
    // 停止音乐
    document.getElementById("bgMusic").pause();
}

function updateFocusStats(f, progress) {
    // 剩余时间计算
    // 简单估算：基于 Total Duration * (1 - progress)
    const tDep = timeToMin(f.depTimeRaw);
    const tArr = timeToMin(f.arrTimeRaw) + (f.arrOffset * 1440);
    const duration = tArr - tDep;
    const remainMin = Math.floor(duration * (1 - progress));
    
    const h = Math.floor(remainMin / 60);
    const m = remainMin % 60;
    
    document.getElementById("focusTimeRem").innerHTML = `${h}<small>h</small> ${m}<small>min</small>`;
    
    // 剩余距离 (Mock: 假设每分钟 8 英里)
    document.getElementById("focusDistRem").innerHTML = `${Math.floor(remainMin * 8)}<small>mi</small>`;
    document.getElementById("focusProgressBar").style.width = (progress * 100) + "%";
}

// 音乐播放器逻辑
function initMusicPlayer() {
    const audio = document.getElementById("bgMusic");
    const titleEl = document.getElementById("musicTitle");
    const statusEl = document.getElementById("musicStatus");
    const playBtn = document.getElementById("musicPlay");
    
    const loadTrack = (idx) => {
        state.musicIndex = idx;
        const track = MP3_LIST[idx];
        audio.src = track.src;
        titleEl.innerText = track.title;
        statusEl.innerText = "Paused";
        updatePlaylistUI();
    };
    
    // Controls
    document.getElementById("musicPlay").onclick = () => {
        if(audio.paused) {
            audio.play().catch(e => console.log("Auto-play prevented"));
            playBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>';
            statusEl.innerText = "Playing";
        } else {
            audio.pause();
            playBtn.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
            statusEl.innerText = "Paused";
        }
    };
    
    document.getElementById("musicNext").onclick = () => {
        let next = state.musicIndex + 1;
        if(next >= MP3_LIST.length) next = 0;
        loadTrack(next);
        audio.play();
        playBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>';
    };
    
    document.getElementById("musicPrev").onclick = () => {
        let prev = state.musicIndex - 1;
        if(prev < 0) prev = MP3_LIST.length - 1;
        loadTrack(prev);
        audio.play();
        playBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>';
    };
    
    document.getElementById("musicListBtn").onclick = () => {
        document.getElementById("playlistPopup").classList.toggle("hidden");
    };
    
    // Render Playlist
    const listEl = document.getElementById("playlistItems");
    listEl.innerHTML = "";
    MP3_LIST.forEach((t, i) => {
        const div = document.createElement("div");
        div.className = "playlist-item";
        div.innerText = t.title;
        div.onclick = () => { loadTrack(i); audio.play(); document.getElementById("playlistPopup").classList.add("hidden"); playBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>'; };
        listEl.appendChild(div);
    });
    
    // Start Default
    loadTrack(0);
    // Auto play if entered focus
    audio.play().catch(()=>{}); 
    playBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>';
}

function updatePlaylistUI() {
    const items = document.querySelectorAll(".playlist-item");
    items.forEach((el, i) => {
        if(i === state.musicIndex) el.classList.add("active");
        else el.classList.remove("active");
    });
}


// ================== 工具函数 ==================
function interpolate(p1, p2, f) {
  return [ p1.lat + (p2.lat - p1.lat) * f, p1.lng + (p2.lng - p1.lng) * f ];
}
function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const y = Math.sin(toRad(lon2-lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) - Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lon2-lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// 启动
(function init() {
    // 绑定事件
    // Settings
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
    bindSw("sw_showFlightNo", "showFlightNo", renderFlights); // Re-render to update tooltip
    bindSw("sw_showPlaneIcon", "showPlaneIcon", renderFlights);
    bindSw("sw_showAllLines", "showAllLines", renderFlights);
    bindSw("sw_hideOtherWhenFilter", "hideOtherWhenFilter", renderFlights);
    
    document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.toggle("hidden");
    document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");
    
    // Search (Debounced)
    let debounceTimer;
    const handleSearch = () => {
        renderFlights();
        const val = document.getElementById("searchInput").value.trim().toUpperCase();
        if(val) {
            const found = state.flights.find(f => f.flightNo.includes(val) || (f.reg && f.reg.includes(val)));
            if(found) { selectFlight(found); openFlightCard(found); }
        }
    };
    document.getElementById("searchInput").oninput = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(handleSearch, 600);
    };
    document.getElementById("searchBtn").onclick = handleSearch;
    document.getElementById("clearBtn").onclick = () => {
        document.getElementById("searchInput").value = "";
        handleSearch();
    };

    // Layer Toggle
    const toggleLayer = (type) => {
        map.removeLayer(LAYERS.clean); map.removeLayer(LAYERS.satellite);
        LAYERS[type].addTo(map);
        document.querySelectorAll(".layer-btn").forEach(b => b.classList.toggle("active", b.dataset.type === type));
    };
    document.querySelectorAll(".layer-btn").forEach(btn => {
        btn.onclick = () => toggleLayer(btn.dataset.type);
    });
    // Focus Mode Layer Toggle
    let focusLayerState = 'clean';
    document.getElementById("focusLayerBtn").onclick = () => {
        focusLayerState = (focusLayerState === 'clean' ? 'satellite' : 'clean');
        toggleLayer(focusLayerState);
    };
    
    document.getElementById("exitFocusBtn").onclick = exitFocusMode;

    loadData();
    setInterval(renderFlights, 2000); // 2秒刷新一次动画位置
})();
