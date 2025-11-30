// ================== 全局配置 ==================
const AIRPORTS_PATH = "../data/airports.json";
const FLIGHT_DATA_PATH = "../data/flight_data.txt";

// 自动刷新间隔（秒） — 可在设置中更改并保存
let refreshIntervalSec = Number(localStorage.getItem("refreshIntervalSec") || 180);

// 本地状态（从设置读取 / 保存）
let settings = {
  showAirportName: JSON.parse(localStorage.getItem("showAirportName") || "true"),
  showAirportCode: JSON.parse(localStorage.getItem("showAirportCode") || "true"),
  showFlightNo: JSON.parse(localStorage.getItem("showFlightNo") || "false"),
  hideOtherWhenFilter: JSON.parse(localStorage.getItem("hideOtherWhenFilter") || "false"),
  showPlaneIcon: JSON.parse(localStorage.getItem("showPlaneIcon") || "true"),
};

// 地图与图层
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 }).addTo(map);

let airportDB = {};
let flights = [];
let airportMarkers = {};
let flightMarkers = {};
let flightLines = {};
let highlightedKey = null;

const PLANE_IMG = "https://i.imgur.com/4bZtV3y.png"; // 机头向上（北）

// ============== 核心时间工具函数 (绝对时间戳版) ==============

// 1. 将 "HH:MM" 转为当天的分钟数 (0-1439)
function timeStrToMinutes(t) {
  if (!t) return null;
  const parts = t.split(":").map(s => s.trim());
  if (parts.length < 2) return null;
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

// 2. 获取北京时间当前时刻的绝对时间戳 (分钟级，自 1970年 epoch 以来)
function getNowBeijingAbsMinutes() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const bj = new Date(utc + 8 * 3600 * 1000); // 转为北京时间 Date 对象
  return Math.floor(bj.getTime() / 60000);
}

// 3. 获取北京时间“今天”午夜 00:00 的绝对时间戳 (分钟级)
function getBeijingTodayMidnightAbs() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const bj = new Date(utc + 8 * 3600 * 1000);
  bj.setHours(0, 0, 0, 0); // 设置为今天 0点
  return Math.floor(bj.getTime() / 60000);
}

// 4. 计算航班的关键时间点（起飞、到达）的绝对分钟数
// offsetDays: 0=今天, 1=明天, -1=昨天
function getFlightAbsTime(timeStr, offsetDays) {
  const minOfDay = timeStrToMinutes(timeStr);
  if (minOfDay === null) return null;
  const midnight = getBeijingTodayMidnightAbs();
  return midnight + minOfDay + (Number(offsetDays || 0) * 24 * 60);
}

// 格式化日期显示用
function formatDateOffset(offsetDays) {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const base = new Date(utc + 8 * 3600 * 1000);
  base.setDate(base.getDate() + Number(offsetDays || 0));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 计算方位角
function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  let θ = toDeg(Math.atan2(y, x));
  return (θ + 360 + 90) % 360; // +90 修正图片方向
}

// ============== 解析与数据处理 ==============
function getFlightIDFromURL() {
  const urlParams = new URLSearchParams(location.search);
  const v = urlParams.get("flights_map");
  if (!v || v === "0") return "ALL";
  return v;
}

function parseFlightData(raw) {
  const entries = [];
  const parts = raw.split("《航班结束》");
  for (let block of parts) {
    block = block.trim();
    if (!block) continue;
    
    // 基础正则提取
    const getVal = (reg) => { const m = block.match(reg); return m ? m[1].trim() : ""; };
    
    const flightNo = getVal(/【\s*([^\]　]+)\s*】/);
    const planeType = getVal(/〔\s*([^\]　]+)\s*〕/);
    const airline = getVal(/『\s*([^』]+)\s*』/);
    const reg = getVal(/<\s*([^>]+)\s*>/);
    
    // 提取出发
    const depMatch = block.match(/《\s*([^》]+?)出发\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const depName = depMatch ? depMatch[1].trim() : "";
    const depTimeRaw = depMatch ? depMatch[2].trim() : "";
    const depOffset = depMatch && depMatch[3] ? Number(depMatch[3].replace(/[^\d]/g,"")) : 0;
    
    // 提取到达
    const arrMatch = block.match(/《\s*([^》]+?)到达\s*》\s*\{([^}]+)\}\s*(\#\+\d+\#)?/i);
    const arrName = arrMatch ? arrMatch[1].trim() : "";
    const arrTimeRaw = arrMatch ? arrMatch[2].trim() : "";
    const arrOffset = arrMatch && arrMatch[3] ? Number(arrMatch[3].replace(/[^\d]/g,"")) : 0;

    entries.push({
      flightNo, planeType, airline, reg,
      dep: depName, depTimeRaw, depOffset,
      arr: arrName, arrTimeRaw, arrOffset,
      raw: block
    });
  }
  return entries;
}

function airportByName(nameOrCode) {
  if (!nameOrCode) return null;
  const key = String(nameOrCode).trim().toLowerCase();
  // 先精确匹配 code
  if (airportDB[key.toUpperCase()]) return airportDB[key.toUpperCase()];
  
  for (let code in airportDB) {
    const a = airportDB[code];
    const nm = (a.name || "").toLowerCase();
    const city = (a.city || "").toLowerCase();
    const aliases = (a.aliases || []).map(x => x.toLowerCase());
    if (a.code.toLowerCase() === key) return a;
    if (nm === key || city === key || aliases.includes(key)) return a;
    if (nm.includes(key) || city.includes(key)) return a;
  }
  return null;
}

// ============== 渲染核心逻辑 ==============

function keyForFlight(flight) {
  // 唯一键值，确保同一航班多次刷新能对应上
  return (flight.reg || flight.flightNo) + "|" + flight.depTimeRaw + "|" + flight.arrTimeRaw;
}

// 强制移除图层工具
function removeFlightLayers(idKey) {
  if (flightLines[idKey]) {
    try { map.removeLayer(flightLines[idKey]); } catch (e) {}
    delete flightLines[idKey];
  }
  if (flightMarkers[idKey]) {
    try { map.removeLayer(flightMarkers[idKey]); } catch (e) {}
    delete flightMarkers[idKey];
  }
  if (highlightedKey === idKey) highlightedKey = null;
}

// 渲染单个航班（核心修改处）
function renderFlight(flight) {
  const idKey = keyForFlight(flight);

  // 1. 获取机场坐标
  const depA = airportByName(flight.dep);
  const arrA = airportByName(flight.arr);
  if (!depA || !arrA || !depA.lat || !arrA.lat) {
    removeFlightLayers(idKey);
    return;
  }

  // 2. 计算绝对时间（分钟）
  const nowAbs = getNowBeijingAbsMinutes();
  const depAbs = getFlightAbsTime(flight.depTimeRaw, flight.depOffset);
  const arrAbs = getFlightAbsTime(flight.arrTimeRaw, flight.arrOffset);

  // 3. 【绝对判定】如果在时间范围外，直接移除！
  // 判定条件：当前时间 < 起飞时间  或者  当前时间 > 到达时间
  if (depAbs === null || arrAbs === null || nowAbs < depAbs || nowAbs > arrAbs) {
    removeFlightLayers(idKey); 
    // 直接返回，不再执行后续画图代码
    return; 
  }

  // 4. 计算进度 (仅用于定位插值)
  // 既然已经通过了上面的判定，说明 depAbs <= nowAbs <= arrAbs
  let progress = 0;
  if (arrAbs > depAbs) {
    progress = (nowAbs - depAbs) / (arrAbs - depAbs);
  }
  // 双重保险：强制限制在 0-1 之间
  progress = Math.max(0, Math.min(1, progress));

  // 5. 绘制/更新航线
  const depLat = depA.lat, depLng = depA.lon || depA.lng;
  const arrLat = arrA.lat, arrLng = arrA.lon || arrA.lng;

  if (!flightLines[idKey]) {
    const line = L.polyline([[depLat, depLng], [arrLat, arrLng]], {
      color: "var(--orange)", weight: 2, dashArray: "6 6"
    }).addTo(map);
    line.on("click", () => onFlightClicked(idKey, flight));
    flightLines[idKey] = line;
  } else {
    flightLines[idKey].setLatLngs([[depLat, depLng], [arrLat, arrLng]]);
    if (highlightedKey !== idKey) {
       flightLines[idKey].setStyle({ color: "var(--orange)", dashArray: "6 6", weight: 2 });
    }
  }

  // 6. 绘制/更新飞机图标
  if (settings.showPlaneIcon) {
    // 线性插值计算当前坐标
    const curLat = depLat + (arrLat - depLat) * progress;
    const curLng = depLng + (arrLng - depLng) * progress;
    const angle = bearingBetween(depLat, depLng, arrLat, arrLng);

    const planeHtml = `<div style="transform: rotate(${angle}deg);"><img class="plane-icon" src="${PLANE_IMG}" /></div>`;
    const icon = L.divIcon({ html: planeHtml, className: "plane-divicon", iconSize: [36, 36], iconAnchor: [18, 18] });

    if (!flightMarkers[idKey]) {
      const mk = L.marker([curLat, curLng], { icon: icon, zIndexOffset: 1000 }).addTo(map);
      mk.on("click", () => onFlightClicked(idKey, flight));
      flightMarkers[idKey] = mk;
    } else {
      flightMarkers[idKey].setLatLng([curLat, curLng]);
      flightMarkers[idKey].setIcon(icon);
    }
    
    // 标签
    if (settings.showFlightNo) {
      flightMarkers[idKey].bindTooltip(flight.flightNo || flight.reg || "", {permanent:true, direction:"right", className:"flight-label"});
    } else {
      flightMarkers[idKey].unbindTooltip();
    }
  } else {
    // 设置里关掉了飞机图标，但还在飞，所以只留线，删图标
    if (flightMarkers[idKey]) {
       map.removeLayer(flightMarkers[idKey]);
       delete flightMarkers[idKey];
    }
  }
}

// ============== 交互与UI ==============
function onFlightClicked(key, flight) {
  if (highlightedKey && flightLines[highlightedKey]) {
    flightLines[highlightedKey].setStyle({ color: "var(--orange)", dashArray: "6 6", weight: 2 });
  }
  highlightedKey = key;
  if (flightLines[key]) {
    flightLines[key].setStyle({ color: "var(--accent)", dashArray: "6 6", weight: 3 });
  }
  const depA = airportByName(flight.dep);
  const arrA = airportByName(flight.arr);
  showInfoCard(flight, depA, arrA);
}

function showInfoCard(f, depA, arrA) {
  const card = document.getElementById("infoCard");
  
  // 重新计算进度显示
  const nowAbs = getNowBeijingAbsMinutes();
  const depAbs = getFlightAbsTime(f.depTimeRaw, f.depOffset);
  const arrAbs = getFlightAbsTime(f.arrTimeRaw, f.arrOffset);
  let percent = 0;
  if (depAbs && arrAbs && arrAbs > depAbs) {
      percent = (nowAbs - depAbs) / (arrAbs - depAbs);
  }
  const percentDisp = Math.round(Math.max(0, Math.min(1, percent)) * 100);

  const depDateStr = formatDateOffset(f.depOffset);
  const arrDateStr = formatDateOffset(f.arrOffset);

  // 上一程下一程逻辑
  let prevHtml = "", nextHtml = "";
  if (f.reg) {
    const same = flights.filter(x => x.reg === f.reg);
    // 简单按出发时间排序
    same.sort((a,b) => getFlightAbsTime(a.depTimeRaw, a.depOffset) - getFlightAbsTime(b.depTimeRaw, b.depOffset));
    const idx = same.findIndex(x => x.raw === f.raw);
    if (idx > 0) prevHtml = `<button id="cardPrev" class="btn ghost">上一程</button>`;
    if (idx >= 0 && idx < same.length - 1) nextHtml = `<button id="cardNext" class="btn ghost">下一程</button>`;
  }

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div style="flex:1">
        <h3 style="margin:0">${f.flightNo || "-"}</h3>
        <div style="font-size:12px;color:rgba(0,0,0,0.6);margin-top:4px">${f.airline||""} · ${f.planeType||""}</div>
        <div style="margin-top:8px;font-size:13px"><b>注册号：</b> ${f.reg?f.reg:'—'}</div>
      </div>
      <div style="text-align:right;font-size:12px;min-width:140px">
        <div style="font-weight:700">${depA?depA.name:f.dep} → ${arrA?arrA.name:f.arr}</div>
        <div style="font-size:12px;color:rgba(0,0,0,0.6)">${f.depTimeRaw} <span style="font-size:11px;opacity:0.6">${depDateStr}</span></div>
        <div style="font-size:12px;color:rgba(0,0,0,0.6);margin-top:4px">${f.arrTimeRaw} <span style="font-size:11px;opacity:0.6">${arrDateStr}</span></div>
      </div>
    </div>
    <div style="margin-top:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px"><span>进度</span><span>${percentDisp}%</span></div>
      <div class="progressWrap"><div class="progressBar" style="width:${percentDisp}%"></div></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      ${prevHtml} ${nextHtml}
      <button id="cardClose" class="btn primary">关闭</button>
    </div>
  `;
  card.classList.remove("hidden");
  
  document.getElementById("cardClose").onclick = () => card.classList.add("hidden");
  
  // 绑定按钮事件
  const bindNav = (id, offset) => {
      const btn = document.getElementById(id);
      if(btn) btn.onclick = () => {
        const same = flights.filter(x => x.reg === f.reg).sort((a,b) => getFlightAbsTime(a.depTimeRaw, a.depOffset) - getFlightAbsTime(b.depTimeRaw, b.depOffset));
        const idx = same.findIndex(x => x.raw === f.raw);
        const target = same[idx + offset];
        if(target) onFlightClicked(keyForFlight(target), target);
      }
  };
  bindNav("cardPrev", -1);
  bindNav("cardNext", 1);
}

function showAirportCard(ap) {
  const card = document.getElementById("infoCard");
  const aliases = (ap.aliases && ap.aliases.length) ? `<p><b>别名：</b>${ap.aliases.join(' / ')}</p>` : '';
  card.innerHTML = `
    <h3 style="margin:0">${ap.name || ""} (${ap.code || ""})</h3>
    ${aliases}
    ${ap.level?`<p><b>机场等级：</b>${ap.level}</p>` : ''}
    ${ap.runways?`<p><b>跑道数量：</b>${ap.runways}</p>` : ''}
    <div style="display:flex;justify-content:flex-end;margin-top:8px"><button id="cardCloseAp" class="btn primary">关闭</button></div>
  `;
  card.classList.remove("hidden");
  document.getElementById("cardCloseAp").onclick = ()=> card.classList.add("hidden");
}

// ============== 主循环 ==============
function renderFlights() {
  // 1. 先渲染机场
  renderAllAirports();
  
  // 2. 清理失效的航班图层 (重要：每次全量检测，不依赖 clearFlightLayers)
  // 我们不再暴力清空所有，而是智能更新，但为了保险，先全清空也行
  // 考虑到性能，我们保留 "清除所有 -> 重画有效" 的逻辑，确保“消失”的飞机立即消失
  for (let k in flightLines) map.removeLayer(flightLines[k]);
  for (let k in flightMarkers) map.removeLayer(flightMarkers[k]);
  flightLines = {};
  flightMarkers = {};
  highlightedKey = null;

  const urlId = getFlightIDFromURL();
  const filterKey = (urlId && urlId !== "ALL") ? String(urlId).toLowerCase() : null;

  flights.forEach(f => {
    // 过滤逻辑
    let matches = true;
    if (filterKey) {
       matches = (f.flightNo||"").toLowerCase().includes(filterKey) || (f.reg||"").toLowerCase().includes(filterKey);
    }
    if (settings.hideOtherWhenFilter && filterKey && !matches) return;

    // 渲染 (内部包含时间判断，不在时间范围会自动跳过)
    renderFlight(f);
  });
  
  // 如果有过滤，自动聚焦
  if (filterKey) {
     const group = [];
     for(let k in flightLines) group.push(flightLines[k]);
     if(group.length) {
         const feat = L.featureGroup(group);
         map.fitBounds(feat.getBounds().pad(0.2));
     }
  }
}

// ============== 初始化与加载 ==============
async function loadData() {
  try {
    const r1 = await fetch(AIRPORTS_PATH);
    const d1 = await r1.json();
    airportDB = {};
    // 兼容数组或对象格式
    if (Array.isArray(d1)) d1.forEach(a => { if(a.code) airportDB[a.code] = a; });
    else airportDB = d1;
  } catch(e) { console.error(e); }

  try {
    const r2 = await fetch(FLIGHT_DATA_PATH);
    const t2 = await r2.text();
    flights = parseFlightData(t2);
  } catch(e) { console.error(e); }

  renderFlights();
}

function initUI() {
  // 绑定设置开关
  const bindSw = (id, key, cb) => {
      const el = document.getElementById(id);
      if(!el) return;
      el.checked = settings[key];
      el.onchange = () => {
          settings[key] = el.checked;
          localStorage.setItem(key, JSON.stringify(settings[key]));
          if(cb) cb(); else renderFlights();
      };
  };

  bindSw("sw_showAirportName", "showAirportName", renderAllAirports);
  bindSw("sw_showAirportCode", "showAirportCode", renderAllAirports);
  bindSw("sw_showFlightNo", "showFlightNo"); // 触发 renderFlights
  bindSw("sw_showPlaneIcon", "showPlaneIcon");
  bindSw("sw_hideOtherWhenFilter", "hideOtherWhenFilter");

  // 顶部快捷开关
  const topSw = document.getElementById("toggleFlightNo");
  if(topSw) {
      topSw.checked = settings.showFlightNo;
      topSw.onchange = () => {
          settings.showFlightNo = topSw.checked;
          localStorage.setItem("showFlightNo", JSON.stringify(settings.showFlightNo));
          const pSw = document.getElementById("sw_showFlightNo");
          if(pSw) pSw.checked = settings.showFlightNo;
          renderFlights();
      };
  }

  // 搜索
  const doSearch = () => {
      const v = document.getElementById("searchInput").value.trim();
      const u = new URLSearchParams(location.search);
      if(v) u.set("flights_map", v); else u.delete("flights_map");
      history.replaceState(null,"", location.pathname + "?" + u.toString());
      renderFlights();
  };
  document.getElementById("searchBtn").onclick = doSearch;
  document.getElementById("searchInput").onkeydown = (e) => { if(e.key==="Enter") doSearch(); };
  document.getElementById("clearBtn").onclick = () => {
      document.getElementById("searchInput").value = "";
      doSearch();
  };

  // 设置面板显隐
  document.getElementById("settingsBtn").onclick = () => document.getElementById("settingsPanel").classList.toggle("hidden");
  document.getElementById("settingsClose").onclick = () => document.getElementById("settingsPanel").classList.add("hidden");

  // 刷新间隔
  const refInp = document.getElementById("input_refreshInterval");
  if(refInp) {
      refInp.value = refreshIntervalSec;
      refInp.onchange = () => {
          refreshIntervalSec = Number(refInp.value)||180;
          localStorage.setItem("refreshIntervalSec", refreshIntervalSec);
          restartAutoRefresh();
      };
  }
  
  // 点击地图关闭卡片
  map.on("click", (e) => {
      // 简单防止点击marker时同时也触发map click
      if(e.originalEvent.target.classList.contains("leaflet-container")) {
          document.getElementById("infoCard").classList.add("hidden");
      }
  });
}

let timer = null;
function restartAutoRefresh() {
    if(timer) clearInterval(timer);
    timer = setInterval(loadData, refreshIntervalSec * 1000);
}

// 启动
(async function(){
    initUI();
    await loadData();
    restartAutoRefresh();
    // 30秒更新一次位置（不请求数据）
    setInterval(renderFlights, 30000);
})();
