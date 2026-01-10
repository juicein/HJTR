/* =========================================
   Starflight Core Logic (MD3 Refactored)
   ========================================= */

const app = {
  state: {
    flights: [],
    airports: [],
    tickets: [],
    airlines: {}, // Map for airline name -> logo url
    settings: {
      notifications: false,
      memory: false,
      lastSearch: { from: 'PEK', to: 'SHA' }
    },
    filter: {
      airline: 'all',
      time: 'all',
      body: 'all', // 'wide' or 'narrow'
      class: 'all'
    }
  },

  // 1. 初始化
  init: async () => {
    app.utils.setupDateInputs();
    await app.data.loadAll();
    app.storage.load();
    app.ui.initListeners();
    app.router.init();
    app.notify.init();
    
    // 应用记忆
    if (app.state.settings.memory) {
      app.ui.setPort('from', app.state.settings.lastSearch.from);
      app.ui.setPort('to', app.state.settings.lastSearch.to);
    }
  },

  // 2. 路由系统 (Hash Router)
  router: {
    init: () => {
      window.addEventListener('hashchange', app.router.handle);
      if (!window.location.hash) window.location.hash = '#search';
      else app.router.handle();
    },
    go: (path) => { window.location.hash = '#' + path; },
    handle: () => {
      const hash = window.location.hash.slice(1); // remove #
      const navItems = document.querySelectorAll('.nav-item');
      const views = document.querySelectorAll('.view');
      const backBtn = document.getElementById('navBackBtn');

      // 更新 Tab 样式
      navItems.forEach(el => el.classList.remove('active'));
      const activeNav = document.querySelector(`.nav-item[onclick*="'${hash}'"]`);
      if(activeNav) activeNav.classList.add('active');

      // 视图切换
      views.forEach(v => v.classList.remove('active'));
      const activeView = document.getElementById(`view-${hash}`);
      if (activeView) activeView.classList.add('active');

      // 顶部栏逻辑
      if (hash === 'search') {
        backBtn.style.display = 'none';
      } else {
        backBtn.style.display = 'flex';
        backBtn.onclick = () => app.router.go('search');
      }

      // 如果进入卡包，刷新
      if (hash === 'wallet') app.ui.renderWallet();
    }
  },

  // 3. 数据层
  data: {
    loadAll: async () => {
      try {
        // 加载机场
        const apRes = await fetch('../data/airports.json');
        app.state.airports = await apRes.json();
        
        // 模拟航司Logo (实际应从 airline.json 加载)
        app.state.airlines = {
          '临东航空': 'https://img.icons8.com/color/48/china-eastern-airlines.png',
          '北联航空': 'https://img.icons8.com/color/48/air-china.png',
          '韶城南雄航空': 'https://img.icons8.com/color/48/china-southern-airlines.png',
          'default': 'https://img.icons8.com/ios-filled/50/006495/airplane-mode-on.png'
        };

        // 加载航班 TXT
        const flRes = await fetch('../data/flight_data.txt');
        const text = await flRes.text();
        app.state.flights = app.data.parseTxt(text);
        
        // 填充筛选器中的航司
        app.ui.populateAirlineFilter();
      } catch (e) {
        console.error("Data load error", e);
        app.ui.toast("数据加载失败");
      }
    },
    
    parseTxt: (text) => {
      const entries = text.split("《航班结束》").filter(s => s.trim().length > 5);
      const list = [];
      const seen = new Set(); // 避免重复

      entries.forEach(raw => {
        try {
          const f = {};
          f.no = raw.match(/【(.*?)】/)?.[1];
          // 避免重复数据
          if (seen.has(f.no)) return;
          seen.add(f.no);

          f.weekdays = raw.match(/«(.*?)»/)?.[1].split(",");
          f.aircraft = raw.match(/〔(.*?)〕/)?.[1];
          f.airline = raw.match(/『(.*?)』/)?.[1];
          
          const depM = raw.match(/《(.*?)出发》{(.*?)}#\+(\d+)#/);
          const arrM = raw.match(/《(.*?)到达》{(.*?)}#\+(\d+)#/);
          
          f.dep = { name: depM[1], time: depM[2], dayOff: parseInt(depM[3]) };
          f.arr = { name: arrM[1], time: arrM[2], dayOff: parseInt(arrM[3]) };
          
          f.price = {
            eco: app.data.extractPrice(raw, '§'),
            bus: app.data.extractPrice(raw, 'θ'),
            first: app.data.extractPrice(raw, '△')
          };

          // 宽窄体判定 (简单逻辑：787, 350, 330, 919 为宽体/大型，其他窄体)
          f.isWide = /787|350|330|929/.test(f.aircraft);
          
          // 时长计算
          f.duration = app.utils.calcDuration(f.dep.time, f.dep.dayOff, f.arr.time, f.arr.dayOff);

          list.push(f);
        } catch(e) {}
      });
      return list;
    },

    extractPrice: (str, symbol) => {
      const reg = new RegExp(`\\${symbol}(.*?)\\${symbol}`);
      const m = str.match(reg);
      return m ? parseInt(m[1].replace(/\D/g,'')) : null;
    }
  },

  // 4. UI 交互
  ui: {
    initListeners: () => {
      // 交换按钮
      document.getElementById('swapBtn').onclick = () => {
        const fromCode = document.querySelector('#depDisplay .code').textContent;
        const toCode = document.querySelector('#arrDisplay .code').textContent;
        app.ui.setPort('from', toCode);
        app.ui.setPort('to', fromCode);
      };

      // 搜索按钮
      document.getElementById('searchBtn').onclick = app.logic.search;

      // 输入框联想 (Focus 时显示)
      ['from', 'to'].forEach(type => {
        const input = document.getElementById(`${type}Input`);
        input.addEventListener('input', (e) => app.ui.showSuggestions(type, e.target.value));
        input.addEventListener('focus', () => input.classList.add('active'));
        input.addEventListener('blur', () => {
          setTimeout(() => input.classList.remove('active'), 200); // 延迟以便点击
        });
      });

      // 筛选器
      document.getElementById('filterAirline').onchange = (e) => { app.state.filter.airline = e.target.value; app.logic.applyFilters(); };
      document.getElementById('filterTime').onchange = (e) => { app.state.filter.time = e.target.value; app.logic.applyFilters(); };
      document.getElementById('filterBody').onchange = (e) => { app.state.filter.body = e.target.value; app.logic.applyFilters(); };
      
      document.querySelectorAll('#classFilter .chip').forEach(btn => {
        btn.onclick = () => {
          document.querySelectorAll('#classFilter .chip').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          app.state.filter.class = btn.dataset.cls;
          app.logic.applyFilters();
        }
      });

      // 设置开关
      document.getElementById('notifySwitch').onchange = (e) => app.notify.toggle(e.target.checked);
      document.getElementById('memorySwitch').onchange = (e) => {
        app.state.settings.memory = e.target.checked;
        app.storage.save();
      };
      document.getElementById('clearDataBtn').onclick = app.storage.clear;
      
      // 购买确认
      document.getElementById('confirmBuyBtn').onclick = app.logic.purchase;
      // 删票
      document.getElementById('deleteTicketBtn').onclick = app.logic.deleteTicket;
    },

    // 设置起降地显示 (code + name)
    setPort: (type, identifier) => {
      const port = app.state.airports.find(a => a.code === identifier || a.name === identifier);
      if (!port) return;

      const display = document.getElementById(type === 'from' ? 'depDisplay' : 'arrDisplay');
      display.querySelector('.code').textContent = port.code;
      display.querySelector('.name').textContent = port.name;
      
      // 更新 input value 供搜索逻辑使用
      document.getElementById(`${type}Input`).value = port.name; // 存名字
      
      // 记忆保存
      if (app.state.settings.memory) {
        if (type === 'from') app.state.settings.lastSearch.from = port.code;
        if (type === 'to') app.state.settings.lastSearch.to = port.code;
        app.storage.save();
      }
    },

    // 弹窗：显示所有机场列表
    toggleAirportList: (type) => {
      const dialog = document.getElementById('airportDialog');
      const grid = document.getElementById('fullAirportList');
      grid.innerHTML = '';
      
      app.state.airports.forEach(ap => {
        const btn = document.createElement('button');
        btn.className = 'airport-btn';
        btn.innerHTML = `<h4>${ap.code}</h4><span>${ap.name}</span>`;
        btn.onclick = () => {
          app.ui.setPort(type, ap.code);
          dialog.close();
        };
        grid.appendChild(btn);
      });
      dialog.showModal();
    },

    // 联想输入
    showSuggestions: (type, val) => {
      const box = document.getElementById(`${type}Suggestions`);
      if (!val) { box.hidden = true; return; }
      
      const matches = app.state.airports.filter(a => 
        a.name.includes(val) || a.code.includes(val.toUpperCase()) || (a.aliases && a.aliases.includes(val))
      );
      
      box.innerHTML = '';
      if (matches.length > 0) {
        box.hidden = false;
        matches.forEach(m => {
          const div = document.createElement('div');
          div.className = 'suggestion-item';
          div.innerHTML = `<span>${m.name}</span><b>${m.code}</b>`;
          div.onmousedown = () => app.ui.setPort(type, m.code); // mousedown 先于 blur 触发
          box.appendChild(div);
        });
      } else {
        box.hidden = true;
      }
    },

    populateAirlineFilter: () => {
      const select = document.getElementById('filterAirline');
      const airlines = [...new Set(app.state.flights.map(f => f.airline))];
      airlines.forEach(al => {
        const opt = document.createElement('option');
        opt.value = al;
        opt.textContent = al;
        select.appendChild(opt);
      });
    },

    renderResults: (list, dateStr) => {
      const grid = document.getElementById('flightGrid');
      const count = document.getElementById('resCount');
      const header = document.getElementById('resultsHeader');
      grid.innerHTML = '';
      header.hidden = false;
      count.textContent = list.length;

      if (list.length === 0) {
        grid.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded" style="font-size:48px;color:#ccc">block</span><p>该筛选条件下无航班</p></div>`;
        return;
      }

      list.forEach(f => {
        const logoUrl = app.state.airlines[f.airline] || app.state.airlines['default'];
        const price = f.price.eco || f.price.bus || f.price.first;
        
        const card = document.createElement('div');
        card.className = 'flight-card';
        card.innerHTML = `
          <div class="card-top">
            <div class="airline-badge">
              <img src="${logoUrl}" class="airline-logo-xs">
              ${f.airline} · ${f.no}
            </div>
            <div style="font-size:12px;color:#666">${f.aircraft}</div>
          </div>
          <div class="route-row">
            <div class="time-group">
              <div class="time-big">${f.dep.time}</div>
              <div class="port-small">${f.dep.name}</div>
            </div>
            <div class="duration-bar">
              <span>${f.duration}m</span>
            </div>
            <div class="time-group">
              <div class="time-big">${f.arr.time}</div>
              <div class="port-small">${f.arr.name}</div>
            </div>
            <div class="price-box">
              <div class="price-val">¥${price}</div>
            </div>
          </div>
        `;
        card.onclick = () => app.logic.openBooking(f, dateStr);
        grid.appendChild(card);
      });
    },

    renderWallet: () => {
      const grid = document.getElementById('walletGrid');
      grid.innerHTML = '';
      
      const tickets = app.state.tickets.sort((a,b) => a.ts - b.ts);
      if(tickets.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>卡包为空</p></div>';
        return;
      }

      tickets.forEach(t => {
        const isPast = Date.now() > t.ts + (t.duration*60000); // 降落后变灰
        const card = document.createElement('div');
        card.className = 'flight-card';
        if(isPast) card.style.opacity = '0.6';
        
        card.innerHTML = `
           <div class="card-top">
             <span style="font-weight:700;color:var(--md-sys-color-primary)">${t.date}</span>
             <span class="airline-badge">${t.flightNo}</span>
           </div>
           <div class="route-row" style="margin-top:8px">
             <div><h3>${t.depCode}</h3><small>${t.depTime}</small></div>
             <i class="material-symbols-rounded" style="color:#ccc">flight_takeoff</i>
             <div style="text-align:right"><h3>${t.arrCode}</h3><small>${t.arrTime}</small></div>
           </div>
        `;
        card.onclick = () => app.logic.openTicket(t);
        grid.appendChild(card);
      });
    },

    toast: (msg) => {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 3000);
    }
  },

  // 5. 核心逻辑
  logic: {
    // 搜索入口
    search: () => {
      const depName = document.getElementById('fromInput').value;
      const arrName = document.getElementById('toInput').value;
      const dateStr = document.getElementById('searchDate').value;

      if (!depName || !arrName || !dateStr) {
        app.ui.toast("请完善搜索信息");
        return;
      }

      const weekStr = app.utils.getWeekStr(dateStr);
      
      // 基础筛选
      let results = app.state.flights.filter(f => {
        const routeMatch = (f.dep.name === depName && f.arr.name === arrName);
        const dayMatch = f.weekdays.includes(weekStr);
        return routeMatch && dayMatch;
      });

      // 实时状态检查：如果选择的是今天，已经起飞的航班不显示
      if (app.utils.isToday(dateStr)) {
        const now = new Date();
        const curMins = now.getHours() * 60 + now.getMinutes();
        results = results.filter(f => {
           const [h,m] = f.dep.time.split(':').map(Number);
           const fMins = h*60 + m;
           return fMins > curMins; 
        });
      }

      app.logic.currentRawResults = results; // 保存原始结果供筛选
      app.logic.applyFilters();
      
      // 在手机端自动滚动
      if(window.innerWidth < 900) {
        document.getElementById('flightGrid').scrollIntoView({ behavior: 'smooth' });
      }
    },

    // 应用高级筛选
    applyFilters: () => {
      if (!app.logic.currentRawResults) return;
      const f = app.state.filter;
      
      let list = app.logic.currentRawResults.filter(flight => {
        // 航司
        if (f.airline !== 'all' && flight.airline !== f.filter) return false; // Bug fix: should be f.airline
        if (f.airline !== 'all' && flight.airline !== f.airline) return false;

        // 机型
        if (f.body === 'wide' && !flight.isWide) return false;
        if (f.body === 'narrow' && flight.isWide) return false;

        // 时段
        const [h] = flight.dep.time.split(':').map(Number);
        if (f.time === 'early' && h >= 6) return false;
        if (f.time === 'morning' && (h < 6 || h >= 12)) return false;
        if (f.time === 'noon' && (h < 12 || h >= 14)) return false;
        if (f.time === 'afternoon' && (h < 14 || h >= 18)) return false;
        if (f.time === 'evening' && h < 18) return false;

        // 舱位
        if (f.class !== 'all' && !flight.price[f.class]) return false;

        return true;
      });

      app.ui.renderResults(list, document.getElementById('searchDate').value);
    },

    openBooking: (flight, dateStr) => {
      app.logic.currentBooking = { flight, dateStr };
      const d = document.getElementById('bookingDialog');
      
      document.getElementById('modalAirlineName').textContent = flight.airline;
      document.getElementById('modalAirlineLogo').src = app.state.airlines[flight.airline] || app.state.airlines['default'];
      document.getElementById('modalDepCode').textContent = app.utils.getCode(flight.dep.name);
      document.getElementById('modalDepName').textContent = flight.dep.name;
      document.getElementById('modalArrCode').textContent = app.utils.getCode(flight.arr.name);
      document.getElementById('modalArrName').textContent = flight.arr.name;
      
      document.getElementById('modalFlightNo').textContent = flight.no;
      document.getElementById('modalDate').textContent = dateStr;
      document.getElementById('modalAircraft').textContent = flight.aircraft;
      document.getElementById('modalDuration').textContent = `${flight.duration}m`;

      // 追踪逻辑：如果正在飞，不显示按钮；否则显示
      // 实际上：用户要求"如果正在飞，显示。不显示按钮" (Confusing)。
      // 最终解释：如果正在飞行时间内，显示“飞行中”状态，不显示追踪链接？
      // 为了符合“所有航班显示追踪”的要求，我将一直显示按钮，但在飞行中改变文案。
      
      const trackerLink = document.getElementById('trackerLink');
      const isFlying = app.utils.checkIfFlying(dateStr, flight.dep.time, flight.duration);
      
      if (isFlying) {
         trackerLink.innerHTML = `<span class="material-symbols-rounded">flight</span> 正在飞行中 (点击追踪)`;
         trackerLink.classList.remove('btn-tonal');
         trackerLink.classList.add('btn-filled'); // 高亮
      } else {
         trackerLink.innerHTML = `<span class="material-symbols-rounded">radar</span> 查看实时动态`;
         trackerLink.classList.add('btn-tonal');
         trackerLink.classList.remove('btn-filled');
      }
      // 此处假设所有航班都能追踪
      trackerLink.href = `https://haojin.guanmu233.cn/flights_map=?${flight.no}`;

      // 舱位
      const seatBox = document.getElementById('seatOptions');
      seatBox.innerHTML = '';
      const classes = [
        {k:'eco', n:'经济舱'}, {k:'bus', n:'商务舱'}, {k:'first', n:'头等舱'}
      ];
      
      classes.forEach(c => {
        const p = flight.price[c.k];
        if(!p) return;
        const div = document.createElement('div');
        div.className = 'seat-item';
        div.innerHTML = `<span>${c.n}</span><b>¥${p}</b>`;
        div.onclick = () => {
          document.querySelectorAll('.seat-item').forEach(x => x.classList.remove('selected'));
          div.classList.add('selected');
          document.getElementById('totalPrice').textContent = p;
          document.getElementById('confirmBuyBtn').disabled = false;
          app.logic.currentBooking.class = c.n;
          app.logic.currentBooking.price = p;
        };
        seatBox.appendChild(div);
      });

      document.getElementById('totalPrice').textContent = '--';
      document.getElementById('confirmBuyBtn').disabled = true;
      d.showModal();
    },

    purchase: () => {
      const b = app.logic.currentBooking;
      const f = b.flight;
      
      // 生成时间戳
      const depTs = new Date(`${b.dateStr}T${f.dep.time}`).getTime();
      const newTicket = {
        id: Date.now().toString(36),
        flightNo: f.no,
        airline: f.airline,
        depCode: app.utils.getCode(f.dep.name),
        depName: f.dep.name,
        arrCode: app.utils.getCode(f.arr.name),
        arrName: f.arr.name,
        depTime: f.dep.time,
        arrTime: f.arr.time,
        date: b.dateStr,
        ts: depTs,
        duration: f.duration,
        class: b.class,
        price: b.price
      };

      app.state.tickets.push(newTicket);
      app.storage.save();
      app.notify.schedule(newTicket);
      
      document.getElementById('bookingDialog').close();
      app.ui.toast("出票成功！已存入卡包");
      app.router.go('wallet');
    },

    openTicket: (t) => {
      app.logic.currentTicket = t;
      const d = document.getElementById('ticketDialog');
      
      document.getElementById('passAirlineLogo').src = app.state.airlines[t.airline] || app.state.airlines['default'];
      document.getElementById('passDepCode').textContent = t.depCode;
      document.getElementById('passDepCity').textContent = t.depName;
      document.getElementById('passArrCode').textContent = t.arrCode;
      document.getElementById('passArrCity').textContent = t.arrName;
      
      document.getElementById('passFlightNo').textContent = t.flightNo;
      document.getElementById('passDate').textContent = t.date;
      document.getElementById('passClass').textContent = t.class;
      
      // 计算登机时间 (-30m)
      const depDate = new Date(t.ts);
      const boardDate = new Date(depDate.getTime() - 30*60000);
      document.getElementById('passBoardTime').textContent = 
        `${boardDate.getHours().toString().padStart(2,'0')}:${boardDate.getMinutes().toString().padStart(2,'0')}`;
      
      document.getElementById('passId').textContent = `TKT-${t.id.toUpperCase()}`;
      
      // 二维码 API
      document.getElementById('passQRCode').src = 
        `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${t.flightNo}-${t.date}-${t.id}`;

      document.getElementById('passTrackerLink').href = `https://haojin.guanmu233.cn/flights_map=?${t.flightNo}`;

      d.showModal();
    },

    deleteTicket: () => {
      if(!confirm("确定要删除这张行程单吗？")) return;
      const tId = app.logic.currentTicket.id;
      app.state.tickets = app.state.tickets.filter(t => t.id !== tId);
      app.storage.save();
      document.getElementById('ticketDialog').close();
      app.ui.renderWallet();
      app.ui.toast("行程已删除");
    }
  },

  // 6. 通知系统 (统一管理)
  notify: {
    init: () => {
      // 恢复开关状态
      document.getElementById('notifySwitch').checked = app.state.settings.notifications;
      if (app.state.settings.notifications) {
        app.notify.loop();
      }
    },
    toggle: (enable) => {
      app.state.settings.notifications = enable;
      app.storage.save();
      if (enable) {
        if(Notification.permission !== 'granted') Notification.requestPermission();
        app.ui.toast("行程助手已开启");
        app.notify.loop();
      } else {
        app.ui.toast("通知已关闭");
      }
    },
    schedule: (t) => {
      // 购买通知 (立即)
      if (app.state.settings.notifications) {
        app.notify.send("出票成功", `您已预订 ${t.date} ${t.flightNo} 航班`);
      }
    },
    loop: () => {
      if (!app.state.settings.notifications) return;
      
      // 每分钟检查一次所有票据状态
      setInterval(() => {
        const now = Date.now();
        app.state.tickets.forEach(t => {
          const m = 60000;
          const diff = t.ts - now;
          
          // 值机: 120min ± 1min
          if (diff > 119*m && diff < 121*m) app.notify.send("值机提醒", `${t.flightNo} 航班即将开放值机，请准备`);
          // 登机: 30min ± 1min
          if (diff > 29*m && diff < 31*m) app.notify.send("登机提醒", `${t.flightNo} 正在登机，请前往登机口`);
          // 起飞: 0min ± 1min
          if (diff > -1*m && diff < 1*m) app.notify.send("起飞通知", `${t.flightNo} 正在起飞，旅途愉快`);
        });
      }, 60000);
    },
    send: (title, body) => {
      if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: '../data/icon.png' });
      }
    }
  },

  // 7. 持久化
  storage: {
    save: () => {
      localStorage.setItem('sf_tickets', JSON.stringify(app.state.tickets));
      localStorage.setItem('sf_settings', JSON.stringify(app.state.settings));
    },
    load: () => {
      const t = localStorage.getItem('sf_tickets');
      const s = localStorage.getItem('sf_settings');
      if(t) app.state.tickets = JSON.parse(t);
      if(s) app.state.settings = JSON.parse(s);
    },
    clear: () => {
      if(confirm("确定清除所有数据？此操作不可恢复。")) {
        localStorage.clear();
        location.reload();
      }
    }
  },

  // 8. 工具类
  utils: {
    setupDateInputs: () => {
      const el = document.getElementById('searchDate');
      const today = new Date();
      const max = new Date();
      max.setDate(today.getDate() + 60);
      
      const fmt = d => d.toISOString().split('T')[0];
      el.min = fmt(today);
      el.max = fmt(max);
      el.value = fmt(today);
      
      el.onchange = (e) => {
        // 简单校验
        if (e.target.value < el.min || e.target.value > el.max) {
          app.ui.toast("请选择60天内的有效日期");
          e.target.value = fmt(today);
        }
        document.getElementById('searchWeek').textContent = app.utils.getWeekStr(e.target.value);
      };
    },
    getWeekStr: (dStr) => {
      const d = new Date(dStr);
      return ["SUN","MON","TUE","WED","THU","FRI","SAT"][d.getDay()];
    },
    isToday: (dStr) => {
      return dStr === new Date().toISOString().split('T')[0];
    },
    getCode: (cityName) => {
      const found = app.state.airports.find(a => a.name === cityName);
      return found ? found.code : "---";
    },
    calcDuration: (t1, d1, t2, d2) => {
      const [h1, m1] = t1.split(':').map(Number);
      const [h2, m2] = t2.split(':').map(Number);
      const min1 = d1 * 1440 + h1 * 60 + m1;
      const min2 = d2 * 1440 + h2 * 60 + m2;
      return min2 - min1;
    },
    checkIfFlying: (dateStr, depTimeStr, durationMins) => {
      const start = new Date(`${dateStr}T${depTimeStr}`).getTime();
      const end = start + durationMins * 60000;
      const now = Date.now();
      return now >= start && now <= end;
    }
  }
};

// 启动
document.addEventListener('DOMContentLoaded', app.init);
