// ================= CONFIG & STATE =================
const STATE = {
  flights: [],
  airports: [],
  airlines: {}, // Name -> Icon URL
  tickets: [],
  settings: {
    notifications: false,
    history: false,
    lastFrom: '',
    lastTo: ''
  }
};

const DATES = {
  getTodayStr: () => new Date().toISOString().split('T')[0],
  addDays: (dateStr, days) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  },
  // Get English weekday short string (MON, TUE...)
  getWeekStr: (dateStr) => {
    const d = new Date(dateStr);
    const map = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    return map[d.getDay()];
  }
};

// ================= INITIALIZATION =================
async function initApp() {
  loadSettings();
  setupDateInputs();
  await loadData();
  
  // Router
  window.addEventListener('hashchange', handleHash);
  handleHash(); // Initial check
  
  // Setup inputs
  setupAutocomplete('from');
  setupAutocomplete('to');
  
  // Setup listeners
  document.getElementById('searchBtn').addEventListener('click', performSearch);
  document.getElementById('swapBtn').addEventListener('click', swapCities);
  document.getElementById('masterNotifySwitch').addEventListener('change', toggleNotifications);
  document.getElementById('historySwitch').addEventListener('change', (e) => {
    STATE.settings.history = e.target.checked;
    saveSettings();
  });
  document.getElementById('clearDataBtn').addEventListener('click', clearAllData);
  
  // Restore history
  if (STATE.settings.history) {
    if(STATE.settings.lastFrom) selectAirport('from', STATE.settings.lastFrom);
    if(STATE.settings.lastTo) selectAirport('to', STATE.settings.lastTo);
  }

  // Periodic check for notifications
  setInterval(checkFlightStatus, 60000); 
}

// ================= DATA LOADING =================
async function loadData() {
  try {
    const [airRes, flightRes, airlineRes] = await Promise.all([
      fetch('../data/airports.json'),
      fetch('../data/flight_data.txt'),
      fetch('../data/airlines.json').catch(() => ({ json: () => ({}) })) // Fallback if missing
    ]);

    STATE.airports = await airRes.json();
    const flightText = await flightRes.text();
    STATE.airlines = await airlineRes.json();
    
    parseFlightData(flightText);
    populateAirlineFilter();
    
    console.log(`Loaded: ${STATE.airports.length} airports, ${STATE.flights.length} flights`);
  } catch (e) {
    console.error("Data load error:", e);
    showToast("数据加载失败，请检查控制台");
  }
}

function parseFlightData(text) {
  // Regex designed for the specific format provided:
  // 【ID】...『Airline』...《Dep》{Time}...《Arr》{Time}... §Price§
  const regex = /【(.*?)】.*?«(.*?)».*?〔(.*?)〕.*?『(.*?)』.*?《(.*?)出发》{(.*?)}.*?@(.*?)@.*?《(.*?)到达》{(.*?)}.*?@(.*?)@.*?§(.*?)元§/g;
  
  let match;
  STATE.flights = [];
  
  // Clean text to avoid line break issues if any
  const cleanText = text.replace(/\n/g, ''); 

  // Since Global regex is tricky with loops, we loop through matches
  // However, simpler approach for the sample given:
  const entries = text.split("《航班结束》");
  
  entries.forEach(entry => {
    if(!entry.trim()) return;
    
    // Extract parts using individual regex for safety
    try {
      const flightNo = (entry.match(/【(.*?)】/) || [])[1];
      const weekStr = (entry.match(/«(.*?)»/) || [])[1];
      const aircraft = (entry.match(/〔(.*?)〕/) || [])[1];
      const airline = (entry.match(/『(.*?)』/) || [])[1];
      
      const depMatch = entry.match(/《(.*?)出发》{(.*?)}.*?@(.*?)@/);
      const arrMatch = entry.match(/《(.*?)到达》{(.*?)}.*?@(.*?)@/);
      const priceMatch = entry.match(/§(.*?)元§/);
      
      if (flightNo && depMatch && arrMatch) {
        STATE.flights.push({
          id: flightNo,
          days: weekStr.split(',').map(s=>s.trim()),
          aircraft: aircraft,
          airline: airline,
          dep: { name: depMatch[1], time: depMatch[2], term: depMatch[3] },
          arr: { name: arrMatch[1], time: arrMatch[2], term: arrMatch[3] },
          price: parseInt(priceMatch ? priceMatch[1] : 0),
          // Calculate minutes for duration later if needed
          rawDuration: calculateDuration(depMatch[2], arrMatch[2])
        });
      }
    } catch (e) {
      console.warn("Skipping invalid entry", e);
    }
  });
}

function calculateDuration(t1, t2) {
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  const h = Math.floor(mins/60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

// ================= UI LOGIC: SEARCH =================

function setupDateInputs() {
  const dateInput = document.getElementById('searchDate');
  const today = DATES.getTodayStr();
  const maxDate = DATES.addDays(today, 60);
  
  dateInput.min = today;
  dateInput.max = maxDate;
  dateInput.value = today;
}

function populateAirlineFilter() {
  const select = document.getElementById('airlineFilter');
  const airlines = [...new Set(STATE.flights.map(f => f.airline))];
  airlines.forEach(al => {
    const opt = document.createElement('option');
    opt.value = al;
    opt.textContent = al;
    select.appendChild(opt);
  });
}

function performSearch() {
  const fromCity = document.getElementById('fromInput').value;
  const toCity = document.getElementById('toInput').value;
  const dateVal = document.getElementById('searchDate').value;
  
  if (!fromCity || !toCity) {
    showToast("请输入出发和到达城市");
    return;
  }

  // Save history
  if (STATE.settings.history) {
    STATE.settings.lastFrom = fromCity;
    STATE.settings.lastTo = toCity;
    saveSettings();
  }

  const weekDay = DATES.getWeekStr(dateVal);
  const airlineFilter = document.getElementById('airlineFilter').value;
  const timeFilter = document.getElementById('timeFilter').value;

  // Filter Logic
  const results = STATE.flights.filter(f => {
    // 1. Route (Use 'includes' to handle "Airport Name" vs "City Name" loosely)
    const matchRoute = f.dep.name.includes(fromCity) && f.arr.name.includes(toCity);
    // 2. Day
    const matchDay = f.days.includes(weekDay);
    // 3. Airline
    const matchAirline = airlineFilter === 'all' || f.airline === airlineFilter;
    // 4. Time
    const matchTime = checkTimeFilter(f.dep.time, timeFilter);
    // 5. Not in past (if today)
    const isPast = (dateVal === DATES.getTodayStr()) && 
                   (f.dep.time < new Date().toTimeString().substr(0,5));

    if (isPast) return false; 
    return matchRoute && matchDay && matchAirline && matchTime;
  });

  renderResults(results, dateVal);
}

function checkTimeFilter(timeStr, filter) {
  const h = parseInt(timeStr.split(':')[0]);
  switch(filter) {
    case 'early': return h >= 0 && h < 6;
    case 'morning': return h >= 6 && h < 12;
    case 'noon': return h >= 12 && h < 14;
    case 'afternoon': return h >= 14 && h < 18;
    case 'evening': return h >= 18 && h < 22;
    case 'night': return h >= 22;
    default: return true;
  }
}

function renderResults(list, dateStr) {
  const grid = document.getElementById('flightGrid');
  grid.innerHTML = '';
  
  if (list.length === 0) {
    grid.innerHTML = `<div style="text-align:center; padding:40px; color:gray">未找到航班<br>请尝试更换日期</div>`;
    return;
  }

  list.forEach(f => {
    const iconUrl = STATE.airlines[f.airline] || 'https://img.icons8.com/color/48/plane.png';
    const card = document.createElement('div');
    card.className = 'flight-card';
    card.innerHTML = `
      <div class="fc-header">
        <div class="airline-badge">
          <img src="${iconUrl}" alt="logo">
          ${f.airline} · ${f.id}
        </div>
        <div style="font-size:12px; color:gray">${f.aircraft}</div>
      </div>
      <div class="fc-main">
        <div class="fc-port">
          <div class="fc-time">${f.dep.time}</div>
          <div class="fc-city">${f.dep.name}</div>
          <div style="font-size:11px; color:gray">${f.dep.term}</div>
        </div>
        <div class="fc-divider">
          <span>${f.rawDuration}</span>
          <div class="fc-line"></div>
        </div>
        <div class="fc-port end">
          <div class="fc-time">${f.arr.time}</div>
          <div class="fc-city">${f.arr.name}</div>
          <div style="font-size:11px; color:gray">${f.arr.term}</div>
        </div>
      </div>
      <div class="fc-price">
        <a href="#" class="tracker-btn" style="visibility:visible">
          <span class="material-symbols-rounded" style="font-size:14px">radar</span>
          实时动态
        </a>
        <span>¥${f.price}</span>
      </div>
    `;

    // Tracker Button Logic
    // If flight is "in air", hide button. 
    // Need full timestamps for this. Assuming 'dateStr' is departure date.
    const depDate = new Date(`${dateStr}T${f.dep.time}`);
    // Handle overnight arrival rough estimation
    let arrDate = new Date(`${dateStr}T${f.arr.time}`);
    if (arrDate < depDate) arrDate.setDate(arrDate.getDate() + 1);
    
    const now = new Date();
    const btn = card.querySelector('.tracker-btn');
    
    // Logic: Hide if NOW is between Dep and Arr
    if (now >= depDate && now <= arrDate) {
      btn.style.display = 'none';
    } else {
      btn.href = `https://haojin.guanmu233.cn/flights_map=?${f.id}`;
      btn.target = "_blank";
      // Prevent card click bubbling when clicking tracker
      btn.addEventListener('click', (e) => e.stopPropagation());
    }

    card.addEventListener('click', () => openBooking(f, dateStr));
    grid.appendChild(card);
  });
}

// ================= UI LOGIC: INPUTS & AUTOCOMPLETE =================

function setupAutocomplete(type) {
  const input = document.getElementById(`${type}Input`);
  const suggestBox = document.getElementById(`${type}Suggest`);
  const dropdownBox = document.getElementById(`${type}Dropdown`);
  
  // 1. Type Input Logic
  input.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase();
    dropdownBox.classList.remove('show'); // Hide full list
    if (!val) {
      suggestBox.classList.remove('show');
      return;
    }
    
    const matches = STATE.airports.filter(ap => 
      ap.name.includes(val) || ap.code.toLowerCase().includes(val) || (ap.aliases && ap.aliases.some(a=>a.includes(val)))
    );
    
    renderPopupList(suggestBox, matches, type);
  });

  // 2. Click outside to close
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.input-group')) {
      suggestBox.classList.remove('show');
      dropdownBox.classList.remove('show');
    }
  });
}

function toggleDropdown(type) {
  const box = document.getElementById(`${type}Dropdown`);
  const suggest = document.getElementById(`${type}Suggest`);
  suggest.classList.remove('show'); // Close suggestions
  
  if (box.classList.contains('show')) {
    box.classList.remove('show');
  } else {
    renderPopupList(box, STATE.airports, type);
  }
}

function renderPopupList(el, data, type) {
  el.innerHTML = '';
  if (data.length === 0) {
    el.classList.remove('show');
    return;
  }
  
  data.forEach(ap => {
    const item = document.createElement('div');
    item.className = 'popup-item';
    item.innerHTML = `<span>${ap.name}</span><span style="font-weight:700; color:var(--md-sys-color-primary)">${ap.code}</span>`;
    item.addEventListener('click', () => {
      selectAirport(type, ap.name, ap.code);
      el.classList.remove('show');
    });
    el.appendChild(item);
  });
  
  el.classList.add('show');
}

function selectAirport(type, name, code) {
  // If code not provided, find it
  if (!code) {
    const found = STATE.airports.find(a => a.name === name);
    code = found ? found.code : '---';
  }
  
  document.getElementById(`${type}Input`).value = name;
  document.getElementById(`${type}CodeDisplay`).textContent = code;
}

function swapCities() {
  const fI = document.getElementById('fromInput');
  const tI = document.getElementById('toInput');
  const fC = document.getElementById('fromCodeDisplay');
  const tC = document.getElementById('toCodeDisplay');
  
  const tempV = fI.value; fI.value = tI.value; tI.value = tempV;
  const tempC = fC.textContent; fC.textContent = tC.textContent; tC.textContent = tempC;
}

// ================= UI LOGIC: WALLET & BOOKING =================

function openBooking(f, dateStr) {
  const d = document.getElementById('bookingDialog');
  const c = document.getElementById('bookingContent');
  
  c.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:16px;">
      <b>${f.airline} ${f.id}</b>
      <span>${dateStr}</span>
    </div>
    <div style="display:flex; align-items:center; justify-content:space-between; font-size:24px;">
      <span>${f.dep.time}</span>
      <span class="material-symbols-rounded">arrow_forward</span>
      <span>${f.arr.time}</span>
    </div>
    <div style="display:flex; justify-content:space-between; color:gray; font-size:14px; margin-bottom:20px;">
      <span>${f.dep.name} ${f.dep.term}</span>
      <span>${f.arr.name} ${f.arr.term}</span>
    </div>
    <div style="text-align:right; font-size:24px; color:#d95d00; font-weight:700;">
      ¥${f.price}
    </div>
  `;
  
  const btn = document.getElementById('confirmPurchaseBtn');
  btn.onclick = () => {
    addToWallet(f, dateStr);
    d.close();
  };
  
  d.showModal();
}

function addToWallet(f, dateStr) {
  const ticket = {
    id: Date.now().toString(36), // Simple Unique ID
    flight: f,
    date: dateStr,
    purchaseTime: Date.now(),
    depTimestamp: new Date(`${dateStr}T${f.dep.time}`).getTime()
  };
  
  STATE.tickets.push(ticket);
  saveSettings();
  showToast("购票成功！已加入卡包");
  
  // Trigger notification if enabled
  if (STATE.settings.notifications) {
    new Notification("购票成功", { body: `您已预订 ${f.dep.name} 至 ${f.arr.name} 的航班。` });
  }
}

function renderWallet() {
  const grid = document.getElementById('walletGrid');
  grid.innerHTML = '';
  
  if (STATE.tickets.length === 0) {
    grid.innerHTML = '<p style="padding:20px; opacity:0.6">暂无行程</p>';
    return;
  }
  
  STATE.tickets.sort((a,b) => a.depTimestamp - b.depTimestamp).forEach(t => {
    const f = t.flight;
    const isEnded = Date.now() > t.depTimestamp + (4 * 3600 * 1000); // Rough "ended" check
    
    const div = document.createElement('div');
    div.className = 'flight-card wallet-card';
    if(isEnded) div.style.borderColor = 'gray';
    
    div.innerHTML = `
      <div class="fc-header">
        <span>${t.date} · ${f.id}</span>
        <span style="color:${isEnded?'gray':'green'}">${isEnded?'已结束':'待出行'}</span>
      </div>
      <div class="fc-main">
        <div class="fc-port">
           <div class="fc-time">${f.dep.time}</div>
           <div class="fc-city">${f.dep.name}</div>
        </div>
        <div class="fc-divider"><span class="material-symbols-rounded">airplane_ticket</span></div>
        <div class="fc-port end">
           <div class="fc-time">${f.arr.time}</div>
           <div class="fc-city">${f.arr.name}</div>
        </div>
      </div>
      <div class="wallet-actions">
        <button class="btn-icon-small" onclick="deleteTicket('${t.id}', event)">
          <span class="material-symbols-rounded">delete</span>
        </button>
      </div>
    `;
    
    // Click to show Boarding Pass
    div.addEventListener('click', () => showBoardingPass(t));
    grid.appendChild(div);
  });
}

function showBoardingPass(t) {
  const d = document.getElementById('bpDialog');
  document.getElementById('bpDep').textContent = t.flight.dep.name.substring(0,2); // Fake Airport Code extraction for UI
  document.getElementById('bpArr').textContent = t.flight.arr.name.substring(0,2);
  document.getElementById('bpFlight').textContent = t.flight.id;
  document.getElementById('bpDate').textContent = t.date;
  document.getElementById('bpFullCode').textContent = `${t.flight.id}-${t.date}`;
  
  // Generate QR (Using an API for demo, replaces real generation logic)
  const qrData = `FLIGHT:${t.flight.id}|DATE:${t.date}|USER:GUEST`;
  document.getElementById('bpQr').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`;
  
  d.showModal();
}

window.deleteTicket = function(id, e) {
  e.stopPropagation();
  if(!confirm("确认删除该行程？")) return;
  STATE.tickets = STATE.tickets.filter(t => t.id !== id);
  saveSettings();
  renderWallet();
}

// ================= ROUTING & UTILS =================

window.switchTab = function(tab) {
  window.location.hash = tab;
};

function handleHash() {
  const hash = window.location.hash.replace('#', '') || 'search';
  
  // Update UI State
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${hash}`).classList.add('active');
  
  document.querySelectorAll('.icon-btn').forEach(btn => btn.classList.remove('active'));
  const navBtn = document.getElementById(`nav-${hash}`);
  if(navBtn) navBtn.classList.add('active');
  
  if (hash === 'wallet') renderWallet();
}

function loadSettings() {
  const s = localStorage.getItem('starflight_data');
  if (s) {
    const data = JSON.parse(s);
    STATE.settings = data.settings || STATE.settings;
    STATE.tickets = data.tickets || [];
  }
  
  document.getElementById('masterNotifySwitch').checked = STATE.settings.notifications;
  document.getElementById('historySwitch').checked = STATE.settings.history;
}

function saveSettings() {
  localStorage.setItem('starflight_data', JSON.stringify({
    settings: STATE.settings,
    tickets: STATE.tickets
  }));
}

function clearAllData() {
  if(confirm("确定清空？")) {
    localStorage.removeItem('starflight_data');
    location.reload();
  }
}

function toggleNotifications(e) {
  const enabled = e.target.checked;
  STATE.settings.notifications = enabled;
  saveSettings();
  
  if (enabled && Notification.permission !== 'granted') {
    Notification.requestPermission();
  }
}

function checkFlightStatus() {
  if (!STATE.settings.notifications) return;
  if (Notification.permission !== 'granted') return;
  
  const now = Date.now();
  
  STATE.tickets.forEach(t => {
    // Check-in (120 mins before)
    timeCheck(t, now, 120, '值机提醒', `航班 ${t.flight.id} 即将开放值机，请前往航站楼 ${t.flight.dep.term}`);
    // Boarding (30 mins before)
    timeCheck(t, now, 30, '登机提醒', `航班 ${t.flight.id} 正在登机`);
    // Takeoff (0 mins)
    timeCheck(t, now, 0, '起飞提醒', `祝您旅途愉快`);
  });
}

function timeCheck(ticket, now, offsetMins, title, body) {
  // Simple "Sent" flag logic would be better in real app, here we rely on minute precision matching
  const target = ticket.depTimestamp - (offsetMins * 60 * 1000);
  const diff = Math.abs(now - target);
  
  // If within 1 minute of target time
  if (diff < 60000) { 
     new Notification(title, { body, icon: '../data/icon.png' });
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.opacity = 1;
  t.style.transform = "translateX(-50%) translateY(0)";
  setTimeout(() => {
    t.style.opacity = 0;
    t.style.transform = "translateX(-50%) translateY(100px)";
  }, 3000);
}

// Start
initApp();
