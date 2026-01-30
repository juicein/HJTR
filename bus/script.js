/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffix: [] },
  currentView: 'home',
  
  // Persistent State
  selectedCity: localStorage.getItem('bus_city') || 'all',
  selectedType: localStorage.getItem('bus_type') || 'all',
  
  planner: { start: '', end: '', rule: 'fastest' }
};

/* --- 1. Init & Persistence --- */
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
    
    // Restore Filters
    applyFilters(); 
  } catch (e) {
    console.error("Init Error:", e);
    showToast("数据加载失败");
  }
}

function parseLines(rawText) {
  const lines = rawText.trim().split(/\n+/);
  appState.lines = lines.map((line, index) => {
    const name = line.match(/【(.*?)】/)?.[1] || "未命名";
    const company = line.match(/\{(.*?)\}/)?.[1] || "";
    const fare = line.match(/《(.*?)》/)?.[1] || "";
    const city = line.match(/『(.*?)』/)?.[1] || "其他";
    const startTime = line.match(/§(.*?)§/)?.[1] || "";
    const endTime = line.match(/@(.*?)@/)?.[1] || "";
    const color = line.match(/∮([0-9A-Fa-f]{6,8})∮/)?.[1];
    
    // Types
    const isMetro = line.includes("θ地铁θ");
    // Explicitly look for Train keywords (User requirement 8)
    const isTrain = line.includes("θ铁路θ") || line.includes("θ火车θ");
    
    let type = 'bus';
    if(isMetro) type = 'metro';
    if(isTrain) type = 'train';

    const stationPart = line.replace(/^【.*?】/, "").split("-{")[0];
    const rawStations = stationPart.split("-").filter(s => s && s.trim());
    
    // Parse Directions
    const stationsUp = [];
    const stationsDown = [];

    rawStations.forEach(s => {
      const cleanName = s.replace(/[↑↓]/g, "");
      if (!s.includes("↓")) stationsUp.push(cleanName);
    });

    [...rawStations].reverse().forEach(s => {
      const cleanName = s.replace(/[↑↓]/g, "");
      if (!s.includes("↑")) stationsDown.push(cleanName);
    });

    return {
      id: index,
      name, company, fare, city, startTime, endTime, color, type,
      stationsUp, stationsDown
    };
  });
  
  populateDatalist();
}

function populateDatalist() {
  const allStations = new Set();
  appState.lines.forEach(l => {
    l.stationsUp.forEach(s => allStations.add(s));
    l.stationsDown.forEach(s => allStations.add(s));
  });
  
  const datalist = document.getElementById('station-datalist');
  datalist.innerHTML = '';
  [...allStations].sort().forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    datalist.appendChild(opt);
  });
}

/* --- 2. Logic: Routing with Region Lock & Merging --- */

function normalizeStation(name) {
  let n = name.trim();
  for (const suffix of appState.aliases.suffix) {
    if (n.endsWith(suffix)) {
      n = n.substring(0, n.length - suffix.length);
      break;
    }
  }
  return n;
}

function getCanonicalStationId(name) {
  const norm = normalizeStation(name);
  for (const group of appState.aliases.manual) {
    if (group.some(g => normalizeStation(g) === norm)) {
      return normalizeStation(group[0]);
    }
  }
  return norm;
}

// Graph builder now filters by CITY (Requirement 1)
function buildGraph(rule) {
  const graph = {}; 
  
  // If a specific city is selected in Home, stick to it. 
  // If 'all', we try to infer from start station or just allow all (but user asked for region lock).
  // Strategy: If user selected "North Union" in top bar, only build graph with North Union lines.
  const targetCity = appState.selectedCity; 

  appState.lines.forEach(line => {
    // Filter 1: City Constraint
    if (targetCity !== 'all' && line.city !== targetCity) return;
    
    // Filter 2: Type Constraint (Bus Only Rule)
    if (rule === 'bus_only' && (line.type === 'metro' || line.type === 'train')) return;

    addLineEdges(graph, line, line.stationsUp, 'up');
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
      lineType: line.type,
      lineColor: line.color,
      fare: line.fare,
      time: line.startTime + '-' + line.endTime,
      direction: dir
    });
  }
}

function findRoute() {
  const startRaw = document.getElementById('plan-start').value;
  const endRaw = document.getElementById('plan-end').value;
  const start = getCanonicalStationId(startRaw);
  const end = getCanonicalStationId(endRaw);
  
  if (!start || !end) return;

  const rule = document.getElementById('planner-filters').querySelector('.active').dataset.rule;
  const graph = buildGraph(rule);
  
  // Dijkstra
  const queue = [{ node: start, cost: 0, path: [] }];
  const visited = {};
  const results = [];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    if (current.cost > (visited[current.node] || Infinity)) continue;
    visited[current.node] = current.cost;

    if (current.node === end) {
      // Post-process path to merge segments (Requirement 5)
      const mergedPath = mergePathSegments(current.path);
      results.push({ ...current, segments: mergedPath });
      if (results.length >= 3) break;
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      let stepCost = 1; 
      let penalty = 0;
      
      const lastEdge = current.path[current.path.length - 1];
      // Transfer Penalty
      if (lastEdge && lastEdge.lineId !== edge.lineId) {
        penalty = 10;
        if (rule === 'min_transfer') penalty = 50;
      }
      
      // Type weights
      if (edge.lineType === 'metro') stepCost = 0.8; // Metro faster
      if (edge.lineType === 'train') stepCost = 0.5; // Train fastest
      
      const newCost = current.cost + stepCost + penalty;
      if (newCost < (visited[edge.toNode] || Infinity)) {
         queue.push({ 
           node: edge.toNode, 
           cost: newCost, 
           path: [...current.path, { ...edge, from: current.node }] 
         });
      }
    });
  }

  renderPlannerResults(results);
}

// Important: Merge continuous stops into one instruction (Requirement 5)
function mergePathSegments(rawPath) {
  if (rawPath.length === 0) return [];
  
  const segments = [];
  let currentSeg = null;

  rawPath.forEach(step => {
    if (!currentSeg) {
      currentSeg = { 
        line: step.lineName, 
        lineId: step.lineId,
        color: step.lineColor,
        type: step.lineType,
        from: step.from, 
        to: step.toNode, 
        count: 1,
        meta: step.fare 
      };
    } else if (currentSeg.lineId === step.lineId && currentSeg.direction === step.direction) {
      // Continue same line
      currentSeg.to = step.toNode;
      currentSeg.count++;
    } else {
      // Change line
      segments.push(currentSeg);
      currentSeg = { 
        line: step.lineName, 
        lineId: step.lineId,
        color: step.lineColor,
        type: step.lineType,
        from: step.from, 
        to: step.toNode, 
        count: 1,
        meta: step.fare
      };
    }
  });
  if (currentSeg) segments.push(currentSeg);
  return segments;
}

/* --- 3. UI Interaction --- */

function setupUI() {
  // Navigation
  const portalBtn = document.getElementById('nav-portal');
  const appBackBtn = document.getElementById('nav-app-back');
  
  appBackBtn.onclick = () => {
    if(appState.currentView === 'detail' || appState.currentView === 'planner') {
      switchView('home');
    }
  };

  document.getElementById('nav-planner').onclick = () => switchView('planner');
  
  // Transport Filters (Persistence)
  document.querySelectorAll('#transport-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#transport-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      appState.selectedType = e.currentTarget.dataset.type;
      localStorage.setItem('bus_type', appState.selectedType);
      renderHome();
    };
  });

  // Area Menu Logic
  const areaBtn = document.getElementById('filter-area-btn');
  const backdrop = document.getElementById('area-menu-backdrop');
  const searchInput = document.getElementById('area-search-input');

  areaBtn.onclick = () => {
     renderAreaMenu(); // Render first
     document.getElementById('area-menu').classList.toggle('open');
     backdrop.classList.toggle('open');
     searchInput.focus();
  };
  
  backdrop.onclick = () => {
    document.getElementById('area-menu').classList.remove('open');
    backdrop.classList.remove('open');
  };
  
  // Area Search (Requirement 11)
  searchInput.addEventListener('input', (e) => {
    renderAreaMenu(e.target.value);
  });

  // Search Home
  document.getElementById('line-search').addEventListener('input', renderHome);

  // Detail View Toggles
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
  
  document.getElementById('btn-swap-stations').onclick = () => {
    const s = document.getElementById('plan-start');
    const e = document.getElementById('plan-end');
    [s.value, e.value] = [e.value, s.value];
    findRoute();
  };
  
  document.getElementById('plan-start').addEventListener('change', findRoute);
  document.getElementById('plan-end').addEventListener('change', findRoute);

  // Modal Close
  document.getElementById('close-modal-btn').onclick = () => {
    document.getElementById('route-detail-modal').close();
  };
  
  document.getElementById('share-route-btn').onclick = () => {
    showToast("正在生成图片...");
    setTimeout(() => showToast("图片已保存到相册 (模拟)"), 1000);
  };
  
  document.getElementById('modal-notify-btn').onclick = () => {
    if ('Notification' in window) {
       Notification.requestPermission().then(p => {
         if(p==='granted') showToast("到站提醒已开启");
       });
    } else {
      showToast("提醒已开启");
    }
  };
}

function applyFilters() {
  // Apply saved chips
  const typeChip = document.querySelector(`#transport-filters .chip[data-type="${appState.selectedType}"]`);
  if(typeChip) {
    document.querySelectorAll('#transport-filters .chip').forEach(c => c.classList.remove('active'));
    typeChip.classList.add('active');
  }
  renderHome();
}

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  
  const portalBtn = document.getElementById('nav-portal');
  const appBackBtn = document.getElementById('nav-app-back');
  const title = document.getElementById('page-title');
  const plannerBtn = document.getElementById('nav-planner');
  const areaBtn = document.getElementById('filter-area-btn');
  
  appState.currentView = viewName;

  // Top Bar Logic (Requirement 2 & 6)
  if (viewName === 'home') {
    portalBtn.style.display = 'flex';
    appBackBtn.style.display = 'none';
    title.innerText = '公交 / 地铁';
    plannerBtn.style.display = 'flex';
    areaBtn.style.display = 'flex';
  } else {
    portalBtn.style.display = 'none';
    appBackBtn.style.display = 'flex';
    plannerBtn.style.display = 'none'; // Hide planner entry when inside other views
    areaBtn.style.display = 'none';
    
    if (viewName === 'detail') title.innerText = '线路详情';
    if (viewName === 'planner') title.innerText = '出行规划';
  }
}

/* --- Render Logic --- */

function renderHome() {
  const container = document.getElementById('line-list');
  container.innerHTML = '';
  
  const search = document.getElementById('line-search').value.toLowerCase();
  
  const filtered = appState.lines.filter(l => {
    const matchCity = appState.selectedCity === 'all' || l.city === appState.selectedCity;
    const matchType = appState.selectedType === 'all' || l.type === appState.selectedType;
    const matchSearch = l.name.toLowerCase().includes(search);
    return matchCity && matchType && matchSearch;
  });

  filtered.forEach(line => {
    const card = document.createElement('div');
    card.className = 'card';
    const color = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';
    
    let icon = 'directions_bus';
    if(line.type === 'metro') icon = 'subway';
    if(line.type === 'train') icon = 'train';
    
    // Layout Requirement 4: Start-End under Title
    card.innerHTML = `
      <div class="line-icon-badge" style="background:${color}">
        <span class="material-symbols-rounded">${icon}</span>
      </div>
      <div class="card-content">
        <div class="line-name">${line.name}</div>
        <div class="line-route">
          <span>${line.stationsUp[0]}</span>
          <span class="material-symbols-rounded" style="font-size:14px;">arrow_right_alt</span>
          <span>${line.stationsUp[line.stationsUp.length-1]}</span>
        </div>
      </div>
    `;
    card.onclick = () => openDetail(line);
    container.appendChild(card);
  });
}

function renderAreaMenu(filterText = '') {
  const list = document.getElementById('area-menu-list');
  list.innerHTML = `<div class="menu-item ${appState.selectedCity==='all'?'active':''}" onclick="selectCity('all')">全部地区</div>`;
  
  const cities = [...new Set(appState.lines.map(l => l.city))];
  
  cities.filter(c => c.includes(filterText)).forEach(c => {
    const logo = appState.logos.area[c] || '';
    list.innerHTML += `
      <div class="menu-item ${appState.selectedCity===c?'active':''}" onclick="selectCity('${c}')">
        ${logo ? `<img src="${logo}">` : ''}
        <span>${c}</span>
      </div>
    `;
  });
}

function selectCity(city) {
  appState.selectedCity = city;
  localStorage.setItem('bus_city', city); // Persistence
  document.getElementById('area-menu-backdrop').click();
  renderHome();
}

let currentLine = null;
function openDetail(line) {
  currentLine = line;
  switchView('detail');
  
  const header = document.getElementById('detail-header');
  // Requirement 9: Company Logo ONLY in Detail
  const compLogo = appState.logos.company[line.company] || '';
  const badgeColor = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';

  header.innerHTML = `
    <div class="dh-top">
      <div class="line-icon-badge" style="background:${badgeColor}; width:56px; height:56px; font-size:24px;">
        ${line.name}
      </div>
      <div>
        <div style="font-size:22px; font-weight:bold;">${line.name}</div>
        <div style="font-size:14px; opacity:0.8; margin-top:4px;">
           ${line.company}
           ${compLogo ? `<img src="${compLogo}" class="company-logo-large">` : ''}
        </div>
      </div>
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; font-size:12px;">
       ${line.fare ? `<span style="background:rgba(255,255,255,0.2); padding:4px 8px; border-radius:4px;">${line.fare}</span>` : ''}
       <span style="background:rgba(255,255,255,0.2); padding:4px 8px; border-radius:4px;">首 ${line.startTime} 末 ${line.endTime}</span>
    </div>
  `;

  document.getElementById('dest-up').innerText = line.stationsUp[line.stationsUp.length - 1];
  document.getElementById('dest-down').innerText = line.stationsDown[line.stationsDown.length - 1];
  renderStations('up');
}

function renderStations(dir) {
  const list = document.getElementById('station-list');
  list.innerHTML = '';
  document.getElementById('btn-dir-up').classList.toggle('active', dir === 'up');
  document.getElementById('btn-dir-down').classList.toggle('active', dir === 'down');

  const stations = dir === 'up' ? currentLine.stationsUp : currentLine.stationsDown;
  stations.forEach(s => {
    const div = document.createElement('div');
    div.className = 'station-item';
    div.innerText = s;
    list.appendChild(div);
  });
}

/* --- Planner Results --- */
function renderPlannerResults(results) {
  const container = document.getElementById('planner-results');
  container.innerHTML = '';
  
  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到同地区的换乘方案</div>';
    return;
  }

  results.forEach(res => {
    const segments = res.segments;
    const card = document.createElement('div');
    card.className = 'plan-result-card';
    
    // Calculate total stops and transfer count
    const totalStops = segments.reduce((acc, s) => acc + s.count, 0);
    const transfers = segments.length - 1;
    
    // Overview HTML
    let routeSummary = segments.map((s, i) => `
      <span style="font-weight:600; color:${s.type==='metro'?'#006495':(s.type==='train'?'#d81b60':'#333')}">${s.line}</span>
      ${i < segments.length-1 ? '<span class="material-symbols-rounded" style="font-size:14px; color:#999">arrow_forward</span>' : ''}
    `).join(' ');

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div style="font-size:20px; font-weight:700;">推荐方案</div>
        <div style="font-size:12px; color:gray;">${totalStops}站 · 换乘${transfers}次</div>
      </div>
      <div style="font-size:14px; line-height:1.6;">${routeSummary}</div>
    `;
    
    // Requirement 7: Click to open detail modal
    card.onclick = () => showRouteDetailModal(res);
    container.appendChild(card);
  });
}

function showRouteDetailModal(result) {
  const modal = document.getElementById('route-detail-modal');
  const content = document.getElementById('modal-route-content');
  content.innerHTML = ''; // Clear previous

  // Requirement 5 & 7: Vertical Timeline Display
  result.segments.forEach((seg, index) => {
    // Determine color
    const segColor = seg.color ? `#${seg.color.slice(0,6)}` : 'var(--md-sys-color-primary)';
    let icon = 'directions_bus';
    if(seg.type === 'metro') icon = 'subway';
    if(seg.type === 'train') icon = 'train';

    content.innerHTML += `
      <div class="route-segment">
        <div class="seg-line-indicator" style="background:${segColor}">
           <div class="seg-icon" style="color:${segColor}">
             <span class="material-symbols-rounded">${icon}</span>
           </div>
        </div>
        <div class="seg-content">
          <div class="seg-title" style="color:${segColor}">${seg.line}</div>
          <div class="seg-desc">
            从 <strong>${seg.from}</strong> 上车<br>
            乘坐 ${seg.count} 站<br>
            在 <strong>${seg.to}</strong> ${index < result.segments.length -1 ? '换乘' : '下车'}
          </div>
          ${seg.meta ? `<div class="seg-meta">${seg.meta}</div>` : ''}
        </div>
      </div>
    `;
  });
  
  modal.showModal();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// Start
init();
