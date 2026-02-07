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
      fetch('../data/direct_line.json') // 加载直通车数据
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
    applyFilters();
    
    // 4. URL Routing Handler
    handleRouting();
    
  } catch (e) {
    console.error("Initialization failed:", e);
    showToast("数据加载失败");
  }
}

// 4. URL Routing Logic (Enhanced)
function handleRouting() {
  const url = window.location.href;
  const params = new URLSearchParams(window.location.search);
  
  // Case 1: Search Detail
  // Compatible with: /bus/search?=LineName OR ?q=LineName
  let searchQuery = params.get('q') || params.get('search');
  
  // Handle custom prompt style: /bus/search?=LineName
  if (!searchQuery && url.includes('search?=')) {
      searchQuery = decodeURIComponent(url.split('search?=')[1]);
  }

  if (searchQuery) {
    document.getElementById('line-search').value = searchQuery;
    const exactMatch = appState.lines.find(l => l.name === searchQuery);
    if (exactMatch) {
      openDetail(exactMatch);
    } else {
      renderHome();
    }
    return;
  }

  // Case 2: Planner
  // Compatible with: /bus/planning?=StartStation OR ?start=StartStation
  let startStation = params.get('start');
  const endStation = params.get('end');

  // Handle custom prompt style: /bus/planning?=StartStation
  if (!startStation && url.includes('planning?=')) {
      startStation = decodeURIComponent(url.split('planning?=')[1]);
  }
  
  if (startStation || url.includes('planning')) {
    if(startStation) document.getElementById('plan-start').value = startStation;
    if(endStation) document.getElementById('plan-end').value = endStation;
    switchView('planner');
    if(startStation && endStation) findRoute();
  }
}

/* 8. Enhanced Parsing */
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

// 核心换乘逻辑判断
function checkTransferType(prevLine, nextLine, prevRaw, nextRaw) {
  if (prevRaw === nextRaw) {
    // 10. 规则：公交与地铁之间必须是出站换乘
    const isPrevBus = !prevLine.isMetro && !prevLine.isRail;
    const isNextBus = !nextLine.isMetro && !nextLine.isRail;
    
    // 如果一个是公交，一个是轨道（地铁/铁路），强制 Walking
    if (isPrevBus !== isNextBus) return 'walking';
    
    // 如果都是地铁或都是公交，视为站内/同站
    return 'same_station';
  }
  
  // 10. 规则：直通线路检测
  if (isDirectLine(prevLine.name, nextLine.name)) {
      return 'direct_connect';
  }

  return 'walking';
}

function isDirectLine(nameA, nameB) {
    // 检查手动库
    for (const group of appState.directLines.manual) {
        if (group.includes(nameA) && group.includes(nameB)) return true;
    }
    // 检查自动后缀库 (e.g. 1号线主线 vs 1号线支线)
    for (const suffixes of appState.directLines.auto) {
        let baseA = nameA;
        let baseB = nameB;
        let foundA = false, foundB = false;

        // 尝试剥离后缀
        for (const s of suffixes) {
            if (nameA.endsWith(s)) { baseA = nameA.replace(s, ''); foundA = true; }
            if (nameB.endsWith(s)) { baseB = nameB.replace(s, ''); foundB = true; }
        }
        
        // 如果两个名字剥离后缀后相同，且确实都含有定义的后缀（或者是纯基础名）
        // 这里简化逻辑：只要剥离后缀后Base相同，且原名不同
        if (baseA === baseB && nameA !== nameB) return true;
    }
    return false;
}

/* --- Logic: Route Finding (Refactored for "All Plans") --- */

// 核心计算函数：根据特定规则跑一次 Dijkstra
function runDijkstraSearch(startId, endId, rule, regionLock) {
  const graph = {}; 

  appState.lines.forEach(line => {
    if (regionLock && line.city !== regionLock) return;
    if (rule === 'bus_only' && (line.isMetro || line.isRail)) return;
    
    // 动态权重分配
    let baseWeight = 1; // 默认

    if (rule === 'fastest') {
        // 时间优先：轨道极快，公交慢
        if (line.isRail) baseWeight = 0.4;
        else if (line.isMetro) baseWeight = 0.6;
        else if (line.specialType === 'brt') baseWeight = 0.8;
        else baseWeight = 1.2;
    } else if (rule === 'min_transfer') {
        // 少换乘：所有线路权重差不多，但在换乘时加巨大惩罚
        baseWeight = 1; 
    } else if (rule === 'rail_priority') {
        // 轨道优先
        if (line.isMetro || line.isRail) baseWeight = 0.3;
        else baseWeight = 5.0; // 极度惩罚公交
    } else if (rule === 'bus_only') {
        baseWeight = 1;
    }

    addLineEdges(graph, line, line.stationsUp, 'up', baseWeight);
    addLineEdges(graph, line, line.stationsDown, 'down', baseWeight);
  });

  // Dijkstra
  const queue = [{ node: startId, cost: 0, path: [] }];
  const visited = {}; 
  const foundPaths = [];
  const maxLoops = 5000;
  let loops = 0;

  while (queue.length > 0 && loops < maxLoops) {
    loops++;
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    // 允许轻微的重复访问以找到不同路径，但需防止死循环
    if (current.cost > (visited[current.node] || Infinity) + 5) continue;
    visited[current.node] = current.cost;

    if (current.node === endId) {
      foundPaths.push(current);
      if (foundPaths.length >= 3) break; // 每个策略只取前3
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      let stepCost = edge.weight;
      let isTransfer = false;
      let transferType = 'none';
      
      const lastStep = current.path[current.path.length - 1];
      
      if (lastStep) {
        if (lastStep.lineId !== edge.lineId) {
          isTransfer = true;
          transferType = checkTransferType(lastStep.fullLine, edge.fullLine, lastStep.toRawName, edge.fromRawName);
          
          // 换乘惩罚逻辑
          let transferPenalty = 10;
          if (transferType === 'walking') transferPenalty = 25; // 步行换乘成本高
          if (transferType === 'direct_connect') transferPenalty = 2; // 直通车换乘成本极低

          if (rule === 'min_transfer') transferPenalty = 500; // 极度厌恶换乘

          stepCost += transferPenalty;
        }
      }
      
      const newCost = current.cost + stepCost;
      const newPath = [...current.path, { ...edge, transferType: isTransfer ? transferType : 'none' }];

      if (newCost < (visited[edge.toNode] || Infinity) + 5) {
         queue.push({ node: edge.toNode, cost: newCost, path: newPath });
      }
    });
  }
  return foundPaths;
}

function addLineEdges(graph, line, stations, dir, weight) {
  for (let i = 0; i < stations.length - 1; i++) {
    const fromRaw = stations[i];
    const toRaw = stations[i+1];
    const fromId = getCanonicalStationId(fromRaw);
    const toId = getCanonicalStationId(toRaw);
    
    if (!graph[fromId]) graph[fromId] = [];
    
    graph[fromId].push({
      toNode: toId,
      toRawName: toRaw,
      fromRawName: fromRaw,
      lineName: line.name,
      lineId: line.id,
      direction: dir,
      weight: weight, // Calculated Weight
      type: line.type,
      fullLine: line 
    });
  }
}

// 主入口
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

  // 锁定起点城市
  const startLine = appState.lines.find(l => 
    l.stationsUp.some(s => getCanonicalStationId(s) === startId) || 
    l.stationsDown.some(s => getCanonicalStationId(s) === startId)
  );
  const regionLock = startLine ? startLine.city : null; 
  
  const activeChip = document.getElementById('planner-filters').querySelector('.active');
  const uiRule = activeChip ? activeChip.dataset.rule : 'all';
  
  let rawResults = [];

  // 1. "所有方案" 逻辑：运行所有策略并合并
  if (uiRule === 'all') {
      const strategies = ['fastest', 'min_transfer', 'rail_priority', 'bus_only'];
      strategies.forEach(strat => {
          const res = runDijkstraSearch(startId, endId, strat, regionLock);
          rawResults.push(...res);
      });
  } else {
      // 运行特定策略
      rawResults = runDijkstraSearch(startId, endId, uiRule, regionLock);
  }

  // 结果去重 (基于线路序列)
  const uniqueResults = [];
  const seenSignatures = new Set();

  rawResults.sort((a,b) => a.cost - b.cost); // 先按成本排序

  rawResults.forEach(res => {
      const signature = res.path.map(p => p.lineName + '-' + p.direction).join('|');
      if (!seenSignatures.has(signature)) {
          seenSignatures.add(signature);
          uniqueResults.push(res);
      }
  });

  const formattedResults = uniqueResults.map(res => compressPath(res.path)).slice(0, 10);
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
        transferType: step.transferType // 这是上一段到这一段的换乘方式
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

  if (end < start) {
    return currentMinutes >= start || currentMinutes <= end;
  }
  return currentMinutes >= start && currentMinutes <= end;
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

/* --- Planner Results (Updated for 2. UI requirement) --- */
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
         if (seg.transferType === 'walking') totalTime += 10;
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
    
    // 2. 运营时间显示逻辑
    let metaText = `${totalStops}站 · 换乘 ${transfers} 次`;
    if (!isServiceActive) {
        metaText += ' · <span class="out-of-service">不在运营时段</span>';
    }

    card.innerHTML = `
      <div class="plan-header">
        <div class="plan-time-big">${totalTime} <span style="font-size:14px; font-weight:normal">分钟</span></div>
        <div class="plan-meta">${metaText}</div>
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

/* --- Route Detail Modal (Updated for 10. Transfer logic) --- */
let currentSegments = [];

function openRouteModal(segments, time, isActive) {
  currentSegments = segments;
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('route-modal');
  const content = document.getElementById('modal-content-body');
  const footer = document.getElementById('modal-footer-actions');
  
  let html = `
    <div class="modal-summary">
       ${isActive ? `<div class="ms-time">${time}分钟</div>` : `<div class="out-of-service" style="font-size:24px">不在运营时段</div>`}
       <div class="ms-meta">共 ${segments.reduce((a,b)=>a+b.stopCount,0)} 站</div>
    </div>
  `;
  
  segments.forEach((seg, idx) => {
    const isLast = idx === segments.length - 1;
    const color = seg.meta.color ? `#${seg.meta.color.slice(0,6)}` : '#006495';
    
    html += `
      <div class="step-card">
        <div class="step-left-line"></div>
        <div class="step-icon-box" style="background:${color}">
             <span class="material-symbols-rounded" style="color:white; font-size:16px;">${seg.iconType}</span>
        </div>
        
        <div class="step-content">
          <div class="step-title-row">
            <span class="step-line-name" style="color:${color}">${seg.lineName}</span>
            <span class="step-dir">往 ${seg.direction==='up'?seg.meta.stationsUp[seg.meta.stationsUp.length-1]:seg.meta.stationsDown[seg.meta.stationsDown.length-1]}</span>
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
      const transferType = nextSeg.transferType; // 获取存入的换乘类型
      
      let transferHtml = '';
      
      // 10. 换乘逻辑显示
      if (transferType === 'direct_connect') {
          // 直通列车特殊显示
          const nextDest = nextSeg.direction==='up'?nextSeg.meta.stationsUp[nextSeg.meta.stationsUp.length-1]:nextSeg.meta.stationsDown[nextSeg.meta.stationsDown.length-1];
          transferHtml = `
            <div class="walk-badge special">
               <span class="material-symbols-rounded">train</span>
               <span>乘坐前往 ${nextDest} 方向的列车，需要留意站台来车</span>
            </div>
          `;
      } else if (transferType === 'walking') {
          // 强制出站/公交地铁换乘
          transferHtml = `
            <div class="walk-badge">
             <span class="material-symbols-rounded">directions_walk</span>
             <span>出站换乘 (需步行)</span>
           </div>
          `;
      } else {
          // 站内换乘
          transferHtml = `
            <div class="walk-badge">
             <span class="material-symbols-rounded">transfer_within_a_station</span>
             <span>站内换乘</span>
           </div>
          `;
      }

      html += `
        <div class="transfer-gap">
           ${transferHtml}
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

/* --- Real Features --- */
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
        icon: '../data/logos_company.json', 
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
