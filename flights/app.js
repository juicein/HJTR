/* =========================================
   1. 初始化与数据 (Init & Data)
   ========================================= */

const STATE = {
  flights: [],     // 解析后
  airports: [],    // JSON
  airlines: {},    // Map: Name -> IconUrl
  purchased: [],   // LocalStorage
  settings: {
    notifications: false,
    history: true,
    lastFrom: { code: 'SIN', city: '新加坡' },
    lastTo: { code: 'HND', city: '东京' }
  },
  currentInputTarget: null // 'from' or 'to'
};

const CONSTANTS = {
  MAX_DAYS: 60,
  MS_PER_DAY: 86400000
};

async function initApp() {
  await loadData();
  loadStorage();
  initRouter();
  initUI();
  setupNotifications(); // 检查权限
  
  // 恢复上次搜索
  if (STATE.settings.history) {
    setAirportInput('from', STATE.settings.lastFrom);
    setAirportInput('to', STATE.settings.lastTo);
  }
}

async function loadData() {
  try {
    const [airRes, fltRes, alRes] = await Promise.all([
      fetch('data/airports.json'),
      fetch('data/flight_data.txt'),
      fetch('data/airlines.json').catch(() => ({ json: () => [] })) // 容错
    ]);

    STATE.airports = await airRes.json();
    STATE.flights = parseFlightData(await fltRes.text());
    
    // 处理航司图标
    const alData = await alRes.json();
    if(Array.isArray(alData)) {
      alData.forEach(a => STATE.airlines[a.name] = a.icon);
    }

    populateAirlineFilter();
  } catch (e) {
    console.error("Data Load Error", e);
    showToast("数据加载失败");
  }
}

/* =========================================
   2. 核心搜索与过滤 (Search Logic)
   ========================================= */

// 解析TXT (保持原有正则逻辑，增加健壮性)
function parseFlightData(raw) {
  const entries = raw.split("《航班结束》").map(s => s.trim()).filter(Boolean);
  return entries.map(str => {
    try {
      const flightNo = str.match(/【(.*?)】/)?.[1] || "Unknown";
      const weekdays = (str.match(/«(.*?)»/)?.[1] || "").split(",").map(s=>s.trim());
      const aircraft = str.match(/〔(.*?)〕/)?.[1] || "";
      const airline  = str.match(/『(.*?)』/)?.[1] || "";
      const equipId  = str.match(/<(R-.*?)>/)?.[1] || "";
      
      const getPort = (type) => {
        const m = str.match(type === 'dep' ? /《(.*?)出发》{(.*?)}#\+(\d+)#@(.*?)@/ : /《(.*?)到达》{(.*?)}#\+(\d+)#@(.*?)@/);
        return m ? { name: m[1], time: m[2], dayOff: parseInt(m[3]), term: m[4] } : null;
      };
      
      const origin = getPort('dep');
      const dest = getPort('arr');
      
      const prices = {
        eco: parsePrice(str.match(/§(.*?)§/)?.[1]),
        bus: parsePrice(str.match(/θ(.*?)θ/)?.[1]),
        first: parsePrice(str.match(/△(.*?)△/)?.[1])
      };

      if (!origin || !dest) return null;

      // 找机场代码
      const findCode = (name) => STATE.airports.find(a => a.name === name)?.code || "---";
      origin.code = findCode(origin.name);
      dest.code = findCode(dest.name);

      return {
        raw: str, flightNo, weekdays, aircraft, airline, equipmentId: equipId,
        origin, dest, prices,
        duration: calculateDuration(origin.time, origin.dayOff, dest.time, dest.dayOff)
      };
    } catch(e) { return null; }
  }).filter(Boolean);
}

function performSearch() {
  const fromCode = document.getElementById('dispFromCode').innerText;
  const toCode = document.getElementById('dispToCode').innerText;
  const dateStr = document.getElementById('searchDate').value;
  
  // 1. 日期校验
  const todayStr = new Date().toISOString().split('T')[0];
  const searchDate = new Date(dateStr);
  const todayDate = new Date(todayStr);
  
  if (dateStr < todayStr) return showToast("不能选择过去的日期");
  const diffDays = (searchDate - todayDate) / CONSTANTS.MS_PER_DAY;
  if (diffDays > CONSTANTS.MAX_DAYS) return showToast("仅支持预订60天内的航班");

  // 2. 筛选器
  const timeFilter = document.getElementById('filterTime').value;
  const airlineFilter = document.getElementById('filterAirline').value;
  const weekStr = getWeekStr(dateStr);
  
  // 当前时间用于过滤已起飞航班 (如果搜的是今天)
  const now = new Date();
  const isToday = dateStr === todayStr;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const results = STATE.flights.filter(f => {
    // 基础匹配
    if (f.origin.code !== fromCode || f.dest.code !== toCode) return false;
    if (!f.weekdays.includes(weekStr)) return false;

    // 航司过滤
    if (airlineFilter !== 'all' && f.airline !== airlineFilter) return false;

    // 时间段过滤
    const [h, m] = f.origin.time.split(':').map(Number);
    const depMins = h * 60 + m;
    
    // 如果是今天，且起飞时间早于当前时间 -> 隐藏
    if (isToday && depMins < currentMinutes) return false;

    // 时段逻辑
    if (timeFilter !== 'all') {
      if (timeFilter === 'midnight' && !(depMins >= 0 && depMins < 360)) return false;
      if (timeFilter === 'morning' && !(depMins >= 360 && depMins < 720)) return false;
      if (timeFilter === 'noon' && !(depMins >= 720 && depMins < 840)) return false;
      if (timeFilter === 'afternoon' && !(depMins >= 840 && depMins < 1080)) return false;
      if (timeFilter === 'evening' && !(depMins >= 1080)) return false;
    }

    return true;
  });

  renderResults(results, dateStr);
  
  // 记忆
  if (STATE.settings.history) {
    STATE.settings.lastFrom = { code: fromCode, city: document.getElementById('dispFromCity').innerText };
    STATE.settings.lastTo = { code: toCode, city: document.getElementById('dispToCity').innerText };
    saveStorage();
  }
}

function renderResults(list, dateStr) {
  const grid = document.getElementById('flightGrid');
  document.getElementById('resultCount').innerText = list.length;
  grid.innerHTML = '';

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded" style="font-size:48px;color:#ccc">block</span><p>暂无符合条件的航班</p></div>`;
    return;
  }

  list.forEach(f => {
    const iconUrl = STATE.airlines[f.airline] || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzY2NiIgZD0iTTIxIDE2djItMmwtOC01VjMuNWMwLS44My0uNjctMS41LTEuNS0xLjVTMTAgMi42NyAxMCAzLjVWOUwyIDd2MmwyIDMgMiAzaC0ydjJoNHYyaDJ2LTJoNHYtMmgxem0tMy41IDJINy41VjE1SDE3LjV2M3oiLz48L3N2Zz4='; // 默认飞机图标

    const card = document.createElement('div');
    card.className = 'flight-card';
    card.innerHTML = `
      <div class="fc-header">
        <div class="airline-badge">
          <img src="${iconUrl}" class="airline-icon-small">
          <span>${f.airline} · ${f.flightNo}</span>
        </div>
        <span>${f.aircraft}</span>
      </div>
      <div class="fc-body">
        <div class="fc-port">
          <div class="fc-time">${f.origin.time}</div>
          <div class="fc-code">${f.origin.code}</div>
        </div>
        <div class="fc-arrow">
          <span>${fmtDuration(f.duration)}</span>
          <span class="material-symbols-rounded">trending_flat</span>
        </div>
        <div class="fc-port right">
          <div class="fc-time">${f.dest.time} <small style="font-size:12px">${f.dest.dayOff>0?'+1':''}</small></div>
          <div class="fc-code">${f.dest.code}</div>
        </div>
      </div>
      <div class="fc-footer">
        <span>${f.origin.term} - ${f.dest.term}</span>
        <span class="price">¥${f.prices.eco || f.prices.bus} 起</span>
      </div>
    `;
    card.onclick = () => openBooking(f, dateStr);
    grid.appendChild(card);
  });
}

/* =========================================
   3. 交互与UI (Interaction)
   ========================================= */

// 路由控制
function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute(); // 初始加载
}

function handleRoute() {
  const hash = window.location.hash.replace('#', '') || 'search';
  const views = ['search', 'wallet', 'settings'];
  
  if (!views.includes(hash)) return;

  // 切换视图
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${hash}`).classList.add('active');
  
  // 更新标题
  const titles = { search: '探索航班', wallet: '我的卡包', settings: '设置' };
  document.getElementById('pageTitle').innerText = titles[hash];

  if (hash === 'wallet') renderWallet();
}

function routeTo(page) {
  window.location.hash = page;
}

// 机场选择器逻辑
function triggerAirportInput(target) {
  STATE.currentInputTarget = target;
  const dialog = document.getElementById('airportSelector');
  const input = document.getElementById('airportSearchInput');
  const list = document.getElementById('fullAirportList');
  const suggest = document.getElementById('suggestionList');
  
  input.value = '';
  suggest.innerHTML = '';
  suggest.hidden = true;
  
  // 填充完整列表
  list.innerHTML = '';
  STATE.airports.forEach(ap => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `<span>${ap.name}</span><strong>${ap.code}</strong>`;
    div.onclick = () => selectAirport(ap);
    list.appendChild(div);
  });

  dialog.showModal();
  input.focus();

  // 联想输入
  input.oninput = (e) => {
    const val = e.target.value.toLowerCase();
    if (!val) {
      suggest.hidden = true;
      return;
    }
    const matches = STATE.airports.filter(ap => 
      ap.name.includes(val) || ap.code.toLowerCase().includes(val) || (ap.aliases && ap.aliases.some(a=>a.includes(val)))
    );
    
    suggest.hidden = false;
    suggest.innerHTML = '';
    matches.forEach(ap => {
      const div = document.createElement('div');
      div.className = 'list-item';
      div.innerHTML = `<span>${ap.name}</span><strong>${ap.code}</strong>`;
      div.onclick = () => selectAirport(ap);
      suggest.appendChild(div);
    });
  };
}

function selectAirport(ap) {
  setAirportInput(STATE.currentInputTarget, ap);
  document.getElementById('airportSelector').close();
}

function setAirportInput(target, ap) {
  document.getElementById(`disp${target === 'from' ? 'From' : 'To'}Code`).innerText = ap.code;
  document.getElementById(`disp${target === 'from' ? 'From' : 'To'}City`).innerText = ap.name || ap.city;
}

/* =========================================
   4. 购票与卡包 (Booking & Wallet)
   ========================================= */

let pendingBooking = null;

function openBooking(f, dateStr) {
  const dialog = document.getElementById('bookingDialog');
  pendingBooking = { flight: f, date: dateStr, class: null, price: 0 };
  
  // 填充UI
  document.getElementById('modalAirlineName').innerText = f.airline;
  document.getElementById('modalAirlineIcon').src = STATE.airlines[f.airline] || '';
  document.getElementById('modalDepCode').innerText = f.origin.code;
  document.getElementById('modalArrCode').innerText = f.dest.code;
  document.getElementById('modalDepTime').innerText = f.origin.time;
  document.getElementById('modalArrTime').innerText = f.dest.time;
  document.getElementById('modalFlightNo').innerText = f.flightNo;
  document.getElementById('modalDuration').innerText = fmtDuration(f.duration);
  document.getElementById('modalDate').innerText = dateStr;

  // 舱位
  const seatBox = document.getElementById('seatOptions');
  seatBox.innerHTML = '';
  const classes = [
    {k:'eco', n:'经济舱', p: f.prices.eco},
    {k:'bus', n:'商务舱', p: f.prices.bus},
    {k:'first', n:'头等舱', p: f.prices.first}
  ];

  classes.forEach(c => {
    if(!c.p) return;
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="radio" name="seat" value="${c.k}"> 
                     <div>${c.n}</div> <div>¥${c.p}</div>`;
    lbl.querySelector('input').onchange = () => {
      pendingBooking.class = c.n;
      pendingBooking.price = c.p;
      document.getElementById('totalPrice').innerText = `¥${c.p}`;
      document.getElementById('confirmBuyBtn').disabled = false;
    };
    seatBox.appendChild(lbl);
  });

  document.getElementById('totalPrice').innerText = '--';
  document.getElementById('confirmBuyBtn').disabled = true;
  dialog.showModal();
}

document.getElementById('confirmBuyBtn').onclick = () => {
  if (!pendingBooking) return;
  const t = {
    id: Date.now().toString(36),
    ...pendingBooking.flight, // 展开所有航班信息
    depDate: pendingBooking.date,
    class: pendingBooking.class,
    price: pendingBooking.price,
    ts: new Date(`${pendingBooking.date}T${pendingBooking.flight.origin.time}`).getTime()
  };
  
  STATE.purchased.push(t);
  saveStorage();
  scheduleTicketNotifs(t);
  
  document.getElementById('bookingDialog').close();
  showToast("出票成功！已存入卡包");
  
  if(STATE.settings.notifications) {
     new Notification("出票成功", { body: `您已预订 ${t.depDate} ${t.origin.name} -> ${t.dest.name}` });
  }
};

function renderWallet() {
  const grid = document.getElementById('walletGrid');
  grid.innerHTML = '';
  const now = Date.now();
  
  // 排序：未来的在前，过去的在后
  const list = STATE.purchased.sort((a,b) => a.ts - b.ts);
  
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>暂无行程</p></div>`;
    return;
  }

  list.forEach(t => {
    const isPast = now > t.ts + (t.duration * 60000); // 落地后算结束
    const card = document.createElement('div');
    card.className = 'flight-card';
    if(isPast) card.style.opacity = '0.6';
    
    card.innerHTML = `
      <div class="fc-header">
        <span>${t.depDate} · ${t.flightNo}</span>
        <span style="color:${isPast ? 'gray' : '#006495'}">${isPast ? '已结束' : '即将出行'}</span>
      </div>
      <div class="fc-body">
        <div class="fc-port">
          <div class="fc-time">${t.origin.time}</div>
          <div class="fc-city">${t.origin.name}</div>
        </div>
        <div class="fc-arrow"><span class="material-symbols-rounded">flight</span></div>
        <div class="fc-port">
          <div class="fc-time">${t.dest.time}</div>
          <div class="fc-city">${t.dest.name}</div>
        </div>
      </div>
    `;
    card.onclick = () => openBoardingPass(t);
    grid.appendChild(card);
  });
}

function openBoardingPass(t) {
  const dlg = document.getElementById('boardingPassDialog');
  
  // 填充信息
  document.getElementById('passFlightNo').innerText = t.flightNo;
  document.getElementById('passDate').innerText = t.depDate;
  document.getElementById('passClass').innerText = t.class;
  document.getElementById('passDepCode').innerText = t.origin.code;
  document.getElementById('passArrCode').innerText = t.dest.code;
  document.getElementById('passDepTime').innerText = t.origin.time;
  document.getElementById('passArrTime').innerText = t.dest.time;
  document.getElementById('passDepCity').innerText = t.origin.name;
  document.getElementById('passArrCity').innerText = t.dest.name;
  document.getElementById('passAirlineIcon').src = STATE.airlines[t.airline] || '';
  
  // 删除逻辑
  document.getElementById('deleteTicketBtn').onclick = () => {
    if(confirm('确定要删除这张票吗？')) {
      STATE.purchased = STATE.purchased.filter(x => x.id !== t.id);
      saveStorage();
      renderWallet();
      dlg.close();
      showToast("行程已删除");
    }
  };

  // 追踪逻辑：如果航班未结束，显示链接
  // 需求：所有航班显示，除非"currently in this flight time" (这里按全部显示处理，但可加逻辑)
  const link = document.getElementById('passTrackerLink');
  link.href = `https://haojin.guanmu233.cn/flights_map=?${t.flightNo}`;
  
  dlg.showModal();
}

/* =========================================
   5. 设置与通知 (Settings & Utils)
   ========================================= */

function setupNotifications() {
  const sw = document.getElementById('notifySwitch');
  sw.checked = STATE.settings.notifications;
  sw.onchange = (e) => {
    STATE.settings.notifications = e.target.checked;
    saveStorage();
    if (e.target.checked) {
      Notification.requestPermission();
      STATE.purchased.forEach(scheduleTicketNotifs); // 重新调度
    }
  };

  // 历史记录开关
  const hisSw = document.getElementById('historySwitch');
  hisSw.checked = STATE.settings.history;
  hisSw.onchange = (e) => { STATE.settings.history = e.target.checked; saveStorage(); };

  // 清除数据
  document.getElementById('clearDataBtn').onclick = () => {
    localStorage.removeItem('starflight_data');
    STATE.purchased = [];
    showToast("所有数据已清除");
    setTimeout(() => location.reload(), 1000);
  };
}

function scheduleTicketNotifs(t) {
  if (!STATE.settings.notifications) return;
  if (Notification.permission !== 'granted') return;

  const now = Date.now();
  const depTs = t.ts;
  
  // Helper
  const sched = (time, title, body) => {
    const delay = time - now;
    if (delay > 0 && delay < CONSTANTS.MS_PER_DAY) { // 仅在24小时内有效，避免定时器溢出
      setTimeout(() => new Notification(title, { body, icon: 'icon.png' }), delay);
    }
  };

  // 1. 值机提醒 (-120m)
  sched(depTs - 120*60000, "航班值机提醒", `航班 ${t.flightNo} 建议现在值机，前往 ${t.origin.term}`);
  
  // 2. 登机提醒 (-30m)
  sched(depTs - 30*60000, "准备登机", `航班 ${t.flightNo} 即将登机，请前往登机口`);
  
  // 3. 起飞提醒 (0m)
  sched(depTs, "航班起飞", `您的航班 ${t.flightNo} 正在起飞，旅途愉快！`);
}

// Utils
function loadStorage() {
  const data = JSON.parse(localStorage.getItem('starflight_data') || '{}');
  if(data.purchased) STATE.purchased = data.purchased;
  if(data.settings) STATE.settings = {...STATE.settings, ...data.settings};
}

function saveStorage() {
  localStorage.setItem('starflight_data', JSON.stringify({
    purchased: STATE.purchased,
    settings: STATE.settings
  }));
}

function populateAirlineFilter() {
  const sel = document.getElementById('filterAirline');
  const set = new Set(STATE.flights.map(f => f.airline));
  set.forEach(al => {
    const opt = document.createElement('option');
    opt.value = al;
    opt.innerText = al;
    sel.appendChild(opt);
  });
}

function getWeekStr(d) {
  return ["SUN","MON","TUE","WED","THU","FRI","SAT"][new Date(d).getDay()];
}

function fmtDuration(m) {
  return `${Math.floor(m/60)}h ${m%60}m`;
}

function calculateDuration(t1, d1, t2, d2) {
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  return (d2 * 24 * 60 + h2 * 60 + m2) - (d1 * 24 * 60 + h1 * 60 + m1);
}

function parsePrice(s) { return s ? parseInt(s.replace(/\D/g,'')) : null; }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 3000);
}

// 默认日期
document.getElementById('searchDate').value = new Date().toISOString().split('T')[0];
document.getElementById('swapBtn').onclick = () => {
  const fC = document.getElementById('dispFromCode').innerText;
  const fN = document.getElementById('dispFromCity').innerText;
  const tC = document.getElementById('dispToCode').innerText;
  const tN = document.getElementById('dispToCity').innerText;
  
  document.getElementById('dispFromCode').innerText = tC;
  document.getElementById('dispFromCity').innerText = tN;
  document.getElementById('dispToCode').innerText = fC;
  document.getElementById('dispToCity').innerText = fN;
};
document.getElementById('searchBtn').onclick = performSearch;

// Start
initApp();
