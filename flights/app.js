/* =========================================
   1. 核心状态与数据 (State & Data)
   ========================================= */
const STATE = {
  flights: [],
  airports: [], // 格式: { name, code }
  purchased: [],
  settings: {
    notifications: true, // 默认开启
    memory: true
  }
};

const DATES = {
  today: new Date(),
  weekMap: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
  
  fmt: (d) => d.toISOString().split('T')[0],
  
  addDays: (d, n) => {
    const res = new Date(d);
    res.setDate(res.getDate() + n);
    return res;
  },

  // 检查是否在时间范围内 (用于航班追踪按钮)
  isTimeBetween: (startStr, endStr, dateStr) => {
    // 构造完整时间对象
    const now = new Date();
    // 假设 dateStr 是航班日期 (YYYY-MM-DD)
    const start = new Date(`${dateStr}T${startStr}`);
    
    // 处理跨天 (如果结束时间小于开始时间，说明跨天)
    // 但这里简化处理，假设数据里的 timestamp 已经包含了日期信息
    // 实际上我们需要用 ticket.timestamp (起飞) 和 ticket.arrTimestamp
    return false; // 逻辑下移到具体渲染函数
  }
};

/* =========================================
   2. 初始化 (Init)
   ========================================= */
async function initApp() {
  loadStorage();
  await loadData();
  
  initUI();
  initInputs();
  
  // 恢复URL状态 (比如直接进入卡包)
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'wallet') {
    switchTab('wallet');
  }

  // 恢复上次搜索记忆
  if (STATE.settings.memory) {
    const mem = JSON.parse(localStorage.getItem('sf_search_mem') || '{}');
    if (mem.from) setInputSelection('From', mem.from.name, mem.from.code);
    if (mem.to) setInputSelection('To', mem.to.name, mem.to.code);
  }

  // 重新调度通知 (因为刷新页面后 timeout 会丢失)
  if (STATE.settings.notifications) {
    rescheduleAllNotifications();
  }
}

async function loadData() {
  try {
    const airRes = await fetch('../data/airports.json');
    const airData = await airRes.json();
    // 建立查找表
    STATE.airports = airData.map(a => ({
      name: a.name,
      code: a.code || "---", // 必须要有三字码
      searchStr: `${a.name}${a.code}${a.aliases?.join('')||''}`
    }));

    const fltRes = await fetch('../data/flight_data.txt');
    const txt = await fltRes.text();
    STATE.flights = parseFlights(txt);
  } catch (e) {
    console.error(e);
    showToast("数据加载异常");
  }
}

function loadStorage() {
  const tix = localStorage.getItem('sf_tickets');
  if (tix) STATE.purchased = JSON.parse(tix);
  
  const set = localStorage.getItem('sf_settings');
  if (set) STATE.settings = JSON.parse(set);
}

function saveStorage() {
  localStorage.setItem('sf_tickets', JSON.stringify(STATE.purchased));
  localStorage.setItem('sf_settings', JSON.stringify(STATE.settings));
}

/* =========================================
   3. 复杂输入框逻辑 (Complex Inputs)
   ========================================= */
function initInputs() {
  setupComplexInput('From');
  setupComplexInput('To');

  document.getElementById('swapBtn').addEventListener('click', () => {
    // 交换显示
    const dFrom = document.getElementById('dispFrom');
    const dTo = document.getElementById('dispTo');
    
    const code1 = dFrom.querySelector('.code').textContent;
    const city1 = dFrom.querySelector('.city').textContent;
    const code2 = dTo.querySelector('.code').textContent;
    const city2 = dTo.querySelector('.city').textContent;

    if (city1 === '选择城市' || city2 === '选择城市') return;

    setInputSelection('From', city2, code2);
    setInputSelection('To', city1, code1);
  });

  // 日期限制
  const dateInput = document.getElementById('searchDate');
  const minDate = DATES.fmt(new Date());
  const maxDate = DATES.fmt(DATES.addDays(new Date(), 60));
  dateInput.min = minDate;
  dateInput.max = maxDate;
  dateInput.value = minDate; // 默认今天
}

function setupComplexInput(type) {
  const group = document.getElementById(`group${type}`);
  const input = document.getElementById(`${type.toLowerCase()}Input`);
  const list = document.getElementById(`list${type}`);
  
  // 点击容器聚焦输入框
  group.addEventListener('click', () => {
    group.classList.add('editing');
    input.focus();
    list.hidden = false;
    renderSuggestions(type, input.value);
  });

  // 输入监听
  input.addEventListener('input', (e) => {
    renderSuggestions(type, e.target.value);
  });

  // 失去焦点 (延时为了让点击列表项生效)
  input.addEventListener('blur', () => {
    setTimeout(() => {
      group.classList.remove('editing');
      list.hidden = true;
      // 如果没选，清空输入以便下次显示placeholder
      if (input.value === '') {
        // 保持原样或重置
      }
    }, 200);
  });
}

function renderSuggestions(type, query) {
  const list = document.getElementById(`list${type}`);
  list.innerHTML = '';
  
  const matches = STATE.airports.filter(ap => {
    if (!query) return true; // 显示全部
    return ap.searchStr.toLowerCase().includes(query.toLowerCase());
  }).slice(0, 10); // 最多显示10个

  if (matches.length === 0) {
    list.innerHTML = `<li style="color:#999; justify-content:center">无匹配结果</li>`;
    return;
  }

  matches.forEach(ap => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${ap.name}</span> <span class="hl">${ap.code}</span>`;
    li.onclick = (e) => {
      e.stopPropagation(); // 防止冒泡触发 input focus
      setInputSelection(type, ap.name, ap.code);
      document.getElementById(`list${type}`).hidden = true;
      document.getElementById(`group${type}`).classList.remove('editing');
    };
    list.appendChild(li);
  });
}

function setInputSelection(type, name, code) {
  const disp = document.getElementById(`disp${type}`);
  const input = document.getElementById(`${type.toLowerCase()}Input`);
  
  disp.querySelector('.code').textContent = code;
  disp.querySelector('.city').textContent = name;
  input.value = name; // 设置 input value 方便后续校验

  // 保存记忆
  if (STATE.settings.memory) {
    const mem = JSON.parse(localStorage.getItem('sf_search_mem') || '{}');
    mem[type.toLowerCase()] = { name, code };
    localStorage.setItem('sf_search_mem', JSON.stringify(mem));
  }
}

/* =========================================
   4. 搜索与过滤 (Search Logic)
   ========================================= */
document.getElementById('searchBtn').addEventListener('click', () => {
  const fromCity = document.getElementById('dispFrom').querySelector('.city').textContent;
  const toCity = document.getElementById('dispTo').querySelector('.city').textContent;
  const dateVal = document.getElementById('searchDate').value;
  
  if (fromCity === '选择城市' || toCity === '选择城市') {
    showToast("请完善出发地和目的地");
    return;
  }

  // 星期匹配
  const selDate = new Date(dateVal);
  const weekStr = DATES.weekMap[selDate.getDay()];

  // 当前时间 (用于今天过滤)
  const now = new Date();
  const isToday = dateVal === DATES.fmt(now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const results = STATE.flights.filter(f => {
    // 地点匹配 (模糊匹配 txt 中的出发到达地名)
    // 注意：txt里的出发地名可能包含机场名，而airports.json是标准名
    // 只要 input 里的标准名 包含在 txt 字符串里，或 txt 包含标准名即可
    const matchFrom = f.origin.name.includes(fromCity) || fromCity.includes(f.origin.name);
    const matchTo = f.dest.name.includes(toCity) || toCity.includes(f.dest.name);
    const matchWeek = f.weekdays.includes(weekStr);
    
    let timeValid = true;
    if (isToday) {
      // 过滤已经起飞的航班
      const [h, m] = f.origin.time.split(':').map(Number);
      const fMins = h * 60 + m;
      if (fMins < nowMins) timeValid = false;
    }

    return matchFrom && matchTo && matchWeek && timeValid;
  });

  renderResults(results, dateVal);
  
  // 移动端：如果是手机，稍微滚动
  if (window.innerWidth < 768) {
    document.getElementById('flightGrid').scrollIntoView({ behavior: 'smooth' });
  }
});

function renderResults(list, dateStr) {
  const grid = document.getElementById('flightGrid');
  const header = document.getElementById('resultsHeader');
  grid.innerHTML = '';
  header.hidden = false;

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">sentiment_dissatisfied</span><p>暂无符合条件的航班</p></div>`;
    return;
  }

  list.forEach(f => {
    const el = document.createElement('div');
    el.className = 'flight-card';
    el.innerHTML = `
      <div class="fc-header">
        <span>${f.airline} ${f.flightNo}</span>
        <span>${f.aircraft}</span>
      </div>
      <div class="fc-body">
        <div class="fc-port">
          <div class="time">${f.origin.time}</div>
          <div class="code">${f.origin.name}</div>
        </div>
        <div class="fc-arrow">
          <span class="plane-icon material-symbols-rounded">flight_takeoff</span>
          <div class="line"></div>
          <span>${fmtDuration(f.duration)}</span>
        </div>
        <div class="fc-port">
          <div class="time">${f.dest.time} <small>${f.dest.dayOff>0?'+1':''}</small></div>
          <div class="code">${f.dest.name}</div>
        </div>
      </div>
      <div class="fc-footer">
        <span>设备 ${f.equip}</span>
        <span class="price">¥${f.price.eco || f.price.bus}</span>
      </div>
    `;
    el.onclick = () => openBooking(f, dateStr);
    grid.appendChild(el);
  });
}

/* =========================================
   5. 购票逻辑 (Booking)
   ========================================= */
let currentOrder = null;

function openBooking(flight, dateStr) {
  const dlg = document.getElementById('bookingDialog');
  currentOrder = { flight, dateStr, seat: null, price: 0 };
  
  // 填充 UI
  document.getElementById('modalDepCode').textContent = getCodeByName(flight.origin.name);
  document.getElementById('modalDepCity').textContent = flight.origin.name;
  document.getElementById('modalArrCode').textContent = getCodeByName(flight.dest.name);
  document.getElementById('modalArrCity').textContent = flight.dest.name;
  
  document.getElementById('modalDate').textContent = dateStr;
  document.getElementById('modalDepTime').textContent = flight.origin.time;
  document.getElementById('modalFlightNo').textContent = flight.flightNo;
  document.getElementById('modalAircraft').textContent = flight.aircraft;
  document.getElementById('modalDuration').textContent = fmtDuration(flight.duration);

  // 舱位
  const opts = document.getElementById('seatOptions');
  opts.innerHTML = '';
  const classes = [
    {id:'eco', name:'经济舱', p: flight.price.eco},
    {id:'bus', name:'商务舱', p: flight.price.bus},
    {id:'fst', name:'头等舱', p: flight.price.fst}
  ];

  classes.forEach(c => {
    if (!c.p) return;
    const div = document.createElement('div');
    div.className = 'seat-opt';
    div.innerHTML = `<span>${c.name}</span> <b>¥${c.p}</b>`;
    div.onclick = () => {
      document.querySelectorAll('.seat-opt').forEach(x => x.classList.remove('selected'));
      div.classList.add('selected');
      currentOrder.seat = c.name;
      currentOrder.price = c.p;
      document.getElementById('totalPrice').textContent = `¥${c.p}`;
      document.getElementById('confirmBuyBtn').disabled = false;
    };
    opts.appendChild(div);
  });

  document.getElementById('totalPrice').textContent = '--';
  document.getElementById('confirmBuyBtn').disabled = true;
  
  dlg.showModal();
}

document.getElementById('closeBookingBtn').onclick = () => document.getElementById('bookingDialog').close();

document.getElementById('confirmBuyBtn').onclick = () => {
  if (!currentOrder) return;
  
  // 生成票据 ID
  const tid = 'TKT' + Date.now().toString().slice(-6);
  
  // 计算精确的时间戳
  const depTs = new Date(`${currentOrder.dateStr}T${currentOrder.flight.origin.time}`).getTime();
  const arrTs = depTs + currentOrder.flight.duration * 60000;

  const ticket = {
    id: tid,
    flight: currentOrder.flight,
    date: currentOrder.dateStr,
    seat: currentOrder.seat,
    tsDep: depTs,
    tsArr: arrTs,
    tsBuy: Date.now()
  };

  STATE.purchased.push(ticket);
  saveStorage();
  
  showToast("出票成功，请前往卡包查看");
  document.getElementById('bookingDialog').close();
  
  // 触发一次通知调度
  if (STATE.settings.notifications) {
    scheduleTicketNotifs(ticket);
    sendSysNotif("购票成功", `您已成功预订 ${ticket.flight.flightNo} 前往 ${ticket.flight.dest.name}`);
  }
  
  switchTab('wallet');
};


/* =========================================
   6. 卡包与登机牌 (Wallet & Boarding Pass)
   ========================================= */
function renderWallet() {
  const grid = document.getElementById('walletGrid');
  grid.innerHTML = '';
  
  const list = STATE.purchased.sort((a,b) => a.tsDep - b.tsDep);
  
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>还没有行程</p></div>`;
    return;
  }

  list.forEach(t => {
    const isPast = Date.now() > t.tsArr;
    const div = document.createElement('div');
    div.className = 'flight-card';
    if(isPast) div.style.opacity = '0.6';
    
    div.innerHTML = `
      <div class="fc-header">
        <span>${t.date} · ${t.flight.flightNo}</span>
        <span style="color:${isPast?'gray':'#006495'}">${isPast?'已结束':'待出行'}</span>
      </div>
      <div class="fc-body">
        <div class="fc-port">
          <div class="time">${t.flight.origin.time}</div>
          <div class="code">${t.flight.origin.name}</div>
        </div>
        <div class="fc-arrow">
          <span class="material-symbols-rounded" style="font-size:24px; color:var(--primary)">qr_code_2</span>
          <div style="font-size:10px; margin-top:4px">点击查看登机牌</div>
        </div>
        <div class="fc-port">
          <div class="time">${t.flight.dest.time}</div>
          <div class="code">${t.flight.dest.name}</div>
        </div>
      </div>
    `;
    div.onclick = () => showBoardingPass(t);
    grid.appendChild(div);
  });
}

function showBoardingPass(ticket) {
  const dlg = document.getElementById('boardingPassDialog');
  
  // 填充信息
  document.getElementById('bpAirline').textContent = ticket.flight.airline;
  document.getElementById('bpDepCode').textContent = getCodeByName(ticket.flight.origin.name);
  document.getElementById('bpArrCode').textContent = getCodeByName(ticket.flight.dest.name);
  document.getElementById('bpDepTime').textContent = ticket.flight.origin.time;
  document.getElementById('bpArrTime').textContent = ticket.flight.dest.time;
  
  document.getElementById('bpDate').textContent = ticket.date;
  document.getElementById('bpFlight').textContent = ticket.flight.flightNo;
  document.getElementById('bpClass').textContent = ticket.seat;
  document.getElementById('bpEquip').textContent = ticket.flight.equip;

  // 追踪逻辑：当前时间是否在飞行中
  const now = Date.now();
  const trackerSec = document.getElementById('bpTrackerSection');
  const trackerLink = document.getElementById('bpTrackerLink');
  
  // 严格要求：处于飞行时间中才显示
  if (now >= ticket.tsDep && now <= ticket.tsArr) {
    trackerSec.hidden = false;
    // 假设 URL 结构
    trackerLink.href = `https://haojin.guanmu233.cn/flights_map=?${ticket.flight.flightNo}`;
  } else {
    trackerSec.hidden = true;
  }

  // 删除功能绑定
  const delBtn = document.getElementById('deleteTicketBtn');
  delBtn.onclick = () => {
    if(confirm("确定要删除这张登机牌吗？")) {
      STATE.purchased = STATE.purchased.filter(x => x.id !== ticket.id);
      saveStorage();
      renderWallet();
      dlg.close();
      showToast("已删除");
    }
  };

  dlg.showModal();
}
document.getElementById('closeBpBtn').onclick = () => document.getElementById('boardingPassDialog').close();

/* =========================================
   7. 通知系统 (Notification System)
   ========================================= */

// 请求权限
document.getElementById('notifySwitch').addEventListener('change', (e) => {
  STATE.settings.notifications = e.target.checked;
  saveStorage();
  if (e.target.checked) {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
    rescheduleAllNotifications();
    showToast("通知已开启");
  } else {
    showToast("通知已关闭");
  }
});

function sendSysNotif(title, body) {
  if (Notification.permission === 'granted' && STATE.settings.notifications) {
    new Notification(title, { body, icon: '../assets/icon.png' });
  }
}

// 调度单个订单的所有提醒
function scheduleTicketNotifs(t) {
  const now = Date.now();
  const tasks = [
    { offset: -120 * 60000, msg: `航班 ${t.flight.flightNo} 现已开放值机` },
    { offset: -30 * 60000, msg: `航班 ${t.flight.flightNo} 即将登机，请前往登机口` },
    { offset: 0, msg: `航班 ${t.flight.flightNo} 正在起飞，祝您旅途愉快` }
  ];

  tasks.forEach(task => {
    const triggerTime = t.tsDep + task.offset;
    const delay = triggerTime - now;
    if (delay > 0 && delay < 24 * 60 * 60 * 1000) { // 只调度24小时内的
      console.log(`设置定时器: ${Math.round(delay/1000)}秒后提醒 - ${task.msg}`);
      setTimeout(() => sendSysNotif("星际航行提醒", task.msg), delay);
    }
  });
}

// 重新加载所有提醒
function rescheduleAllNotifications() {
  STATE.purchased.forEach(t => {
    if (t.tsArr > Date.now()) { // 只处理未结束的行程
      scheduleTicketNotifs(t);
    }
  });
}

/* =========================================
   8. 工具函数 (Utils)
   ========================================= */

function switchTab(tab) {
  // 视觉切换
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  // 简单根据索引找不太靠谱，最好用 data-target，这里简化
  // 你可以给 HTML 里的 nav-item 加上 data-tab="search"
  
  // 更新 View
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${tab}`).classList.add('active');
  
  // 更新 URL 方便刷新保持
  const url = new URL(window.location);
  url.searchParams.set('view', tab);
  window.history.pushState({}, '', url);

  if (tab === 'wallet') renderWallet();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// 解析 TXT
function parseFlights(raw) {
  const entries = raw.split("《航班结束》").filter(s => s.trim());
  return entries.map(str => {
    try {
      const flightNo = str.match(/【(.*?)】/)?.[1];
      const aircraft = str.match(/〔(.*?)〕/)?.[1];
      const airline = str.match(/『(.*?)』/)?.[1];
      const equip = str.match(/<(R-.*?)>/)?.[1] || "未定";
      
      const depM = str.match(/《(.*?)出发》{(.*?)}#\+(\d+)#/);
      const arrM = str.match(/《(.*?)到达》{(.*?)}#\+(\d+)#/);
      
      const ecoP = str.match(/§(.*?)元§/)?.[1];
      const busP = str.match(/θ(.*?)元θ/)?.[1];
      const fstP = str.match(/△(.*?)元△/)?.[1];
      
      // 星期
      const weekM = str.match(/«(.*?)»/)?.[1] || "";
      
      // 计算时长
      const [dh, dm] = depM[2].split(':').map(Number);
      const [ah, am] = arrM[2].split(':').map(Number);
      const dMin = dh*60 + dm;
      const aMin = (parseInt(arrM[3])*24*60) + ah*60 + am;
      const dur = aMin - dMin;

      return {
        flightNo, aircraft, airline, equip,
        weekdays: weekM.split(',').map(s=>s.trim()),
        duration: dur,
        origin: { name: depM[1], time: depM[2], dayOff: parseInt(depM[3]) },
        dest: { name: arrM[1], time: arrM[2], dayOff: parseInt(arrM[3]) },
        price: { eco: parseInt(ecoP), bus: parseInt(busP), fst: parseInt(fstP) }
      };
    } catch(e) { return null; }
  }).filter(Boolean);
}

function fmtDuration(m) {
  const h = Math.floor(m/60);
  const min = m%60;
  return `${h}h ${min}m`;
}

// 辅助：根据中文名找 Code
function getCodeByName(name) {
  const found = STATE.airports.find(a => name.includes(a.name) || a.name.includes(name));
  return found ? found.code : "---";
}

// 设置清除
document.getElementById('clearDataBtn').onclick = () => {
  localStorage.removeItem('sf_tickets');
  localStorage.removeItem('sf_search_mem');
  STATE.purchased = [];
  renderWallet();
  showToast("数据已清空");
};

document.getElementById('homeBtn').onclick = () => switchTab('search');

// 启动
initApp();
