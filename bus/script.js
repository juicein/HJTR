/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffixGroups: [] },
  directRules: { manual: [], auto: [] }, // 新增直通规则
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
      fetch('../data/direct_line.json') // 新增
    ]);

    const txt = await txtRes.text();
    appState.logos.area = await areaRes.json();
    appState.logos.company = await compRes.json();
    const aliasData = await aliasRes.json();
    const directData = await directRes.json();
    
    appState.aliases.manual = aliasData.manual_equivalents || [];
    appState.aliases.suffixGroups = aliasData.suffix_groups || [];
    appState.directRules = directData;

    parseLines(txt);
    setupUI();
    populateStationDatalist();
    applyFilters();
    
    // URL Routing Handler
    handleRouting();
    
  } catch (e) {
    console.error("Initialization failed:", e);
    showToast("数据加载失败");
  }
}

// 4. Enhanced URL Routing
function handleRouting() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  
  // 模式 A: /bus/search?q=LineName (兼容 prompt 要求)
  // 模式 B: index.html?view=search&q=LineName
  const searchQuery = params.get('q') || params.get('search');
  
  if (view === 'search' || (searchQuery && !view)) {
    if (searchQuery) {
      document.getElementById('line-search').value = searchQuery;
      // 尝试完全匹配跳转
      const exactMatch = appState.lines.find(l => l.name === searchQuery);
      if (exactMatch) {
        openDetail(exactMatch);
      } else {
        renderHome();
      }
    }
    return;
  }

  // 模式 C: /bus/planning?start=Station (兼容 prompt 要求)
  // 模式 D: index.html?view=planner&start=A&end=B
  const startStation = params.get('start');
  const endStation = params.get('end');
  
  // 简单判断是否意图进入规划页面
  if (view === 'planner' || window.location.href.includes('planning') || startStation) {
    if(startStation) document.getElementById('plan-start').value = startStation;
    if(endStation) document.getElementById('plan-end').value = endStation;
    switchView('planner');
    if(startStation && endStation) {
      // 稍微延迟一下等待数据完全就绪
      setTimeout(findRoute, 200);
    }
  }
}

/* 8. Parsing */
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

// 解决重名问题的核心：DataList 携带 City 信息
function populateStationDatalist() {
  const stationMap = new Map(); // Key: "StationName", Value: Set(Cities)

  appState.lines.forEach(l => {
    [...l.stationsUp, ...l.stationsDown].forEach(s => {
      if(!stationMap.has(s)) stationMap.set(s, new Set());
      stationMap.get(s).add(l.city);
    });
  });
  
  const datalist = document.getElementById('station-datalist');
  datalist.innerHTML = '';
  
  // 排序
  const sortedStations = [...stationMap.keys()].sort();

  sortedStations.forEach(s => {
    const cities = stationMap.get(s);
    // 如果该站点只属于一个城市，直接显示名字
    // 如果属于多个城市，为了区分，虽然 datalist value 只能是文本，
    // 我们这里暂时还是存纯名字，但是在搜索逻辑里通过 "当前选择的城市" 来过滤
    // 或者，更高级的做法是 value="站名 (城市)"，但这需要用户精准输入。
    // *策略*：为了保持用户体验，Datalist 存纯名字。但在搜索时，
    // 如果名字在多个城市存在，优先使用 appState.selectedCity，如果选了 All，则无法区分（Bug源）。
    // *修正策略*：为了满足“自动识别”和“隔离”，Datalist 显示 "站名"，但在计算时，我们会遍历所有城市构建图。
    
    const option = document.createElement('option');
    option.value = s;
    // option.label = [...cities].join(', '); // 辅助显示城市
    datalist.appendChild(option);
  });
}

// 获取带城市命名空间的唯一ID
// 格式: "City::CanonicalStationName"
function getNodeId(city, stationName) {
  let n = stationName.trim();
  // 别名处理 (局部匹配)
  for (const group of appState.aliases.manual) {
    if (group.includes(n)) { n = group[0]; break; }
  }
  if(n === stationName) { // 如果没有手动别名，尝试后缀处理
      for (const group of appState.aliases.suffixGroups) {
        for (const suffix of group) {
          if (n.endsWith(suffix)) {
            const candidate = n.substring(0, n.length - suffix.length);
            if (candidate.length > 0) { n = candidate; break; }
          }
        }
      }
  }
  return `${city}::${n}`;
}

/* --- Logic: Route Finding V2 (Graph Isolation) --- */

// 检查是否为直通线路
function isDirectLine(lineA, lineB) {
  // 1. 手动规则
  for (const group of appState.directRules.manual_equivalents) {
    if (group.includes(lineA.name) && group.includes(lineB.name)) return true;
  }
  // 2. 自动规则 (正则替换后缀后比较)
  const cleanA = removeSuffix(lineA.name);
  const cleanB = removeSuffix(lineB.name);
  if (cleanA && cleanB && cleanA === cleanB) return true;
  
  return false;
}

function removeSuffix(name) {
  for (const group of appState.directRules.auto_equivalents) {
    for (const suffix of group) {
       // 简单匹配，比如 "1号线主线" -> "1号线"
       if (name.includes(suffix)) return name.replace(suffix, "");
    }
  }
  return name;
}

function buildGraph(rule) {
  const graph = {}; 

  appState.lines.forEach(line => {
    // 规则过滤
    if (rule === 'bus_only' && (line.isMetro || line.isRail)) return;
    
    // 关键：图的构建必须限定在 Line 所在的 City
    // 这样不同 City 的同名站点就会生成不同的 Node ID，物理隔离
    addLineEdges(graph, line, line.stationsUp, 'up', rule);
    addLineEdges(graph, line, line.stationsDown, 'down', rule);
  });
  return graph;
}

function addLineEdges(graph, line, stations, dir, rule) {
  for (let i = 0; i < stations.length - 1; i++) {
    const fromRaw = stations[i];
    const toRaw = stations[i+1];
    // 使用带 City 的 ID
    const fromId = getNodeId(line.city, fromRaw);
    const toId = getNodeId(line.city, toRaw);
    
    if (!graph[fromId]) graph[fromId] = [];
    
    // 权重计算
    let weight = 1; 
    if (line.isMetro) weight = 0.6;
    if (line.isRail) weight = 0.4;
    if (line.specialType === 'brt') weight = 0.8;

    if (rule === 'rail_priority') {
      if (line.isMetro || line.isRail) weight = 0.3; 
      else weight = 2.0; 
    } else if (rule === 'fastest') {
        // Fastest 模式下更加重每站的时间成本
        if (line.isMetro) weight = 0.5;
        else weight = 1.5;
    }
    
    graph[fromId].push({
      toNode: toId,
      toRawName: toRaw,
      fromRawName: fromRaw,
      lineName: line.name,
      lineId: line.id,
      city: line.city, // 记录城市
      direction: dir,
      rawWeight: weight,
      type: line.type,
      fullLine: line 
    });
  }
}

// 核心 Dijkstra 算法
function runDijkstra(startId, endId, rule, graph) {
  const queue = [{ node: startId, cost: 0, path: [] }];
  const visited = {}; 
  const results = [];
  // All 模式需要更多结果来聚合
  const limit = 5; 

  let loops = 0;
  while (queue.length > 0 && loops < 5000) {
    loops++;
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    // 稍微宽松的 Visited 检查，允许不同路径
    if (current.cost > (visited[current.node] || Infinity) + 2) continue;
    visited[current.node] = current.cost;

    if (current.node === endId) {
      results.push(current);
      if (results.length >= limit) break; 
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      let stepCost = edge.rawWeight;
      let isTransfer = false;
      let transferType = 'none';
      let transferMsg = '';
      
      const lastStep = current.path[current.path.length - 1];
      
      if (lastStep) {
        if (lastStep.lineId !== edge.lineId) {
          isTransfer = true;
          
          // 1. 直通判断
          if (isDirectLine(lastStep.fullLine, edge.fullLine)) {
            transferType = 'through_service';
            stepCost += 0; // 无惩罚
            // 计算方向：取下一段的终点或线路终点
            const dirName = edge.direction === 'up' 
                ? edge.fullLine.stationsUp[edge.fullLine.stationsUp.length-1]
                : edge.fullLine.stationsDown[edge.fullLine.stationsDown.length-1];
            transferMsg = `乘坐前往${dirName}方向的列车，需要留意站台来车`;
          } 
          // 2. 公交 <-> 地铁 强制出站
          else if ((lastStep.type === 'bus' && edge.type === 'metro') || 
                   (lastStep.type === 'metro' && edge.type === 'bus')) {
            transferType = 'exit_station'; // 出站换乘
            stepCost += 15; // 较大惩罚
          }
          // 3. 普通换乘
          else {
             // 同站名换乘
             if (lastStep.toRawName === edge.fromRawName) {
                 transferType = 'same_station';
                 stepCost += 5;
             } else {
                 transferType = 'walking';
                 stepCost += 20;
             }
          }

          if (rule === 'min_transfer') stepCost += 50; 
        }
      }
      
      const newCost = current.cost + stepCost;
      const newPath = [...current.path, { 
          ...edge, 
          transferType: isTransfer ? transferType : 'none',
          transferMsg: transferMsg
      }];

      if (newCost < (visited[edge.toNode] || Infinity) + 5) {
         queue.push({ node: edge.toNode, cost: newCost, path: newPath });
      }
    });
  }
  return results.map(r => ({ ...r, ruleSource: rule })); // 标记来源
}

function findRoute() {
  const startInput = document.getElementById('plan-start').value.trim();
  const endInput = document.getElementById('plan-end').value.trim();
  
  if (!startInput || !endInput) {
    showToast("请输入起点和终点");
    return;
  }

  // 1. 确定搜索的城市范围
  // 如果用户选择了特定城市，只搜索该城市。
  // 如果是 'all'，我们需要推断。简单起见，我们遍历所有拥有该站点名的城市进行尝试。
  
  let targetCities = [];
  if (appState.selectedCity !== 'all') {
    targetCities = [appState.selectedCity];
  } else {
    // 查找包含起点的所有城市
    const citiesWithStart = new Set();
    appState.lines.forEach(l => {
        if (l.stationsUp.includes(startInput) || l.stationsDown.includes(startInput)) {
            citiesWithStart.add(l.city);
        }
    });
    targetCities = [...citiesWithStart];
  }

  if (targetCities.length === 0) {
    showToast("未找到起点所在的城市数据");
    return;
  }

  const activeChip = document.getElementById('planner-filters').querySelector('.active');
  const userRule = activeChip ? activeChip.dataset.rule : 'all';

  let finalResults = [];

  // 对每个可能的城市进行搜索 (解决同名隔离)
  targetCities.forEach(city => {
     // 构建起点终点 ID
     const startId = getNodeId(city, startInput);
     const endId = getNodeId(city, endInput);

     // 如果该城市没有终点，跳过
     // (简单的预检查，避免构建图)
     const cityHasEnd = appState.lines.some(l => l.city === city && (l.stationsUp.includes(endInput) || l.stationsDown.includes(endInput)));
     if (!cityHasEnd) return;

     if (startId === endId) return;

     // 策略执行
     let strategies = [];
     if (userRule === 'all') {
         // 聚合模式：运行所有策略
         strategies = ['fastest', 'min_transfer', 'rail_priority', 'bus_only'];
     } else {
         strategies = [userRule];
     }

     strategies.forEach(rule => {
        const graph = buildGraph(rule); // 针对该策略构建图
        const res = runDijkstra(startId, endId, rule, graph);
        finalResults.push(...res);
     });
  });

  // 去重 (根据路径 ID 序列)
  const uniqueResults = [];
  const seenPaths = new Set();
  
  // 排序：先按成本(时间)，再按换乘数
  finalResults.sort((a, b) => a.cost - b.cost);

  finalResults.forEach(res => {
     const pathKey = res.path.map(p => `${p.lineId}-${p.direction}`).join('|');
     if (!seenPaths.has(pathKey)) {
         seenPaths.add(pathKey);
         uniqueResults.push(res);
     }
  });

  const formattedResults = uniqueResults.map(res => compressPath(res.path));
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
        transferType: step.transferType,
        transferMsg: step.transferMsg // 传递直通信息
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
        transferType: step.transferType,
        transferMsg: step.transferMsg
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
    // 处理中文冒号等
    const safeT = t.replace('：', ':');
    const [h, m] = safeT.split(':').map(Number);
    return h * 60 + m;
  };

  const start = parseTime(startTime);
  const end = parseTime(endTime);

  if (end < start) { // 跨夜
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

  // Planner Filters
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
         setTimeout(findRoute, 100);
       }
    };
    list.appendChild(div);
  });
}

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
    // 换乘次数计算：不包括 "直通运转" (through_service)
    const transfers = segments.filter(s => s.transferType !== 'none' && s.transferType !== 'through_service').length;
    let totalTime = 0;
    
    // Operating Time Check
    let isServiceActive = true;

    segments.forEach((seg, i) => {
      const perStop = seg.type === 'metro' ? 2.5 : (seg.type === 'rail' ? 5 : 3.5);
      totalTime += Math.ceil(seg.stopCount * perStop);
      if (i > 0) {
         if (seg.transferType === 'walking' || seg.transferType === 'exit_station') totalTime += 10;
         else if (seg.transferType === 'same_station') totalTime += 5;
         // through_service 加 0
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
      metaText += ` · <span style="color:var(--md-sys-color-error)">不在运营时段</span>`;
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
      
      // 4. 换乘文案逻辑
      let transferHtml = '';
      const tType = nextSeg.transferType;

      if (tType === 'through_service') {
        transferHtml = `
           <div class="walk-badge direct">
             <span class="material-symbols-rounded" style="font-size:14px">sync_alt</span>
             <span>${nextSeg.transferMsg}</span>
           </div>
        `;
      } else if (tType === 'exit_station') {
         transferHtml = `
           <div class="walk-badge exit">
             <span class="material-symbols-rounded" style="font-size:14px">directions_walk</span>
             <span>出站换乘 (需重新进站)</span>
           </div>
         `;
      } else if (tType === 'walking') {
         transferHtml = `
           <div class="walk-badge">
             <span class="material-symbols-rounded" style="font-size:14px">directions_walk</span>
             <span>同名/异站换乘 (需步行)</span>
           </div>
         `;
      } else {
         transferHtml = `
           <div class="walk-badge">
             <span class="material-symbols-rounded" style="font-size:14px">transfer_within_a_station</span>
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
