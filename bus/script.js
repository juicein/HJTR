/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffix: [] },
  currentView: 'home',
  selectedCity: 'all',
  selectedType: 'all',
  planner: { start: '', end: '', rule: 'fastest' }
};

/* --- 1. Data Loading & Parsing --- */
async function init() {
  try {
    const [txtRes, areaRes, compRes, aliasRes] = await Promise.all([
      fetch('../data/bus_data.txt'),
      fetch('../data/logos_area.json'),
      fetch('../data/logos_company.json'),
      fetch('../data/station_alias.json')
    ]);

    const txt = await txtRes.text();
    appState.logos.area = await areaRes.json();
    appState.logos.company = await compRes.json();
    const aliasData = await aliasRes.json();
    appState.aliases.manual = aliasData.manual_equivalents;
    appState.aliases.suffix = aliasData.auto_suffix_remove;

    parseLines(txt);
    setupUI();
    renderHome();
  } catch (e) {
    console.error("Initialization failed:", e);
    showToast("数据加载失败");
  }
}

function parseLines(rawText) {
  const lines = rawText.trim().split(/\n+/);
  appState.lines = lines.map((line, index) => {
    // Regex Extraction
    const name = line.match(/【(.*?)】/)?.[1] || "未命名";
    const company = line.match(/\{(.*?)\}/)?.[1] || "";
    const fare = line.match(/《(.*?)》/)?.[1] || "";
    const city = line.match(/『(.*?)』/)?.[1] || "其他";
    const startTime = line.match(/§(.*?)§/)?.[1] || "";
    const endTime = line.match(/@(.*?)@/)?.[1] || "";
    const isMetro = line.includes("θ地铁θ");
    const color = line.match(/∮([0-9A-Fa-f]{6,8})∮/)?.[1];

    // Station Parsing Logic
    const stationPart = line.replace(/^【.*?】/, "").split("-{")[0];
    const rawStations = stationPart.split("-").filter(s => s && s.trim());
    
    // Parse directions strictly
    const stationsUp = [];
    const stationsDown = [];

    // First pass: Build ordered list ignoring arrows for basic index
    // But arrows define availability.
    // Logic: No arrow = both. Up = Up only. Down = Down only.
    
    rawStations.forEach(s => {
      const cleanName = s.replace(/[↑↓]/g, "");
      const isUp = !s.includes("↓");   // If contains down arrow, NOT up
      const isDown = !s.includes("↑"); // If contains up arrow, NOT down
      
      if (isUp) stationsUp.push(cleanName);
    });

    // Down direction is usually reverse order, but sometimes tracks differ.
    // Based on provided bus_data format (e.g., A-B↓-C↑-D), 
    // Up: A -> C -> D
    // Down: D -> B -> A (Reverse iteration of raw?)
    // Actually, usually in these strings, the sequence is geographic.
    // Let's assume the order in string is "Start to End" (Up).
    // Down is "End to Start".
    
    // Re-parsing for Down: Reverse the raw list, then filter
    [...rawStations].reverse().forEach(s => {
      const cleanName = s.replace(/[↑↓]/g, "");
      const isDown = !s.includes("↑");
      if (isDown) stationsDown.push(cleanName);
    });

    return {
      id: index,
      name, company, fare, city, startTime, endTime, isMetro, color,
      stationsUp, stationsDown,
      // Metadata for filters
      type: isMetro ? 'metro' : 'bus'
    };
  });
}

/* --- 2. Logic: Aliasing & Routing --- */

function normalizeStation(name) {
  let n = name.trim();
  // Automatic suffix removal
  for (const suffix of appState.aliases.suffix) {
    if (n.endsWith(suffix)) {
      n = n.substring(0, n.length - suffix.length);
      break; // Only remove one suffix
    }
  }
  return n;
}

function getCanonicalStationId(name) {
  const norm = normalizeStation(name);
  // Check manual groups
  for (const group of appState.aliases.manual) {
    if (group.some(g => normalizeStation(g) === norm)) {
      return normalizeStation(group[0]); // Return the first one as ID
    }
  }
  return norm;
}

function buildGraph(filterType) {
  const graph = {}; // { stationId: [ {to, line, type} ] }

  appState.lines.forEach(line => {
    if (filterType === 'bus_only' && line.isMetro) return;
    
    // Add edges for Up
    addLineEdges(graph, line, line.stationsUp, 'up');
    // Add edges for Down
    addLineEdges(graph, line, line.stationsDown, 'down');
  });
  return graph;
}

function addLineEdges(graph, line, stations, dir) {
  for (let i = 0; i < stations.length - 1; i++) {
    const from = getCanonicalStationId(stations[i]);
    const to = getCanonicalStationId(stations[i+1]);
    
    if (!graph[from]) graph[from] = [];
    graph[from].push({
      toNode: to,
      lineName: line.name,
      lineId: line.id,
      direction: dir,
      isMetro: line.isMetro
    });
  }
}

function findRoute() {
  const start = getCanonicalStationId(document.getElementById('plan-start').value);
  const end = getCanonicalStationId(document.getElementById('plan-end').value);
  
  if (!start || !end) return;

  const rule = document.getElementById('planner-filters').querySelector('.active').dataset.rule;
  const graph = buildGraph(rule);

  // Dijkstra
  const queue = [{ node: start, cost: 0, transfers: 0, path: [] }];
  const visited = {}; // stores min cost to reach node
  const results = [];

  // Simple Priority Queue implementation would be better, using array sort for now (slow but ok for small data)
  
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    if (current.cost > (visited[current.node] || Infinity)) continue;
    visited[current.node] = current.cost;

    if (current.node === end) {
      results.push(current);
      if (results.length >= 3) break; // Top 3
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      // Cost calculation
      let stepCost = 1; // Base cost per stop
      let isTransfer = false;
      
      const lastStep = current.path[current.path.length - 1];
      if (lastStep && lastStep.lineId !== edge.lineId) {
        stepCost += 10; // Penalty for transfer
        isTransfer = true;
      }
      
      if (rule === 'min_transfer') stepCost = isTransfer ? 100 : 1;

      const newCost = current.cost + stepCost;
      const newPath = [...current.path, { ...edge, from: current.node }];

      // Allow revisiting if cost is lower (standard Dijkstra)
      // Note: for "Top K" paths this needs to be relaxed, but let's stick to optimal
      if (newCost < (visited[edge.toNode] || Infinity)) {
         queue.push({ 
           node: edge.toNode, 
           cost: newCost, 
           transfers: current.transfers + (isTransfer ? 1 : 0), 
           path: newPath 
         });
      }
    });
  }

  renderPlannerResults(results);
}


/* --- 3. UI Rendering --- */

function setupUI() {
  // Navigation
  document.getElementById('nav-back').onclick = () => switchView('home');
  document.getElementById('nav-planner').onclick = () => switchView('planner');
  document.getElementById('btn-ride').onclick = () => showToast("功能开发中...");
  
  // Filters
  document.querySelectorAll('#transport-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#transport-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      appState.selectedType = e.currentTarget.dataset.type;
      renderHome();
    };
  });

  // Area Menu
  const areaBtn = document.getElementById('filter-area-btn');
  const backdrop = document.getElementById('area-menu-backdrop');
  areaBtn.onclick = () => {
     renderAreaMenu();
     document.getElementById('area-menu').classList.toggle('open');
     backdrop.classList.toggle('open');
  };
  backdrop.onclick = () => {
    document.getElementById('area-menu').classList.remove('open');
    backdrop.classList.remove('open');
  };

  // Search
  document.getElementById('line-search').addEventListener('input', renderHome);

  // Detail Toggle
  document.getElementById('btn-dir-up').onclick = () => renderStations('up');
  document.getElementById('btn-dir-down').onclick = () => renderStations('down');

  // Planner
  document.querySelectorAll('#planner-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#planner-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      findRoute();
    };
  });
  
  // Autocomplete bindings
  bindAutocomplete('plan-start');
  bindAutocomplete('plan-end');
  document.getElementById('btn-swap-stations').onclick = () => {
    const s = document.getElementById('plan-start');
    const e = document.getElementById('plan-end');
    [s.value, e.value] = [e.value, s.value];
    findRoute();
  };
}

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  
  const backBtn = document.getElementById('nav-back');
  const title = document.getElementById('page-title');
  
  if (viewName === 'home') {
    backBtn.style.display = 'none';
    title.innerText = '公交 / 地铁';
  } else if (viewName === 'detail') {
    backBtn.style.display = 'flex';
    title.innerText = '线路详情';
  } else {
    backBtn.style.display = 'flex';
    title.innerText = '出行规划';
  }
  appState.currentView = viewName;
}

/* --- Render Home --- */
function renderHome() {
  const container = document.getElementById('line-list');
  container.innerHTML = '';
  
  const search = document.getElementById('line-search').value.toLowerCase();
  
  // Get unique cities for filter menu
  const cities = [...new Set(appState.lines.map(l => l.city))];
  
  const filtered = appState.lines.filter(l => {
    const matchCity = appState.selectedCity === 'all' || l.city === appState.selectedCity;
    const matchType = appState.selectedType === 'all' || 
                      (appState.selectedType === 'metro' && l.isMetro) ||
                      (appState.selectedType === 'bus' && !l.isMetro);
    const matchSearch = l.name.toLowerCase().includes(search) || l.stationsUp.join('').includes(search);
    return matchCity && matchType && matchSearch;
  });

  filtered.forEach(line => {
    const card = document.createElement('div');
    card.className = 'card';
    const color = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';
    
    // Icon
    const icon = line.isMetro ? 'subway' : 'directions_bus';
    
    card.innerHTML = `
      <div class="line-info-row">
        <div class="line-icon-badge" style="background:${color}">
          <span class="material-symbols-rounded">${icon}</span>
        </div>
        <div class="line-name">${line.name}</div>
        ${appState.logos.area[line.city] ? `<img src="${appState.logos.area[line.city]}" style="width:24px;">` : ''}
      </div>
      <div class="line-route">
        <span>${line.stationsUp[0]}</span>
        <span class="material-symbols-rounded" style="font-size:14px; margin:0 4px;">arrow_forward</span>
        <span>${line.stationsUp[line.stationsUp.length-1]}</span>
      </div>
    `;
    card.onclick = () => openDetail(line);
    container.appendChild(card);
  });
}

function renderAreaMenu() {
  const menu = document.getElementById('area-menu');
  menu.innerHTML = `<div class="menu-item" onclick="selectCity('all')">全部地区</div>`;
  const cities = [...new Set(appState.lines.map(l => l.city))];
  cities.forEach(c => {
    const logo = appState.logos.area[c] || '';
    menu.innerHTML += `
      <div class="menu-item" onclick="selectCity('${c}')">
        ${logo ? `<img src="${logo}">` : ''}
        <span>${c}</span>
      </div>
    `;
  });
}

function selectCity(city) {
  appState.selectedCity = city;
  document.getElementById('area-menu-backdrop').click(); // close menu
  renderHome();
}

/* --- Render Detail --- */
let currentLine = null;

function openDetail(line) {
  currentLine = line;
  switchView('detail');
  
  const header = document.getElementById('detail-header');
  const compLogo = appState.logos.company[line.company] || '';
  const badgeColor = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';

  header.innerHTML = `
    <div class="dh-top">
      <div class="line-icon-badge" style="background:${badgeColor}; width:56px; height:56px; font-size:20px;">
        ${line.name}
      </div>
      <div>
        <div style="font-size:20px; font-weight:bold;">${line.name}</div>
        <div style="font-size:14px; opacity:0.8;">${line.city} · ${line.company} ${compLogo ? `<img src="${compLogo}" class="company-logo">` : ''}</div>
      </div>
    </div>
    <div class="dh-tags">
       ${line.fare ? `<div class="tag"><span class="material-symbols-rounded" style="font-size:14px">payments</span>${line.fare}</div>` : ''}
       <div class="tag"><span class="material-symbols-rounded" style="font-size:14px">schedule</span>首 ${line.startTime} 末 ${line.endTime}</div>
    </div>
  `;

  document.getElementById('dest-up').innerText = line.stationsUp[line.stationsUp.length - 1];
  document.getElementById('dest-down').innerText = line.stationsDown[line.stationsDown.length - 1];
  
  // Default to Up
  renderStations('up');
}

function renderStations(dir) {
  const list = document.getElementById('station-list');
  list.innerHTML = '';
  
  // Toggle Buttons UI
  document.getElementById('btn-dir-up').classList.toggle('active', dir === 'up');
  document.getElementById('btn-dir-down').classList.toggle('active', dir === 'down');

  const stations = dir === 'up' ? currentLine.stationsUp : currentLine.stationsDown;

  stations.forEach(s => {
    const div = document.createElement('div');
    div.className = 'station-item';
    div.innerText = s;
    div.onclick = () => {
       // Simple interaction: ask to set as start or end
       if(!document.getElementById('plan-start').value) {
         document.getElementById('plan-start').value = s;
         showToast(`已设为起点: ${s}`);
         switchView('planner');
       } else {
         document.getElementById('plan-end').value = s;
         showToast(`已设为终点: ${s}`);
         switchView('planner');
         findRoute();
       }
    };
    list.appendChild(div);
  });
}

/* --- Planner Helper --- */
function bindAutocomplete(id) {
  const input = document.getElementById(id);
  const box = document.getElementById('suggestion-box');
  
  input.addEventListener('input', () => {
    const val = input.value.trim();
    if(val.length < 1) { box.classList.add('hidden'); return; }
    
    // Flatten all stations
    const allSt = new Set();
    appState.lines.forEach(l => {
      l.stationsUp.forEach(s => allSt.add(s));
      l.stationsDown.forEach(s => allSt.add(s));
    });
    
    const matches = [...allSt].filter(s => s.includes(val)).slice(0, 5);
    
    box.innerHTML = '';
    matches.forEach(m => {
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      div.innerText = m;
      div.onclick = () => {
        input.value = m;
        box.classList.add('hidden');
        findRoute();
      };
      box.appendChild(div);
    });
    
    if(matches.length > 0) box.classList.remove('hidden');
  });
}

function renderPlannerResults(results) {
  const container = document.getElementById('planner-results');
  container.innerHTML = '';
  
  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到相关路线</div>';
    return;
  }

  results.forEach(res => {
    // Reconstruct path for display logic (merging sequential stops on same line)
    const segments = [];
    let currentSeg = null;

    res.path.forEach(step => {
      if (!currentSeg || currentSeg.lineId !== step.lineId) {
        if(currentSeg) segments.push(currentSeg);
        currentSeg = { line: step.lineName, from: step.from, to: step.toNode, count: 1, isMetro: step.isMetro };
      } else {
        currentSeg.to = step.toNode;
        currentSeg.count++;
      }
    });
    if(currentSeg) segments.push(currentSeg);

    const card = document.createElement('div');
    card.className = 'plan-result-card';
    
    const totalStops = res.path.length;
    // Estimate: 3 min per bus stop, 2 min per metro stop, 5 min transfer
    const timeEst = segments.reduce((acc, seg) => acc + (seg.count * (seg.isMetro?2:3)), 0) + (segments.length - 1) * 5;

    card.innerHTML = `
      <div class="plan-summary">
        <div class="plan-time">约 ${timeEst} 分钟</div>
        <div style="font-size:12px; color:gray">${totalStops}站 · 换乘${segments.length-1}次</div>
      </div>
      <div class="plan-route-steps">
        ${segments.map((seg, idx) => `
          <span style="font-weight:600; color:${seg.isMetro?'#006495':'#d81b60'}">${seg.line}</span>
          ${idx < segments.length-1 ? '<span class="material-symbols-rounded step-arrow" style="font-size:14px">arrow_forward</span>' : ''}
        `).join('')}
      </div>
      <div style="text-align:right; margin-top:8px;">
        <button class="push-btn" onclick="subscribePush('${segments.map(s=>s.line).join('→')}')">
          <span class="material-symbols-rounded" style="vertical-align:middle">notifications_active</span> 提醒
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function subscribePush(routeInfo) {
  // Web Push Simulation
  if ('Notification' in window) {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
         new Notification('出行提醒已设置', { body: `将在到站时提醒您: ${routeInfo}` });
         showToast("提醒已添加");
      }
    });
  } else {
    showToast("浏览器不支持通知");
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// Start
init();
