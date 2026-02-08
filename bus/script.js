/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffixGroups: [] },
  directLines: { manual: [], auto: [] }, // 新增：直通线路数据
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
      fetch('../data/direct_lines.json') // 加载直通配置
    ]);

    const txt = await txtRes.text();
    appState.logos.area = await areaRes.json();
    appState.logos.company = await compRes.json();
    
    const aliasData = await aliasRes.json();
    appState.aliases.manual = aliasData.manual_equivalents || [];
    appState.aliases.suffixGroups = aliasData.suffix_groups || [];

    const directData = await directRes.json();
    appState.directLines.manual = directData.manual_equivalents || [];
    appState.directLines.auto = directData.auto_equivalents || [];

    parseLines(txt);
    setupUI();
    populateStationDatalist();
    applyFilters();
    
    // URL Routing Handler (Must be last)
    handleRouting();
    
  } catch (e) {
    console.error("Initialization failed:", e);
    showToast("数据加载失败");
  }
}

// 4. Enhanced URL Routing Logic
function handleRouting() {
  const url = window.location.href;
  const params = new URLSearchParams(window.location.search);
  
  // 1. 获取纯参数 (兼容 ?=Value 这种空Key写法)
  // 获取 search 之后第一个等号后面的内容
  let rawQuery = "";
  if (window.location.search.startsWith("?=")) {
    rawQuery = decodeURIComponent(window.location.search.substring(2));
  }
  
  // 2. 判定模式
  const isPlanning = url.includes("/planning");
  const isSearch = url.includes("/search");
  
  // 优先处理标准参数 ?start=... ?q=...
  const paramStart = params.get('start');
  const paramQ = params.get('q') || params.get('search');

  if (isPlanning) {
    // 模式: /bus/planning?=站点名 OR /bus/planning?start=站点名
    const startStation = paramStart || rawQuery;
    if (startStation) {
      document.getElementById('plan-start').value = startStation;
      switchView('planner');
    }
  } else if (isSearch || rawQuery) {
    // 模式: /bus/search?=线路名 OR /bus/?q=线路名
    const query = paramQ || rawQuery;
    if (query) {
      document.getElementById('line-search').value = query;
      // 尝试精确匹配跳转
      const exactMatch = appState.lines.find(l => l.name === query);
      if (exactMatch) {
        openDetail(exactMatch);
      } else {
        renderHome();
      }
    }
  }
}

/* 8. Data Parsing */
function parseLines(rawText) {
  const lines = rawText.trim().split(/\n+/);
  appState.lines = lines.map((line, index) => {
    const name = line.match(/【(.*?)】/)?.[1] || "未命名";
    const company = line.match(/\{(.*?)\}/)?.[1] || "";
    const fare = line.match(/《(.*?)》/)?.[1] || "";
    const city = line.match(/『(.*?)』/)?.[1] || "其他";
    const startTime = line.match(/§(.*?)§/)?.[1] || "";
    const endTime = line.match(/@(.*?)@/)?.[1] || "";
    
    // Types
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

// 核心逻辑：判断是否直通
function isDirectLine(lineNameA, lineNameB) {
    if (!lineNameA || !lineNameB) return false;
    // 1. 手动列表
    for (const group of appState.directLines.manual) {
        if (group.includes(lineNameA) && group.includes(lineNameB)) return true;
    }
    // 2. 自动后缀识别 (如: 1号线主线 & 1号线支线)
    for (const pair of appState.directLines.auto) {
        // pair example: ["主线", "支线"]
        const suffixA = pair.find(s => lineNameA.endsWith(s));
        const suffixB = pair.find(s => lineNameB.endsWith(s));
        
        if (suffixA && suffixB && suffixA !== suffixB) {
            const rootA = lineNameA.substring(0, lineNameA.length - suffixA.length);
            const rootB = lineNameB.substring(0, lineNameB.length - suffixB.length);
            if (rootA === rootB) return true;
        }
    }
    return false;
}

// 核心逻辑：判断换乘类型
function getTransferType(rawNameA, rawNameB, lineTypeA, lineTypeB) {
  if (rawNameA !== rawNameB) return 'walking'; // 站名不同肯定是走
  
  // 需求4：公轨互换一定是出站
  const isRailA = lineTypeA === 'metro' || lineTypeA === 'rail';
  const isRailB = lineTypeB === 'metro' || lineTypeB === 'rail';
  
  // 只要其中一个是公交，且不全是公交(纯公交换乘通常是同站/原地)，视为出站步行
  // 修正：公交转公交通常在同一个站台或路边，算same_station。公交转地铁一定是walking。
  if (isRailA !== isRailB) {
      return 'walking'; 
  }
  
  // 地铁转地铁，默认为站内
  if (isRailA && isRailB) return 'same_station';
  
  return 'same_station'; // 公交转公交
}

/* --- Logic: Route Finding --- */

// Modified: Build Graph with Global City Filter
function buildGraph(rule) {
  const graph = {}; 
  // 需求3：使用全局选择的地区作为硬性过滤
  const cityLock = appState.selectedCity !== 'all' ? appState.selectedCity : null;

  appState.lines.forEach(line => {
    // 过滤逻辑
    if (cityLock && line.city !== cityLock) return;
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
    
    let weight = 1; // 基础时间成本
    
    // 速度假设
    if (line.isMetro) weight = 0.6;
    if (line.isRail) weight = 0.4; 
    if (line.specialType === 'brt') weight = 0.8;

    // 规则权重调整
    if (rule === 'rail_priority') {
      if (line.isMetro || line.isRail) weight = 0.3; // 极度偏好轨道
      else weight = 2.5; // 惩罚公交
    } else if (rule === 'fastest') {
       // Fastest 已经在基础速度里体现了，这里不做额外惩罚
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
  constnow = new Date(); // Typo fix
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

// 核心逻辑：主寻路入口
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

  const activeChip = document.getElementById('planner-filters').querySelector('.active');
  const currentRule = activeChip ? activeChip.dataset.rule : 'all';
  
  let finalResults = [];

  // 需求1：所有方案 = 把其他策略的结果聚合
  if (currentRule === 'all') {
      const strategies = ['fastest', 'min_transfer', 'rail_priority', 'bus_only'];
      let aggregator = [];
      
      strategies.forEach(r => {
          const res = runDijkstra(startId, endId, r);
          aggregator = aggregator.concat(res);
      });
      
      // 去重 (根据路径的线路ID序列)
      const uniqueMap = new Map();
      aggregator.forEach(item => {
          const signature = item.path.map(p => p.lineId).join('-');
          if (!uniqueMap.has(signature)) {
              uniqueMap.set(signature, item);
          } else {
              // 如果重复，保留cost更小的（虽然一般路径一样cost也一样）
              if (item.cost < uniqueMap.get(signature).cost) uniqueMap.set(signature, item);
          }
      });
      finalResults = Array.from(uniqueMap.values());
      // 按照时间/Cost排序
      finalResults.sort((a, b) => a.cost - b.cost);

  } else {
      // 单一策略
      finalResults = runDijkstra(startId, endId, currentRule);
  }

  const formattedResults = finalResults.map(res => compressPath(res.path));
  renderPlannerResults(formattedResults);
}

function runDijkstra(startId, endId, rule) {
    const graph = buildGraph(rule);
    const queue = [{ node: startId, cost: 0, path: [] }];
    const visited = {}; 
    const results = [];
    // 增加限制防止卡死，但要足够找到结果
    const maxLoops = 8000; 

    let loops = 0;
    while (queue.length > 0 && loops < maxLoops) {
      loops++;
      queue.sort((a, b) => a.cost - b.cost);
      const current = queue.shift();
  
      if (current.cost > (visited[current.node] || Infinity)) continue;
      // 稍微放宽Visited检查，允许不同的路径经过同一个点（为了找到不同的换乘方案）
      // 只有当cost显著大于已知cost时才丢弃
      visited[current.node] = current.cost;
  
      if (current.node === endId) {
        results.push(current);
        // 如果我们只要前几个最优解，可以在这里break，但在'all'模式下我们需要多一点变种
        if (results.length >= 3) break; 
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
            // 需求4：严格判断换乘类型
            transferType = getTransferType(
                lastStep.toRawName, 
                edge.fromRawName, 
                lastStep.type, 
                edge.type
            );
            
            // 换乘惩罚
            if (transferType === 'walking') {
              stepCost += 20; // 步行换乘很慢
            } else {
              stepCost += 8; // 同站换乘较快
            }
            
            // 直通车特判：如果是直通车，几乎无惩罚
            if (isDirectLine(lastStep.lineName, edge.lineName)) {
                stepCost = edge.rawWeight; // 重置为仅行驶时间，无换乘惩罚
                transferType = 'direct_connect'; // 标记为直通
            }

            if (rule === 'min_transfer') stepCost += 1000; // 巨额惩罚换乘
          }
        }
        
        const newCost = current.cost + stepCost;
        // 允许略微高一点的成本进入队列，为了多样性
        if (newCost < (visited[edge.toNode] || Infinity) + 10) {
           queue.push({ 
               node: edge.toNode, 
               cost: newCost, 
               path: [...current.path, { ...edge, transferType: isTransfer ? transferType : 'none' }] 
           });
        }
      });
    }
    return results;
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
        transferType: step.transferType
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
        // 下一段的起始transferType来源于这一步的连接
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
    
    // 逻辑：过滤直通车，直通车不计入“换乘次数”显示
    // transferType === 'direct_connect'
    const transfers = segments.filter(s => s.transferType !== 'none' && s.transferType !== 'direct_connect').length;
    const totalStops = segments.reduce((sum, seg) => sum + seg.stopCount, 0);
    let totalTime = 0;
    
    // Operating Time Check
    let isServiceActive = true;

    segments.forEach((seg, i) => {
      const perStop = seg.type === 'metro' ? 2.5 : (seg.type === 'rail' ? 5 : 3.5);
      totalTime += Math.ceil(seg.stopCount * perStop);
      
      // 时间成本计算
      if (i > 0) {
         if (seg.transferType === 'walking') totalTime += 10;
         else if (seg.transferType === 'same_station') totalTime += 5;
         // 直通车无额外时间惩罚
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
    
    // 需求2：不在运营时段显示逻辑
    let metaHTML = `${totalStops}站 · 换乘 ${transfers} 次`;
    if (!isServiceActive) {
        metaHTML += ` <span style="color:var(--md-sys-color-error); margin-left:6px; font-weight:600">· 不在运营时段</span>`;
    }

    // 如果不在运营时段，时间显示可以灰色或依旧显示但已在meta提示
    // 这里保持显示时间，但在meta强调
    const timeDisplay = `<div class="plan-time-big">${totalTime} <span style="font-size:14px; font-weight:normal">分钟</span></div>`;

    card.innerHTML = `
      <div class="plan-header">
        ${timeDisplay}
        <div class="plan-meta">${metaHTML}</div>
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
       <div class="ms-time">${time}分钟</div>
       <div class="ms-meta">共 ${segments.reduce((a,b)=>a+b.stopCount,0)} 站 ${!isActive ? '<span class="out-of-service">· 不在运营时段</span>' : ''}</div>
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
      const tType = nextSeg.transferType;
      
      let badgeIcon = 'transfer_within_a_station';
      let badgeText = '站内换乘';
      
      if (tType === 'walking') {
          badgeIcon = 'directions_walk';
          badgeText = '出站换乘 (需步行)';
      } else if (tType === 'direct_connect') {
          // 需求4：直通列车提示
          badgeIcon = 'train';
          badgeText = `乘坐前往 ${nextSeg.direction==='up'?nextSeg.meta.stationsUp[nextSeg.meta.stationsUp.length-1]:nextSeg.meta.stationsDown[nextSeg.meta.stationsDown.length-1]} 方向的列车，需要留意站台来车`;
      }
      
      html += `
        <div class="transfer-gap">
           <div class="walk-badge ${tType === 'direct_connect' ? 'direct' : ''}">
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
