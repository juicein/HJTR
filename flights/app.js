/* =========================================
   1. 状态与配置
   ========================================= */
const STATE = {
  flights: [],
  airports: [],
  airlines: [],
  purchased: [],
  settings: {
    notifications: false,
    rememberRoute: false,
    lastDep: '',
    lastArr: ''
  }
};

const DATES = {
  today: new Date(),
  weekMap: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
  fmt: (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
};

/* =========================================
   2. 初始化与数据加载
   ========================================= */
async function initApp() {
  await loadData();
  loadStorage();
  
  initNavigation();
  initSearchUI();
  initSettingsUI();
  
  // URL 路由检查 (?view=wallet)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('view') === 'wallet') {
    switchView('wallet');
  } else {
    // 恢复记忆的航线
    if (STATE.settings.rememberRoute) {
      if(STATE.settings.lastDep) setStationInput('dep', STATE.settings.lastDep);
      if(STATE.settings.lastArr) setStationInput('arr', STATE.settings.lastArr);
    }
  }

  // 启动通知检查
  checkNotifications();
  setInterval(checkNotifications, 60000); // 每分钟检查一次
}

async function loadData() {
  try {
    const [airRes, fltRes, alRes] = await Promise.all([
      fetch('../data/airports.json'),
      fetch('../data/flight_data.txt'),
      fetch('../data/airlines.json').catch(() => ({ json: () => [] })) // 容错
    ]);

    STATE.airports = await airRes.json();
    STATE.airlines = await alRes.json();
    const rawText = await fltRes.text();
    STATE.flights = parseFlightData(rawText);
    
    // 填充 datalist
    const dl = document.getElementById('airportList');
    STATE.airports.forEach(ap => {
      const opt = document.createElement('option');
      opt.value = ap.name; // 联想词
      dl.appendChild(opt);
    });

  } catch (e) {
    showToast("数据加载异常，请检查 data 目录");
    console.error(e);
  }
}

// 解析逻辑 (保持原有逻辑，增加航司匹配)
function parseFlightData(raw) {
  const entries = raw.split("《航班结束》").map(s => s.trim()).filter(Boolean);
  return entries.map(str => {
    try {
      const flightNo = str.match(/【(.*?)】/)?.[1] || "Unknown";
      const airlineName = str.match(/『(.*?)』/)?.[1] || "Unknown";
      
      // 查找 Logo
      const alObj = STATE.airlines.find(a => a.name === airlineName) || STATE.airlines.find(a => a.name === "默认");
      const logo = alObj ? alObj.logo : "";

      const depMatch = str.match(/《(.*?)出发》{(.*?)}#\+(\d+)#@(.*?)@/);
      const arrMatch = str.match(/《(.*?)到达》{(.*?)}#\+(\d+)#@(.*?)@/);

      return {
        raw: str,
        flightNo, airline: airlineName, logo,
        weekdays: (str.match(/«(.*?)»/)?.[1] || "").split(",").map(s=>s.trim()),
        aircraft: str.match(/〔(.*?)〕/)?.[1] || "",
        equip: str.match(/<(R-.*?)>/)?.[1] || "",
        origin: { name: depMatch[1], time: depMatch[2], dayOff: parseInt(depMatch[3]), term: depMatch[4] },
        dest:   { name: arrMatch[1], time: arrMatch[2], dayOff: parseInt(arrMatch[3]), term: arrMatch[4] },
        prices: {
          eco: parsePrice(str.match(/§(.*?)§/)?.[1]),
          bus: parsePrice(str.match(/θ(.*?)θ/)?.[1]),
          first: parsePrice(str.match(/△(.*?)△/)?.[1])
        }
      };
    } catch(e) { return null; }
  }).filter(Boolean);
}

function parsePrice(s) { return s ? parseInt(s.replace(/\D/g,'')) : null; }

/* =========================================
   3. 交互逻辑 (Search & Inputs)
   ========================================= */

// 自定义输入框逻辑：大字显示代码，小字显示名称
function setStationInput(type, airportName) {
  const airport = STATE.airports.find(a => a.name === airportName);
  const codeEl = document.getElementById(`${type}CodeDisplay`);
  const nameEl = document.getElementById(`${type}NameDisplay`);
  const inputEl = document.getElementById(`${type}Input`);

  if (airport) {
    codeEl.textContent = airport.code;
    nameEl.textContent = airport.name;
    inputEl.value = airport.name; // 确保输入框值同步
  } else {
    // 手动输入的情况
    codeEl.textContent = "???";
    nameEl.textContent = airportName || (type==='dep'?'出发地':'目的地');
    inputEl.value = airportName;
  }
  
  // 记忆
  if (STATE.settings.rememberRoute) {
    if(type==='dep') STATE.settings.lastDep = airportName;
    if(type==='arr') STATE.settings.lastArr = airportName;
    saveStorage();
  }
}

function initSearchUI() {
  // 绑定输入框事件 (当用户在 ghost-input 中输入并失焦时更新UI)
  ['dep', 'arr'].forEach(type => {
    const input = document.getElementById(`${type}Input`);
    input.addEventListener('change', (e) => setStationInput(type, e.target.value));
    input.addEventListener('input', (e) => {
        // 实时联想已经在 datalist 中处理，这里只做简单的UI反馈
    });
  });

  // 交换按钮
  document.getElementById('swapBtn').addEventListener('click', () => {
    const depVal = document.getElementById('depInput').value;
    const arrVal = document.getElementById('arrInput').value;
    setStationInput('dep', arrVal);
    setStationInput('arr', depVal);
  });

  // 全量机场列表按钮
  document.getElementById('showAllAirportsBtn').addEventListener('click', () => {
    const dialog = document.getElementById('airportDialog');
    const container = document.getElementById('airportListContainer');
    container.innerHTML = '';
    
    STATE.airports.forEach(ap => {
      const btn = document.createElement('button');
      btn.className = 'airport-item-btn';
      btn.innerHTML = `<strong>${ap.code}</strong><span>${ap.name}</span>`;
      btn.onclick = () => {
        // 简单的逻辑：如果出发地没填填出发，否则填到达
        if (document.getElementById('depInput').value === '') {
          setStationInput('dep', ap.name);
        } else {
          setStationInput('arr', ap.name);
        }
        dialog.close();
      };
      container.appendChild(btn);
    });
    dialog.showModal();
  });
  
  document.getElementById('closeAirportDialog').onclick = () => document.getElementById('airportDialog').close();

  // 日期限制逻辑
  const dateInput = document.getElementById('searchDate');
  const todayStr = DATES.fmt(DATES.today);
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 60);
  
  dateInput.min = todayStr;
  dateInput.max = DATES.fmt(maxDate);
  dateInput.value = todayStr;

  // 搜索按钮
  document.getElementById('searchBtn').addEventListener('click', performSearch);
}

function performSearch() {
  const from = document.getElementById('depInput').value.trim();
  const to = document.getElementById('arrInput').value.trim();
  const dateVal = document.getElementById('searchDate').value;

  if (!from || !to || !dateVal) {
    showToast("请完善搜索信息");
    return;
  }

  // 严格的时间校验
  const now = new Date();
  const selectedDate = new Date(dateVal);
  const isToday = selectedDate.toDateString() === now.toDateString();

  const weekStr = DATES.weekMap[selectedDate.getDay()];
  
  const results = STATE.flights.filter(f => {
    const matchRoute = f.origin.name.includes(from) && f.dest.name.includes(to);
    const matchDay = f.weekdays.includes(weekStr);
    
    if (matchRoute && matchDay) {
        // 如果是今天，检查起飞时间是否已过
        if (isToday) {
            const [h, m] = f.origin.time.split(':').map(Number);
            const depMins = h * 60 + m;
            const nowMins = now.getHours() * 60 + now.getMinutes();
            if (depMins < nowMins) return false; // 已起飞
        }
        return true;
    }
    return false;
  });
  
  renderResults(results, dateVal);
}

function renderResults(list, dateStr) {
  const grid = document.getElementById('flightGrid');
  const countDisplay = document.getElementById('resultCount');
  grid.innerHTML = '';
  countDisplay.textContent = `找到 ${list.length} 个航班`;

  list.forEach(f => {
    const card = document.createElement('div');
    card.className = 'flight-card';
    card.innerHTML = `
      <div class="card-head">
        <div class="airline-badge">
           <img src="${f.logo}" alt="logo">
           ${f.airline}
        </div>
        <span style="font-size:12px;color:gray">${f.aircraft}</span>
      </div>
      <div class="card-route">
        <div>
          <div class="route-time">${f.origin.time}</div>
          <div class="route-city">${f.origin.name}</div>
        </div>
        <div class="route-arrow">
           <span>${f.flightNo}</span>
           <span class="material-symbols-rounded">trending_flat</span>
        </div>
        <div>
          <div class="route-time">${f.dest.time}</div>
          <div class="route-city">${f.dest.name}</div>
        </div>
      </div>
      <div class="card-price">¥${f.prices.eco || f.prices.bus} 起</div>
    `;
    card.onclick = () => openBooking(f, dateStr);
    grid.appendChild(card);
  });
}

/* =========================================
   4. 购票与卡包 (Wallet & Booking)
   ========================================= */
let currentOrder = null;

function openBooking(flight, dateStr) {
    const dialog = document.getElementById('bookingDialog');
    currentOrder = { flight, dateStr };
    
    // 渲染预览
    document.getElementById('bookingPreview').innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:8px">
        <strong>${flight.depName} → ${flight.arrName}</strong>
        <span>${dateStr}</span>
      </div>
      <div style="font-size:12px; color:gray">${flight.flightNo} | ${flight.aircraft}</div>
    `;

    // 实时动态按钮逻辑: 只要点开就显示，除非需要更复杂的“正在飞行中”判断
    // 题目要求：所有航班显示，如果正在飞显示。
    // 这里简单处理：始终显示，点击跳转链接
    const trackerLink = document.getElementById('trackerLink');
    trackerLink.href = `https://haojin.guanmu233.cn/flights_map=?${flight.flightNo}`;

    // 舱位渲染
    const seatContainer = document.getElementById('seatOptions');
    seatContainer.innerHTML = '';
    
    const classes = [
       {n: '经济舱', p: flight.prices.eco}, 
       {n: '商务舱', p: flight.prices.bus}, 
       {n: '头等舱', p: flight.prices.first}
    ];

    classes.forEach(c => {
        if(!c.p) return;
        const div = document.createElement('div');
        div.style.padding = "8px";
        div.style.border = "1px solid #ccc";
        div.style.borderRadius = "8px";
        div.style.marginBottom = "4px";
        div.style.cursor = "pointer";
        div.innerHTML = `<input type="radio" name="seat" value="${c.n}"> ${c.n} <b style="float:right">¥${c.p}</b>`;
        
        div.onclick = () => {
            div.querySelector('input').checked = true;
            document.getElementById('totalPrice').textContent = `¥${c.p}`;
            document.getElementById('confirmBuyBtn').disabled = false;
            currentOrder.seatClass = c.n;
            currentOrder.price = c.p;
        };
        seatContainer.appendChild(div);
    });
    
    dialog.showModal();
}

document.getElementById('confirmBuyBtn').onclick = () => {
    // 购买逻辑
    const now = Date.now();
    const depTimeStr = `${currentOrder.dateStr}T${currentOrder.flight.origin.time}`;
    const depTimestamp = new Date(depTimeStr).getTime();
    
    const ticket = {
        id: 'TK' + now.toString(36),
        flight: currentOrder.flight, // 存入完整数据方便调用
        date: currentOrder.dateStr,
        seat: currentOrder.seatClass,
        ts: depTimestamp,
        purchasedAt: now
    };
    
    STATE.purchased.push(ticket);
    saveStorage();
    showToast("购买成功！已存入卡包");
    document.getElementById('bookingDialog').close();
    
    // 触发购买通知
    sendSystemNotify("购买成功", `您已成功预订 ${ticket.flight.flightNo}，祝旅途愉快。`);
};

// 渲染卡包
function renderWallet() {
    const grid = document.getElementById('walletGrid');
    grid.innerHTML = '';
    
    STATE.purchased.sort((a,b) => b.ts - a.ts).forEach(tk => {
        const isPast = Date.now() > tk.ts + (3600*1000*4); // 4小时后算过期
        const f = tk.flight;
        
        const card = document.createElement('div');
        card.className = 'flight-card';
        if(isPast) card.style.opacity = '0.6';
        
        card.innerHTML = `
          <div class="card-head">
             <div class="airline-badge"><img src="${f.logo}"> ${f.airline}</div>
             <span class="material-symbols-rounded" style="color:${isPast?'gray':'#006493'}">qr_code_2</span>
          </div>
          <div class="card-route">
            <div><div class="route-time">${f.origin.time}</div><div class="route-city">${f.origin.name}</div></div>
            <div class="route-arrow"><span>${f.flightNo}</span>➔</div>
            <div><div class="route-time">${f.dest.time}</div><div class="route-city">${f.dest.name}</div></div>
          </div>
          <div style="margin-top:8px; font-size:12px; display:flex; justify-content:space-between;">
             <span>${tk.date}</span>
             <strong>${tk.seat}</strong>
          </div>
        `;
        card.onclick = () => showBoardingPass(tk);
        grid.appendChild(card);
    });
}

function showBoardingPass(ticket) {
    const dialog = document.getElementById('boardingPassDialog');
    const f = ticket.flight;
    
    // 填充数据
    document.getElementById('bpLogo').src = f.logo;
    document.getElementById('bpAirline').textContent = f.airline;
    document.getElementById('bpFlight').textContent = f.flightNo;
    document.getElementById('bpDate').textContent = ticket.date;
    
    // 尝试获取三字码，如果没有则显示前三个字
    const findCode = (name) => STATE.airports.find(a=>a.name===name)?.code || name.substr(0,3);
    document.getElementById('bpDepCode').textContent = findCode(f.origin.name);
    document.getElementById('bpArrCode').textContent = findCode(f.dest.name);
    
    document.getElementById('bpDepTime').textContent = f.origin.time;
    document.getElementById('bpArrTime').textContent = f.dest.time;
    document.getElementById('bpClass').textContent = ticket.seat;
    document.getElementById('bpEquip').textContent = f.equip || f.aircraft;
    
    // 二维码 (使用 QR Server API)
    document.getElementById('bpQr').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${ticket.id}|${f.flightNo}`;
    
    // 删除按钮
    document.getElementById('deleteTicketBtn').onclick = () => {
        if(confirm('确定要删除这张登机牌吗？')) {
            STATE.purchased = STATE.purchased.filter(t => t.id !== ticket.id);
            saveStorage();
            renderWallet();
            dialog.close();
        }
    };
    
    dialog.showModal();
}

/* =========================================
   5. 通知与设置
   ========================================= */

function initNavigation() {
  document.querySelectorAll('.nav-btn[data-target]').forEach(btn => {
    btn.onclick = () => {
        const target = btn.dataset.target;
        switchView(target);
        // 更新 Topbar 状态
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    };
  });
  
  document.getElementById('homeBtn').onclick = () => switchView('search');
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');
    
    // 动态刷新
    if(viewId === 'wallet') renderWallet();
    
    // 更新 URL hash，方便直接访问
    history.pushState(null, '', `?view=${viewId}`);
}

function initSettingsUI() {
    const swNotify = document.getElementById('notifyMasterSwitch');
    const swRoute = document.getElementById('rememberRouteSwitch');
    
    swNotify.checked = STATE.settings.notifications;
    swRoute.checked = STATE.settings.rememberRoute;
    
    swNotify.onchange = (e) => {
        STATE.settings.notifications = e.target.checked;
        saveStorage();
        if(e.target.checked) Notification.requestPermission();
    };
    
    swRoute.onchange = (e) => {
        STATE.settings.rememberRoute = e.target.checked;
        saveStorage();
    };
    
    document.getElementById('clearDataBtn').onclick = () => {
        localStorage.removeItem('starflight_data');
        location.reload();
    };
}

function checkNotifications() {
    if (!STATE.settings.notifications || Notification.permission !== 'granted') return;
    
    const now = Date.now();
    STATE.purchased.forEach(tk => {
        // 防止重复通知需要记录 flag (这里简化处理，实际开发需要记录已通知状态)
        // 简单逻辑：检查时间差是否在 [T-1min, T+1min] 范围内触发
        // 由于是 setInterval 1分钟一次，这里做区间匹配
        
        const depT = tk.ts;
        const diffMins = Math.floor((depT - now) / 60000);
        
        // 1. 值机 (提前120分)
        if (diffMins === 120) sendSystemNotify("值机提醒", `航班 ${tk.flight.flightNo} 现已开放值机。`);
        
        // 2. 登机 (提前30分)
        if (diffMins === 30) sendSystemNotify("登机提醒", `航班 ${tk.flight.flightNo} 开始登机，请前往登机口。`);
        
        // 3. 起飞 (0分)
        if (diffMins === 0) sendSystemNotify("起飞提醒", `航班 ${tk.flight.flightNo} 即将起飞。`);
    });
}

function sendSystemNotify(title, body) {
    new Notification(title, {
        body: body,
        icon: '../data/icon.png' // 假设有个图标，没有也没关系
    });
}

function loadStorage() {
    const data = localStorage.getItem('starflight_data');
    if(data) Object.assign(STATE, JSON.parse(data));
}
function saveStorage() {
    localStorage.setItem('starflight_data', JSON.stringify({
        purchased: STATE.purchased,
        settings: STATE.settings
    }));
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// 启动
initApp();
