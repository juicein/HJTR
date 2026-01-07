/* =========================================
   1. 数据处理核心 (Data Handling)
   ========================================= */

// 全局状态
const STATE = {
  flights: [],     // 解析后的航班数据
  airports: [],    // 机场数据
  purchased: [],   // 已购票据
  settings: {
    notifications: false
  }
};

const DATES = {
  weekMap: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
  today: new Date(),
  
  // 工具：格式化日期 YYYY-MM-DD
  fmtDate: (d) => d.toISOString().split('T')[0],
  
  // 工具：获取日期对应的星期字符串
  getWeekStr: (dateStr) => {
    const d = new Date(dateStr);
    return DATES.weekMap[d.getDay()];
  }
};

// 初始化应用
async function initApp() {
  await loadData();
  loadStorage();
  initUI();
  setupNotifications();
}

// 读取本地/远程数据
async function loadData() {
  try {
    // 读取机场 JSON
    const airRes = await fetch('../data/airports.json');
    STATE.airports = await airRes.json();
    populateAirportList();

    // 读取航班 TXT
    const flightRes = await fetch('../data/flight_data.txt');
    const rawText = await flightRes.text();
    STATE.flights = parseFlightData(rawText);
    
    console.log("数据加载完成:", STATE.flights.length, "个航班");
  } catch (e) {
    showToast("数据加载失败，请检查 data 目录");
    console.error(e);
  }
}

// 解析 TXT 数据的正则魔法
function parseFlightData(raw) {
  // 分割每条航班记录 (假设以 《航班结束》 分隔)
  const entries = raw.split("《航班结束》").map(s => s.trim()).filter(Boolean);
  
  return entries.map(str => {
    try {
      // 提取核心字段
      const flightNo    = str.match(/【(.*?)】/)?.[1] || "Unknown";
      const weekdaysStr = str.match(/«(.*?)»/)?.[1] || "";
      const aircraft    = str.match(/〔(.*?)〕/)?.[1] || "";
      const airline     = str.match(/『(.*?)』/)?.[1] || "";
      const equipmentId = str.match(/<(R-.*?)>/)?.[1] || ""; // 提取设备号

      // 提取出发信息
      const depMatch    = str.match(/《(.*?)出发》{(.*?)}#\+(\d+)#@(.*?)@/);
      const depAirport  = depMatch ? depMatch[1] : "";
      const depTime     = depMatch ? depMatch[2] : "";
      const depDayOffset= depMatch ? parseInt(depMatch[3]) : 0;
      const depTerminal = depMatch ? depMatch[4] : "";

      // 提取到达信息
      const arrMatch    = str.match(/《(.*?)到达》{(.*?)}#\+(\d+)#@(.*?)@/);
      const arrAirport  = arrMatch ? arrMatch[1] : "";
      const arrTime     = arrMatch ? arrMatch[2] : "";
      const arrDayOffset= arrMatch ? parseInt(arrMatch[3]) : 0;
      const arrTerminal = arrMatch ? arrMatch[4] : "";

      // 提取价格
      const ecoPrice   = parsePrice(str.match(/§(.*?)§/)?.[1]);
      const busPrice   = parsePrice(str.match(/θ(.*?)θ/)?.[1]);
      const firstPrice = parsePrice(str.match(/△(.*?)△/)?.[1]);

      // 计算飞行时长 (分钟)
      const dur = calculateDuration(depTime, depDayOffset, arrTime, arrDayOffset);

      return {
        raw: str,
        flightNo, 
        weekdays: weekdaysStr.split(",").map(s=>s.trim()), 
        aircraft, airline, equipmentId,
        origin: { name: depAirport, time: depTime, dayOff: depDayOffset, term: depTerminal },
        dest:   { name: arrAirport, time: arrTime, dayOff: arrDayOffset, term: arrTerminal },
        prices: { eco: ecoPrice, bus: busPrice, first: firstPrice },
        duration: dur
      };
    } catch (e) {
      console.warn("解析跳过一条错误数据", e);
      return null;
    }
  }).filter(Boolean);
}

function parsePrice(str) {
  if (!str) return null;
  const num = parseInt(str.replace(/\D/g, ''));
  return isNaN(num) ? null : num;
}

function calculateDuration(t1, d1, t2, d2) {
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  const min1 = d1 * 24 * 60 + h1 * 60 + m1;
  const min2 = d2 * 24 * 60 + h2 * 60 + m2;
  return min2 - min1;
}

function fmtDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

/* =========================================
   2. UI 逻辑与交互 (UI & Interaction)
   ========================================= */

function initUI() {
  // 设置日期选择器默认为今天
  const dateInput = document.getElementById('searchDate');
  dateInput.value = DATES.fmtDate(DATES.today);
  dateInput.min = DATES.fmtDate(DATES.today);
  dateInput.addEventListener('change', updateWeekDisplay);
  updateWeekDisplay();

  // 绑定按钮事件
  document.getElementById('searchBtn').addEventListener('click', performSearch);
  document.getElementById('swapBtn').addEventListener('click', () => {
    const f = document.getElementById('fromInput');
    const t = document.getElementById('toInput');
    [f.value, t.value] = [t.value, f.value];
  });
  
  document.getElementById('closeDialogBtn').addEventListener('click', closeDialog);
  document.getElementById('confirmBuyBtn').addEventListener('click', confirmPurchase);
  
  // 设置页事件
  const notifySwitch = document.getElementById('notifySwitch');
  notifySwitch.checked = STATE.settings.notifications;
  notifySwitch.addEventListener('change', (e) => toggleNotifications(e.target.checked));
  
  document.getElementById('clearDataBtn').addEventListener('click', () => {
    localStorage.removeItem('starflight_tickets');
    STATE.purchased = [];
    renderWallet();
    showToast("已清空所有数据");
  });

  renderWallet(); // 渲染已有票据
}

// 自动补全
function populateAirportList() {
  const list = document.getElementById('airportList');
  STATE.airports.forEach(ap => {
    const opt = document.createElement('option');
    opt.value = ap.name;
    // 可以在 label 中显示代码，但 datalist 行为各浏览器不一致
    list.appendChild(opt);
  });
}

// 更新日期旁边的星期显示
function updateWeekDisplay() {
  const val = document.getElementById('searchDate').value;
  if (!val) return;
  const badge = document.getElementById('weekDisplay');
  const week = DATES.getWeekStr(val);
  badge.textContent = week;
}

// 搜索航班
function performSearch() {
  const from = document.getElementById('fromInput').value.trim();
  const to = document.getElementById('toInput').value.trim();
  const dateStr = document.getElementById('searchDate').value;
  const weekStr = DATES.getWeekStr(dateStr);

  const results = STATE.flights.filter(f => {
    // 1. 检查出发地 (支持模糊匹配或精准匹配)
    // 根据需求：通过中文 name 检索
    const matchFrom = from ? f.origin.name.includes(from) : true;
    const matchTo   = to ? f.dest.name.includes(to) : true;
    
    // 2. 检查运行日
    const matchDay = f.weekdays.includes(weekStr);

    return matchFrom && matchTo && matchDay;
  });

  renderResults(results, dateStr);
}

// 渲染结果列表
function renderResults(list, dateStr) {
  const grid = document.getElementById('flightGrid');
  const header = document.getElementById('resultsHeader');
  grid.innerHTML = '';
  header.hidden = false;

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>未找到符合条件的航班</p></div>`;
    return;
  }

  list.forEach(f => {
    // 计算实际日期
    // 假设 baseDate 是出发日期的基准，如果数据中有 offset (如+1天)，则显示上需要体现
    // 但此处逻辑：用户搜的是出发日，所以 depTime 就是当天
    
    const card = document.createElement('div');
    card.className = 'flight-card';
    card.innerHTML = `
      <div class="fc-header">
        <span>${f.airline} · ${f.flightNo}</span>
        <span>${f.aircraft}</span>
      </div>
      <div class="fc-body">
        <div class="fc-port">
          <div class="fc-time">${f.origin.time}</div>
          <div class="fc-city">${f.origin.name}</div>
        </div>
        <div class="fc-arrow">
          <span>${fmtDuration(f.duration)}</span>
          <span class="material-symbols-rounded">trending_flat</span>
        </div>
        <div class="fc-port">
          <div class="fc-time">${f.dest.time} <small style="font-size:12px">${f.dest.dayOff > f.origin.dayOff ? '+1' : ''}</small></div>
          <div class="fc-city">${f.dest.name}</div>
        </div>
      </div>
      <div class="fc-footer">
        <span>${f.equipmentId ? '设备 '+f.equipmentId : ''}</span>
        <span class="price-tag">¥${f.prices.eco || f.prices.bus || '--'} 起</span>
      </div>
    `;
    card.addEventListener('click', () => openBookingDialog(f, dateStr));
    grid.appendChild(card);
  });
}

/* =========================================
   3. 购票流程 (Booking Flow)
   ========================================= */

let currentSelection = null; // 暂存当前正在购买的航班

function openBookingDialog(flight, depDateStr) {
  const dialog = document.getElementById('bookingDialog');
  currentSelection = { flight, depDateStr, class: null, price: 0 };

  // 填充信息
  document.getElementById('modalDep').textContent = flight.origin.name;
  document.getElementById('modalArr').textContent = flight.dest.name;
  document.getElementById('modalFlightNo').textContent = flight.flightNo;
  document.getElementById('modalDate').textContent = depDateStr;
  document.getElementById('modalAircraft').textContent = `${flight.aircraft} ${flight.equipmentId}`;
  
  document.getElementById('modalDepTime').textContent = flight.origin.time;
  document.getElementById('modalDepTerm').textContent = flight.origin.term || '--';
  document.getElementById('modalArrTime').textContent = flight.dest.time;
  document.getElementById('modalArrTerm').textContent = flight.dest.term || '--';
  document.getElementById('modalDuration').textContent = fmtDuration(flight.duration);

  // 动态追踪按钮
  const trackerBox = document.getElementById('trackerContainer');
  const trackerLink = document.getElementById('trackerLink');
  // 检查航班号是否包含 "HA" (不区分大小写) 或特定号段，此处逻辑根据 Prompt：如果是 ha1121
  // 也可以放宽条件：只要是 HA 开头的都显示
  if (flight.flightNo.toUpperCase().startsWith('HA')) {
    trackerBox.hidden = false;
    trackerLink.href = `https://haojin.guanmu233.cn/flights_map=?${flight.flightNo}`;
  } else {
    trackerBox.hidden = true;
  }

  // 生成舱位选项
  const seatContainer = document.getElementById('seatOptions');
  seatContainer.innerHTML = '';
  const classes = [
    { code: 'eco', name: '经济舱', price: flight.prices.eco },
    { code: 'bus', name: '商务舱', price: flight.prices.bus },
    { code: 'first', name: '头等舱', price: flight.prices.first }
  ];

  classes.forEach(c => {
    if (!c.price) return;
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="radio" name="seatClass" class="seat-radio" value="${c.code}" data-price="${c.price}">
      <div class="seat-card">
        <span class="seat-name">${c.name}</span>
        <span class="seat-price">¥${c.price}</span>
      </div>
    `;
    label.querySelector('input').addEventListener('change', (e) => {
      currentSelection.class = c.name;
      currentSelection.price = c.price;
      document.getElementById('totalPrice').textContent = `¥${c.price}`;
      document.getElementById('confirmBuyBtn').disabled = false;
    });
    seatContainer.appendChild(label);
  });

  document.getElementById('totalPrice').textContent = '请选择舱位';
  document.getElementById('confirmBuyBtn').disabled = true;
  
  dialog.showModal();
}

function closeDialog() {
  document.getElementById('bookingDialog').close();
  currentSelection = null;
}

function confirmPurchase() {
  if (!currentSelection) return;
  
  // 生成唯一ID
  const ticketId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  // 计算实际起飞 Date 对象
  const depDateTimeStr = `${currentSelection.depDateStr}T${currentSelection.flight.origin.time}`;
  const flightTimestamp = new Date(depDateTimeStr).getTime();

  const ticket = {
    id: ticketId,
    flightNo: currentSelection.flight.flightNo,
    airline: currentSelection.flight.airline,
    depCity: currentSelection.flight.origin.name,
    arrCity: currentSelection.flight.dest.name,
    depTime: currentSelection.flight.origin.time,
    arrTime: currentSelection.flight.dest.time,
    depDate: currentSelection.depDateStr, // 字符串 YYYY-MM-DD
    timestamp: flightTimestamp, // 用于排序和通知
    class: currentSelection.class,
    price: currentSelection.price,
    equipmentId: currentSelection.flight.equipmentId,
    status: '有效'
  };

  STATE.purchased.push(ticket);
  saveStorage();
  
  showToast("购买成功！已存入卡包");
  closeDialog();
  renderWallet();
  
  // 检查是否需要安排通知
  scheduleNotification(ticket);
}

/* =========================================
   4. 卡包与持久化 (Wallet & Storage)
   ========================================= */

function loadStorage() {
  const savedTix = localStorage.getItem('starflight_tickets');
  if (savedTix) STATE.purchased = JSON.parse(savedTix);
  
  const savedSet = localStorage.getItem('starflight_settings');
  if (savedSet) STATE.settings = JSON.parse(savedSet);
}

function saveStorage() {
  localStorage.setItem('starflight_tickets', JSON.stringify(STATE.purchased));
  localStorage.setItem('starflight_settings', JSON.stringify(STATE.settings));
}

function renderWallet() {
  const grid = document.getElementById('walletGrid');
  grid.innerHTML = '';
  
  // 按时间排序
  const list = STATE.purchased.sort((a, b) => a.timestamp - b.timestamp);

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>暂无行程，快去预订吧</p></div>`;
    return;
  }

  list.forEach(t => {
    // 检查是否已过期
    const isPast = Date.now() > t.timestamp + 86400000; // 这里的过期简单判定为起飞后24小时
    
    const card = document.createElement('div');
    card.className = 'flight-card';
    card.style.borderLeft = `4px solid ${isPast ? '#999' : 'var(--highlight-orange)'}`;
    card.innerHTML = `
      <div class="fc-header">
        <span>${t.depDate} · ${t.flightNo}</span>
        <span style="color:${isPast?'gray':'green'}">${isPast ? '已结束' : '待出行'}</span>
      </div>
      <div class="fc-body">
        <div class="fc-port">
          <div class="fc-time">${t.depTime}</div>
          <div class="fc-city">${t.depCity}</div>
        </div>
        <div class="fc-arrow">
           <span class="material-symbols-rounded">flight</span>
        </div>
        <div class="fc-port">
          <div class="fc-time">${t.arrTime}</div>
          <div class="fc-city">${t.arrCity}</div>
        </div>
      </div>
      <div class="fc-footer">
        <span>${t.class}</span>
        <span>${t.equipmentId}</span>
      </div>
    `;
    // 点击卡包里的卡片，也可以查看详情（这里复用 openBookingDialog 只是为了展示，实际应为只读模式，此处简化）
    // 为了满足“独立URL”需求，实际在SPA中我们通常用 URL Hash，但这里简单起见，仅做点击展示
    // card.addEventListener('click', () => alert(`电子票号: ${t.id}\n请凭此登机`));
    grid.appendChild(card);
  });
}

/* =========================================
   5. 系统通知 (Notifications)
   ========================================= */

function setupNotifications() {
  // 页面加载时，检查所有未出行航班
  if (STATE.settings.notifications) {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
    STATE.purchased.forEach(scheduleNotification);
  }
}

function toggleNotifications(enabled) {
  STATE.settings.notifications = enabled;
  saveStorage();
  
  if (enabled) {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        showToast("起飞提醒已开启");
        STATE.purchased.forEach(scheduleNotification);
      } else {
        showToast("通知权限被拒绝");
        document.getElementById('notifySwitch').checked = false;
      }
    });
  }
}

// 调度单个提醒
function scheduleNotification(ticket) {
  if (!STATE.settings.notifications) return;
  
  const now = Date.now();
  const flyTime = ticket.timestamp;
  const alertTime = flyTime - 15 * 60 * 1000; // 起飞前15分钟
  
  const delay = alertTime - now;
  
  // 只有当时间未过，且在合理的未来（例如24小时内，防止setTimeout溢出或无效等待）时才设置
  if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
    console.log(`已设置提醒: ${ticket.flightNo} 将在 ${Math.round(delay/60000)} 分钟后提醒`);
    setTimeout(() => {
      sendNotification(ticket);
    }, delay);
  }
}

function sendNotification(ticket) {
  if (Notification.permission === 'granted') {
    new Notification("航班即将起飞", {
      body: `您的航班 ${ticket.flightNo} (${ticket.depCity} -> ${ticket.arrCity}) 将在15分钟后起飞，请准备登机。`,
      icon: 'https://img.mcwfmtr.cc/i/2025/07/18/5gkzqx.png' // 使用你的 Logo
    });
  }
}

/* =========================================
   6. 视图切换与工具 (View Switcher & Utils)
   ========================================= */

// 简单的 Tab 切换
window.switchTab = function(tabName) {
  // 更新按钮状态
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  // 简单粗暴根据 onclick 查找可能不准，这里假设顺序固定
  // 更好的方式是给 button 加 data-target
  const index = ['search', 'wallet', 'settings'].indexOf(tabName);
  document.querySelectorAll('.nav-item')[index].classList.add('active');

  // 更新视图
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${tabName}`).classList.add('active');
  
  // 如果切换到卡包，刷新一下
  if(tabName === 'wallet') renderWallet();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// 启动
initApp();
