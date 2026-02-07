/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffixGroups: [] },
  directLines: { manual: [], auto: [] }, // 新增直通车数据
  currentView: 'home',
  selectedCity: localStorage.getItem('bus_selected_city') || 'all',
  selectedType: localStorage.getItem('bus_selected_type') || 'all', 
  planner: { start: '', end: '', rule: 'all' }
};

/* --- 1. Data Loading & Parsing --- */
async function init() {
  try {
    const [txtRes, areaRes, compRes, aliasRes, directRes] = await Promise.all([
      fetch('../data/bus_data.txt'),
      fetch('../data/logos_area.json'),
      fetch('../data/logos_company.json'),
      fetch('../data/station_alias.json'),
      fetch('../data/direct_line.json') // 新增加载
    ]);

    const txt = await txtRes.text();
    appState.logos.area = await areaRes.json();
    appState.logos.company = await compRes.json();
    const aliasData = await aliasRes.json();
    const directData = await directRes.json();
    
    appState.aliases.manual = aliasData.manual_equivalents || [];
    appState.aliases.suffixGroups = aliasData.suffix_groups || [];
    appState.directLines.manual = directData.manual_equivalents || [];
    appState.directLines.auto = directData.auto_equivalents || [];

    parseLines(txt);
    setupUI();
    populateStationDatalist();
    
    // 优先处理URL路由
    if (!handleRouting()) {
       applyFilters(); // 只有没命中路由时才加载默认首页
    }
    
  } catch (e) {
    console.error("Initialization failed:", e);
    showToast("数据加载失败");
  }
}

// 4. Enhanced URL Routing Logic
function handleRouting() {
  // 获取完整查询字符串，例如 "?search=1号线" 或 "planning?=奥涅加"
  const urlStr = decodeURIComponent(window.location.search);
  const path = window.location.pathname; // /bus/search 或 /bus/planning
  
  // 归一化处理：提取关键部分
  // 支持 /bus/search?=LineName 或 ?search=LineName
  // 支持 /bus/planning?=StartStation 或 ?planning=StartStation
  
  let mode = null;
  let value = "";

  if (urlStr.includes('search') || path.includes('search')) {
    mode = 'search';
    // 尝试提取值：可能是 ?search=Value 或 ?=Value (如果在search路径下)
    const match = urlStr.match(/[?&]search=([^&]*)/) || urlStr.match(/\?=([^&]*)/);
    if (match) value = match[1];
  } else if (urlStr.includes('planning') || path.includes('planning')) {
    mode = 'planner';
    const match = urlStr.match(/[?&]planning=([^&]*)/) || urlStr.match(/\?=([^&]*)/);
    if (match) value = match[1];
  }

  if (mode === 'search' && value) {
    document.getElementById('line-search').value = value;
    switchView('home'); // Home view handles the search render
    const exactMatch = appState.lines.find(l => l.name === value);
    if (exactMatch) openDetail(exactMatch);
    else renderHome();
    return true;
  }

  if (mode === 'planner' && value) {
    document.getElementById('plan-start').value = value;
    switchView('planner');
    return true;
  }

  return false;
}

/* 8. Enhanced Parsing (保留原有逻辑) */
function parseLines(rawText) {
  const lines = rawText.trim().split(/\n+/);
  appState.lines = lines.map((line, index) => {
    const name = line.match(/【(.*?)】/)?.[1] || "未命名";
    const company = line.match(/\{(.*?)\}/)?.[1] || "";
    const fare = line.match(/《(.*?)》/)?.[1] || "";
    const city = line.match(/『(.*?)』/)?.[1] || "其他";
    const startTime = line.match(/§(.*?)§/)?.[1] || "";
    const endTime = line.match(/@(.*?)@/)?.[1] || "";
    
    const isMonorail = line.includes("θ单轨θ");
    const isRubber = line.includes("θ胶轮θ");
    const isMetroRaw = line.includes("θ地铁θ");
    const isBRT = line.includes("θBRTθ");
    const isRailRaw = line.includes("θ铁路θ") || name.includes("城际") || name.includes("高铁");
    const color = line.match(/∮([0-9A-Fa-f]{6,8})∮/)?.[1];

    const isMetro = isMetroRaw || isMonorail || isRubber; 
    const isRail = isRailRaw; 
    
    let iconType = 'directions_bus'; 
    if (isRail) iconType = 'train';
    else if (isMonorail) iconType = 'tram'; 
    else if (isRubber) iconType = 'commute'; 
    else if (isMetroRaw) iconType = 'subway';
    else if (isBRT) iconType = 'directions_bus'; 

    const stationPart = line.replace(/^【.*?】/, "").split("-{")[0];
    const rawStations = stationPart.split("-").filter(s => s && s.trim());
    
    const stationsUp = [];
    const stationsDown = [];

    rawStations.forEach(s => {
      const cleanName = s.replace(/[↑↓]/g, "");
      const isUp = !s.includes("↓");   
      if (isUp) stationsUp.push(cleanName);
    });

    [...rawStations].reverse().forEach(s => {
      const cleanName = s.replace(/[↑↓]/g, "");
      const isDown = !s.includes("↑");
      if (isDown) stationsDown.push(cleanName);
    });

    return {
      id: index,
      name, company, fare, city, startTime, endTime, 
      isMetro, isRail, color,
      specialType: isMonorail ? 'monorail' : (isRubber ? 'rubber' : (isBRT ? 'brt' : null)),
      iconType,
      stationsUp, stationsDown,
      type: isMetro ? 'metro' : (isRail ? 'rail' : 'bus') 
    };
  });
}

function populateStationDatalist() {
  const allStations = new Set();
  appState.lines.forEach(l => {
    l.stationsUp.forEach(s => allStations.add(s));
    l.stationsDown.forEach(s => allStations.add(s));
  });
  
  const datalist = document.getElementById('station-datalist');
  datalist.innerHTML = '';
  [...allStations].sort().forEach(s => {
    const option = document.createElement('option');
    option.value = s;
    datalist.appendChild(option);
  });
}

function getCanonicalStationId(name) {
  let n = name.trim();
  for (const group of appState.aliases.manual) {
    if (group.includes(n)) return group[0];
  }
  let baseName = n;
  for (const group of appState.aliases.suffixGroups) {
    for (const suffix of group) {
      if (baseName.endsWith(suffix)) {
        const candidate = baseName.substring(0, baseName.length - suffix.length);
        if (candidate.length > 0) return candidate; 
      }
    }
  }
  return baseName;
}

// Check if two lines are "Direct/Through" lines
function areLinesDirect(nameA, nameB) {
  // Manual check
  for (const group of appState.directLines.manual) {
    if (group.includes(nameA) && group.includes(nameB)) return true;
  }
  // Auto suffix check (e.g. Line 1 Main & Line 1 Branch)
  for (const pair of appState.directLines.auto) {
    // Check if one name contains suffix A and the other suffix B, but base is same
    // Simplified logic: Remove suffix, check equality
    // This is a basic implementation.
    const removeSuffix = (str) => {
        let res = str;
        pair.forEach(s => { if(str.endsWith(s)) res = str.replace(s, ''); });
        return res;
    };
    if (removeSuffix(nameA) === removeSuffix(nameB) && nameA !== nameB) return true;
  }
  return false;
}

// 10. Transfer Logic Update
function getTransferType(lineA, lineB) {
  if (lineA.id === lineB.id) return 'same_line'; // Should not happen in transfer logic usually
  
  // Rule: Bus <-> Metro/Rail is ALWAYS out_station
  const typeA = lineA.type; // bus, metro, rail
  const typeB = lineB.type;
  
  if ((typeA === 'bus' && (typeB === 'metro' || typeB === 'rail')) ||
      (typeB === 'bus' && (typeA === 'metro' || typeA === 'rail'))) {
    return 'out_station';
  }

  // Check Direct Line
  if (areLinesDirect(lineA.name, lineB.name)) {
      return 'direct_connect'; // Special visual type
  }

  // Default Metro<->Metro or Bus<->Bus
  return 'internal_transfer'; // 站内换乘 (assuming generic case)
}

/* --- Logic: Route Finding --- */
function buildGraph(rule, startCity) {
  const graph = {}; 

  appState.lines.forEach(line => {
    if (startCity && line.city !== startCity) return;
    if (rule === 'bus_only' && (line.isMetro || line.isRail)) return;
    
    addLineEdges(graph, line, line.stationsUp, 'up', rule);
    addLineEdges(graph, line, line.stationsDown, 'down', rule);
  });
  return graph;
}

function addLineEdges(graph, line, stations, dir, rule) {
  for (let i = 0; i < stations.length - 1; i++) {
    const fromRaw = stations[i];
    const toRaw = stations[i+1];
    const fromId = getCanonicalStationId(fromRaw);
    const toId = getCanonicalStationId(toRaw);
    
    if (!graph[fromId]) graph[fromId] = [];
    
    let weight = 1; 
    
    // Weight Strategy
    if (line.isMetro) weight = 0.6;
    if (line.isRail) weight = 0.4;
    if (line.specialType === 'brt') weight = 0.8;

    if (rule === 'rail_priority') {
      if (line.isMetro || line.isRail) weight = 0.3;
      else weight = 2.0;
    }
    
    graph[fromId].push({
      toNode: toId,
      toRawName: toRaw,
      fromRawName: fromRaw,
      lineName: line.name,
      lineId: line.id,
      direction: dir,
      rawWeight: weight,
      type: line.type,
      fullLine: line 
    });
  }
}

function checkOperatingTime(startTime, endTime) {
  if (!startTime || !endTime) return true;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const parseTime = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  if (end < start) return currentMinutes >= start || currentMinutes <= end;
  return currentMinutes >= start && currentMinutes <= end;
}

// Core Dijkstra Algorithm (returns raw results)
function calculatePath(startId, endId, rule, startCity) {
  const graph = buildGraph(rule, startCity);
  const queue = [{ node: startId, cost: 0, path: [] }];
  const visited = {}; 
  const results = [];
  const maxResults = 5; // Per strategy

  let loops = 0;
  while (queue.length > 0 && loops < 8000) {
    loops++;
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    if (current.cost > (visited[current.node] || Infinity)) continue;
    visited[current.node] = current.cost;

    if (current.node === endId) {
      results.push(current);
      if (results.length >= maxResults) break; 
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      let stepCost = edge.rawWeight;
      let isTransfer = false;
      let transferType = 'none';
      
      const lastStep = current.path[current.path.length - 1];
      
      if (lastStep && lastStep.lineId !== edge.lineId) {
        isTransfer = true;
        transferType = getTransferType(lastStep.fullLine, edge.fullLine);
        
        // Cost Penalty Logic
        if (transferType === 'out_station') stepCost += 25; // High penalty for exit
        else if (transferType === 'direct_connect') stepCost += 2; // Low penalty for direct
        else stepCost += 10; // Normal station transfer
        
        if (rule === 'min_transfer') stepCost += 100; // Artificial High Penalty
      }
      
      const newCost = current.cost + stepCost;
      const newPath = [...current.path, { ...edge, transferType: isTransfer ? transferType : 'none' }];

      // Looser visited check
      if (newCost < (visited[edge.toNode] || Infinity) + 5) {
         queue.push({ node: edge.toNode, cost: newCost, path: newPath });
      }
    });
  }
  return results;
}

function findRoute() {
  const startInput = document.getElementById('plan-start').value;
  const endInput = document.getElementById('plan-end').value;
  
  if (!startInput || !endInput) {
    showToast("请输入起点和终点");
    return;
  }

  const startId = getCanonicalStationId(startInput);
  const endId = getCanonicalStationId(endInput);

  if (startId === endId) {
    showToast("起点终点看起来是同一个地方");
    return;
  }

  const startLine = appState.lines.find(l => 
    l.stationsUp.some(s => getCanonicalStationId(s) === startId) || 
    l.stationsDown.some(s => getCanonicalStationId(s) === startId)
  );
  const regionLock = startLine ? startLine.city : null; 
  
  const activeChip = document.getElementById('planner-filters').querySelector('.active');
  const uiRule = activeChip ? activeChip.dataset.rule : 'all';
  
  let finalRawResults = [];

  // 1. Planner Strategy: "All" means aggregate
  if (uiRule === 'all') {
    // Run separate strategies to ensure variety
    const rFastest = calculatePath(startId, endId, 'fastest', regionLock);
    const rTransfer = calculatePath(startId, endId, 'min_transfer', regionLock);
    const rRail = calculatePath(startId, endId, 'rail_priority', regionLock);
    
    // Merge and deduplicate based on line sequence
    const all = [...rFastest, ...rTransfer, ...rRail];
    const uniqueMap = new Map();
    
    all.forEach(res => {
        const key = res.path.map(p => p.lineName).join('|'); // Simple dedupe key
        if (!uniqueMap.has(key) || uniqueMap.get(key).cost > res.cost) {
            uniqueMap.set(key, res);
        }
    });
    
    finalRawResults = Array.from(uniqueMap.values()).sort((a,b) => a.cost - b.cost).slice(0, 10);
  } else {
    // Single strategy
    finalRawResults = calculatePath(startId, endId, uiRule, regionLock);
  }

  const formattedResults = finalRawResults.map(res => compressPath(res.path));
  renderPlannerResults(formattedResults);
}

function compressPath(rawPath) {
  if (rawPath.length === 0) return [];

  const segments = [];
  let currentSeg = null;

  rawPath.forEach(step => {
    if (!currentSeg) {
      currentSeg = {
        lineName: step.lineName,
        lineId: step.lineId,
        type: step.type,
        iconType: step.fullLine.iconType,
        startStation: step.fromRawName,
        endStation: step.toRawName,
        stopCount: 1,
        direction: step.direction,
        meta: step.fullLine,
        transferType: step.transferType // From previous step to this segment start
      };
    } else if (step.lineId === currentSeg.lineId && step.direction === currentSeg.direction) {
      currentSeg.endStation = step.toRawName;
      currentSeg.stopCount++;
    } else {
      segments.push(currentSeg);
      currentSeg = {
        lineName: step.lineName,
        lineId: step.lineId,
        type: step.type,
        iconType: step.fullLine.iconType,
        startStation: step.fromRawName,
        endStation: step.toRawName,
        stopCount: 1,
        direction: step.direction,
        meta: step.fullLine,
        transferType: step.transferType
      };
    }
  });
  if (currentSeg) segments.push(currentSeg);
  return segments;
}

/* --- UI Rendering --- */

function setupUI() {
  document.getElementById('nav-back').onclick = () => {
    if (appState.currentView === 'home') window.history.back();
    else switchView('home');
  };
  
  document.getElementById('nav-to-planner').onclick = () => switchView('planner');
  
  document.querySelectorAll('#transport-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#transport-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      appState.selectedType = e.currentTarget.dataset.type;
      localStorage.setItem('bus_selected_type', appState.selectedType);
      renderHome();
    };
  });

  const areaBtn = document.getElementById('filter-area-btn');
  const backdrop = document.getElementById('area-menu-backdrop');
  areaBtn.onclick = () => {
     renderAreaMenu();
     document.getElementById('area-menu').classList.toggle('open');
     backdrop.classList.toggle('open');
     setTimeout(() => document.getElementById('area-search-input').focus(), 100);
  };
  backdrop.onclick = () => {
    document.getElementById('area-menu').classList.remove('open');
    backdrop.classList.remove('open');
  };

  document.getElementById('line-search').addEventListener('input', renderHome);
  document.getElementById('btn-dir-up').onclick = () => renderStations('up');
  document.getElementById('btn-dir-down').onclick = () => renderStations('down');

  document.querySelectorAll('#planner-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#planner-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      // Trigger search if fields are full
      if(document.getElementById('plan-start').value && document.getElementById('plan-end').value) {
          findRoute();
      }
    };
  });
  
  document.getElementById('btn-swap-stations').onclick = () => {
    const s = document.getElementById('plan-start');
    const e = document.getElementById('plan-end');
    [s.value, e.value] = [e.value, s.value];
  };

  document.getElementById('btn-start-plan').onclick = findRoute;
  document.getElementById('modal-close').onclick = closeRouteModal;
  document.getElementById('modal-backdrop').onclick = closeRouteModal;
}

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  
  const title = document.getElementById('page-title');
  const plannerBtn = document.getElementById('nav-to-planner');
  
  appState.currentView = viewName;
  
  if (viewName === 'home') {
    title.innerText = '公交 / 地铁';
    plannerBtn.style.display = 'flex';
  } else if (viewName === 'detail') {
    title.innerText = '线路详情';
    plannerBtn.style.display = 'none';
  } else {
    title.innerText = '出行规划';
    plannerBtn.style.display = 'none';
  }
}

function applyFilters() {
  const typeChip = document.querySelector(`#transport-filters .chip[data-type="${appState.selectedType}"]`);
  if(typeChip) {
    document.querySelectorAll('#transport-filters .chip').forEach(c => c.classList.remove('active'));
    typeChip.classList.add('active');
  }
  renderHome();
}

function renderHome() {
  const container = document.getElementById('line-list');
  container.innerHTML = '';
  const search = document.getElementById('line-search').value.toLowerCase();
  
  const filtered = appState.lines.filter(l => {
    const matchCity = appState.selectedCity === 'all' || l.city === appState.selectedCity;
    const matchType = appState.selectedType === 'all' || 
                      (appState.selectedType === 'metro' && l.isMetro) ||
                      (appState.selectedType === 'rail' && l.isRail) || 
                      (appState.selectedType === 'bus' && !l.isMetro && !l.isRail);
    const matchSearch = l.name.toLowerCase().includes(search) || l.stationsUp.join('').includes(search);
    return matchCity && matchType && matchSearch;
  });

  filtered.forEach(line => {
    const card = document.createElement('div');
    card.className = 'card';
    const color = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';
    
    const icon = line.iconType || 'directions_bus';

    card.innerHTML = `
      <div class="line-row-main">
        <div class="line-icon-badge" style="background:${color}">
          <span class="material-symbols-rounded sub-icon">${icon}</span>
        </div>
        <div class="line-text-group">
          <div class="line-header-row">
            <div class="line-name">${line.name}</div>
            ${appState.logos.area[line.city] ? `<img src="${appState.logos.area[line.city]}" class="area-icon">` : ''}
          </div>
          <div class="line-subtitle">
            ${line.stationsUp[0]} → ${line.stationsUp[line.stationsUp.length-1]}
          </div>
        </div>
      </div>
    `;
    card.onclick = () => openDetail(line);
    container.appendChild(card);
  });
}

function renderAreaMenu() {
  const menuList = document.getElementById('area-menu-list');
  const searchInput = document.getElementById('area-search-input');
  
  const renderItems = (filterText) => {
    menuList.innerHTML = `<div class="menu-item ${appState.selectedCity === 'all' ? 'selected' : ''}" onclick="selectCity('all')">全部地区</div>`;
    const cities = [...new Set(appState.lines.map(l => l.city))];
    const filteredCities = cities.filter(c => c.includes(filterText));

    filteredCities.forEach(c => {
      const logo = appState.logos.area[c] || '';
      const isSelected = appState.selectedCity === c;
      menuList.innerHTML += `
        <div class="menu-item ${isSelected ? 'selected' : ''}" onclick="selectCity('${c}')">
          ${logo ? `<img src="${logo}">` : ''}
          <span>${c}</span>
          ${isSelected ? '<span class="material-symbols-rounded check">check</span>' : ''}
        </div>
      `;
    });
  };
  renderItems('');
  searchInput.oninput = (e) => renderItems(e.target.value.trim());
}

function selectCity(city) {
  appState.selectedCity = city;
  localStorage.setItem('bus_selected_city', city);
  document.getElementById('area-menu').classList.remove('open');
  document.getElementById('area-menu-backdrop').classList.remove('open');
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
      <div class="line-icon-badge large" style="background:${badgeColor}">
         <span class="material-symbols-rounded sub-icon">${line.iconType}</span>
      </div>
      <div style="flex:1">
        <div class="dh-title-row">
          <div class="dh-name">${line.name}</div>
          <div class="company-row">
             ${compLogo ? `<img src="${compLogo}" class="company-logo-detail">` : ''}
             <span>${line.company}</span>
          </div>
        </div>
        <div class="dh-sub" style="margin-top:4px">${line.city}</div>
      </div>
    </div>
    <div class="dh-info-grid">
       ${line.fare ? `<div class="info-item"><span class="material-symbols-rounded">payments</span>${line.fare}</div>` : ''}
       <div class="info-item"><span class="material-symbols-rounded">schedule</span>${line.startTime} - ${line.endTime}</div>
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

  stations.forEach((s, idx) => {
    const div = document.createElement('div');
    div.className = 'station-item';
    div.innerHTML = `
      <div class="station-name">${s}</div>
      ${idx === 0 ? '<div class="station-badge start">起</div>' : ''}
      ${idx === stations.length - 1 ? '<div class="station-badge end">终</div>' : ''}
    `;
    div.onclick = () => {
       const startIn = document.getElementById('plan-start');
       const endIn = document.getElementById('plan-end');
       if(!startIn.value) {
         startIn.value = s;
         showToast(`已设为起点: ${s}`);
         switchView('planner');
       } else {
         endIn.value = s;
         showToast(`已设为终点: ${s}`);
         switchView('planner');
       }
    };
    list.appendChild(div);
  });
}

/* --- Planner Results --- */
function renderPlannerResults(segmentsList) {
  const container = document.getElementById('planner-results');
  container.innerHTML = '';
  
  if (segmentsList.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <span class="material-symbols-rounded" style="font-size:48px; opacity:0.3">alt_route</span>
      <p>未找到合适方案，请尝试更换条件</p>
    </div>`;
    return;
  }

  segmentsList.forEach((segments, index) => {
    const card = document.createElement('div');
    card.className = 'plan-result-card';
    
    const totalStops = segments.reduce((sum, seg) => sum + seg.stopCount, 0);
    const transfers = segments.length - 1;
    let totalTime = 0;
    
    let isServiceActive = true;

    segments.forEach((seg, i) => {
      const perStop = seg.type === 'metro' ? 2.5 : (seg.type === 'rail' ? 5 : 3.5);
      totalTime += Math.ceil(seg.stopCount * perStop);
      if (i > 0) {
         // Cost estimation for display
         if (seg.transferType === 'out_station') totalTime += 15;
         else if (seg.transferType === 'direct_connect') totalTime += 0;
         else totalTime += 5;
      }
      
      const inService = checkOperatingTime(seg.meta.startTime, seg.meta.endTime);
      if (!inService) isServiceActive = false;
    });

    const routeSummary = segments.map((seg, i) => `
      <div class="route-step-pill">
        <span class="step-icon material-symbols-rounded">${seg.iconType}</span>
        <span class="step-name">${seg.lineName}</span>
      </div>
      ${i < segments.length - 1 ? '<span class="material-symbols-rounded step-arrow">arrow_forward</span>' : ''}
    `).join('');
    
    // 2. Logic: If not active, hide time and show warning IN META string
    let timeHtml = `<div class="plan-time-big">${totalTime} <span style="font-size:14px; font-weight:normal">分钟</span></div>`;
    let metaHtml = `${totalStops}站 · 换乘 ${transfers} 次`;

    if (!isServiceActive) {
      timeHtml = `<div class="plan-time-big" style="color:var(--md-sys-color-on-surface-variant); opacity:0.5">--</div>`;
      metaHtml = `<span class="out-of-service">${totalStops}站 · 换乘 ${transfers} 次 · 不在运营时段</span>`;
    }

    card.innerHTML = `
      <div class="plan-header">
        ${timeHtml}
        <div class="plan-meta">${metaHtml}</div>
      </div>
      <div class="plan-route-visual">
        ${routeSummary}
      </div>
      <div class="plan-desc">
        从 ${segments[0].startStation} 出发
      </div>
    `;
    card.onclick = () => openRouteModal(segments, totalTime, isServiceActive);
    container.appendChild(card);
  });
}

/* --- Route Detail Modal --- */
let currentSegments = []; 

function openRouteModal(segments, time, isActive) {
  currentSegments = segments;
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('route-modal');
  const content = document.getElementById('modal-content-body');
  const footer = document.getElementById('modal-footer-actions');
  
  let html = `
    <div class="modal-summary">
       ${isActive ? `<div class="ms-time">${time}分钟</div>` : `<div class="out-of-service" style="font-size:20px">不在运营时段</div>`}
       <div class="ms-meta">共 ${segments.reduce((a,b)=>a+b.stopCount,0)} 站</div>
    </div>
  `;
  
  segments.forEach((seg, idx) => {
    const isLast = idx === segments.length - 1;
    const color = seg.meta.color ? `#${seg.meta.color.slice(0,6)}` : '#006495';
    
    // Destination extraction
    const destName = seg.direction==='up' 
        ? seg.meta.stationsUp[seg.meta.stationsUp.length-1] 
        : seg.meta.stationsDown[seg.meta.stationsDown.length-1];

    html += `
      <div class="step-card">
        <div class="step-left-line"></div>
        <div class="step-icon-box" style="background:${color}">
             <span class="material-symbols-rounded" style="color:white; font-size:16px;">${seg.iconType}</span>
        </div>
        
        <div class="step-content">
          <div class="step-title-row">
            <span class="step-line-name" style="color:${color}">${seg.lineName}</span>
            <span class="step-dir">往 ${destName}</span>
          </div>
          
          <div class="step-detail-row">
            <strong>${seg.startStation}</strong>
            <span class="material-symbols-rounded" style="font-size:12px;opacity:0.5">arrow_forward</span>
            <strong>${seg.endStation}</strong>
          </div>
          
          <div class="step-sub-info">
            ${seg.stopCount} 站 · ${seg.meta.fare || '按段收费'}
          </div>
        </div>
      </div>
    `;
    
    if (!isLast) {
      const nextSeg = segments[idx+1];
      const isWalk = nextSeg.transferType === 'out_station';
      const isDirect = nextSeg.transferType === 'direct_connect';
      
      let badgeIcon = 'transfer_within_a_station';
      let badgeText = '站内换乘';

      // 10. Display Logic Update
      if (isDirect) {
        // Direct Line specific text
        // Need to find the direction of the NEXT segment
        const nextDest = nextSeg.direction === 'up' 
             ? nextSeg.meta.stationsUp[nextSeg.meta.stationsUp.length-1] 
             : nextSeg.meta.stationsDown[nextSeg.meta.stationsDown.length-1];

        badgeIcon = 'alt_route';
        badgeText = `乘坐前往 ${nextDest} 方向的列车，需要留意站台来车`;
      } else if (isWalk) {
        badgeIcon = 'directions_walk';
        badgeText = '出站换乘 (需步行)';
      }

      html += `
        <div class="transfer-gap">
           <div class="walk-badge ${isDirect ? 'direct' : ''}">
             <span class="material-symbols-rounded" style="font-size:14px">
               ${badgeIcon}
             </span>
             <span>${badgeText}</span>
           </div>
        </div>
      `;
    }
  });

  content.innerHTML = html;
  
  footer.innerHTML = `
      <button class="action-btn tonal" onclick="shareRouteImageReal()">
        <span class="material-symbols-rounded">share</span> 分享图片
      </button>
      <button class="action-btn primary" onclick="subscribePushReal()">
        <span class="material-symbols-rounded">notifications_active</span> 开启提醒
      </button>
  `;

  backdrop.classList.add('visible');
  modal.classList.add('visible');
}

function closeRouteModal() {
  document.getElementById('modal-backdrop').classList.remove('visible');
  document.getElementById('route-modal').classList.remove('visible');
}

/* --- Real Features (Keep as is) --- */
function shareRouteImageReal() {
  const element = document.getElementById('modal-content-body');
  showToast("正在生成图片，请稍候...");
  html2canvas(element, {
    backgroundColor: getComputedStyle(document.body).getPropertyValue('--md-sys-color-surface'),
    scale: 2
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = `route-plan-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("图片已生成并下载");
  }).catch(err => {
    console.error(err);
    showToast("生成图片失败");
  });
}

function subscribePushReal() {
  if (!('Notification' in window)) {
    showToast("浏览器不支持通知");
    return;
  }
  Notification.requestPermission().then(permission => {
    if (permission === 'granted') {
      let routeStr = `从 ${currentSegments[0].startStation} 出发，`;
      currentSegments.forEach((seg, idx) => {
        routeStr += `乘坐 ${seg.lineName} 到 ${seg.endStation}`;
        if(idx < currentSegments.length - 1) routeStr += "，换乘 ";
      });
      routeStr += "。";
      new Notification('行程规划提醒已开启', {
        body: routeStr,
        requireInteraction: true 
      });
      showToast("提醒已发送至通知栏");
    } else {
      showToast("请在浏览器设置中允许通知权限");
    }
  });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// Start
init();
