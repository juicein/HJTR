/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { 
    manual: [], 
    suffixGroups: [] // 改为后缀组数组
  },
  currentView: 'home',
  selectedCity: localStorage.getItem('bus_selected_city') || 'all',
  selectedType: localStorage.getItem('bus_selected_type') || 'all', 
  planner: { start: '', end: '', rule: 'fastest' }
};

/* --- 1. Data Loading & Parsing --- */
async function init() {
  try {
    const [txtRes, areaRes, compRes, aliasRes] = await Promise.all([
      fetch('data/bus_data.txt'),
      fetch('data/logos_area.json'),
      fetch('data/logos_company.json'),
      fetch('data/station_alias.json')
    ]);

    const txt = await txtRes.text();
    appState.logos.area = await areaRes.json();
    appState.logos.company = await compRes.json();
    const aliasData = await aliasRes.json();
    
    // 12. 加载新的别名结构
    appState.aliases.manual = aliasData.manual_equivalents || [];
    appState.aliases.suffixGroups = aliasData.suffix_groups || []; 

    parseLines(txt);
    setupUI();
    populateStationDatalist();
    applyFilters();
    
    // 处理浏览器历史记录返回
    window.onpopstate = (event) => {
      if (appState.currentView !== 'home') {
        switchView('home', false);
      }
    };
  } catch (e) {
    console.error("Initialization failed:", e);
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
    const isMetro = line.includes("θ地铁θ");
    const isRail = line.includes("θ铁路θ") || name.includes("城际") || name.includes("高铁"); 
    const color = line.match(/∮([0-9A-Fa-f]{6,8})∮/)?.[1];

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
      name, company, fare, city, startTime, endTime, isMetro, isRail, color,
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

/* --- 2. Logic: Advanced Aliasing & Routing --- */

// 12. 改进的归一化逻辑：支持多组后缀
function normalizeStation(name) {
  let n = name.trim();
  
  // 遍历每一组后缀规则
  for (const group of appState.aliases.suffixGroups) {
    for (const suffix of group) {
      if (n.endsWith(suffix)) {
        // 尝试移除后缀，得到 baseName
        // 例如 "大桥北" -> "大桥"
        const base = n.substring(0, n.length - suffix.length);
        // 如果移除后还有内容，我们就认为这是一个变体，返回 base
        // 这样 "大桥北" 和 "大桥南" 都会变成 "大桥"
        if (base.length > 0) {
           return base;
        }
      }
    }
  }
  // 如果没有匹配任何后缀规则，或者本身就是基础词（如"大桥"不以"北"结尾），保持原样
  return n;
}

function getCanonicalStationId(name) {
  const norm = normalizeStation(name);
  // 检查手动完全等价组
  for (const group of appState.aliases.manual) {
    if (group.some(g => normalizeStation(g) === norm)) {
      return normalizeStation(group[0]); 
    }
  }
  return norm;
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
    const rawFrom = stations[i];
    const rawTo = stations[i+1];
    
    const fromId = getCanonicalStationId(rawFrom);
    const toId = getCanonicalStationId(rawTo);
    
    if (!graph[fromId]) graph[fromId] = [];
    
    let weight = 1;
    if (line.isMetro) weight = 0.8;
    if (line.isRail) weight = 0.5;
    
    // 7. 轨道优先逻辑：降低 Metro/Rail 权重 (越小越好)，增加 Bus 权重
    if (rule === 'rail_priority') {
      if (line.isMetro || line.isRail) weight = 0.4;
      else weight = 2.0; 
    }

    graph[fromId].push({
      toNode: toId,
      lineName: line.name,
      lineId: line.id,
      direction: dir,
      rawWeight: weight,
      type: line.type,
      fare: line.fare,
      intervals: line.startTime + '~' + line.endTime,
      fullLine: line,
      fromRaw: rawFrom, // 记录原始站名用于判断是否同站换乘
      toRaw: rawTo
    });
  }
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
    showToast("起点和终点不能相同");
    return;
  }

  const startLine = appState.lines.find(l => 
    l.stationsUp.some(s => getCanonicalStationId(s) === startId) || 
    l.stationsDown.some(s => getCanonicalStationId(s) === startId)
  );
  const regionLock = startLine ? startLine.city : null; 
  
  const activeFilter = document.getElementById('planner-filters').querySelector('.active');
  const rule = activeFilter ? activeFilter.dataset.rule : 'fastest';
  
  const graph = buildGraph(rule, regionLock);

  const queue = [{ node: startId, cost: 0, path: [] }];
  const visited = {}; 
  const results = [];
  const maxResults = 5;

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    // 稍微放宽访问限制以找到不同路径
    if (current.cost > (visited[current.node] || Infinity) + 10) continue;
    visited[current.node] = Math.min(visited[current.node] || Infinity, current.cost);

    if (current.node === endId) {
      results.push(current);
      if (results.length >= maxResults) break; 
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      let stepCost = edge.rawWeight;
      let isTransfer = false;
      
      const lastStep = current.path[current.path.length - 1];
      
      if (lastStep) {
        if (lastStep.lineId !== edge.lineId) {
           stepCost += 15; // 基础换乘惩罚
           isTransfer = true;
           
           // 12. 关键逻辑：站内 vs 站外换乘
           // 如果上一段的终点原始名 !== 这一段的起点原始名
           // 说明是同义词换乘（例如 大桥北 -> 大桥南），需要步行
           if (lastStep.toRaw !== edge.fromRaw) {
             stepCost += 10; // 额外步行惩罚
           }
        }
      }
      
      if (rule === 'min_transfer' && isTransfer) stepCost += 50; 

      const newCost = current.cost + stepCost;
      const newPath = [...current.path, { ...edge, fromName: current.node }]; // fromName keeps ID

      // 简单剪枝
      if (newCost < (visited[edge.toNode] || Infinity) + 15) {
         queue.push({ node: edge.toNode, cost: newCost, path: newPath });
      }
    });
  }

  const formattedResults = results.map(res => compressPath(res.path));
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
        startStation: step.fromRaw, // 使用原始名称展示
        endStation: step.toRaw,
        stopCount: 1,
        direction: step.direction,
        meta: step.fullLine
      };
    } else if (step.lineId === currentSeg.lineId && step.direction === currentSeg.direction) {
      currentSeg.endStation = step.toRaw;
      currentSeg.stopCount++;
    } else {
      segments.push(currentSeg);
      currentSeg = {
        lineName: step.lineName,
        lineId: step.lineId,
        type: step.type,
        startStation: step.fromRaw, // 这里会捕捉到换乘时的不同站名（例如上一步是...到大桥北，这一步是大桥南到...）
        endStation: step.toRaw,
        stopCount: 1,
        direction: step.direction,
        meta: step.fullLine
      };
    }
  });
  if (currentSeg) segments.push(currentSeg);
  return segments;
}

/* --- 3. UI Rendering --- */

function setupUI() {
  // 2. 导航返回逻辑
  document.getElementById('nav-back').onclick = handleBack;
  
  // Home -> Planner
  document.getElementById('nav-planner-btn').onclick = () => switchView('planner');
  
  // Transport Filters (Home)
  document.querySelectorAll('#transport-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#transport-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      appState.selectedType = e.currentTarget.dataset.type;
      localStorage.setItem('bus_selected_type', appState.selectedType);
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
     setTimeout(() => document.getElementById('area-search-input').focus(), 100);
  };
  backdrop.onclick = () => {
    document.getElementById('area-menu').classList.remove('open');
    backdrop.classList.remove('open');
  };

  // Search Input
  document.getElementById('line-search').addEventListener('input', renderHome);

  // Detail View Buttons
  document.getElementById('btn-dir-up').onclick = () => renderStations('up');
  document.getElementById('btn-dir-down').onclick = () => renderStations('down');

  // Planner Filters
  document.querySelectorAll('#planner-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#planner-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
    };
  });
  
  // Planner Logic
  document.getElementById('btn-swap-stations').onclick = () => {
    const s = document.getElementById('plan-start');
    const e = document.getElementById('plan-end');
    [s.value, e.value] = [e.value, s.value];
  };

  // 7. 绑定搜索按钮
  document.getElementById('btn-search-route').onclick = findRoute;

  // Modal Close
  document.getElementById('modal-close').onclick = closeRouteModal;
  document.getElementById('modal-backdrop').onclick = closeRouteModal;
  
  // Menu Item Search
  document.getElementById('area-search-input').oninput = (e) => {
    renderAreaMenu(e.target.value.trim());
  };
}

// 2. 导航逻辑核心
function handleBack() {
  if (appState.currentView === 'home') {
    // 如果在主页，返回门户 (模拟 history.back)
    // 实际场景中，如果没有上一页，可能需要 window.close() 或跳转指定 URL
    if (window.history.length > 1) {
      window.history.back();
    } else {
      console.log("Returned to Portal Home");
      // window.location.href = '/portal'; 
    }
  } else {
    // 如果在子页面，返回 Home View
    switchView('home');
  }
}

function switchView(viewName, pushState = true) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  
  appState.currentView = viewName;
  
  const title = document.getElementById('page-title');
  const plannerBtn = document.getElementById('nav-planner-btn');
  const areaBtn = document.getElementById('filter-area-btn');
  const backBtn = document.getElementById('nav-back');
  
  if (viewName === 'home') {
    title.innerText = '公交 / 地铁';
    plannerBtn.style.display = 'flex';
    areaBtn.style.display = 'flex';
    // 在 Home 页，Back 键的行为是退出
  } else if (viewName === 'detail') {
    title.innerText = '线路详情';
    plannerBtn.style.display = 'none';
    areaBtn.style.display = 'none';
  } else {
    title.innerText = '出行规划';
    plannerBtn.style.display = 'none';
    areaBtn.style.display = 'none';
  }

  // 管理浏览器历史，使得物理返回键也能工作
  if (pushState && viewName !== 'home') {
    history.pushState({ view: viewName }, null, `#${viewName}`);
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
    
    let icon = 'directions_bus';
    if(line.isMetro) icon = 'subway';
    if(line.isRail) icon = 'train';
    
    // 9. 公司 Logo 移除，只保留地区 Logo
    card.innerHTML = `
      <div class="line-row-main">
        <div class="line-icon-badge" style="background:${color}">
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

function renderAreaMenu(filterText = '') {
  const menuList = document.getElementById('area-menu-list');
  menuList.innerHTML = `<div class="menu-item ${appState.selectedCity === 'all' ? 'selected' : ''}" onclick="selectCity('all')">全部地区</div>`;
  
  const cities = [...new Set(appState.lines.map(l => l.city))];
  const filteredCities = cities.filter(c => c.toLowerCase().includes(filterText.toLowerCase()));

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
  
  // CSS for menu items (injected dynamically here or added to css)
  if (!document.getElementById('menu-style')) {
    const style = document.createElement('style');
    style.id = 'menu-style';
    style.innerHTML = `
      .menu-list-content { max-height: 300px; overflow-y: auto; }
      .menu-item { padding: 12px 16px; display: flex; align-items: center; gap: 12px; cursor: pointer; }
      .menu-item:hover { background: rgba(0,0,0,0.05); }
      .menu-item.selected { background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
      .menu-item img { width: 24px; height: 24px; object-fit: contain; }
      .menu-item .check { margin-left: auto; font-size: 18px; }
    `;
    document.head.appendChild(style);
  }
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

  // 9. 公司 Logo 在详情页显示
  header.innerHTML = `
    <div class="dh-top">
      <div class="line-icon-badge large" style="background:${badgeColor}">
        ${line.name}
      </div>
      <div style="flex:1">
        <div class="dh-title-row">
          <div class="dh-name">${line.name}</div>
          ${compLogo ? `<img src="${compLogo}" class="company-logo-detail" alt="${line.company}">` : `<span class="company-text">${line.company}</span>`}
        </div>
        <div class="dh-sub" style="opacity:0.8; margin-top:4px;">${line.city}</div>
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
         // 可选：自动查询
         // findRoute(); 
       }
    };
    list.appendChild(div);
  });
}

function renderPlannerResults(segmentsList) {
  const container = document.getElementById('planner-results');
  container.innerHTML = '';
  
  if (!segmentsList || segmentsList.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <span class="material-symbols-rounded icon">alt_route</span>
      <p>未找到合适方案，请尝试更换筛选条件或同地区查询</p>
    </div>`;
    return;
  }

  segmentsList.forEach((segments) => {
    const card = document.createElement('div');
    card.className = 'plan-result-card';
    
    // 基础时间计算
    const totalStops = segments.reduce((sum, seg) => sum + seg.stopCount, 0);
    const transfers = segments.length - 1;
    let totalTime = 0;
    
    segments.forEach(seg => {
      const perStop = seg.type === 'metro' ? 2.5 : (seg.type === 'rail' ? 5 : 3.5);
      totalTime += Math.ceil(seg.stopCount * perStop);
    });
    // 换乘时间估算
    for(let i=0; i<segments.length-1; i++) {
        const segA = segments[i];
        const segB = segments[i+1];
        // 如果是异名同站（如大桥北->大桥南），增加更多时间
        if (segA.endStation !== segB.startStation) {
            totalTime += 15; // 步行换乘
        } else {
            totalTime += 8; // 站内/同站换乘
        }
    }

    const routeSummary = segments.map((seg, i) => `
      <div class="route-step-pill">
        <span class="step-icon material-symbols-rounded" style="font-size:16px;">
          ${seg.type==='metro'?'subway':(seg.type==='rail'?'train':'directions_bus')}
        </span>
        <span class="step-name">${seg.lineName}</span>
      </div>
      ${i < segments.length - 1 ? '<span class="material-symbols-rounded step-arrow">arrow_forward</span>' : ''}
    `).join('');

    card.innerHTML = `
      <div class="plan-header">
        <div class="plan-time-big">${totalTime}<span style="font-size:14px; font-weight:normal; margin-left:2px">分</span></div>
        <div class="plan-meta">${totalStops}站 · 换乘 ${transfers} 次</div>
      </div>
      <div class="plan-route-visual">
        ${routeSummary}
      </div>
      <div class="plan-desc">
        ${segments[0].startStation} <span class="material-symbols-rounded" style="font-size:12px; vertical-align:middle">arrow_right_alt</span> ${segments[segments.length-1].endStation}
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
       <div class="ms-time">${time}<span style="font-size:16px; font-weight:500;">分钟</span></div>
       <div class="ms-meta">共 ${segments.reduce((a,b)=>a+b.stopCount,0)} 站 · ${segments.length > 1 ? '需换乘' : '直达'}</div>
    </div>
  `;
  
  segments.forEach((seg, idx) => {
    const isLast = idx === segments.length - 1;
    const color = seg.meta.color ? `#${seg.meta.color.slice(0,6)}` : '#006495';
    
    html += `
      <div class="step-card">
        <div class="step-left-line" style="background:${color}"></div>
        <div class="step-icon-box" style="background:${color}">
             <span class="material-symbols-rounded" style="color:white; font-size:18px;">
               ${seg.type==='metro'?'subway':(seg.type==='rail'?'train':'directions_bus')}
             </span>
        </div>
        
        <div class="step-content">
          <div class="step-title-row">
            <span class="step-line-name" style="color:${color}">${seg.lineName}</span>
            <span class="step-dir">往 ${seg.direction==='up'?seg.meta.stationsUp[seg.meta.stationsUp.length-1]:seg.meta.stationsDown[seg.meta.stationsDown.length-1]}</span>
          </div>
          
          <div class="step-detail-row">
            从 <strong>${seg.startStation}</strong> 到 <strong>${seg.endStation}</strong>
          </div>
          
          <div class="step-sub-info">
            ${seg.stopCount} 站 · ${seg.meta.fare || '分段收费'}
            <br>
            <span style="opacity:0.7">首 ${seg.meta.startTime} 末 ${seg.meta.endTime}</span>
          </div>
        </div>
      </div>
    `;
    
    if (!isLast) {
      const nextSeg = segments[idx+1];
      // 12. 判断是同名站换乘还是异名站换乘
      const isWalk = seg.endStation !== nextSeg.startStation;
      
      html += `
        <div class="transfer-gap">
           <span class="material-symbols-rounded">directions_walk</span>
           <span>${isWalk ? `步行换乘 (从 ${seg.endStation} 到 ${nextSeg.startStation})` : '站内换乘'}</span>
        </div>
      `;
    }
  });

  // 7. 分享与通知按钮
  html += `
    <div class="modal-actions">
      <button class="action-btn tonal" onclick="shareRouteImage()">
        <span class="material-symbols-rounded">share</span> 分享方案
      </button>
      <button class="action-btn primary" onclick="subscribePush()">
        <span class="material-symbols-rounded">notifications_active</span> 发送至手机
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

// 7. 模拟功能实现
window.shareRouteImage = function() {
  showToast("正在生成图片... (已保存至相册)");
}

window.subscribePush = function() {
  if ('Notification' in window) {
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
         new Notification('提醒设置成功', { body: '将在您接近换乘站时发送通知' });
         showToast("已发送至通知栏");
      } else {
        showToast("请允许通知权限");
      }
    });
  } else {
    // Fallback for demo
    showToast("提醒已添加 (模拟)");
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
