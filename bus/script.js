/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffixGroups: [] },
  directLines: { manual: [], auto: [] }, // 10. 直通线路数据
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
      fetch('../data/direct_line.json') // 10. 加载直通数据
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
    
    // 3. URL Routing Logic
    handleUrlParams();
    
    // 如果没有跳转到 Planner，则加载 Home
    if (appState.currentView === 'home') {
      applyFilters();
    }

  } catch (e) {
    console.error("Initialization failed:", e);
    showToast("数据加载失败");
  }
}

// 3. URL Processing
function handleUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const rawQuery = window.location.search;

  // Case 1: /bus/planning?=站点 (Old/Specific style from prompt)
  // or ?planning=站点 or ?start=站点&end=站点
  if (rawQuery.includes('planning') || urlParams.has('planning') || urlParams.has('start')) {
    let startStation = urlParams.get('start') || urlParams.get('planning');
    // Handle "?=站点" oddity if specifically needed, usually browser parses key="" value="站点"
    if (!startStation && rawQuery.includes('?=')) {
        startStation = decodeURIComponent(rawQuery.split('=')[1]);
    }
    
    if (startStation) {
      document.getElementById('plan-start').value = startStation;
      const endStation = urlParams.get('end');
      if (endStation) document.getElementById('plan-end').value = endStation;
      switchView('planner');
      if (startStation && endStation) findRoute();
    }
  } 
  // Case 2: /bus/search?=线路
  else if (rawQuery.includes('search') || urlParams.has('q')) {
    let query = urlParams.get('q') || urlParams.get('search');
    if (!query && rawQuery.includes('?=')) {
       query = decodeURIComponent(rawQuery.split('=')[1]);
    }
    if (query) {
      document.getElementById('line-search').value = query;
      switchView('home');
      renderHome();
    }
  }
}

function parseLines(rawText) {
  const lines = rawText.trim().split(/\n+/);
  appState.lines = lines.map((line, index) => {
    const name = line.match(/【(.*?)】/)?.[1] || "未命名";
    const company = line.match(/\{(.*?)\}/)?.[1] || "";
    const fare = line.match(/《(.*?)》/)?.[1] || "";
    const city = line.match(/『(.*?)』/)?.[1] || "其他";
    const startTimeStr = line.match(/§(.*?)§/)?.[1] || "";
    const endTimeStr = line.match(/@(.*?)@/)?.[1] || "";
    const color = line.match(/∮([0-9A-Fa-f]{6,8})∮/)?.[1];

    // 8. Type Classification
    let type = 'bus';
    let subType = 'regular_bus'; // For icons

    if (line.includes("θ地铁θ")) { type = 'metro'; subType = 'metro'; }
    else if (line.includes("θ单轨θ")) { type = 'metro'; subType = 'monorail'; }
    else if (line.includes("θ胶轮θ")) { type = 'metro'; subType = 'rubber'; } // 胶轮系统归类为 Metro 逻辑，但显示不同
    else if (line.includes("θ铁路θ") || name.includes("城际") || name.includes("高铁")) { type = 'rail'; subType = 'rail'; }
    else if (line.includes("θBRTθ")) { type = 'bus'; subType = 'brt'; }

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
      name, company, fare, city, 
      startTimeStr, endTimeStr,
      isMetro: type === 'metro',
      isRail: type === 'rail',
      color,
      stationsUp, stationsDown,
      type, subType
    };
  });
}

// 2. 运营时间判断
function checkIsOperating(line) {
    if (!line.startTimeStr || !line.endTimeStr) return true; // 无数据默认运营
    
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    
    const parseTime = (tStr) => {
        const [h, m] = tStr.split(/[:：]/).map(Number);
        return h * 60 + (m || 0);
    };

    const startMins = parseTime(line.startTimeStr);
    let endMins = parseTime(line.endTimeStr);
    if (endMins < startMins) endMins += 24 * 60; // 跨天

    // 简单判断：如果当前时间在区间内，或者当前时间+24小时在区间内（针对凌晨查看）
    return (currentMins >= startMins && currentMins <= endMins) || 
           ((currentMins + 1440) >= startMins && (currentMins + 1440) <= endMins);
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

// Aliasing Logic (Same as before)
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

// 10. 判断是否直通线路
function isDirectConnected(lineA, lineB) {
  const checkGroups = (groups) => {
    return groups.some(group => {
      // 简单模糊匹配：如果 lineA 包含 group[0] 且 lineB 包含 group[1] (或反之)
      // 对于 manual，需要精确匹配 Line Name
      const aName = lineA.name;
      const bName = lineB.name;
      return (group.includes(aName) && group.includes(bName));
    });
  };
  
  // Check Manual
  if (checkGroups(appState.directLines.manual)) return true;
  
  // Check Auto (e.g. 1号线主线 vs 1号线支线)
  // 这里的逻辑稍微复杂，简化为：如果前缀相同，且后缀在 auto 组里
  // 暂且简化处理：如果名字高度相似
  return false; 
}

function getTransferType(prevEdge, currEdge) {
  // 10. 优先检查直通
  if (prevEdge.fullLine && currEdge.fullLine) {
     if (isDirectConnected(prevEdge.fullLine, currEdge.fullLine)) {
         return 'direct';
     }
  }
  
  if (prevEdge.toRawName === currEdge.fromRawName) return 'same_station'; 
  return 'walking';
}

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
    
    // Base Weights (Time in minutes approx)
    let weight = 3.5; // Bus default
    if (line.type === 'metro') weight = 2.5;
    if (line.type === 'rail') weight = 5; // Rail longer distance per stop but faster, avg 5
    if (line.subType === 'brt') weight = 3.0;

    // Adjust by Rule
    if (rule === 'rail_priority') {
      if (line.isMetro || line.isRail) weight = weight * 0.5; // Favor Rail
      else weight = weight * 2.0; // Penalize Bus
    }
    // Fastest rule relies on accurate base weights (already set)

    graph[fromId].push({
      toNode: toId,
      toRawName: toRaw, 
      fromRawName: fromRaw,
      lineName: line.name,
      lineId: line.id,
      direction: dir,
      rawWeight: weight,
      type: line.type,
      subType: line.subType, // 8. Pass subtype
      fullLine: line 
    });
  }
}

async function findRoute() {
  const startInput = document.getElementById('plan-start').value;
  const endInput = document.getElementById('plan-end').value;
  if (!startInput || !endInput) { showToast("请输入起点和终点"); return; }

  const startId = getCanonicalStationId(startInput);
  const endId = getCanonicalStationId(endInput);
  if (startId === endId) { showToast("起点终点相同"); return; }

  const activeChip = document.getElementById('planner-filters').querySelector('.active');
  let selectedRule = activeChip ? activeChip.dataset.rule : 'all';

  document.getElementById('planner-results').innerHTML = '<div class="empty-state"><p>正在规划...</p></div>';

  // 1. "All Plans" Logic: Run multiple strategies and merge
  let strategies = [];
  if (selectedRule === 'all') {
      strategies = ['fastest', 'min_transfer', 'rail_priority', 'bus_only'];
  } else {
      strategies = [selectedRule];
  }

  // City lock check
  const startLine = appState.lines.find(l => 
    l.stationsUp.some(s => getCanonicalStationId(s) === startId) || 
    l.stationsDown.some(s => getCanonicalStationId(s) === startId)
  );
  const regionLock = startLine ? startLine.city : null;

  let allResults = [];

  // Run Dijkstra for each strategy
  for (const rule of strategies) {
      const graph = buildGraph(rule, regionLock);
      const results = runDijkstra(graph, startId, endId, rule);
      allResults = [...allResults, ...results];
  }

  // Deduplicate results based on Line Sequence
  const uniqueResults = [];
  const signatures = new Set();
  
  allResults.sort((a,b) => a.cost - b.cost); // Sort by cost (time) initially

  allResults.forEach(res => {
      const sig = res.path.map(p => p.lineId).join('-');
      if (!signatures.has(sig)) {
          signatures.add(sig);
          uniqueResults.push(res);
      }
  });

  // Limit to top 5
  const formattedResults = uniqueResults.slice(0, 8).map(res => compressPath(res.path));
  renderPlannerResults(formattedResults);
}

function runDijkstra(graph, startId, endId, rule) {
  const queue = [{ node: startId, cost: 0, path: [], transfers: 0 }];
  const visited = {}; 
  const foundPaths = [];

  let loops = 0;
  while (queue.length > 0 && loops < 4000) {
    loops++;
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    // Relaxed visited check to allow different paths arriving at same node
    if (visited[current.node] && visited[current.node] < current.cost - 15) continue; 
    visited[current.node] = current.cost;

    if (current.node === endId) {
      foundPaths.push(current);
      if (foundPaths.length >= 3) break; // Get top 3 per rule
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      let stepCost = edge.rawWeight;
      let isTransfer = false;
      let transferType = 'none';
      
      const lastStep = current.path[current.path.length - 1];
      
      if (lastStep) {
        if (lastStep.lineId !== edge.lineId) {
          isTransfer = true;
          // Calculate Transfer Logic
          transferType = getTransferType(lastStep, edge);
          
          // 10. Bus <-> Metro 强制出站 (Walking)
          const isBusA = lastStep.type === 'bus';
          const isMetroA = lastStep.type === 'metro' || lastStep.type === 'rail';
          const isBusB = edge.type === 'bus';
          const isMetroB = edge.type === 'metro' || edge.type === 'rail';

          if ((isBusA && isMetroB) || (isMetroA && isBusB)) {
              transferType = 'walking';
          }
          
          // Cost Penalties
          if (transferType === 'direct') {
              stepCost += 1; // Very low penalty
          } else if (transferType === 'walking') {
              stepCost += 20; // High penalty
          } else {
              stepCost += 10; // Same station transfer
          }
          
          if (rule === 'min_transfer') stepCost += 1000; // Huge penalty for transfer
        }
      }
      
      const newCost = current.cost + stepCost;
      const newPath = [...current.path, { 
        ...edge, 
        transferType: isTransfer ? transferType : 'none'
      }];

      queue.push({ 
          node: edge.toNode, 
          cost: newCost, 
          path: newPath,
          transfers: isTransfer ? current.transfers + 1 : current.transfers
      });
    });
  }
  return foundPaths;
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
        subType: step.subType,
        startStation: step.fromRawName,
        endStation: step.toRawName,
        stopCount: 1,
        direction: step.direction,
        meta: step.fullLine,
        transferType: 'none'
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
        subType: step.subType,
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
  
  // Transport Type Filters (Home)
  document.querySelectorAll('#transport-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#transport-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      appState.selectedType = e.currentTarget.dataset.type;
      localStorage.setItem('bus_selected_type', appState.selectedType);
      renderHome();
    };
  });

  // Planner Rules Filters (New)
  document.querySelectorAll('#planner-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#planner-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      if(document.getElementById('plan-start').value && document.getElementById('plan-end').value) {
          findRoute();
      }
    };
  });
  
  // Area Menu
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

function getIconForSubType(subType) {
    if (subType === 'metro') return 'subway';
    if (subType === 'monorail') return 'tram'; // Monorail icon
    if (subType === 'rubber') return 'tram'; 
    if (subType === 'rail') return 'train';
    if (subType === 'brt') return 'directions_bus'; // Use bus but will style differently
    return 'directions_bus';
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
    const icon = getIconForSubType(line.subType);
    
    // 8. BRT Badge Style
    const badgeStyle = line.subType === 'brt' ? 
        `background:${color}; border: 2px solid #FFC107;` : 
        `background:${color}`;

    card.innerHTML = `
      <div class="line-row-main">
        <div class="line-icon-badge" style="${badgeStyle}">
          <span class="material-symbols-rounded">${icon}</span>
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

// ... renderAreaMenu, selectCity ... (No logic changes)
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

function openDetail(line) {
  currentLine = line;
  switchView('detail');
  
  const header = document.getElementById('detail-header');
  const compLogo = appState.logos.company[line.company] || '';
  const badgeColor = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';
  
  // 9. 公司名称和Logo同时显示
  header.innerHTML = `
    <div class="dh-top">
      <div class="line-icon-badge large" style="background:${badgeColor}">
        ${line.name}
      </div>
      <div style="flex:1">
        <div class="dh-title-row">
          <div class="dh-name">${line.name}</div>
          ${compLogo ? `<img src="${compLogo}" class="company-logo-detail" alt="${line.company}">` : ''}
        </div>
        <div class="dh-sub" style="margin-top:4px; display:flex; align-items:center; gap:6px;">
             <span class="company-text" style="font-size:12px; border:1px solid currentColor; padding:1px 4px; border-radius:4px;">${line.company}</span>
             <span>${line.city}</span>
        </div>
      </div>
    </div>
    <div class="dh-info-grid">
       ${line.fare ? `<div class="info-item"><span class="material-symbols-rounded">payments</span>${line.fare}</div>` : ''}
       <div class="info-item"><span class="material-symbols-rounded">schedule</span>${line.startTimeStr} - ${line.endTimeStr}</div>
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
           findRoute(); // Auto start
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
    // 直通不算换乘
    const transfers = segments.filter((s, i) => i > 0 && s.transferType !== 'direct').length;
    let totalTime = 0;
    
    // 2. 运营时间检查
    let allOperating = true;

    segments.forEach((seg, i) => {
      // 检查每段是否在运营
      if (!checkIsOperating(seg.meta)) allOperating = false;

      const perStop = seg.type === 'metro' ? 2.5 : (seg.type === 'rail' ? 5 : 3.5);
      totalTime += Math.ceil(seg.stopCount * perStop);
      
      // Transfer time
      if (i > 0) {
         if (seg.transferType === 'walking') totalTime += 10; 
         else if (seg.transferType === 'direct') totalTime += 1;
         else totalTime += 5; 
      }
    });

    const routeSummary = segments.map((seg, i) => `
      <div class="route-step-pill">
        <span class="step-icon material-symbols-rounded">
          ${getIconForSubType(seg.subType)}
        </span>
        <span class="step-name">${seg.lineName}</span>
      </div>
      ${i < segments.length - 1 ? '<span class="material-symbols-rounded step-arrow">arrow_forward</span>' : ''}
    `).join('');

    // 2. 运营时间提示状态
    const statusHtml = !allOperating 
        ? `<span style="color:#B3261E; font-weight:bold; margin-left:8px;">· 不在运营时段</span>` 
        : ``;

    card.innerHTML = `
      <div class="plan-header">
        <div class="plan-time-big">${totalTime} <span style="font-size:14px; font-weight:normal">分钟</span></div>
        <div class="plan-meta">${totalStops}站 · 换乘 ${transfers} 次 ${statusHtml}</div>
      </div>
      <div class="plan-route-visual">
        ${routeSummary}
      </div>
      <div class="plan-desc">
        从 ${segments[0].startStation} 出发
      </div>
    `;
    card.onclick = () => openRouteModal(segments, totalTime);
    container.appendChild(card);
  });
}

/* --- 7. Route Detail Modal --- */
function openRouteModal(segments, time) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('route-modal');
  const content = document.getElementById('modal-content-body');
  
  let html = `
    <div class="modal-summary">
       <div class="ms-time">${time}分钟</div>
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
             <span class="material-symbols-rounded" style="color:white; font-size:16px;">
               ${getIconForSubType(seg.subType)}
             </span>
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
            ${!checkIsOperating(seg.meta) ? '<span style="color:#B3261E; margin-left:6px;">(不在运营时段)</span>' : ''}
          </div>
        </div>
      </div>
    `;
    
    if (!isLast) {
      const nextSeg = segments[idx+1];
      const isWalk = nextSeg.transferType === 'walking';
      const isDirect = nextSeg.transferType === 'direct';
      
      // 10. 直通运行特别提示
      let transferMsg = '站内换乘';
      let transferIcon = 'transfer_within_a_station';
      
      if (isDirect) {
          transferMsg = `乘坐前往 ${nextSeg.meta.stationsUp[nextSeg.meta.stationsUp.length-1]} 方向的列车，需要留意站台来车`;
          transferIcon = 'alt_route';
      } else if (isWalk) {
          transferMsg = '同名/出站换乘 (需步行)';
          transferIcon = 'directions_walk';
      }

      html += `
        <div class="transfer-gap">
           <div class="walk-badge" style="${isDirect ? 'background:#E8DEF8; color:#1D192B;' : ''}">
             <span class="material-symbols-rounded" style="font-size:14px">
               ${transferIcon}
             </span>
             <span>${transferMsg}</span>
           </div>
        </div>
      `;
    }
  });

  // Action Buttons (Not part of screenshot usually, but here handled by selector)
  html += `
    <div class="modal-actions" data-html2canvas-ignore>
      <button class="action-btn tonal" onclick="shareRouteImage()">
        <span class="material-symbols-rounded">share</span> 分享图片
      </button>
      <button class="action-btn primary" onclick='subscribePush(${JSON.stringify(segments).replace(/'/g, "&apos;")})'>
        <span class="material-symbols-rounded">notifications_active</span> 开启提醒
      </button>
    </div>
  `;

  content.innerHTML = html;
  backdrop.classList.add('visible');
  modal.classList.add('visible');
}

function closeRouteModal() {
  document.getElementById('modal-backdrop').classList.remove('visible');
  document.getElementById('route-modal').classList.remove('visible');
}

// 4. Real Image Share
function shareRouteImage() {
  const content = document.getElementById('modal-content-body');
  showToast("正在生成图片...");
  
  html2canvas(content, {
      scale: 2, // High resolution
      backgroundColor: getComputedStyle(document.body).getPropertyValue('--md-sys-color-surface'),
      ignoreElements: (element) => element.hasAttribute('data-html2canvas-ignore')
  }).then(canvas => {
      // Create a fake link to download
      const link = document.createElement('a');
      link.download = '出行方案.png';
      link.href = canvas.toDataURL("image/png");
      link.click();
      showToast("图片已生成并开始下载");
  }).catch(err => {
      console.error(err);
      showToast("图片生成失败");
  });
}

// 7. Notification Logic
function subscribePush(segments) {
  if (!('Notification' in window)) {
    showToast("浏览器不支持通知");
    return;
  }
  
  // Construct detailed body
  let bodyText = `从 ${segments[0].startStation} 出发`;
  segments.forEach((seg, i) => {
      if (i > 0) bodyText += ` -> ${seg.lineName}`;
      else bodyText += ` -> 乘坐 ${seg.lineName}`;
  });
  bodyText += ` -> 抵达 ${segments[segments.length-1].endStation}`;

  Notification.requestPermission().then(permission => {
    if (permission === 'granted') {
      new Notification('行程提醒已开启', {
        body: bodyText,
        icon: '../data/logos_company.json' // Ideally use a real path
      });
      showToast("提醒设置成功，请查看通知栏");
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
