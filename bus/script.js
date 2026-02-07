/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffixGroups: [] },
  directLines: { manual: [], auto: [] }, // 直通线路规则
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
      fetch('../data/direct_line.json')
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
    
    // URL Routing Handler
    handleRouting();
    
  } catch (e) {
    console.error("Initialization failed:", e);
    showToast("数据加载失败");
  }
}

// URL Routing Logic (Supports ?=Value syntax)
function handleRouting() {
  const rawSearch = window.location.search; // e.g., "?=地铁1号线"
  const decoded = decodeURIComponent(rawSearch);
  
  // Custom parser for "?=Value"
  let queryValue = "";
  if (decoded.startsWith("?=")) {
    queryValue = decoded.substring(2);
  } else {
    const params = new URLSearchParams(window.location.search);
    queryValue = params.get('q') || params.get('search') || "";
  }

  // Planner specific: /bus/planning?=StartStation
  if (window.location.href.includes("planning") && queryValue) {
    document.getElementById('plan-start').value = queryValue;
    switchView('planner');
    return;
  }

  // Search specific: /bus/search?=LineName
  // Or generic fallback
  if (queryValue) {
    document.getElementById('line-search').value = queryValue;
    const exactMatch = appState.lines.find(l => l.name === queryValue);
    if (exactMatch) {
      openDetail(exactMatch);
    } else {
      renderHome();
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

// 解决重名：生成唯一ID (城市::站点名)
function getUniqueStationId(name, city) {
  let cleanName = name.trim();
  
  // 别名归一化 (先处理别名，再组合城市)
  for (const group of appState.aliases.manual) {
    if (group.includes(cleanName)) {
      cleanName = group[0]; 
      break;
    }
  }
  // 后缀处理
  let baseName = cleanName;
  for (const group of appState.aliases.suffixGroups) {
    for (const suffix of group) {
      if (baseName.endsWith(suffix)) {
        const candidate = baseName.substring(0, baseName.length - suffix.length);
        if (candidate.length > 0) {
          baseName = candidate;
          break;
        }
      }
    }
  }
  
  return `${city}::${baseName}`;
}

function populateStationDatalist() {
  const stationMap = new Map(); // Name -> Set(Cities)

  appState.lines.forEach(l => {
    [...l.stationsUp, ...l.stationsDown].forEach(s => {
      if (!stationMap.has(s)) stationMap.set(s, new Set());
      stationMap.get(s).add(l.city);
    });
  });
  
  const datalist = document.getElementById('station-datalist');
  datalist.innerHTML = '';
  
  // 生成选项：如果有重名，显示 "站点 (城市)"，否则只显示 "站点"
  [...stationMap.keys()].sort().forEach(name => {
    const cities = stationMap.get(name);
    cities.forEach(city => {
      const option = document.createElement('option');
      // 如果该名字只在一个城市出现，value为名字；如果多个，value为名字(城市)
      // 为了逻辑统一，这里我们允许用户输入 "名字"，但在搜索时我们会尝试匹配
      // 但为了最好体验，我们建议输入格式。
      if (cities.size > 1) {
        option.value = `${name} (${city})`;
      } else {
        option.value = name; 
      }
      datalist.appendChild(option);
    });
  });
}

// 解析用户输入，返回可能的 UniqueID 列表
function resolveStationInput(input) {
  input = input.trim();
  // Check format "Name (City)"
  const match = input.match(/^(.*)\s\((.*)\)$/);
  if (match) {
    const name = match[1];
    const city = match[2];
    return [getUniqueStationId(name, city)];
  }

  // Plain name search
  const candidates = [];
  appState.lines.forEach(l => {
    if (l.stationsUp.includes(input) || l.stationsDown.includes(input)) {
       const uid = getUniqueStationId(input, l.city);
       if (!candidates.includes(uid)) candidates.push(uid);
    }
  });
  return candidates;
}

/* --- Logic: Route Finding --- */

function checkDirectLine(lineNameA, lineNameB) {
  // 检查直通规则
  const checkGroups = (groups) => {
    for (const group of groups) {
       // 如果两个线路名都在同一组，或者符合前缀+后缀逻辑
       // 这里简化：检查是否存在于同一手动组
       if (group.includes(lineNameA) && group.includes(lineNameB)) return true;
    }
    return false;
  };
  
  if (checkGroups(appState.directLines.manual)) return true;

  // 自动规则：去除后缀后名字相同
  // 例如 1号线主线 vs 1号线支线 -> 1号线
  for (const group of appState.directLines.auto) {
     for (const suffixA of group) {
       if (lineNameA.endsWith(suffixA)) {
         const baseA = lineNameA.replace(suffixA, "");
         for (const suffixB of group) {
            if (lineNameB.endsWith(suffixB)) {
               const baseB = lineNameB.replace(suffixB, "");
               if (baseA === baseB) return true;
            }
         }
       }
     }
  }
  return false;
}

function buildGraph(rule) {
  const graph = {}; 

  appState.lines.forEach(line => {
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
    // 关键：ID包含城市
    const fromId = getUniqueStationId(fromRaw, line.city);
    const toId = getUniqueStationId(toRaw, line.city);
    
    if (!graph[fromId]) graph[fromId] = [];
    
    let weight = 1; 
    
    // 基础权重
    if (line.isMetro) weight = 0.6;
    if (line.isRail) weight = 0.4; 
    if (line.specialType === 'brt') weight = 0.8;

    // 规则调整
    if (rule === 'rail_priority') {
      if (line.isMetro || line.isRail) weight = 0.3; 
      else weight = 2.0; 
    } else if (rule === 'min_transfer') {
      // 在Dijkstra中对换乘进行惩罚，这里保持基础
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

async function findRoute() {
  const startInput = document.getElementById('plan-start').value;
  const endInput = document.getElementById('plan-end').value;
  
  if (!startInput || !endInput) {
    showToast("请输入起点和终点");
    return;
  }

  // 解析ID，处理重名
  const startIds = resolveStationInput(startInput);
  const endIds = resolveStationInput(endInput);

  if (startIds.length === 0 || endIds.length === 0) {
    showToast("找不到该站点，请检查输入或加上 (城市)");
    return;
  }
  
  // 如果有多个可能（例如用户只输了"奥体中心"，且存在于两个城市），
  // 这里简化逻辑：优先取同一个城市的。如果没有交集，默认取第一个。
  let startId = startIds[0];
  let endId = endIds[0];

  // 尝试匹配同城
  let matchFound = false;
  for(let s of startIds) {
    const sCity = s.split("::")[0];
    for(let e of endIds) {
      if (e.split("::")[0] === sCity) {
        startId = s;
        endId = e;
        matchFound = true;
        break;
      }
    }
    if(matchFound) break;
  }

  if (startId === endId) {
    showToast("起点终点看起来是同一个地方");
    return;
  }

  const activeChip = document.getElementById('planner-filters').querySelector('.active');
  let selectedRule = activeChip ? activeChip.dataset.rule : 'all';

  document.getElementById('planner-results').innerHTML = '<div class="loading-state">正在规划路线...</div>';

  // 1. 实现“所有方案”：聚合所有策略
  let rulesToRun = [];
  if (selectedRule === 'all') {
    rulesToRun = ['fastest', 'min_transfer', 'rail_priority', 'bus_only'];
  } else {
    rulesToRun = [selectedRule];
  }

  let aggregatedResults = [];
  
  // 运行算法
  for (const rule of rulesToRun) {
    const graph = buildGraph(rule);
    const results = runDijkstra(graph, startId, endId, rule);
    aggregatedResults = [...aggregatedResults, ...results];
  }

  // 去重 (基于线路ID序列)
  const uniquePaths = [];
  const seenSignatures = new Set();

  aggregatedResults.sort((a,b) => a.cost - b.cost); // 总体排序

  aggregatedResults.forEach(res => {
    const signature = res.path.map(p => `${p.lineId}_${p.direction}`).join('|');
    if (!seenSignatures.has(signature)) {
      seenSignatures.add(signature);
      uniquePaths.push(res);
    }
  });

  const formattedResults = uniquePaths.map(res => compressPath(res.path)).slice(0, 10); // 取前10
  renderPlannerResults(formattedResults);
}

function runDijkstra(graph, startId, endId, rule) {
  const queue = [{ node: startId, cost: 0, path: [] }];
  const visited = {}; // node -> minCost
  const results = [];
  const maxResults = 5; 

  let loops = 0;
  while (queue.length > 0 && loops < 8000) {
    loops++;
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    if (current.cost > (visited[current.node] || Infinity) + 3) continue; // 允许稍微次优的路径以寻找不同换乘
    visited[current.node] = current.cost;

    if (current.node === endId) {
      results.push(current);
      if (results.length >= maxResults) continue; // 或者是 break，取决于想找多少差异化路径
    }

    const neighbors = graph[current.node] || [];
    
    // 跨城市同名站点隐式换乘逻辑？暂时不支持，除非 alias 定义了。
    // 这里假设图已经是连通的。

    neighbors.forEach(edge => {
      let stepCost = edge.rawWeight;
      let isTransfer = false;
      let transferType = 'none';
      
      const lastStep = current.path[current.path.length - 1];
      
      if (lastStep) {
        if (lastStep.lineId !== edge.lineId) {
          isTransfer = true;
          
          // 4. 判断换乘类型
          const isDirect = checkDirectLine(lastStep.lineName, edge.lineName);
          
          if (isDirect) {
             transferType = 'direct_running';
             stepCost += 0; // 直通无惩罚
          } else {
             // 检查是否是 公交 <-> 地铁/轨道
             const lastIsRail = lastStep.fullLine.isMetro || lastStep.fullLine.isRail;
             const currIsRail = edge.fullLine.isMetro || edge.fullLine.isRail;
             
             if (lastIsRail !== currIsRail) {
               transferType = 'out_station'; // 强制出站换乘
               stepCost += 25; // 步行惩罚
             } else {
               transferType = 'same_station'; // 普通换乘
               stepCost += 15;
             }
          }
          
          if (rule === 'min_transfer' && !isDirect) stepCost += 500; // 巨额惩罚
        }
      }
      
      const newCost = current.cost + stepCost;
      const newPath = [...current.path, { ...edge, transferType: isTransfer ? transferType : 'none' }];

      // 松弛条件
      if (newCost < (visited[edge.toNode] || Infinity) + 5) {
         queue.push({ node: edge.toNode, cost: newCost, path: newPath });
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
      currentSeg = createSegment(step);
    } else if (step.lineId === currentSeg.lineId && step.direction === currentSeg.direction) {
      currentSeg.endStation = step.toRawName;
      currentSeg.stopCount++;
    } else {
      segments.push(currentSeg);
      // Transfer Logic carried to next segment start
      currentSeg = createSegment(step);
    }
  });
  if (currentSeg) segments.push(currentSeg);
  return segments;
}

function createSegment(step) {
  return {
    lineName: step.lineName,
    lineId: step.lineId,
    type: step.type,
    iconType: step.fullLine.iconType,
    startStation: step.fromRawName,
    endStation: step.toRawName,
    stopCount: 1,
    direction: step.direction,
    meta: step.fullLine,
    transferType: step.transferType // This is how we got onto this line
  };
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

/* --- UI Rendering --- */

// Same setupUI as before, mostly unchanged...
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

function openDetail(line) {
    appState.lines.forEach(l => {
        if(l.id === line.id) {
             currentLine = l;
        }
    });
    
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
         // Use Name (City) format for planner input to be precise
         const preciseName = `${s} (${currentLine.city})`;
         
         if(!startIn.value) {
           startIn.value = preciseName;
           showToast(`已设为起点: ${s}`);
           switchView('planner');
         } else {
           endIn.value = preciseName;
           showToast(`已设为终点: ${s}`);
           switchView('planner');
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
    // 只统计物理换乘，不统计直通
    const transfers = segments.filter(s => s.transferType !== 'none' && s.transferType !== 'direct_running').length;
    
    let totalTime = 0;
    let isServiceActive = true;

    segments.forEach((seg, i) => {
      const perStop = seg.type === 'metro' ? 2.5 : (seg.type === 'rail' ? 5 : 3.5);
      totalTime += Math.ceil(seg.stopCount * perStop);
      
      if (seg.transferType === 'out_station') totalTime += 15;
      else if (seg.transferType === 'same_station') totalTime += 5;
      
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
    let headerHtml = '';
    if (isServiceActive) {
        headerHtml = `
            <div class="plan-time-big">${totalTime} <span style="font-size:14px; font-weight:normal">分钟</span></div>
            <div class="plan-meta">${totalStops}站 · 换乘 ${transfers} 次</div>
        `;
    } else {
        headerHtml = `
            <div class="out-of-service">
               <span class="material-symbols-rounded">schedule_off</span> 不在运营时段
            </div>
            <div class="plan-meta" style="margin-top:4px;">${totalStops}站 · 换乘 ${transfers} 次</div>
        `;
    }

    card.innerHTML = `
      <div class="plan-header-block">
        ${headerHtml}
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

function openRouteModal(segments, time, isActive) {
  currentSegments = segments;
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('route-modal');
  const content = document.getElementById('modal-content-body');
  
  let html = `
    <div class="modal-summary">
       ${isActive ? `<div class="ms-time">${time}分钟</div>` : `<div class="out-of-service" style="font-size:24px">不在运营时段</div>`}
       <div class="ms-meta">共 ${segments.reduce((a,b)=>a+b.stopCount,0)} 站</div>
    </div>
  `;
  
  segments.forEach((seg, idx) => {
    const isLast = idx === segments.length - 1;
    const color = seg.meta.color ? `#${seg.meta.color.slice(0,6)}` : '#006495';
    
    const endStationName = seg.direction==='up' ? seg.meta.stationsUp[seg.meta.stationsUp.length-1] : seg.meta.stationsDown[seg.meta.stationsDown.length-1];

    html += `
      <div class="step-card">
        <div class="step-left-line"></div>
        <div class="step-icon-box" style="background:${color}">
             <span class="material-symbols-rounded" style="color:white; font-size:16px;">${seg.iconType}</span>
        </div>
        
        <div class="step-content">
          <div class="step-title-row">
            <span class="step-line-name" style="color:${color}">${seg.lineName}</span>
            <span class="step-dir">往 ${endStationName}</span>
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
      
      if (nextSeg.transferType === 'direct_running') {
         transferHtml = `
            <div class="transfer-gap direct">
               <div class="walk-badge direct">
                 <span class="material-symbols-rounded" style="font-size:14px">link</span>
                 <span>乘坐前往 ${endStationName} 方向的列车，需要留意站台来车</span>
               </div>
            </div>
         `;
      } else if (nextSeg.transferType === 'out_station') {
         transferHtml = `
            <div class="transfer-gap">
               <div class="walk-badge out">
                 <span class="material-symbols-rounded" style="font-size:14px">directions_walk</span>
                 <span>出站换乘 (需步行)</span>
               </div>
            </div>
         `;
      } else {
         transferHtml = `
            <div class="transfer-gap">
               <div class="walk-badge">
                 <span class="material-symbols-rounded" style="font-size:14px">transfer_within_a_station</span>
                 <span>站内换乘</span>
               </div>
            </div>
         `;
      }
      html += transferHtml;
    }
  });

  content.innerHTML = html;
  
  const footer = document.getElementById('modal-footer-actions');
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

// Reuse existing close/share/toast functions...
function closeRouteModal() {
    document.getElementById('modal-backdrop').classList.remove('visible');
    document.getElementById('route-modal').classList.remove('visible');
}
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
init();
