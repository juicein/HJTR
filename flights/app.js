/* =========================================
   Config & State
   ========================================= */
const STATE = {
  flights: [],
  airports: [], // Array of {name, code, ...}
  purchased: JSON.parse(localStorage.getItem('starflight_tickets') || '[]'),
  settings: JSON.parse(localStorage.getItem('starflight_settings') || '{"notifications":true, "memory":true}'),
  lastSearch: JSON.parse(localStorage.getItem('starflight_last_search') || '{}')
};

// 工具函数
const DATES = {
  today: () => new Date(),
  fmtYMD: (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2,'0');
    const da = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  },
  // 增加分钟
  addMin: (date, min) => new Date(date.getTime() + min * 60000),
  // 将 "HH:MM" 转为今日的具体 Date 对象 (需结合具体日期字符串)
  parseDateTime: (dateStr, timeStr, dayOffset = 0) => {
    // dateStr: YYYY-MM-DD, timeStr: HH:MM
    const d = new Date(`${dateStr}T${timeStr}:00`);
    if (dayOffset > 0) d.setDate(d.getDate() + dayOffset);
    return d;
  }
};

/* =========================================
   1. Initialization & Router
   ========================================= */

async function initApp() {
  await loadData();
  setupUI();
  setupRouter();
  
  // 恢复记忆的输入
  if (STATE.settings.memory && STATE.lastSearch.from) {
    document.getElementById('fromInput').value = STATE.lastSearch.from;
    document.getElementById('toInput').value = STATE.lastSearch.to;
    updateCodeDisplay('from', STATE.lastSearch.from);
    updateCodeDisplay('to', STATE.lastSearch.to);
  }
  
  // 检查通知权限
  if (STATE.settings.notifications && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  
  // 启动全局通知调度
  scheduleAllNotifications();
}

// 简单的 Hash 路由
function setupRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute(); // 初始加载
}

function handleRoute() {
  const hash = window.location.hash.slice(1) || 'search';
  
  // 隐藏所有视图
  document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  
  // 激活当前视图
  const activeView = document.getElementById(`view-${hash}`);
  if (activeView) activeView.classList.add('active');
  
  // 激活导航状态
  const activeNav = document.getElementById(`nav-${hash}`);
  if (activeNav) activeNav.classList.add('active');

  // 更新标题
  const titles = { 'search': '航班预订', 'wallet': '我的卡包', 'settings': '系统设置', 'heat': '航线热度' };
  document.getElementById('pageTitle').textContent = titles[hash] || '星际航行';

  // 特殊处理
  if (hash === 'heat') {
    window.location.href = '../flights/dgree.html';
    return;
  }
  if (hash === 'wallet') renderWallet();
}

function navigateTo(page) {
  window.location.hash = page;
}

/* =========================================
   2. Data Loading & Parsing
   ========================================= */

async function loadData() {
  try {
    const [airRes, fltRes] = await Promise.all([
      fetch('../data/airports.json'),
      fetch('../data/flight_data.txt')
    ]);
    
    STATE.airports = await airRes.json();
    const rawTxt = await fltRes.text();
    STATE.flights = parseFlightData(rawTxt);
    
    populateDatalist();
    populateAirportDialog();
  } catch(e) {
    console.error("Data Load Error", e);
    showToast("数据加载失败");
  }
}

// 解析器保持之前的高鲁棒性逻辑
function parseFlightData(raw) {
  const entries = raw.split("《航班结束》").map(s => s.trim()).filter(Boolean);
  return entries.map(str => {
    try {
      const flightNo = str.match(/【(.*?)】/)?.[1];
      const depMatch = str.match(/《(.*?)出发》{(.*?)}#\+(\d+)#@(.*?)@/);
      const arrMatch = str.match(/《(.*?)到达》{(.*?)}#\+(\d+)#@(.*?)@/);
      const weekdays = str.match(/«(.*?)»/)?.[1]?.split(',') || [];
      const prices = {
        eco: parseInt(str.match(/§(.*?)§/)?.[1]?.match(/\d+/)?.[0] || 0),
        bus: parseInt(str.match(/θ(.*?)θ/)?.[1]?.match(/\d+/)?.[0] || 0),
        first: parseInt(str.match(/△(.*?)△/)?.[1]?.match(/\d+/)?.[0] || 0),
      };
      
      return {
        raw: str,
        flightNo,
        weekdays,
        aircraft: str.match(/〔(.*?)〕/)?.[1],
        airline: str.match(/『(.*?)』/)?.[1],
        dep: { city: depMatch[1], time: depMatch[2], dayOff: parseInt(depMatch[3]), term: depMatch[4] },
        arr: { city: arrMatch[1], time: arrMatch[2], dayOff: parseInt(arrMatch[3]), term: arrMatch[4] },
        prices
      };
    } catch(e) { return null; }
  }).filter(Boolean);
}

/* =========================================
   3. Search & Validation Logic
   ========================================= */

function setupUI() {
  // 日期限制: Today ~ Today+60
  const dateInput = document.getElementById('searchDate');
  const today = DATES.today();
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + 60);
  
  dateInput.min = DATES.fmtYMD(today);
  dateInput.max = DATES.fmtYMD(maxDate);
  dateInput.value = DATES.fmtYMD(today);

  // 输入监听 (Code Display)
  ['from', 'to'].forEach(type => {
    document.getElementById(`${type}Input`).addEventListener('input', (e) => {
      updateCodeDisplay(type, e.target.value);
    });
  });

  // 按钮事件
  document.getElementById('searchBtn').addEventListener('click', performSearch);
  document.getElementById('swapBtn').addEventListener('click', swapStations);
  document.getElementById('navHomeBtn').addEventListener('click', () => navigateTo('search'));
  
  // 设置开关
  const nSwitch = document.getElementById('notifySwitch');
  const mSwitch = document.getElementById('memorySwitch');
  nSwitch.checked = STATE.settings.notifications;
  mSwitch.checked = STATE.settings.memory;
  
  nSwitch.addEventListener('change', e => {
    STATE.settings.notifications = e.target.checked;
    saveSettings();
    if(e.target.checked) Notification.requestPermission();
  });
  
  mSwitch.addEventListener('change', e => {
    STATE.settings.memory = e.target.checked;
    saveSettings();
  });
  
  document.getElementById('clearDataBtn').addEventListener('click', () => {
    if(confirm('确定清空所有数据吗？')) {
      localStorage.removeItem('starflight_tickets');
      STATE.purchased = [];
      showToast('数据已清空');
      renderWallet();
    }
  });
}

function updateCodeDisplay(type, cityName) {
  const ap = STATE.airports.find(a => a.name === cityName);
  const el = document.getElementById(`${type}CodeDisplay`);
  el.textContent = ap ? ap.code : '---';
}

function swapStations() {
  const f = document.getElementById('fromInput');
  const t = document.getElementById('toInput');
  [f.value, t.value] = [t.value, f.value];
  updateCodeDisplay('from', f.value);
  updateCodeDisplay('to', t.value);
}

function performSearch() {
  const from = document.getElementById('fromInput').value.trim();
  const to = document.getElementById('toInput').value.trim();
  const dateStr = document.getElementById('searchDate').value;
  
  if (!from || !to) { showToast('请输入出发和到达地'); return; }
  
  // 记忆输入
  if (STATE.settings.memory) {
    STATE.lastSearch = { from, to };
    localStorage.setItem('starflight_last_search', JSON.stringify(STATE.lastSearch));
  }

  const searchDateObj = new Date(dateStr);
  const weekStr = ['SUN','MON','TUE','WED','THU','FRI','SAT'][searchDateObj.getDay()];
  const now = new Date();

  const results = STATE.flights.filter(f => {
    // 基础匹配
    if (!f.dep.city.includes(from)) return false;
    if (!f.arr.city.includes(to)) return false;
    if (!f.weekdays.includes(weekStr)) return false;
    
    // 时间逻辑验证 (Ref 6)
    // 如果查询的是今天，起飞时间必须晚于当前时间
    if (dateStr === DATES.fmtYMD(now)) {
        const [h, m] = f.dep.time.split(':').map(Number);
        const flightTimeVal = h * 60 + m;
        const nowTimeVal = now.getHours() * 60 + now.getMinutes();
        if (flightTimeVal < nowTimeVal) return false; // 已经起飞
    }
    
    return true;
  });

  renderResults(results, dateStr);
}

function renderResults(list, dateStr) {
  const grid = document.getElementById('flightGrid');
  grid.innerHTML = '';
  
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>未找到该日期的可用航班</p></div>`;
    return;
  }

  list.forEach(f => {
    const card = document.createElement('div');
    card.className = 'flight-card';
    card.innerHTML = `
      <div class="fc-row" style="margin-bottom:12px">
         <span style="font-weight:600; font-size:14px">${f.airline}</span>
         <span style="font-size:12px; color:var(--md-sys-color-primary)">${f.aircraft}</span>
      </div>
      <div class="fc-row">
        <div style="text-align:center">
          <div class="fc-time">${f.dep.time}</div>
          <div class="fc-port">${f.dep.city}</div>
        </div>
        <div class="fc-dur">
          <span>直飞</span>
          <div class="line"></div>
          <span>${f.flightNo}</span>
        </div>
        <div style="text-align:center">
          <div class="fc-time">${f.arr.time}</div>
          <div class="fc-port">${f.arr.city}</div>
        </div>
      </div>
      <div class="fc-row" style="margin-top:16px; border-top:1px solid var(--md-sys-color-surface-variant); padding-top:8px">
         <span style="font-size:12px">T${f.dep.term} - T${f.arr.term}</span>
         <span style="color:var(--highlight-orange); font-weight:700">¥${f.prices.eco}起</span>
      </div>
    `;
    card.addEventListener('click', () => openBooking(f, dateStr));
    grid.appendChild(card);
  });
}

/* =========================================
   4. Booking & Wallet
   ========================================= */

let currentBook = null;

function openBooking(flight, dateStr) {
  currentBook = { flight, dateStr, class: null, price: 0 };
  const d = document.getElementById('bookingDialog');
  
  // 填充数据
  document.getElementById('modalFlightNo').textContent = flight.flightNo;
  document.getElementById('modalDep').textContent = flight.dep.city;
  document.getElementById('modalArr').textContent = flight.arr.city;
  document.getElementById('modalDepTime').textContent = flight.dep.time;
  document.getElementById('modalArrTime').textContent = flight.arr.time;
  document.getElementById('modalDepDate').textContent = dateStr;
  document.getElementById('modalDepTerm').textContent = flight.dep.term;
  document.getElementById('modalArrTerm').textContent = flight.arr.term;
  document.getElementById('modalAircraft').textContent = flight.aircraft;
  
  // Tracker Logic (Ref 4: Show if currently flying)
  // 计算起飞绝对时间和降落绝对时间
  const depObj = DATES.parseDateTime(dateStr, flight.dep.time, flight.dep.dayOff);
  const arrObj = DATES.parseDateTime(dateStr, flight.arr.time, flight.arr.dayOff);
  const now = new Date();
  
  const trackerBox = document.getElementById('trackerContainer');
  // 如果现在时间在 起飞和降落之间
  if (now >= depObj && now <= arrObj) {
      trackerBox.hidden = false;
      document.getElementById('trackerLink').href = `https://haojin.guanmu233.cn/flights_map=?${flight.flightNo}`;
  } else {
      trackerBox.hidden = true;
  }

  // 舱位生成
  const seats = document.getElementById('seatOptions');
  seats.innerHTML = '';
  const classes = [
    {k:'eco', n:'经济舱', p: flight.prices.eco},
    {k:'bus', n:'商务舱', p: flight.prices.bus},
    {k:'first',n:'头等舱', p: flight.prices.first}
  ];
  
  classes.forEach(c => {
    if(!c.p) return;
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="radio" name="seat" value="${c.k}">
      <div class="seat-card">
        <strong>${c.n}</strong>
        <span style="color:var(--highlight-orange)">¥${c.p}</span>
      </div>
    `;
    label.querySelector('input').addEventListener('change', () => {
      currentBook.class = c.n;
      currentBook.price = c.p;
      document.getElementById('totalPrice').textContent = `¥${c.p}`;
      document.getElementById('confirmBuyBtn').disabled = false;
    });
    seats.appendChild(label);
  });
  
  document.getElementById('confirmBuyBtn').onclick = processPurchase;
  document.getElementById('confirmBuyBtn').disabled = true;
  document.getElementById('totalPrice').textContent = '--';
  
  d.showModal();
}

function processPurchase() {
  const { flight, dateStr, class: cls, price } = currentBook;
  
  // 生成起飞时间戳用于通知
  const depTimeObj = DATES.parseDateTime(dateStr, flight.dep.time, flight.dep.dayOff);
  
  const ticket = {
    id: 'TKT-' + Date.now().toString(36).toUpperCase(),
    flightNo: flight.flightNo,
    dep: flight.dep.city,
    arr: flight.arr.city,
    depCode: getCode(flight.dep.city),
    arrCode: getCode(flight.arr.city),
    date: dateStr,
    time: flight.dep.time,
    timestamp: depTimeObj.getTime(), // 起飞时间戳
    class: cls,
    price: price
  };
  
  STATE.purchased.push(ticket);
  localStorage.setItem('starflight_tickets', JSON.stringify(STATE.purchased));
  
  // 触发购买通知
  sendLocalNotif('购票成功', `您已成功预订 ${ticket.dep} 到 ${ticket.arr} 的航班。`);
  
  // 注册未来通知
  scheduleSingleTicketNotifs(ticket);
  
  closeDialog('bookingDialog');
  showToast('购票成功！已存入卡包');
  navigateTo('wallet');
}

function getCode(name) {
  const f = STATE.airports.find(a => a.name === name);
  return f ? f.code : name.substr(0,3).toUpperCase();
}

function renderWallet() {
  const grid = document.getElementById('walletGrid');
  grid.innerHTML = '';
  
  if (STATE.purchased.length === 0) {
    grid.innerHTML = `<div class="empty-state">暂无行程</div>`;
    return;
  }
  
  STATE.purchased.sort((a,b) => a.timestamp - b.timestamp).forEach((t, idx) => {
    const card = document.createElement('div');
    card.className = 'flight-card';
    const isPast = Date.now() > t.timestamp;
    
    card.innerHTML = `
      <div class="fc-row">
        <span style="font-weight:700; color:var(--md-sys-color-primary)">${t.date}</span>
        <span class="${isPast ? 'error' : 'success-text'}">${isPast ? '已结束' : '待出行'}</span>
      </div>
      <div class="fc-row" style="margin: 12px 0">
        <div>
           <div style="font-size:24px; font-weight:700">${t.depCode}</div>
           <div style="font-size:12px">${t.dep}</div>
        </div>
        <div class="material-symbols-rounded" style="color:var(--md-sys-color-outline)">flight_takeoff</div>
        <div style="text-align:right">
           <div style="font-size:24px; font-weight:700">${t.arrCode}</div>
           <div style="font-size:12px">${t.arr}</div>
        </div>
      </div>
      <div class="fc-row">
         <span>${t.flightNo}</span>
         <span>${t.class}</span>
      </div>
    `;
    card.addEventListener('click', () => openBoardingPass(t, idx));
    grid.appendChild(card);
  });
}

function openBoardingPass(ticket, idx) {
  const d = document.getElementById('boardingPassDialog');
  document.getElementById('passDepCode').textContent = ticket.depCode;
  document.getElementById('passArrCode').textContent = ticket.arrCode;
  document.getElementById('passFlight').textContent = ticket.flightNo;
  document.getElementById('passDate').textContent = ticket.date.slice(5);
  document.getElementById('passBoardingTime').textContent = ticket.time; // 登机时间简化为起飞时间
  document.getElementById('passClass').textContent = ticket.class;
  document.getElementById('passId').textContent = ticket.id;
  
  // 删除功能
  const delBtn = document.getElementById('deleteTicketBtn');
  delBtn.onclick = () => {
      if(confirm('确定删除这张登机牌吗？')) {
          STATE.purchased.splice(idx, 1);
          localStorage.setItem('starflight_tickets', JSON.stringify(STATE.purchased));
          closeDialog('boardingPassDialog');
          renderWallet();
          showToast('订单已删除');
      }
  };
  
  d.showModal();
}

/* =========================================
   5. Notification System (Ref 3)
   ========================================= */

function scheduleAllNotifications() {
  if (!STATE.settings.notifications) return;
  STATE.purchased.forEach(scheduleSingleTicketNotifs);
}

function scheduleSingleTicketNotifs(ticket) {
  const now = Date.now();
  const depTime = ticket.timestamp;
  
  // 1. 值机通知 (提前 120 分钟)
  setTimer(ticket, depTime - 120 * 60000, '值机提醒', `航班 ${ticket.flightNo} 现已开放值机，请及时办理。`);
  
  // 2. 登机通知 (提前 30 分钟)
  setTimer(ticket, depTime - 30 * 60000, '登机提醒', `航班 ${ticket.flightNo} 即将开始登机。`);
  
  // 3. 起飞通知 (准点)
  setTimer(ticket, depTime, '起飞提醒', `旅途愉快！您的航班 ${ticket.flightNo} 正在起飞。`);
}

function setTimer(ticket, triggerTime, title, body) {
  const delay = triggerTime - Date.now();
  if (delay > 0 && delay < 24 * 60 * 60 * 1000) { // 仅调度24小时内的
    setTimeout(() => {
       if (STATE.settings.notifications) sendLocalNotif(title, body);
    }, delay);
  }
}

function sendLocalNotif(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'https://img.mcwfmtr.cc/i/2025/07/18/5gkzqx.png' });
  } else {
    showToast(`${title}: ${body}`);
  }
}

/* =========================================
   6. UI Helpers (Airport Picker)
   ========================================= */

function populateDatalist() {
  const dl = document.getElementById('airportList');
  dl.innerHTML = '';
  STATE.airports.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.name;
    dl.appendChild(opt);
  });
}

// 独立的下拉框弹窗逻辑 (Ref 2)
let pickingType = null;
function openAirportPicker(type) {
  pickingType = type;
  const d = document.getElementById('airportDialog');
  d.showModal();
}

function populateAirportDialog() {
  const container = document.getElementById('airportListContainer');
  container.innerHTML = '';
  STATE.airports.forEach(a => {
     const div = document.createElement('div');
     div.className = 'airport-item';
     div.innerHTML = `<span>${a.name}</span> <span style="color:#aaa; font-weight:bold">${a.code}</span>`;
     div.onclick = () => {
         document.getElementById(`${pickingType}Input`).value = a.name;
         updateCodeDisplay(pickingType, a.name);
         closeDialog('airportDialog');
     };
     container.appendChild(div);
  });
}

function closeDialog(id) {
  document.getElementById(id).close();
}

function saveSettings() {
  localStorage.setItem('starflight_settings', JSON.stringify(STATE.settings));
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// Start
initApp();
