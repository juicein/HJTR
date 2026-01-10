/* =========================================
   1. Core Data & Config
   ========================================= */

const CONFIG = {
  maxDays: 60,
  notificationOffsets: [
    { label: 'checkin', min: -120, msg: '航班还有2小时起飞，请确认航站楼并值机' },
    { label: 'boarding', min: -30, msg: '航班即将开始登机，请前往登机口' },
    { label: 'takeoff', min: 0, msg: '航班计划起飞，祝您旅途愉快' }
  ]
};

const STATE = {
  flights: [],
  airports: [],
  airlines: [], // New
  purchased: [],
  settings: {
    notifications: false, // Default OFF
    rememberInputs: true
  },
  notificationTimers: [] // Store timer IDs
};

const DATES = {
  weekMap: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
  today: new Date(),
  fmtDate: (d) => d.toISOString().split('T')[0],
  getWeekStr: (dateStr) => DATES.weekMap[new Date(dateStr).getDay()],
  // Helper: Get flight timestamp based on date string and time string (HH:MM)
  getTimestamp: (dateStr, timeStr) => new Date(`${dateStr}T${timeStr}:00`).getTime()
};

/* =========================================
   2. Initialization
   ========================================= */

async function initApp() {
  await loadData();
  loadStorage();
  initUI();
  handleHashRouting();
  
  // Re-schedule notifications if enabled
  if (STATE.settings.notifications) {
    rescheduleAllNotifications();
  }
}

async function loadData() {
  try {
    const [airRes, flightRes, airlineRes] = await Promise.all([
      fetch('data/airports.json'),
      fetch('data/flight_data.txt'),
      fetch('data/airlines.json').catch(() => ({ json: () => [] })) // Fallback
    ]);

    STATE.airports = await airRes.json();
    STATE.airlines = await airlineRes.json(); // Load Airlines
    const rawText = await flightRes.text();
    STATE.flights = parseFlightData(rawText);

    populateDatalist();
    populateAirlineFilter();
  } catch (e) {
    console.error("Data Load Error:", e);
    showToast("数据加载部分失败");
  }
}

/* =========================================
   3. Parsing Logic (Regex)
   ========================================= */
function parseFlightData(raw) {
  const entries = raw.split("《航班结束》").map(s => s.trim()).filter(Boolean);
  return entries.map(str => {
    try {
      const flightNo = str.match(/【(.*?)】/)?.[1] || "Unknown";
      const weekdays = (str.match(/«(.*?)»/)?.[1] || "").split(",").map(s=>s.trim());
      const aircraft = str.match(/〔(.*?)〕/)?.[1] || "";
      const airline = str.match(/『(.*?)』/)?.[1] || "";
      const equipmentId = str.match(/<(R-.*?)>/)?.[1] || "";

      const depMatch = str.match(/《(.*?)出发》{(.*?)}#\+(\d+)#@(.*?)@/);
      const arrMatch = str.match(/《(.*?)到达》{(.*?)}#\+(\d+)#@(.*?)@/);

      if (!depMatch || !arrMatch) return null;

      const eco = parsePrice(str.match(/§(.*?)§/)?.[1]);
      const bus = parsePrice(str.match(/θ(.*?)θ/)?.[1]);
      const first = parsePrice(str.match(/△(.*?)△/)?.[1]);

      return {
        flightNo, weekdays, aircraft, airline, equipmentId,
        origin: { name: depMatch[1], time: depMatch[2], term: depMatch[4] },
        dest: { name: arrMatch[1], time: arrMatch[2], term: arrMatch[4], dayOff: parseInt(arrMatch[3]) },
        prices: { eco, bus, first },
        duration: calculateDuration(depMatch[2], 0, arrMatch[2], parseInt(arrMatch[3]))
      };
    } catch (e) { return null; }
  }).filter(Boolean);
}

function parsePrice(str) {
  return str ? parseInt(str.replace(/\D/g, '')) : null;
}
function calculateDuration(t1, d1, t2, d2) {
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  return (d2 * 24 * 60 + h2 * 60 + m2) - (d1 * 24 * 60 + h1 * 60 + m1);
}
function fmtDuration(mins) {
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/* =========================================
   4. UI & Interaction
   ========================================= */

function initUI() {
  // Navigation
  window.addEventListener('hashchange', handleHashRouting);

  // Date Setup
  const dateInput = document.getElementById('searchDate');
  const todayStr = DATES.fmtDate(DATES.today);
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + CONFIG.maxDays);
  
  dateInput.min = todayStr;
  dateInput.max = DATES.fmtDate(maxDate);
  dateInput.value = todayStr; // Default
  dateInput.addEventListener('change', () => {
    document.getElementById('weekDisplay').textContent = DATES.getWeekStr(dateInput.value);
    validateDate();
  });

  // Input Listeners (Auto-update Code Display)
  setupStationInput('fromInput', 'fromCodeDisp');
  setupStationInput('toInput', 'toCodeDisp');
  
  if (STATE.settings.rememberInputs) restoreInputs();

  // Buttons
  document.getElementById('swapBtn').addEventListener('click', swapStations);
  document.getElementById('searchBtn').addEventListener('click', performSearch);
  document.getElementById('confirmBuyBtn').addEventListener('click', confirmPurchase);
  document.getElementById('closeDialogBtn').addEventListener('click', () => document.getElementById('bookingDialog').close());
  
  // Settings
  const nSwitch = document.getElementById('masterNotifySwitch');
  nSwitch.checked = STATE.settings.notifications;
  nSwitch.addEventListener('change', e => toggleNotifications(e.target.checked));

  const mSwitch = document.getElementById('inputMemorySwitch');
  mSwitch.checked = STATE.settings.rememberInputs;
  mSwitch.addEventListener('change', e => {
    STATE.settings.rememberInputs = e.target.checked;
    saveStorage();
  });

  document.getElementById('clearDataBtn').addEventListener('click', clearAllData);
  document.getElementById('deleteTicketBtn').addEventListener('click', deleteCurrentTicket);

  renderWallet();
}

function handleHashRouting() {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'wallet') switchTab('wallet');
  else if (hash === 'settings') switchTab('settings');
  else switchTab('search');
}

function switchTab(tab) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${tab}`).classList.add('active');
  
  document.querySelectorAll('.icon-nav').forEach(b => b.classList.remove('active'));
  // Update header title
  const titles = { search: '探索航班', wallet: '我的行程', settings: '设置' };
  document.getElementById('pageTitle').textContent = titles[tab] || '航行';
  
  // Highlight Icon logic (simple index match)
  const tabs = ['search', 'wallet', 'settings'];
  const idx = tabs.indexOf(tab);
  if (idx > -1) document.querySelectorAll('.icon-nav')[idx].classList.add('active');
}

/* --- Input Logic --- */

function setupStationInput(inputId, displayId) {
  const input = document.getElementById(inputId);
  const display = document.getElementById(displayId);
  
  input.addEventListener('input', () => {
    const val = input.value.trim();
    // Find matching code
    const found = STATE.airports.find(a => a.name === val || a.code === val || a.aliases?.includes(val));
    display.textContent = found ? found.code : (val ? '???' : '---');
    if (STATE.settings.rememberInputs) saveInputs();
  });
}

function populateDatalist() {
  const dl = document.getElementById('airportSuggestions');
  dl.innerHTML = '';
  STATE.airports.forEach(ap => {
    const opt = document.createElement('option');
    opt.value = ap.name;
    dl.appendChild(opt);
  });
}

// Modal Picker Logic
function openAirportPicker(target) { // 'from' or 'to'
  const dialog = document.getElementById('airportPickerDialog');
  const grid = document.getElementById('airportGridPicker');
  grid.innerHTML = '';
  
  STATE.airports.forEach(ap => {
    const chip = document.createElement('div');
    chip.className = 'airport-chip';
    chip.innerHTML = `<b>${ap.code}</b><span>${ap.name}</span>`;
    chip.onclick = () => {
      const input = document.getElementById(target + 'Input');
      input.value = ap.name;
      input.dispatchEvent(new Event('input')); // Trigger update
      dialog.close();
    };
    grid.appendChild(chip);
  });
  dialog.showModal();
}

function swapStations() {
  const f = document.getElementById('fromInput');
  const t = document.getElementById('toInput');
  [f.value, t.value] = [t.value, f.value];
  f.dispatchEvent(new Event('input'));
  t.dispatchEvent(new Event('input'));
}

/* --- Search Logic --- */

function populateAirlineFilter() {
  const sel = document.getElementById('airlineFilter');
  // Get unique airlines from flights
  const names = [...new Set(STATE.flights.map(f => f.airline))];
  names.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  });
}

function performSearch() {
  const from = document.getElementById('fromInput').value.trim();
  const to = document.getElementById('toInput').value.trim();
  const dateStr = document.getElementById('searchDate').value;
  
  if (!from || !to) { showToast("请输入出发和目的地"); return; }
  if (!validateDate()) return;

  const weekStr = DATES.getWeekStr(dateStr);
  const airFilter = document.getElementById('airlineFilter').value;
  const timeFilter = document.getElementById('timeFilter').value;

  const results = STATE.flights.filter(f => {
    // Basic Route
    const routeMatch = f.origin.name.includes(from) && f.dest.name.includes(to);
    // Weekday
    const dayMatch = f.weekdays.includes(weekStr);
    // Airline Filter
    const airMatch = airFilter === 'all' || f.airline === airFilter;
    // Time Filter
    const timeMatch = checkTimeFilter(f.origin.time, timeFilter);
    // Time Validity (Current Time check)
    const isValidTime = checkFlightTimeValidity(dateStr, f.origin.time);

    return routeMatch && dayMatch && airMatch && timeMatch && isValidTime;
  });

  renderResults(results, dateStr);
}

function checkTimeFilter(timeStr, filter) {
  const hour = parseInt(timeStr.split(':')[0]);
  if (filter === 'all') return true;
  if (filter === 'morning') return hour >= 6 && hour < 12;
  if (filter === 'noon') return hour >= 12 && hour < 14;
  if (filter === 'afternoon') return hour >= 14 && hour < 18;
  if (filter === 'evening') return hour >= 18 && hour <= 23;
  if (filter === 'midnight') return hour >= 0 && hour < 6;
  return true;
}

function checkFlightTimeValidity(dateStr, timeStr) {
  // If date is today, flight time must be > now
  if (dateStr === DATES.fmtDate(DATES.today)) {
    const flightTs = DATES.getTimestamp(dateStr, timeStr);
    return flightTs > Date.now();
  }
  return true;
}

function validateDate() {
  const input = document.getElementById('searchDate');
  const d = new Date(input.value);
  const today = new Date(DATES.fmtDate(new Date())); // normalize
  const max = new Date(); max.setDate(max.getDate() + CONFIG.maxDays);
  
  if (d < today) {
    showToast("不能选择早于今天的日期");
    input.value = DATES.fmtDate(today);
    return false;
  }
  if (d > max) {
    showToast("预订仅开放未来60天");
    input.value = DATES.fmtDate(max);
    return false;
  }
  return true;
}

function renderResults(list, dateStr) {
  const grid = document.getElementById('flightGrid');
  document.getElementById('resultsHeader').hidden = false;
  grid.innerHTML = '';

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>暂无符合条件的航班</p></div>`;
    return;
  }

  list.forEach(f => {
    const card = document.createElement('div');
    card.className = 'flight-card';
    const logo = getAirlineLogo(f.airline);
    
    card.innerHTML = `
      <div class="fc-header">
        <div class="airline-badge">
          <img src="${logo}" class="airline-logo-sm">
          ${f.airline} · ${f.flightNo}
        </div>
        <span style="font-size:12px;color:var(--md-sys-color-primary)">${f.aircraft}</span>
      </div>
      <div class="fc-body">
        <div class="fc-port">
          <div class="fc-time">${f.origin.time}</div>
          <div class="fc-city">${f.origin.name}</div>
        </div>
        <div class="fc-center">
          <span>${fmtDuration(f.duration)}</span>
          <span class="material-symbols-rounded">trending_flat</span>
        </div>
        <div class="fc-port" style="text-align:right">
          <div class="fc-time">${f.dest.time} <small style="font-size:12px">${f.dest.dayOff?'+1':''}</small></div>
          <div class="fc-city">${f.dest.name}</div>
        </div>
      </div>
      <div class="fc-footer">
        <span class="fc-equip">${f.equipmentId || '设备未定'}</span>
        <span class="price-tag">¥${f.prices.eco || f.prices.bus || '--'}</span>
      </div>
    `;
    card.addEventListener('click', () => openBooking(f, dateStr));
    grid.appendChild(card);
  });
}

function getAirlineLogo(name) {
  const found = STATE.airlines.find(a => a.name === name);
  return found ? found.icon : 'https://img.mcwfmtr.cc/i/2025/07/18/5gkzqx.png'; // Fallback
}

/* =========================================
   5. Booking & Wallet
   ========================================= */

let currentBooking = null;
let currentTicketView = null; // For deleting

function openBooking(flight, dateStr) {
  const d = document.getElementById('bookingDialog');
  currentBooking = { flight, dateStr, class: null, price: 0 };
  
  // Fill Data
  document.getElementById('modalDep').textContent = getCode(flight.origin.name);
  document.getElementById('modalArr').textContent = getCode(flight.dest.name);
  document.getElementById('modalFlightNo').textContent = flight.flightNo;
  document.getElementById('modalDate').textContent = dateStr;
  document.getElementById('modalDepTime').textContent = flight.origin.time;
  document.getElementById('modalArrTime').textContent = flight.dest.time;
  document.getElementById('modalDepTerm').textContent = flight.origin.term;
  document.getElementById('modalArrTerm').textContent = flight.dest.term;
  document.getElementById('modalDuration').textContent = fmtDuration(flight.duration);
  document.getElementById('modalAirlineName').textContent = flight.airline;
  document.getElementById('modalAirlineIcon').src = getAirlineLogo(flight.airline);

  // Tracker Logic: Hide if "Currently Flying". 
  // Wait, requirement 4: "If currently flying, DON'T show button".
  // Logic: Flying = (now > dep && now < arr). 
  const depTs = DATES.getTimestamp(dateStr, flight.origin.time);
  const arrTs = depTs + flight.duration * 60000;
  const now = Date.now();
  const isFlying = now >= depTs && now <= arrTs;
  
  const trackBox = document.getElementById('trackerContainer');
  const trackLink = document.getElementById('trackerLink');
  
  if (isFlying) {
    trackBox.hidden = true;
  } else {
    trackBox.hidden = false;
    trackLink.href = `https://haojin.guanmu233.cn/flights_map=?${flight.flightNo}`;
  }

  // Seats
  const seatCon = document.getElementById('seatOptions');
  seatCon.innerHTML = '';
  const classes = [
    { k: 'eco', n: '经济舱', p: flight.prices.eco },
    { k: 'bus', n: '商务舱', p: flight.prices.bus },
    { k: 'first', n: '头等舱', p: flight.prices.first }
  ];
  
  classes.forEach(c => {
    if (!c.p) return;
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="radio" name="seat" class="seat-radio">
      <div class="seat-card">
        <span>${c.n}</span>
        <b>¥${c.p}</b>
      </div>
    `;
    label.querySelector('input').addEventListener('change', () => {
      currentBooking.class = c.n;
      currentBooking.price = c.p;
      document.getElementById('totalPrice').textContent = `¥${c.p}`;
      document.getElementById('confirmBuyBtn').disabled = false;
    });
    seatCon.appendChild(label);
  });
  
  document.getElementById('confirmBuyBtn').disabled = true;
  document.getElementById('totalPrice').textContent = '请选择';
  d.showModal();
}

function getCode(cityName) {
  const ap = STATE.airports.find(a => a.name === cityName);
  return ap ? ap.code : '---';
}

function confirmPurchase() {
  const t = {
    id: Date.now().toString(36),
    ...currentBooking.flight,
    depDate: currentBooking.dateStr,
    className: currentBooking.class,
    price: currentBooking.price,
    purchaseTime: Date.now()
  };
  
  STATE.purchased.push(t);
  saveStorage();
  
  document.getElementById('bookingDialog').close();
  showToast("出票成功");
  
  // Notification (Immediate: Booking success)
  if(STATE.settings.notifications) {
    sendLocalNotif('购买成功', `您已预订 ${t.flightNo} 前往 ${t.dest.name}`);
    scheduleTicketNotifs(t);
  }
  
  renderWallet();
}

function renderWallet() {
  const grid = document.getElementById('walletGrid');
  grid.innerHTML = '';
  const list = STATE.purchased.sort((a,b) => {
    // Sort by dep time
    const tA = DATES.getTimestamp(a.depDate, a.origin.time);
    const tB = DATES.getTimestamp(b.depDate, b.origin.time);
    return tA - tB;
  });

  if(list.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>暂无行程</p></div>`;
    return;
  }

  list.forEach(t => {
    const depTs = DATES.getTimestamp(t.depDate, t.origin.time);
    const isPast = Date.now() > depTs + 24*3600*1000; // 1 day after
    
    const card = document.createElement('div');
    card.className = 'flight-card';
    if(isPast) card.style.opacity = '0.6';
    card.style.borderLeftColor = isPast ? '#999' : 'var(--highlight-orange)';
    
    card.innerHTML = `
      <div class="fc-header">
        <span style="font-weight:700">${t.depDate}</span>
        <span class="badge" style="color:${isPast?'gray':'green'}">${isPast?'已结束':'待出行'}</span>
      </div>
      <div class="fc-body">
        <div class="fc-port">
          <div class="fc-time">${t.origin.time}</div>
          <div class="fc-city">${t.origin.name}</div>
        </div>
        <div class="fc-center">
           <span class="material-symbols-rounded">flight</span>
        </div>
        <div class="fc-port" style="text-align:right">
          <div class="fc-time">${t.dest.time}</div>
          <div class="fc-city">${t.dest.name}</div>
        </div>
      </div>
      <div class="fc-footer">
        <span>${t.className}</span>
        <span style="font-weight:700">${t.flightNo}</span>
      </div>
    `;
    card.addEventListener('click', () => showBoardingPass(t));
    grid.appendChild(card);
  });
}

function showBoardingPass(t) {
  currentTicketView = t;
  const d = document.getElementById('boardingPassDialog');
  
  document.getElementById('bpDepCode').textContent = getCode(t.origin.name);
  document.getElementById('bpDepCity').textContent = t.origin.name;
  document.getElementById('bpArrCode').textContent = getCode(t.dest.name);
  document.getElementById('bpArrCity').textContent = t.dest.name;
  
  document.getElementById('bpFlightNo').textContent = t.flightNo;
  document.getElementById('bpDate').textContent = t.depDate;
  
  // Boarding time = Dep time - 30m
  const depTs = DATES.getTimestamp(t.depDate, t.origin.time);
  const boardTs = depTs - 30 * 60000;
  const boardDate = new Date(boardTs);
  document.getElementById('bpBoardTime').textContent = `${boardDate.getHours().toString().padStart(2,'0')}:${boardDate.getMinutes().toString().padStart(2,'0')}`;
  document.getElementById('bpClass').textContent = t.className;
  
  // Mock QR: just a black box with some "pixels" via CSS or simple image
  const qr = document.getElementById('qrPlaceholder');
  qr.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${t.flightNo}" alt="QR" style="width:100%">`;
  
  d.showModal();
}

function deleteCurrentTicket() {
  if (!currentTicketView) return;
  if (!confirm('确定要删除这张机票吗？')) return;
  
  STATE.purchased = STATE.purchased.filter(x => x.id !== currentTicketView.id);
  saveStorage();
  document.getElementById('boardingPassDialog').close();
  renderWallet();
  showToast("订单已删除");
}

/* =========================================
   6. Notifications
   ========================================= */

function toggleNotifications(enabled) {
  STATE.settings.notifications = enabled;
  saveStorage();
  
  if (enabled) {
    Notification.requestPermission().then(p => {
      if(p === 'granted') {
        showToast("通知已开启");
        rescheduleAllNotifications();
      } else {
        document.getElementById('masterNotifySwitch').checked = false;
        showToast("权限被拒绝");
      }
    });
  } else {
    clearAllTimers();
    showToast("通知已关闭");
  }
}

function clearAllTimers() {
  STATE.notificationTimers.forEach(id => clearTimeout(id));
  STATE.notificationTimers = [];
}

function rescheduleAllNotifications() {
  clearAllTimers();
  STATE.purchased.forEach(scheduleTicketNotifs);
}

function scheduleTicketNotifs(t) {
  const depTs = DATES.getTimestamp(t.depDate, t.origin.time);
  const now = Date.now();
  
  CONFIG.notificationOffsets.forEach(cfg => {
    const triggerTime = depTs + (cfg.min * 60000);
    const delay = triggerTime - now;
    
    if (delay > 0 && delay < 24 * 60 * 60 * 1000) { // Only if future & within 24h
      const tid = setTimeout(() => {
        sendLocalNotif(`航班动态: ${t.flightNo}`, cfg.msg);
      }, delay);
      STATE.notificationTimers.push(tid);
    }
  });
}

function sendLocalNotif(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'https://img.mcwfmtr.cc/i/2025/07/18/5gkzqx.png' });
  }
}

/* =========================================
   7. Storage & Utils
   ========================================= */

function loadStorage() {
  const p = localStorage.getItem('starflight_purchased');
  if(p) STATE.purchased = JSON.parse(p);
  
  const s = localStorage.getItem('starflight_settings');
  if(s) STATE.settings = Object.assign(STATE.settings, JSON.parse(s));
}

function saveStorage() {
  localStorage.setItem('starflight_purchased', JSON.stringify(STATE.purchased));
  localStorage.setItem('starflight_settings', JSON.stringify(STATE.settings));
}

function saveInputs() {
  const data = {
    from: document.getElementById('fromInput').value,
    to: document.getElementById('toInput').value
  };
  localStorage.setItem('starflight_inputs', JSON.stringify(data));
}

function restoreInputs() {
  const d = JSON.parse(localStorage.getItem('starflight_inputs'));
  if(d) {
    document.getElementById('fromInput').value = d.from || '';
    document.getElementById('toInput').value = d.to || '';
    // Trigger update for codes
    document.getElementById('fromInput').dispatchEvent(new Event('input'));
    document.getElementById('toInput').dispatchEvent(new Event('input'));
  }
}

function clearAllData() {
  if(!confirm("确定清空所有数据？")) return;
  localStorage.removeItem('starflight_purchased');
  localStorage.removeItem('starflight_settings');
  localStorage.removeItem('starflight_inputs');
  location.reload();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// Boot
initApp();
