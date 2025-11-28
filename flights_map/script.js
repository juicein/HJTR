// ============ 全局配置 ============
const REFRESH_INTERVAL_SECONDS = 3 * 60; // 3分钟刷新一次 (可调)
const ANIMATION_FPS = 30; // 动画帧率
const ANIMATION_INTERVAL = 1000 / ANIMATION_FPS; // 每帧毫秒数
let refreshTimer = null; // 刷新计时器
let animationFrameId = null; // 动画帧 ID

// ============ 初始化地图 ============
// 使用一个抽象的坐标范围来模拟世界地图
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([35, 90], 3);

// 简约底图（无国界）
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 7,
  attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
}).addTo(map);

// 全局变量
let airportDB = {};
let flights = [];
let markers = {}; // 飞机标记
let airportMarkers = {}; // 机场标记
let polyLines = {};
let showFlightNo = localStorage.getItem("showFlightNo") === "true";
let showAirportLabel = localStorage.getItem("showAirportLabel") === "true";
let enableSingleFlightMode = true; // URL单航班模式默认开启

// ============ 数据结构与工具函数 ============

// 机场数据结构（模拟您提供的新结构）
// 注意：实际项目中，您需要确保您的 airports.json 是正确的。
// 这里的 `airportDB` 最终会是 `{ "BAY": {...}, "QLM": {...} }` 的结构
// 详情请看最后机场数据说明。

/**
 * 将时间字符串 HH:MM 转换为以午夜开始的分钟数 (东八区时间)
 * @param {string} t - 时间字符串 "HH:MM"
 * @returns {number} 分钟数
 */
function timeToMinutes(t) { 
  const [h, m] = t.split(":").map(Number); 
  return h * 60 + m; 
}

/**
 * 根据名称、三字码或别名查找机场
 * @param {string} name - 机场名称、三字码或别名
 * @returns {object|null} 机场对象
 */
function airportByName(name) {
  const query = name.toUpperCase();
  for (let code in airportDB) {
    const ap = airportDB[code];
    if (code === query || ap.name === name || ap.city === name || (ap.aliases && ap.aliases.includes(name))) {
      return ap;
    }
  }
  return null;
}

/**
 * 从 URL 获取航班 ID
 * @returns {string|null} 航班 ID
 */
function getFlightIDFromURL() { 
  if (!enableSingleFlightMode) return null;
  return new URLSearchParams(location.search).get("flights_map"); 
}

// ============ 数据加载与解析 ============

async function loadData() {
  // 假设 airports.json 是一个数组，我们需要转换成以 code 为键的对象
  const rawAirports = await fetch("../data/airports.json").then(r => r.json());
  airportDB = rawAirports.reduce((acc, ap) => {
    acc[ap.code] = ap;
    return acc;
  }, {});

  const txt = await fetch("../data/flight_data.txt").then(r => r.text());
  flights = parseFlightData(txt);

  initToolbar();
  startRenderLoop();
  map.on('moveend', updateVisibleFlightsList); // 移动地图后更新列表
}

/**
 * 解析航班原始格式，包括新字段
 * 【HA1608】〈〉«MON,TUE,WED,THU,FRI,SAT,SUN»〔波音737-800〕『豪金航空』《拜科努尔出发》{0:30}#+0#@T1航站楼@《上海到达》{11:20}#+0#@T1航站楼@ §1150元§θ3100元θ △8888元△<DF1729>《航班结束》
 */
function parseFlightData(raw) {
  const list = [];
  const reg = /【(.*?)】\s*〈(.*?)〉\s*«(.*?)»\s*〔(.*?)〕\s*『(.*?)』\s*《(.*?)出发》\s*\{(.*?)\}\s*#(\+?\d)#\s*@.*?@\s*《(.*?)到达》\s*\{(.*?)\}\s*#(\+?\d)#\s*@.*?@\s*.*?<([^>]+)>/g;
  let m;
  while ((m = reg.exec(raw)) !== null) {
    list.push({
      flightNo: m[1], // HA1608
      regNo: m[2] || 'N/A', // 注册号，这里可能为空，需注意
      days: m[3], // 星期几
      aircraft: m[4], // 机型
      airline: m[5], // 航空公司
      dep: m[6], // 拜科努尔
      depTime: m[7], // 0:30
      depCrossDay: parseInt(m[8]), // 0 (出发跨日)
      arr: m[9], // 上海
      arrTime: m[10], // 11:20
      arrCrossDay: parseInt(m[11]), // 0 (到达跨日)
      prevNextFlight: m[12] // 前后续航班 ID
    });
  }
  return list;
}

// ============ 渲染核心逻辑 ============

/**
 * 计算当前时间在指定时区（东八区）下的分钟数
 * @returns {number} 东八区当天的分钟数 (0-1439)
 */
function getBeijingTimeMinutes() {
  const now = new Date();
  // UTC时间 + 8小时 (8 * 60 = 480 分钟)
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const beijingMinutes = (utcMinutes + 480) % 1440;
  return beijingMinutes;
}

/**
 * 计算飞机位置和飞行状态
 * @param {object} f - 航班对象
 * @param {object} depA - 出发机场
 * @param {object} arrA - 到达机场
 * @param {number} nowMin - 当前东八区分钟数
 * @returns {object|null} 包含 lat, lng, ratio, status 的对象，或 null
 */
function calculateFlightPosition(f, depA, arrA, nowMin) {
  const today = new Date();
  const currentDayOfWeek = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][today.getDay()];
  
  if (!f.days.includes(currentDayOfWeek)) {
    return { status: "NO_FLIGHT", ratio: 0 };
  }

  const depMin = timeToMinutes(f.depTime);
  const arrMin = timeToMinutes(f.arrTime) + f.arrCrossDay * 1440; // 考虑跨日
  
  let flightDuration = arrMin - depMin;
  if (flightDuration <= 0) flightDuration += 1440; // 确保时间为正，处理午夜前后出发到达的情况

  let elapsedMinutes = nowMin - depMin;
  // 核心逻辑：如果 elapsedMinutes < 0 (今天还没到出发时间)，则已到达/准备 (取决于跨日)
  // 如果 elapsedMinutes > flightDuration，则已到达
  
  // 修正跨日出发：如果现在是凌晨但起飞是昨晚，elapsedMinutes会是负数
  if (elapsedMinutes < 0 && depMin > 720) { // 假设起飞时间在下午/晚上
    elapsedMinutes += 1440; // 算作昨天起飞
  }

  // 状态判断
  if (elapsedMinutes < 0) {
    return { status: "PREPARING", ratio: 0 };
  } else if (elapsedMinutes >= flightDuration) {
    return { status: "ARRIVED", ratio: 1 };
  }

  const ratio = elapsedMinutes / flightDuration;
  const lat = depA.lat + (arrA.lat - depA.lat) * ratio;
  const lng = depA.lng + (arrA.lng - depA.lng) * ratio;

  // 计算飞机角度 (L.marker 会自动处理 360 度循环)
  const angle = L.latLng(depA.lat, depA.lng).bearing(L.latLng(arrA.lat, arrA.lng));

  return { 
    status: "IN_FLIGHT", 
    ratio, 
    lat, 
    lng, 
    angle
  };
}

/**
 * 在地图上渲染机场标记
 * @param {object} ap - 机场对象
 */
function renderAirportMarker(ap) {
  if (airportMarkers[ap.code]) return; // 避免重复创建

  // 机场图标 (同心圆)
  const iconHtml = `<div class="airport-icon-div"></div>`;
  const airportMk = L.marker([ap.lat, ap.lon], {
    icon: L.divIcon({className: "airport-icon", html: iconHtml, iconSize: [20, 20], iconAnchor: [10, 10]})
  }).addTo(map);
  airportMk.on("click", () => showAirportCard(ap));
  
  // 机场标签 (可开关)
  const label = L.marker([ap.lat, ap.lon], {
    icon: L.divIcon({
      className: "airport-label", 
      html: `${ap.name} (${ap.code})`,
      iconAnchor: [-5, 10] // 略微偏移，不挡住图标
    })
  }).addTo(map);

  airportMk.label = label;
  
  airportMarkers[ap.code] = { marker: airportMk, label: label };
}


/**
 * 渲染或更新所有航班及其位置
 * @param {boolean} smoothMove - 是否启用平滑移动
 */
function renderFlights(smoothMove = false) {
  const filterID = getFlightIDFromURL();
  const nowMin = getBeijingTimeMinutes();
  
  const activeAirports = new Set();
  const activeFlights = [];

  flights.forEach(f => {
    // URL 过滤
    if (filterID && f.prevNextFlight.toUpperCase() !== filterID.toUpperCase() && f.flightNo.toUpperCase() !== filterID.toUpperCase()) return;

    const depA = airportByName(f.dep);
    const arrA = airportByName(f.arr);
    if (!depA || !arrA) return;

    const pos = calculateFlightPosition(f, depA, arrA, nowMin);
    
    // 渲染航线和机场
    const lineKey = `${f.flightNo}_LINE`;
    if (!polyLines[lineKey]) {
      const line = L.polyline([[depA.lat, depA.lon], [arrA.lat, arrA.lon]], {
        color: "orange", weight: 2, dashArray: "6 6"
      }).addTo(map);
      polyLines[lineKey] = line;
    }
    
    // 渲染机场标记
    activeAirports.add(depA.code);
    activeAirports.add(arrA.code);

    // 飞机图标
    let mk = markers[f.flightNo];

    if (pos.status === "IN_FLIGHT") {
      activeFlights.push(f);
      
      if (!mk) {
        // 创建新的标记
        const icon = L.icon({
          iconUrl: "https://i.imgur.com/4bZtV3y.png", // 飞机 PNG
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });
        mk = L.marker([pos.lat, pos.lng], { icon, rotationAngle: pos.angle }).addTo(map);
        mk.flight = f;
        mk.airportFrom = depA;
        mk.airportTo = arrA;
        mk.on("click", () => showInfoCard(f, depA, arrA, pos.ratio));
        markers[f.flightNo] = mk;
        
        // 绑定航班号标签
        mk.tooltip = L.tooltip({
            permanent: true,
            direction: "right",
            className: "flight-label"
        }).setContent(f.flightNo).setLatLng([pos.lat, pos.lng]).addTo(map);

      } else {
        // 更新现有标记的位置和角度
        const newLatLng = [pos.lat, pos.lng];
        if (smoothMove && mk.getLatLng) {
           // 启用平滑动画
           mk.startLatLng = mk.getLatLng();
           mk.endLatLng = L.latLng(newLatLng);
           mk.startRatio = pos.ratio - (1 / (f.flightDuration * ANIMATION_FPS * REFRESH_INTERVAL_SECONDS)); // 估算起始比例
           mk.startTime = Date.now();
           mk.duration = REFRESH_INTERVAL_SECONDS * 1000;
        } else {
          // 直接跳到新位置
          mk.setLatLng(newLatLng);
        }
        
        mk.setRotationAngle(pos.angle);
        mk.tooltip.setLatLng(newLatLng);
      }
      
      // 检查航班号标签是否显示
      if (mk.tooltip) {
        if (showFlightNo) mk.tooltip.setOpacity(1);
        else mk.tooltip.setOpacity(0);
      }
      
    } else {
      // 航班不在飞行中，移除标记和标签
      if (mk) {
        map.removeLayer(mk);
        if(mk.tooltip) map.removeLayer(mk.tooltip);
        delete markers[f.flightNo];
      }
    }
    
    // 实时更新航线颜色/状态
    const lineColor = (pos.status === "IN_FLIGHT" || pos.status === "ARRIVED") ? "var(--secondary-color)" : "gray";
    const lineWeight = (pos.status === "IN_FLIGHT") ? 3 : 2;
    polyLines[lineKey].setStyle({ color: lineColor, weight: lineWeight, opacity: (filterID ? 1 : 0.4)});
  });
  
  // 移除未使用的航线
  for (let k in polyLines) {
    const flightNo = k.replace("_LINE", "");
    if (!markers[flightNo] && !filterID) {
      polyLines[k].setStyle({opacity: 0.2, weight: 1}); // 仅在非单航班模式下淡化
    }
  }
  
  // 渲染并控制机场标签的可见性
  for (let code in airportDB) {
    const ap = airportDB[code];
    renderAirportMarker(ap); // 确保所有机场图标存在
    const airport = airportMarkers[ap.code];
    
    // 控制机场标签可见性
    if (airport.label) {
      airport.label.setOpacity(showAirportLabel ? 1 : 0);
    }
    // 突出显示相关机场
    const isRelated = activeAirports.has(code) || (filterID && activeAirports.has(code));
    airport.marker.setOpacity(isRelated ? 1 : 0.6);
  }
  
  // 如果是单航班模式且有航班，移动地图视角
  if(filterID && activeFlights.length > 0){
    map.flyTo([activeFlights[0].lat, activeFlights[0].lng], 5, { duration: 1.5 });
  }

  // 更新可见航班列表
  updateVisibleFlightsList();
}


// ============ 动画和平滑移动 ============

function animatePlane() {
    const now = Date.now();
    for (let flightNo in markers) {
        const mk = markers[flightNo];
        const f = mk.flight;
        
        if (mk.startLatLng && mk.endLatLng && mk.startTime && mk.duration) {
            const timeElapsed = now - mk.startTime;
            let ratio = timeElapsed / mk.duration;
            
            if (ratio > 1) {
                ratio = 1;
                // 动画结束，清除起始点
                mk.startLatLng = null;
                mk.endLatLng = null;
            }

            // 插值计算新位置
            const newLat = mk.startLatLng.lat + (mk.endLatLng.lat - mk.startLatLng.lat) * ratio;
            const newLng = mk.startLatLng.lng + (mk.endLatLng.lng - mk.startLatLng.lng) * ratio;
            
            const newLatLng = L.latLng(newLat, newLng);
            mk.setLatLng(newLatLng);
            mk.tooltip.setLatLng(newLatLng);
        }
    }

    animationFrameId = requestAnimationFrame(animatePlane);
}

/**
 * 开始渲染循环（包括定时刷新和动画）
 */
function startRenderLoop() {
  // 1. 立即渲染一次 (不带平滑移动)
  renderFlights(false); 
  
  // 2. 设置定时刷新 (用于重新计算准确位置)
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    renderFlights(true); // 启用平滑移动
  }, REFRESH_INTERVAL_SECONDS * 1000);
  
  // 3. 启动动画帧 (用于平滑移动)
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(animatePlane);
}

// ============ UI/侧边栏逻辑 ============

/**
 * 切换手机上拉栏的状态
 */
function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.classList.toggle("expanded");
  document.getElementById("handle").innerHTML = sidebar.classList.contains("expanded") ? '&#x25BC;' : '&#x25B2;';
}

/**
 * 初始化工具栏开关和事件
 */
function initToolbar() {
  // 开关初始化
  document.getElementById("toggleFlightNo").checked = showFlightNo;
  document.getElementById("toggleAirportLabel").checked = showAirportLabel;
  document.getElementById("toggleSingleFlightMode").checked = enableSingleFlightMode;
  document.getElementById("refresh-interval").textContent = REFRESH_INTERVAL_SECONDS / 60;

  // 手机端：点击把手/头部展开/收起
  const sidebar = document.getElementById("sidebar");
  const handle = document.getElementById("handle");
  handle.addEventListener("click", toggleSidebar);
  document.getElementById("sidebar-header").addEventListener("click", () => {
     if (window.innerWidth <= 768) toggleSidebar();
  });


  // 航班号开关
  document.getElementById("toggleFlightNo").addEventListener("change", (e) => {
    showFlightNo = e.target.checked;
    localStorage.setItem("showFlightNo", showFlightNo);
    renderFlights(false);
  });
  
  // 机场标签开关
  document.getElementById("toggleAirportLabel").addEventListener("change", (e) => {
    showAirportLabel = e.target.checked;
    localStorage.setItem("showAirportLabel", showAirportLabel);
    // 仅更新标签可见性，无需重绘所有航班
    for(let code in airportMarkers) {
      if(airportMarkers[code].label) {
        airportMarkers[code].label.setOpacity(showAirportLabel ? 1 : 0);
      }
    }
  });
  
  // URL单航班模式开关
  document.getElementById("toggleSingleFlightMode").addEventListener("change", (e) => {
    enableSingleFlightMode = e.target.checked;
    renderFlights(false);
  });
}

/**
 * 根据搜索框内容过滤航班
 */
function handleSearch() {
  const query = document.getElementById("flight-search").value.toUpperCase();
  if (query) {
    const foundFlight = flights.find(f => 
      f.flightNo.toUpperCase().includes(query) || 
      f.regNo.toUpperCase().includes(query) || 
      airportByName(query) // 搜索机场
    );

    if (foundFlight) {
        // 如果找到航班，构造一个临时的 URL 过滤
        const searchURL = `?flights_map=${foundFlight.prevNextFlight || foundFlight.flightNo}`;
        // 临时覆盖 getFlightIDFromURL 的行为
        const originalGetID = getFlightIDFromURL;
        getFlightIDFromURL = () => foundFlight.prevNextFlight || foundFlight.flightNo;
        
        renderFlights(false);
        // 恢复
        getFlightIDFromURL = originalGetID;
        return;
    }
  }
  // 清空搜索，回到全部显示或 URL 模式
  renderFlights(false);
}

/**
 * 更新屏幕内航班列表 (平板/PC)
 */
function updateVisibleFlightsList() {
    if (window.innerWidth <= 768) return; // 手机端不显示列表

    const bounds = map.getBounds();
    const flightListElement = document.getElementById("flight-list");
    const visibleFlights = [];

    for (let flightNo in markers) {
        const mk = markers[flightNo];
        if (bounds.contains(mk.getLatLng())) {
            visibleFlights.push(mk.flight);
        }
    }

    document.getElementById("flight-count").textContent = visibleFlights.length;
    flightListElement.innerHTML = visibleFlights.map(f => 
        `<li onclick="showInfoCard(markers['${f.flightNo}'].flight, markers['${f.flightNo}'].airportFrom, markers['${f.flightNo}'].airportTo, markers['${f.flightNo}'].ratio || 0)">${f.flightNo} (${f.dep}-${f.arr})</li>`
    ).join('');
}


// ============ 信息卡片逻辑 ============

/**
 * 显示航班信息卡片
 * @param {object} f - 航班对象
 * @param {object} depA - 出发机场
 * @param {object} arrA - 到达机场
 * @param {number} ratio - 飞行进度 (0-1)
 */
function showInfoCard(f, depA, arrA, ratio) {
  const card = document.getElementById("infoCard");
  
  // 状态
  let statusText = "已到达";
  let progressText = `${(ratio * 100).toFixed(1)}%`;
  
  const nowMin = getBeijingTimeMinutes();
  const pos = calculateFlightPosition(f, depA, arrA, nowMin);

  if (pos.status === "IN_FLIGHT") {
    statusText = "飞行中";
    progressText = `${(pos.ratio * 100).toFixed(1)}%`;
  } else if (pos.status === "PREPARING") {
    statusText = "准备中 (未起飞)";
    progressText = `0%`;
  } else if (pos.status === "ARRIVED") {
    statusText = "已到达";
    progressText = `100%`;
  } else if (pos.status === "NO_FLIGHT") {
    statusText = "当天无航班";
    progressText = `0%`;
  }

  // 飞行进度条
  const progressBarHTML = `
    <div class="progress-label">${statusText} - 进度: ${progressText}</div>
    <div class="progress-bar-container">
      <div class="progress-bar" style="width: ${pos.ratio * 100}%;"></div>
    </div>
  `;

  card.innerHTML = `
    <h3>${f.flightNo} - ${f.airline}</h3>
    <p><b>状态：</b>${statusText}</p>
    ${progressBarHTML}
    <p><b>出发：</b>${depA.name} (${f.depTime}${f.depCrossDay > 0 ? `+${f.depCrossDay}` : ''})</p>
    <p><b>到达：</b>${arrA.name} (${f.arrTime}${f.arrCrossDay > 0 ? `+${f.arrCrossDay}` : ''})</p>
    <p><b>机型：</b>${f.aircraft}</p>
    <p><b>注册号：</b>${f.regNo}</p>
    <p><b>前后序航程：</b>${f.prevNextFlight}</p>
  `;
  card.classList.remove("hidden");
  
  if (window.innerWidth <= 768) {
      document.getElementById("sidebar").classList.add("expanded");
      document.getElementById("handle").innerHTML = '&#x25BC;';
  }
}

/**
 * 显示机场信息卡片
 * @param {object} ap - 机场对象
 */
function showAirportCard(ap) {
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <h3>${ap.name} (${ap.code})</h3>
    <p><b>城市：</b>${ap.city || 'N/A'}</p>
    ${ap.level ? `<p><b>机场等级：</b>${ap.level}</p>` : ""}
    ${ap.runways ? `<p><b>跑道数量：</b>${ap.runways}</p>` : ""}
  `;
  card.classList.remove("hidden");
  
  if (window.innerWidth <= 768) {
      document.getElementById("sidebar").classList.add("expanded");
      document.getElementById("handle").innerHTML = '&#x25BC;';
  }
}

// ============ 启动 ============
loadData();
