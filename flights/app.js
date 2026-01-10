// ==========================================
// 1. 数据与状态管理
// ==========================================
const STATE = {
  flights: [],     // 原始航班数据
  airports: [],    // 机场数据
  airlines: [],    // 航司数据
  purchased: [],   // 已购票据
  settings: {
    notifications: false, // 默认关闭
    memory: true          // 默认开启输入记忆
  },
  cache: {
    selectingInput: null // 当前正在操作“按钮选择机场”的输入框ID
  }
};

const DATES = {
  weekMap: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
  getTodayStr: () => new Date().toISOString().split('T')[0],
  getWeekStr: (dateStr) => DATES.weekMap[new Date(dateStr).getDay()],
  // 比较两个 HH:MM
  isTimePast: (timeStr) => {
    const now = new Date();
    const [h, m] = timeStr.split(':').map(Number);
    const flightTime = h * 60 + m;
    const nowTime = now.getHours() * 60 + now.getMinutes();
    return nowTime > flightTime;
  }
};

// ==========================================
// 2. 初始化与核心加载
// ==========================================
async function initApp() {
  await Promise.all([loadAirports(), loadFlights(), loadAirlines()]);
  loadStorage();
  
  setupUI();
  setupNotifications();
  handleUrlRouting(); // 处理深层链接
  
  // 恢复输入记忆
  if (STATE.settings.memory) {
    const savedFrom = localStorage.getItem('last_search_from');
    const savedTo = localStorage.getItem('last_search_to');
    if (savedFrom) setStationInput('fromInput', savedFrom);
    if (savedTo) setStationInput('toInput', savedTo);
  }
}

async function loadAirports() {
  try {
    const res = await fetch('data/airports.json');
    STATE.airports = await res.json();
    populateDatalist();
  } catch(e) { console.error("机场数据加载失败", e); }
}

async function loadAirlines() {
  try {
    const res = await fetch('data/airlines.json');
    STATE.airlines = await res.json();
  } catch(e) {
    // 失败回退默认
    STATE.airlines = [{name: "默认", icon: "https://img.mcwfmtr.cc/i/2025/01/10/logo_default.png"}];
  }
}

async function loadFlights() {
  try {
    const res = await fetch('data/flight_data.txt');
    const text = await res.text();
    STATE.flights = parseFlightData(text);
    populateAirlineFilter();
  } catch(e) { console.error("航班数据加载失败", e); }
}

// 解析器 (保留原正则逻辑，增强机型/航司提取)
function parseFlightData(raw) {
  const entries = raw.split("《航班结束》").map(s => s.trim()).filter(Boolean);
  return entries.map(str => {
    try {
      const flightNo = str.match(/【(.*?)】/)?.[1] || "UNK";
      const weekdays = (str.match(/«(.*?)»/)?.[1] || "").split(",").map(s=>s.trim());
      const aircraft = str.match(/〔(.*?)〕/)?.[1] || "";
      const airline = str.match(/『(.*?)』/)?.[1] || "";
      const equipId = str.match(/<(R-.*?)>/)?.[1] || "";
      
      const depMatch = str.match(/《(.*?)出发》{(.*?)}#\+(\d+)#@(.*?)@/);
      const arrMatch = str.match(/《(.*?)到达》{(.*?)}#\+(\d+)#@(.*?)@/);
      
      if (!depMatch || !arrMatch) return null;

      const prices = {
        eco: parsePrice(str.match(/§(.*?)§/)?.[1]),
        bus: parsePrice(str.match(/θ(.*?)θ/)?.[1]),
        first: parsePrice(str.match(/△(.*?)△/)?.[1])
      };
      
      // 简单机型判断
      const isWide = /747|777|787|330|350|380|929/.test(aircraft);

      return {
        raw: str,
        flightNo, weekdays, aircraft, airline, equipmentId: equipId,
        isWide,
        origin: { name: depMatch[1], time: depMatch[2], term: depMatch[4] },
        dest: { name: arrMatch[1], time: arrMatch[2], term: arrMatch[4] },
        prices,
        duration: calculateDuration(depMatch[2], parseInt(depMatch[3]), arrMatch[2], parseInt(arrMatch[3]))
      };
    } catch (e) { return null; }
  }).filter(Boolean);
}

function parsePrice(s) { return s ? parseInt(s.replace(/\D/g, '')) : null; }
function calculateDuration(t1, d1, t2, d2) {
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  return (d2 * 24 * 60 + h2 * 60 + m2) - (d1 * 24 * 60 + h1 * 60 + m1);
}

// ==========================================
// 3. UI 交互逻辑
// ==========================================
function setupUI() {
  // 导航
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.target));
  });
  document.getElementById('navHomeBtn').addEventListener('click', () => {
    window.location.hash = '';
    switchTab('search');
  });

  // 搜索相关
  const dateInput = document.getElementById('searchDate');
  const today = DATES.getTodayStr();
  dateInput.value = today;
  dateInput.min = today;
  // 最大60天
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 60);
  dateInput.max = maxDate.toISOString().split('T')[0];
  
  dateInput.addEventListener('change', (e) => {
    document.getElementById('searchWeekBadge').textContent = DATES.getWeekStr(e.target.value);
  });

  // 机场输入逻辑 (自动匹配 Code)
  ['fromInput', 'toInput'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', (e) => updateInputVisuals(id, e.target.value));
    el.addEventListener('change', (e) => saveInputMemory(id, e.target.value));
  });

  // 交换按钮
  document.getElementById('swapBtn').addEventListener('click', () => {
    const f = document.getElementById('fromInput');
    const t = document.getElementById('toInput');
    const tempVal = f.value;
    setStationInput('fromInput', t.value);
    setStationInput('toInput', tempVal);
  });

  // 机场下拉弹窗逻辑
  document.getElementById('depDropdownBtn').addEventListener('click', () => openAirportSheet('fromInput'));
  document.getElementById('arrDropdownBtn').addEventListener('click', () => openAirportSheet('toInput'));

  document.getElementById('searchBtn').addEventListener('click', performSearch);
  
  // 弹窗关闭
  document.getElementById('closeTicketBtn').addEventListener('click', () => document.getElementById('ticketDialog').close());

  // 设置逻辑
  const nSwitch = document.getElementById('masterNotifySwitch');
  nSwitch.checked = STATE.settings.notifications;
  nSwitch.addEventListener('change', (e) => toggleNotifications(e.target.checked));

  const mSwitch = document.getElementById('memorySwitch');
  mSwitch.checked = STATE.settings.memory;
  mSwitch.addEventListener('change', (e) => {
    STATE.settings.memory = e.target.checked;
    saveStorage();
  });

  document.getElementById('clearDataBtn').addEventListener('click', () => {
    if(confirm("确定清除所有数据？")) {
      localStorage.clear();
      location.reload();
    }
  });

  // 初始渲染卡包
  renderWallet();
}

// 辅助：设置输入框并更新视觉
function setStationInput(id, cityName) {
  const el = document.getElementById(id);
  el.value = cityName;
  updateInputVisuals(id, cityName);
  saveInputMemory(id, cityName);
}

function updateInputVisuals(inputId, val) {
  // 查找匹配的机场对象
  const airport = STATE.airports.find(a => a.name === val || a.code === val || (a.aliases && a.aliases.includes(val)));
  const displayId = inputId === 'fromInput' ? 'depCodeDisplay' : 'arrCodeDisplay';
  const displayEl = document.getElementById(displayId);
  
  if (airport) {
    displayEl.textContent = airport.code;
    displayEl.style.color = 'var(--md-sys-color-primary)';
  } else {
    displayEl.textContent = "---";
    displayEl.style.color = 'var(--md-sys-color-outline)';
  }
}

function saveInputMemory(id, val) {
  if (!STATE.settings.memory) return;
  if (id === 'fromInput') localStorage.setItem('last_search_from', val);
  if (id === 'toInput') localStorage.setItem('last_search_to', val);
}

// 填充原生 datalist (用于文字输入联想)
function populateDatalist() {
  const dl = document.getElementById('airportDatalist');
  dl.innerHTML = '';
  STATE.airports.forEach(ap => {
    const opt = document.createElement('option');
    opt.value = ap.name;
    opt.label = ap.code; // 尝试显示 Code
    dl.appendChild(opt);
  });
}

// 填充下拉弹窗 (用于按钮点击选择)
function openAirportSheet(targetInputId) {
  STATE.cache.selectingInput = targetInputId;
  const list = document.getElementById('airportSelectionList');
  list.innerHTML = '';
  
  STATE.airports.forEach(ap => {
    const div = document.createElement('div');
    div.className = 'airport-item';
    div.innerHTML = `<span class="code">${ap.code}</span><span>${ap.name}</span>`;
    div.addEventListener('click', () => {
      setStationInput(targetInputId, ap.name);
      document.getElementById('airportSelectDialog').close();
    });
    list.appendChild(div);
  });
  
  document.getElementById('airportSelectDialog').showModal();
}

function populateAirlineFilter() {
  const select = document.getElementById('filterAirline');
  const airlines = [...new Set(STATE.flights.map(f => f.airline))];
  airlines.forEach(al => {
    const opt = document.createElement('option');
    opt.value = al;
    opt.textContent = al;
    select.appendChild(opt);
  });
}

// ==========================================
// 4. 搜索逻辑 (增强版)
// ==========================================
function performSearch() {
  const from = document.getElementById('fromInput').value.trim();
  const to = document.getElementById('toInput').value.trim();
  const dateStr = document.getElementById('searchDate').value;
  
  if (!from || !to) { showToast("请输入出发地和目的地"); return; }
  
  // 日期校验
  const today = DATES.getTodayStr();
  const isToday = dateStr === today;
  if (new Date(dateStr) < new Date(today)) {
    showToast("不能选择过去的日期"); return;
  }

  const weekStr = DATES.getWeekStr(dateStr);
  
  // 过滤器
  const fAirline = document.getElementById('filterAirline').value;
  const fTime = document.getElementById('filterTime').value; // morning, etc
  const fCabin = document.getElementById('filterCabin').value;
  const fPlane = document.getElementById('filterPlane').value; // wide, narrow

  const results = STATE.flights.filter(f => {
    // 基础匹配
    const matchRoute = (f.origin.name.includes(from) && f.dest.name.includes(to));
    const matchDay = f.weekdays.includes(weekStr);
    
    // 时间逻辑：如果是今天，不能搜已经起飞的
    let matchLive = true;
    if (isToday) {
       matchLive = !DATES.isTimePast(f.origin.time);
    }

    // 高级筛选
    const matchAl = fAirline ? f.airline === fAirline : true;
    const matchPl = fPlane ? (fPlane === 'wide' ? f.isWide : !f.isWide) : true;
    const matchCb = fCabin ? (f.prices[fCabin] !== null) : true;
    
    let matchTi = true;
    if (fTime) {
      const h = parseInt(f.origin.time.split(':')[0]);
      if (fTime === 'morning') matchTi = (h >= 6 && h < 12);
      if (fTime === 'afternoon') matchTi = (h >= 12 && h < 18);
      if (fTime === 'evening') matchTi = (h >= 18 && h <= 23);
      if (fTime === 'night') matchTi = (h >= 0 && h < 6);
    }

    return matchRoute && matchDay && matchLive && matchAl && matchPl && matchCb && matchTi;
  });

  renderResults(results, dateStr);
}

function getAirlineLogo(name) {
  const al = STATE.airlines.find(a => a.name === name) || STATE.airlines.find(a => a.name === "默认");
  return al ? al.icon : '';
}

function renderResults(list, dateStr) {
  const grid = document.getElementById('flightGrid');
  grid.innerHTML = '';

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded" style="font-size:48px;color:#ccc">search_off</span><p>暂无符合条件的航班</p></div>`;
    return;
  }

  list.forEach(f => {
    const card = document.createElement('div');
    card.className = 'flight-card';
    const minPrice = Math.min(...[f.prices.eco, f.prices.bus, f.prices.first].filter(p => p !== null));
    
    card.innerHTML = `
      <div class="fc-header">
        <div class="airline-badge">
          <img src="${getAirlineLogo(f.airline)}" alt="logo">
          <span>${f.airline} · ${f.flightNo}</span>
        </div>
        <span>${dateStr}</span>
      </div>
      <div class="fc-body">
        <div class="fc-port">
          <div class="fc-time">${f.origin.time}</div>
          <div class="fc-port-code">${f.origin.name}</div>
        </div>
        <div class="fc-arrow">
          <span class="material-symbols-rounded">trending_flat</span>
        </div>
        <div class="fc-port">
          <div class="fc-time">${f.dest.time}</div>
          <div class="fc-port-code">${f.dest.name}</div>
        </div>
      </div>
      <div class="fc-footer">
        <span class="plane-tag">${f.aircraft} ${f.isWide ? '宽体' : ''}</span>
        <span class="price-tag">¥${minPrice} 起</span>
      </div>
    `;
    card.addEventListener('click', () => openTicketDialog(f, dateStr));
    grid.appendChild(card);
  });
}

// ==========================================
// 5. 购票与详情 (Dialog)
// ==========================================
function openTicketDialog(flight, dateStr, existingTicket = null) {
  const dialog = document.getElementById('ticketDialog');
  const isPurchased = !!existingTicket;
  
  // 填充头部信息
  document.getElementById('modalDepCode').textContent = getStateCode(flight.origin.name);
  document.getElementById('modalArrCode').textContent = getStateCode(flight.dest.name);
  document.getElementById('modalDepTime').textContent = flight.origin.time;
  document.getElementById('modalArrTime').textContent = flight.dest.time;
  document.getElementById('modalDepName').textContent = flight.origin.name;
  document.getElementById('modalArrName').textContent = flight.dest.name;
  document.getElementById('modalDepTerm').textContent = flight.origin.term;
  document.getElementById('modalArrTerm').textContent = flight.dest.term;
  document.getElementById('modalAirline').textContent = flight.airline;
  document.getElementById('modalAircraft').textContent = flight.aircraft;
  document.getElementById('modalDate').textContent = dateStr;
  
  const durMins = flight.duration;
  document.getElementById('modalDuration').textContent = `${Math.floor(durMins/60)}h ${durMins%60}m`;

  const bpArea = document.getElementById('boardingPassArea');
  const bookArea = document.getElementById('bookingArea');
  const footer = document.getElementById('bookingFooter');

  if (isPurchased) {
    // === 已购票模式 ===
    bpArea.hidden = false;
    bookArea.hidden = true;
    footer.style.display = 'none';

    // 设置登机牌
    document.getElementById('bpAirlineLogo').src = getAirlineLogo(flight.airline);
    document.getElementById('bpFlightNoDisplay').textContent = flight.flightNo;
    // 生成二维码 (使用第三方API简化)
    const qrData = `TICKET:${existingTicket.id}|FLIGHT:${flight.flightNo}`;
    document.getElementById('bpQrCode').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`;
    
    // Tracker 逻辑: 如果正在飞行(当前时间在起飞和到达之间)，按照Prompt要求 **不显示** 按钮
    // "如果这个航班正在处于这个飞行时间中...就不显示这个按钮"
    // 注意日期：需要判断日期是否是今天，且时间是否在范围内
    const now = new Date();
    const isToday = (dateStr === DATES.getTodayStr());
    
    // 将 HH:MM 转为分钟数
    const getMins = (t) => { const[h,m]=t.split(':').map(Number); return h*60+m; };
    const depMins = getMins(flight.origin.time);
    const arrMins = getMins(flight.dest.time); // 这里简单处理，未考虑跨天
    const curMins = now.getHours()*60 + now.getMinutes();
    
    const isFlyingNow = isToday && (curMins >= depMins && curMins <= arrMins);
    
    const trackerBtn = document.getElementById('bpTrackerBtn');
    if (isFlyingNow) {
      trackerBtn.style.display = 'none'; // 飞行中不显示 (按你的Prompt 4)
    } else {
      trackerBtn.style.display = 'inline-flex';
      trackerBtn.href = `https://haojin.guanmu233.cn/flights_map=?${flight.flightNo}`;
    }

    // 删除按钮
    document.getElementById('deleteTicketBtn').onclick = () => {
      if(confirm('确认删除此行程记录？')) {
        STATE.purchased = STATE.purchased.filter(t => t.id !== existingTicket.id);
        saveStorage();
        renderWallet();
        dialog.close();
        switchTab('wallet');
      }
    };

  } else {
    // === 购票模式 ===
    bpArea.hidden = true;
    bookArea.hidden = false;
    footer.style.display = 'flex';
    document.getElementById('totalPrice').textContent = '--';
    document.getElementById('confirmBuyBtn').disabled = true;

    // 渲染舱位
    const seatGrid = document.getElementById('seatOptions');
    seatGrid.innerHTML = '';
    const classes = [
      {k:'eco', n:'经济舱', p: flight.prices.eco},
      {k:'bus', n:'商务舱', p: flight.prices.bus},
      {k:'first', n:'头等舱', p: flight.prices.first}
    ];

    let selectedClass = null;

    classes.forEach(c => {
      if(!c.p) return;
      const el = document.createElement('div');
      el.className = 'seat-option-card';
      el.innerHTML = `<span>${c.n}</span><span>¥${c.p}</span>`;
      el.addEventListener('click', () => {
        document.querySelectorAll('.seat-option-card').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        selectedClass = c;
        document.getElementById('totalPrice').textContent = `¥${c.p}`;
        document.getElementById('confirmBuyBtn').disabled = false;
      });
      seatGrid.appendChild(el);
    });

    document.getElementById('confirmBuyBtn').onclick = () => {
      const ticket = {
        id: Date.now().toString(36),
        flightData: flight, // 保存完整快照
        dateStr: dateStr,
        classInfo: selectedClass,
        timestamp: new Date(`${dateStr}T${flight.origin.time}`).getTime()
      };
      STATE.purchased.push(ticket);
      saveStorage();
      showToast("出票成功！已存入卡包");
      dialog.close();
      renderWallet(); // 刷新卡包
      switchTab('wallet');
      // 触发购买通知
      if(STATE.settings.notifications) sendNotif("出票成功", `您已成功预订 ${flight.airline} ${flight.flightNo}`);
    };
  }

  dialog.showModal();
}

function getStateCode(cityName) {
  const ap = STATE.airports.find(a => a.name === cityName);
  return ap ? ap.code : '???';
}

// ==========================================
// 6. 卡包 (Wallet) & 通知核心
// ==========================================
function renderWallet() {
  const grid = document.getElementById('walletGrid');
  grid.innerHTML = '';
  
  // 按时间排序
  const list = STATE.purchased.sort((a,b) => a.timestamp - b.timestamp);

  if(list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded icon-big">wallet</span><p>暂无行程，快去预订吧</p></div>`;
    return;
  }

  list.forEach(t => {
    const f = t.flightData;
    const isPast = t.timestamp < Date.now();
    
    const card = document.createElement('div');
    card.className = 'flight-card';
    if(isPast) card.style.opacity = '0.6';
    
    card.innerHTML = `
      <div class="fc-header">
        <div class="airline-badge">
          <img src="${getAirlineLogo(f.airline)}" alt="logo">
          <span>${t.dateStr}</span>
        </div>
        <span style="color:${isPast ? 'gray' : 'green'}">${isPast ? '已结束' : '待出行'}</span>
      </div>
      <div class="fc-body">
         <div class="fc-port">
           <div class="fc-time">${f.origin.time}</div>
           <div class="fc-port-code">${f.origin.name}</div>
         </div>
         <div class="fc-arrow"><span class="material-symbols-rounded">flight</span></div>
         <div class="fc-port">
           <div class="fc-time">${f.dest.time}</div>
           <div class="fc-port-code">${f.dest.name}</div>
         </div>
      </div>
      <div class="fc-footer">
        <span>${t.classInfo.n}</span>
        <button class="btn-tonal-small" style="background:transparent;border:1px solid #ddd">查看电子票</button>
      </div>
    `;
    // 点击查看详情/登机牌
    card.addEventListener('click', () => {
      // 更新 URL Hash 方便分享
      window.location.hash = `ticket=${t.id}`;
      openTicketDialog(f, t.dateStr, t);
    });
    grid.appendChild(card);
  });
}

// 通知轮询逻辑
function setupNotifications() {
  // 每分钟检查一次
  setInterval(() => {
    if (!STATE.settings.notifications) return;
    
    const now = Date.now();
    STATE.purchased.forEach(t => {
      if (t.timestamp < now) return; // 已过期不处理
      
      const diffMins = Math.floor((t.timestamp - now) / 60000);
      const f = t.flightData;
      const key = `notif_${t.id}_`; // 避免重复通知的key前缀

      // 值机提醒 (-120m)
      if (diffMins <= 120 && diffMins > 118 && !hasNotified(key+'checkin')) {
        sendNotif("值机提醒", `航班 ${f.flightNo} 将在2小时后起飞，请及时值机。`);
        markNotified(key+'checkin');
      }
      
      // 登机提醒 (-30m)
      if (diffMins <= 30 && diffMins > 28 && !hasNotified(key+'boarding')) {
        sendNotif("登机提醒", `航班 ${f.flightNo} 正在登机，请前往 ${f.origin.term}。`);
        markNotified(key+'boarding');
      }
      
      // 起飞提醒 (0m)
      if (diffMins <= 1 && diffMins > -1 && !hasNotified(key+'takeoff')) {
        sendNotif("起飞提醒", `航班 ${f.flightNo} 正在起飞。旅途愉快！`);
        markNotified(key+'takeoff');
      }
    });
  }, 60000); // 60秒轮询
}

function hasNotified(key) { return sessionStorage.getItem(key) === '1'; }
function markNotified(key) { sessionStorage.setItem(key, '1'); }

function toggleNotifications(enable) {
  STATE.settings.notifications = enable;
  saveStorage();
  if(enable && Notification.permission !== 'granted') {
    Notification.requestPermission();
  }
}

function sendNotif(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'https://img.mcwfmtr.cc/i/2025/07/18/5gkzqx.png' });
  } else {
    showToast(`${title}: ${body}`); // 降级为 Toast
  }
}

// ==========================================
// 7. 工具与路由
// ==========================================
function switchTab(tab) {
  // UI 更新
  document.querySelectorAll('.nav-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.target === tab);
  });
  document.querySelectorAll('.view-section').forEach(v => {
    v.classList.remove('active');
  });
  document.getElementById(`view-${tab}`).classList.add('active');
  
  // TopBar 状态
  const homeBtn = document.getElementById('navHomeBtn');
  homeBtn.hidden = (tab === 'search');
  
  if (tab === 'wallet') renderWallet();
}

function handleUrlRouting() {
  const hash = window.location.hash;
  if (hash.startsWith('#ticket=')) {
    const tid = hash.split('=')[1];
    const ticket = STATE.purchased.find(t => t.id === tid);
    if (ticket) {
      switchTab('wallet');
      openTicketDialog(ticket.flightData, ticket.dateStr, ticket);
    }
  }
}

function loadStorage() {
  const t = localStorage.getItem('starflight_tickets');
  if(t) STATE.purchased = JSON.parse(t);
  const s = localStorage.getItem('starflight_settings');
  if(s) STATE.settings = JSON.parse(s);
}

function saveStorage() {
  localStorage.setItem('starflight_tickets', JSON.stringify(STATE.purchased));
  localStorage.setItem('starflight_settings', JSON.stringify(STATE.settings));
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// 启动
initApp();
