/* =========================================
   全局状态与配置
   ========================================= */
const STATE = {
  flights: [],     // 航班数据
  airports: [],    // 机场数据
  airlines: [],    // 航司数据 (Icon)
  purchased: [],   // 订单
  settings: {
    notifications: false,
    rememberInputs: false,
    lastFrom: '',
    lastTo: ''
  }
};

const DATES = {
  today: new Date(),
  weekMap: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
  
  fmt: (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  },

  getWeekStr: (dateStr) => {
    const d = new Date(dateStr);
    return DATES.weekMap[d.getDay()];
  }
};

/* =========================================
   核心流程：初始化
   ========================================= */
async function initApp() {
  setupNavigation();
  loadStorage();
  await loadData();
  
  initSearchUI();
  initSettingsUI();
  checkNotifications();
  
  handleRouteHash(); // 处理直接 URL 访问
}

// 1. 数据加载
async function loadData() {
  try {
    // 并行加载
    const [airRes, flightRes, airlineRes] = await Promise.all([
      fetch('../data/airports.json'),
      fetch('../data/flight_data.txt'),
      fetch('../data/airlines.json').catch(() => ({ json: () => [] })) // 容错
    ]);

    STATE.airports = await airRes.json();
    STATE.airlines = await airlineRes.json();
    const rawFlight = await flightRes.text();
    STATE.flights = parseFlightData(rawFlight);

    populateAirlineFilter();
    console.log("数据加载完毕");
  } catch (e) {
    showToast("数据加载异常，部分功能可能不可用");
    console.error(e);
  }
}

// 2. 解析逻辑 (正则)
function parseFlightData(raw) {
  const entries = raw.split("《航班结束》").map(s => s.trim()).filter(Boolean);
  return entries.map(str => {
    try {
      // 基础字段提取
      const flightNo    = str.match(/【(.*?)】/)?.[1] || "Unknown";
      const weekdaysStr = str.match(/«(.*?)»/)?.[1] || "";
      const aircraft    = str.match(/〔(.*?)〕/)?.[1] || "";
      const airline     = str.match(/『(.*?)』/)?.[1] || "";
      // 设备号可能不存在
      const equipmentId = str.match(/<(R-.*?)>/)?.[1] || ""; 
      
      // 出发
      const depMatch = str.match(/《(.*?)出发》{(.*?)}#\+(\d+)#@(.*?)@/);
      // 到达
      const arrMatch = str.match(/《(.*?)到达》{(.*?)}#\+(\d+)#@(.*?)@/);

      // 价格
      const eco = parsePrice(str.match(/§(.*?)§/)?.[1]);
      const bus = parsePrice(str.match(/θ(.*?)θ/)?.[1]);
      const first = parsePrice(str.match(/△(.*?)△/)?.[1]);

      if (!depMatch || !arrMatch) return null;

      const [h1, m1] = depMatch[2].split(':').map(Number);
      const [h2, m2] = arrMatch[2].split(':').map(Number);
      const durationMins = (arrMatch[3] * 24 * 60 + h2 * 60 + m2) - (depMatch[3] * 24 * 60 + h1 * 60 + m1);

      return {
        id: flightNo,
        flightNo, airline, aircraft, equipmentId,
        weekdays: weekdaysStr.split(",").map(s=>s.trim()),
        origin: { name: depMatch[1], time: depMatch[2], term: depMatch[4], offset: parseInt(depMatch[3]) },
        dest:   { name: arrMatch[1], time: arrMatch[2], term: arrMatch[4], offset: parseInt(arrMatch[3]) },
        prices: { eco, bus, first },
        duration: durationMins
      };
    } catch (e) { return null; }
  }).filter(Boolean);
}

function parsePrice(s) {
  if(!s) return null;
  const n = parseInt(s.replace(/\D/g, ''));
  return isNaN(n) ? null : n;
}

/* =========================================
   UI 逻辑：搜索与输入
   ========================================= */

function initSearchUI() {
  const dateInput = document.getElementById('searchDate');
  const nowStr = DATES.fmt(DATES.today);
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 60);
  
  // 日期限制
  dateInput.min = nowStr;
  dateInput.max = DATES.fmt(maxDate);
  dateInput.value = nowStr;

  // 输入框记忆回填
  if(STATE.settings.rememberInputs) {
    document.getElementById('fromInput').value = STATE.settings.lastFrom || '';
    document.getElementById('toInput').value = STATE.settings.lastTo || '';
    updateCodeDisplay('from');
    updateCodeDisplay('to');
  }

  // 绑定事件
  bindInputEvents('fromInput', 'suggestFrom', 'depCodeDisplay', 'from');
  bindInputEvents('toInput', 'suggestTo', 'arrCodeDisplay', 'to');
  
  document.getElementById('swapBtn').addEventListener('click', () => {
    const f = document.getElementById('fromInput');
    const t = document.getElementById('toInput');
    [f.value, t.value] = [t.value, f.value];
    updateCodeDisplay('from');
    updateCodeDisplay('to');
  });

  document.getElementById('searchBtn').addEventListener('click', performSearch);
}

// 绑定输入框自动联想
function bindInputEvents(inputId, suggestId, displayId, type) {
  const input = document.getElementById(inputId);
  const suggest = document.getElementById(suggestId);

  input.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    updateCodeDisplay(type); // 实时更新三字码

    if (!val) {
      suggest.hidden = true;
      return;
    }

    // 联想逻辑：匹配中文名称
    const matches = STATE.airports.filter(ap => ap.name.includes(val));
    renderSuggestions(matches, suggest, input, type);
  });

  // 点击外部关闭
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !suggest.contains(e.target)) {
      suggest.hidden = true;
    }
  });
}

// 更新顶部的三字码显示
function updateCodeDisplay(type) {
  const input = document.getElementById(type === 'from' ? 'fromInput' : 'toInput');
  const display = document.getElementById(type === 'from' ? 'depCodeDisplay' : 'arrCodeDisplay');
  const name = input.value.trim();
  
  const found = STATE.airports.find(ap => ap.name === name);
  display.textContent = found ? found.code : '---';
}

// 渲染联想词
function renderSuggestions(list, container, inputField, type) {
  container.innerHTML = '';
  if (list.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  list.forEach(ap => {
    const div = document.createElement('div');
    div.className = 'autocomplete-item';
    div.innerHTML = `<span>${ap.name}</span> <span style="color:var(--md-sys-color-primary)">${ap.code}</span>`;
    div.addEventListener('click', () => {
      inputField.value = ap.name;
      updateCodeDisplay(type);
      container.hidden = true;
    });
    container.appendChild(div);
  });
}

// 下拉弹窗逻辑 (Button Trigger)
window.toggleAirportList = function(type) {
  const dialog = document.getElementById('airportSelectDialog');
  const listBody = document.getElementById('fullAirportList');
  listBody.innerHTML = '';
  
  STATE.airports.forEach(ap => {
    const div = document.createElement('div');
    div.className = 'airport-option';
    div.innerHTML = `<span>${ap.name}</span> <b>${ap.code}</b>`;
    div.addEventListener('click', () => {
      const input = document.getElementById(type === 'from' ? 'fromInput' : 'toInput');
      input.value = ap.name;
      updateCodeDisplay(type);
      dialog.close();
    });
    listBody.appendChild(div);
  });

  dialog.showModal();
  // 点击背景关闭
  dialog.onclick = (e) => { if (e.target === dialog) dialog.close(); }
};

/* =========================================
   搜索与筛选逻辑
   ========================================= */

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

function performSearch() {
  const from = document.getElementById('fromInput').value.trim();
  const to = document.getElementById('toInput').value.trim();
  const dateStr = document.getElementById('searchDate').value;
  
  // 记忆功能
  if (STATE.settings.rememberInputs) {
    STATE.settings.lastFrom = from;
    STATE.settings.lastTo = to;
    saveStorage();
  }

  // 1. 基础匹配
  const weekStr = DATES.getWeekStr(dateStr);
  let results = STATE.flights.filter(f => {
    const matchFrom = from ? f.origin.name.includes(from) : true;
    const matchTo = to ? f.dest.name.includes(to) : true;
    const matchDay = f.weekdays.includes(weekStr);
    return matchFrom && matchTo && matchDay;
  });

  // 2. 筛选
  const timeFilter = document.getElementById('filterTime').value;
  const airlineFilter = document.getElementById('filterAirline').value;

  results = results.filter(f => {
    // 航司筛选
    if (airlineFilter !== 'all' && f.airline !== airlineFilter) return false;
    
    // 时间段筛选
    if (timeFilter !== 'all') {
      const hour = parseInt(f.origin.time.split(':')[0]);
      if (timeFilter === 'early' && !(hour >= 0 && hour < 6)) return false;
      if (timeFilter === 'morning' && !(hour >= 6 && hour < 11)) return false;
      if (timeFilter === 'noon' && !(hour >= 11 && hour < 13)) return false;
      if (timeFilter === 'afternoon' && !(hour >= 13 && hour < 18)) return false;
      if (timeFilter === 'evening' && !(hour >= 18 && hour < 22)) return false;
      if (timeFilter === 'midnight' && !(hour >= 22)) return false;
    }
    return true;
  });

  renderResults(results, dateStr);
}

function renderResults(list, dateStr) {
  const grid = document.getElementById('flightGrid');
  grid.innerHTML = '';

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">sentiment_content_dissatisfied</span><p>暂无航班，尝试调整筛选条件</p></div>`;
    return;
  }

  // 检查是否是"今天"，如果是今天，已过时间的航班不能选
  const isToday = dateStr === DATES.fmt(new Date());
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();

  list.forEach(f => {
    const [depH, depM] = f.origin.time.split(':').map(Number);
    const flightMins = depH * 60 + depM;
    const isPast = isToday && flightMins < nowMins;

    // 获取航司 Icon
    const airlineData = STATE.airlines.find(a => a.name === f.airline);
    const iconUrl = airlineData ? airlineData.logo : 'https://img.icons8.com/color/48/airplane-take-off.png';

    const card = document.createElement('div');
    card.className = 'flight-card';
    if(isPast) card.style.opacity = '0.5';

    card.innerHTML = `
      <div class="fc-header">
        <img src="${iconUrl}" class="airline-logo-sm" alt="logo">
        <div class="fc-header-text">
          <span>${f.airline}</span>
          <span style="font-size:10px">${f.flightNo} · ${f.aircraft}</span>
        </div>
      </div>
      <div class="fc-body">
        <div>
          <div class="fc-time">${f.origin.time}</div>
          <div class="fc-city">${f.origin.name}</div>
        </div>
        <div class="fc-duration">
          <span>${Math.floor(f.duration/60)}h ${f.duration%60}m</span>
          <div style="border-top:1px solid #999; width:40px; margin:2px auto;"></div>
        </div>
        <div style="text-align:right">
          <div class="fc-time">${f.dest.time}</div>
          <div class="fc-city">${f.dest.name}</div>
        </div>
      </div>
      <div class="fc-footer">
        <span>${f.equipmentId || ''}</span>
        <span class="price">¥${f.prices.eco || f.prices.bus} 起</span>
      </div>
    `;

    card.addEventListener('click', () => {
      if (isPast) {
        showToast("该航班已停止检票");
        return;
      }
      openBookingDialog(f, dateStr);
    });
    grid.appendChild(card);
  });
}

/* =========================================
   购票与卡包
   ========================================= */

function openBookingDialog(flight, dateStr) {
  const dialog = document.getElementById('bookingDialog');
  
  // 预览信息
  document.getElementById('bookingPreview').innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:8px">
      <b>${flight.origin.name}</b> 
      <span class="material-symbols-rounded">arrow_right_alt</span>
      <b>${flight.dest.name}</b>
    </div>
    <div style="font-size:12px; color:var(--md-sys-color-outline)">
      ${dateStr} · ${flight.flightNo} · ${flight.airline}
    </div>
  `;

  // 舱位渲染
  const seatContainer = document.getElementById('seatOptions');
  seatContainer.innerHTML = '';
  
  const classes = [
    { n: '经济舱', p: flight.prices.eco, k: 'eco' },
    { n: '商务舱', p: flight.prices.bus, k: 'bus' },
    { n: '头等舱', p: flight.prices.first, k: 'first' }
  ];

  let selected = null;

  classes.forEach(c => {
    if (!c.p) return;
    const btn = document.createElement('div');
    btn.className = 'flight-card'; // 复用卡片样式但简化
    btn.style.padding = '12px';
    btn.style.marginBottom = '8px';
    btn.innerHTML = `<div style="display:flex;justify-content:space-between"><b>${c.n}</b><span style="color:#ff6d00">¥${c.p}</span></div>`;
    
    btn.addEventListener('click', () => {
      // 选中逻辑
      Array.from(seatContainer.children).forEach(ch => ch.style.borderColor = 'transparent');
      btn.style.borderColor = 'var(--md-sys-color-primary)';
      
      document.getElementById('totalPrice').textContent = `¥${c.p}`;
      document.getElementById('confirmBuyBtn').disabled = false;
      selected = { class: c.n, price: c.p };
    });
    seatContainer.appendChild(btn);
  });

  const confirmBtn = document.getElementById('confirmBuyBtn');
  confirmBtn.onclick = () => {
    // 生成订单
    const ticket = {
      id: Date.now().toString(36),
      flight: flight,
      date: dateStr,
      seat: selected,
      ts: new Date(`${dateStr}T${flight.origin.time}`).getTime()
    };
    
    STATE.purchased.push(ticket);
    saveStorage();
    scheduleNotificationsForTicket(ticket); // 调度通知
    
    showToast("预订成功，已存入卡包");
    dialog.close();
    renderWallet();
    
    if(STATE.settings.notifications) {
      sendLocalNotify("购票成功", `您已成功预订 ${dateStr} ${flight.flightNo} 航班`);
    }
  };

  document.getElementById('closeBookingBtn').onclick = () => dialog.close();
  dialog.showModal();
}

function renderWallet() {
  const grid = document.getElementById('walletGrid');
  grid.innerHTML = '';
  
  if (STATE.purchased.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>暂无行程</p></div>`;
    return;
  }

  // 按时间倒序
  const list = STATE.purchased.sort((a,b) => b.ts - a.ts);

  list.forEach((t, index) => {
    const f = t.flight;
    // 状态判定
    const now = Date.now();
    const [arrH, arrM] = f.dest.time.split(':').map(Number);
    // 简易计算到达时间戳 (由于可能跨天，这里做简化，假设在出发当天或次日)
    let arrTs = new Date(`${t.date}T${f.dest.time}`).getTime();
    if (arrTs < t.ts) arrTs += 86400000; // 跨天

    const isFlying = now >= t.ts && now <= arrTs;
    const isDone = now > arrTs;

    const airlineData = STATE.airlines.find(a => a.name === f.airline);
    const iconUrl = airlineData ? airlineData.logo : '';

    const card = document.createElement('div');
    card.className = 'flight-card';
    card.style.borderLeft = isDone ? '4px solid gray' : '4px solid var(--md-sys-color-primary)';

    // 删除按钮
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.innerHTML = '<span class="material-symbols-rounded">delete</span>';
    delBtn.onclick = (e) => {
      e.stopPropagation(); // 防止触发卡片点击
      if(confirm('确定删除此行程？')) {
        STATE.purchased.splice(index, 1);
        saveStorage();
        renderWallet();
      }
    };
    card.appendChild(delBtn);

    // 动态追踪按钮 (飞行区间内隐藏)
    // 题目要求：处于飞行时间区间内...隐藏该按钮。
    // 这里的 trackerUrl 我使用 # 占位
    const trackerHtml = (!isFlying) 
      ? `<button class="btn-filled" style="height:32px; font-size:12px; margin-top:12px; width:auto;" 
          onclick="event.stopPropagation(); window.open('https://haojin.guanmu233.cn/flights_map=?${f.flightNo}')">
          <span class="material-symbols-rounded" style="font-size:16px">radar</span> 实时动态
         </button>` 
      : '';

    card.innerHTML += `
      <div class="fc-header">
        <img src="${iconUrl}" class="airline-logo-sm" alt="">
        <span>${t.date} · ${f.flightNo}</span>
      </div>
      <div class="fc-body">
        <div class="fc-port">
          <div class="fc-time">${f.origin.time}</div>
          <div class="fc-city">${f.origin.name}</div>
        </div>
        <div class="fc-arrow">
          <span class="material-symbols-rounded">flight_takeoff</span>
        </div>
        <div class="fc-port">
          <div class="fc-time">${f.dest.time}</div>
          <div class="fc-city">${f.dest.name}</div>
        </div>
      </div>
      <div class="fc-footer" style="display:block">
         <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span>${t.seat.class}</span>
            <span>${isFlying ? '<b style="color:#ff6d00">飞行中</b>' : (isDone ? '已结束' : '待出行')}</span>
         </div>
         ${trackerHtml}
      </div>
    `;

    card.addEventListener('click', () => showBoardingPass(t));
    grid.appendChild(card);
  });
}

function showBoardingPass(ticket) {
  const f = ticket.flight;
  const d = document.getElementById('boardingPassDialog');
  
  // 查找三字码
  const depCode = STATE.airports.find(a => a.name === f.origin.name)?.code || '---';
  const arrCode = STATE.airports.find(a => a.name === f.dest.name)?.code || '---';
  
  const airlineData = STATE.airlines.find(a => a.name === f.airline);
  
  document.getElementById('bpAirlineIcon').src = airlineData ? airlineData.logo : '';
  document.getElementById('bpDepCode').textContent = depCode;
  document.getElementById('bpDepCity').textContent = f.origin.name;
  document.getElementById('bpArrCode').textContent = arrCode;
  document.getElementById('bpArrCity').textContent = f.dest.name;
  document.getElementById('bpFlightNo').textContent = f.flightNo;
  document.getElementById('bpDate').textContent = ticket.date;
  document.getElementById('bpClass').textContent = ticket.seat.class;
  document.getElementById('bpTerm').textContent = f.origin.term || '--';
  
  // 登机时间 = 起飞前30分钟
  const [h, m] = f.origin.time.split(':').map(Number);
  const boardingMins = h * 60 + m - 30;
  const bH = Math.floor(boardingMins/60);
  const bM = boardingMins % 60;
  document.getElementById('bpBoardingTime').textContent = `${String(bH).padStart(2,'0')}:${String(bM).padStart(2,'0')}`;

  // 二维码：使用 API 或占位
  const qrData = `${f.flightNo}|${ticket.date}|${ticket.seat.class}`;
  document.getElementById('bpQrCode').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${qrData}`;
  
  d.showModal();
}

/* =========================================
   设置与通知系统
   ========================================= */

function initSettingsUI() {
  const masterSw = document.getElementById('notifyMasterSwitch');
  const memoSw = document.getElementById('memorySwitch');
  const clearBtn = document.getElementById('clearDataBtn');

  masterSw.checked = STATE.settings.notifications;
  memoSw.checked = STATE.settings.rememberInputs;

  masterSw.addEventListener('change', (e) => {
    STATE.settings.notifications = e.target.checked;
    saveStorage();
    if(e.target.checked) requestNotifyPermission();
  });

  memoSw.addEventListener('change', (e) => {
    STATE.settings.rememberInputs = e.target.checked;
    if(!e.target.checked) {
      STATE.settings.lastFrom = '';
      STATE.settings.lastTo = '';
    }
    saveStorage();
  });

  clearBtn.addEventListener('click', () => {
    if(confirm('确定清除所有数据？此操作不可逆。')) {
      localStorage.removeItem('sf_data');
      location.reload();
    }
  });
}

function requestNotifyPermission() {
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function checkNotifications() {
  if (!STATE.settings.notifications) return;
  // 页面加载时重新调度所有有效票据的通知
  STATE.purchased.forEach(scheduleNotificationsForTicket);
}

function scheduleNotificationsForTicket(t) {
  if (!STATE.settings.notifications) return;
  const now = Date.now();
  
  // 1. 值机 (120 min before)
  const checkinTime = t.ts - 120 * 60 * 1000;
  if (checkinTime > now) {
    setTimeout(() => sendLocalNotify("值机提醒", `航班 ${t.flight.flightNo} 开放值机，前往 ${t.flight.origin.term}`), checkinTime - now);
  }

  // 2. 登机 (30 min before)
  const boardingTime = t.ts - 30 * 60 * 1000;
  if (boardingTime > now) {
    setTimeout(() => sendLocalNotify("登机提醒", `航班 ${t.flight.flightNo} 开始登机`), boardingTime - now);
  }

  // 3. 起飞
  if (t.ts > now) {
    setTimeout(() => sendLocalNotify("起飞提醒", `航班 ${t.flight.flightNo} 即将起飞，祝旅途愉快`), t.ts - now);
  }
}

function sendLocalNotify(title, body) {
  if (Notification.permission === 'granted' && STATE.settings.notifications) {
    new Notification(title, { body, icon: '../data/icon.png' });
  } else {
    showToast(`${title}: ${body}`); // 降级为 Toast
  }
}

/* =========================================
   工具与路由
   ========================================= */

function loadStorage() {
  const s = localStorage.getItem('sf_data');
  if (s) {
    const data = JSON.parse(s);
    STATE.purchased = data.purchased || [];
    STATE.settings = data.settings || STATE.settings;
  }
}

function saveStorage() {
  localStorage.setItem('sf_data', JSON.stringify({
    purchased: STATE.purchased,
    settings: STATE.settings
  }));
}

// 标签切换
window.switchTab = function(tab) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${tab}`).classList.add('active');
  
  // URL Hash 更新
  window.location.hash = tab;
  
  if (tab === 'wallet') renderWallet();
};

function handleRouteHash() {
  const hash = window.location.hash.replace('#', '');
  if (['search', 'wallet', 'settings'].includes(hash)) {
    switchTab(hash);
  } else if (hash.startsWith('ticket/')) {
    // 简单模拟直接进入特定票据 (实际需更复杂逻辑)
    switchTab('wallet');
  }
}

window.handleBack = function() {
  // 如果在子试图，返回搜索；如果在搜索，提示退出? 这里简单处理为返回 Search
  switchTab('search');
};

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// 启动
initApp();
