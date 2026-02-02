/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffixGroups: [] },
  currentView: 'home',
  selectedCity: localStorage.getItem('bus_selected_city') || 'all',
  selectedType: localStorage.getItem('bus_selected_type') || 'all', 
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
    
    appState.aliases.manual = aliasData.manual_equivalents || [];
    appState.aliases.suffixGroups = aliasData.suffix_groups || [];

    parseLines(txt);
    setupUI();
    populateStationDatalist();
    applyFilters();

    // 4. URL 路由解析
    handleDeepLinks();

  } catch (e) {
    console.error("Initialization failed:", e);
    showToast("数据加载失败");
  }
}

// 4. URL 深度链接处理
function handleDeepLinks() {
  const params = new URLSearchParams(window.location.search);
  
  // Case 1: Search (?q=LineName)
  // 支持 URL: index.html?q=203路
  if (params.has('q')) {
    const query = params.get('q');
    document.getElementById('line-search').value = query;
    renderHome();
    
    // 如果完全匹配，直接打开详情
    const exactLine = appState.lines.find(l => l.name === query);
    if (exactLine) openDetail(exactLine);
  }

  // Case 2: Planning (?start=A&end=B)
  // 支持 URL: index.html?start=大桥&end=梅田
  // 提示中要求的格式是 planning?=... 我们这里兼容标准 query params
  if (params.has('start') && params.has('end')) {
    document.getElementById('plan-start').value = params.get('start');
    document.getElementById('plan-end').value = params.get('end');
    switchView('planner');
    findRoute();
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

/* --- Logic: Aliasing & Graph --- */
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

function getTransferType(rawNameA, rawNameB) {
  if (rawNameA === rawNameB) return 'same_station';
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
    
    let weight = 1; 
    if (line.isMetro) weight = 0.8;
    if (line.isRail) weight = 0.6; 

    // 1. 规则优化：用时少(fastest) 纯粹按时间/权重计算
    // 轨道优先：惩罚非轨道
    if (rule === 'rail_priority') {
      if (line.isMetro || line.isRail) weight = 0.4;
      else weight = 1.5; 
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
  const rule = activeChip ? activeChip.dataset.rule : 'fastest'; // Default to fastest
  
  const graph = buildGraph(rule, regionLock);

  const queue = [{ node: startId, cost: 0, path: [] }];
  const visited = {}; 
  const results = [];

  let loops = 0;
  while (queue.length > 0 && loops < 5000) {
    loops++;
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    if (current.cost > (visited[current.node] || Infinity)) continue;
    visited[current.node] = current.cost;

    if (current.node === endId) {
      results.push(current);
      if (results.length >= 8) break; // Fetch a few more to filter
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
          transferType = getTransferType(lastStep.toRawName, edge.fromRawName);
          
          if (transferType === 'walking') {
            stepCost += 25; 
          } else {
            stepCost += 15; 
          }
        }
      }
      
      // 1. 少换乘规则：大幅增加换乘成本
      if (rule === 'min_transfer' && isTransfer) stepCost += 200; 

      const newCost = current.cost + stepCost;
      
      const newPath = [...current.path, { 
        ...edge, 
        transferType: isTransfer ? transferType : 'none'
      }];

      if (newCost < (visited[edge.toNode] || Infinity)) {
         queue.push({ 
           node: edge.toNode, 
           cost: newCost, 
           path: newPath 
         });
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

/* --- 3. UI Rendering --- */

function setupUI() {
  document.getElementById('nav-back').onclick = () => {
    if (appState.currentView === 'home') {
      window.history.back(); 
    } else {
      switchView('home');
    }
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

  // Planner Filter Logic
  document.querySelectorAll('#planner-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      // 移除其他，激活当前
      const chips = document.querySelectorAll('#planner-filters .chip');
      chips.forEach(c => c.classList.remove('active'));
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
    
    let icon = 'directions_bus';
    if(line.isMetro) icon = 'subway';
    if(line.isRail) icon = 'train';
    
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

  // 9. 公司名称和Logo并排显示
  header.innerHTML = `
    <div class="dh-top">
      <div class="line-icon-badge large" style="background:${badgeColor}">
        ${line.name}
      </div>
      <div style="flex:1">
        <div class="dh-title-row">
          <div class="dh-name">${line.name}</div>
        </div>
        <div class="company-badge-row">
           ${compLogo ? `<img src="${compLogo}" class="company-logo-detail" alt="logo">` : ''}
           <span class="company-name-text">${line.company}</span>
        </div>
        <div class="dh-sub" style="margin-top:4px; opacity:0.7">${line.city}</div>
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

// 3. 检查运营时间逻辑
function checkOperatingTime(segments) {
  // 简单逻辑：只要其中一条线路当前不在运营，整体显示不在运营
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (let seg of segments) {
     const startStr = seg.meta.startTime;
     const endStr = seg.meta.endTime;
     
     if (!startStr || !endStr) continue; // 无数据假设全天

     const [sH, sM] = startStr.split(':').map(Number);
     const [eH, eM] = endStr.split(':').map(Number);
     
     const sMin = sH * 60 + sM;
     const eMin = eH * 60 + eM;

     // 跨午夜处理简单版 (如果结束时间小于开始时间，说明跨天，如 06:00 - 01:00)
     if (eMin < sMin) {
        // 比如 23:00 (1380) 到 01:00 (60)。当前是 00:30 (30) -> OK
        if (currentMinutes < sMin && currentMinutes > eMin) {
           return false;
        }
     } else {
        // 常规 06:00 - 22:00
        if (currentMinutes < sMin || currentMinutes > eMin) {
           return false;
        }
     }
  }
  return true;
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
    const transfers = segments.length - 1;
    let totalTime = 0;
    
    segments.forEach((seg, i) => {
      const perStop = seg.type === 'metro' ? 2.5 : (seg.type === 'rail' ? 5 : 3.5);
      totalTime += Math.ceil(seg.stopCount * perStop);
      if (i > 0) {
         if (seg.transferType === 'walking') totalTime += 10; 
         else totalTime += 5; 
      }
    });

    const routeSummary = segments.map((seg, i) => `
      <div class="route-step-pill">
        <span class="step-icon material-symbols-rounded">
          ${seg.type==='metro'?'subway':(seg.type==='rail'?'train':'directions_bus')}
        </span>
        <span class="step-name">${seg.lineName}</span>
      </div>
      ${i < segments.length - 1 ? '<span class="material-symbols-rounded step-arrow">arrow_forward</span>' : ''}
    `).join('');

    // 3. 判断运营状态
    const isInService = checkOperatingTime(segments);
    
    // 如果不在运营，显示红色提示；否则显示常规信息
    const metaHtml = !isInService 
       ? `<div class="plan-warning"><span class="material-symbols-rounded" style="font-size:16px">block</span>${totalStops}站 · 换乘${transfers}次 · 不在运营时段</div>`
       : `<div class="plan-meta">${totalStops}站 · 换乘 ${transfers} 次</div>`;

    card.innerHTML = `
      <div class="plan-header">
        <div class="plan-time-big">${totalTime} <span style="font-size:14px; font-weight:normal">分钟</span></div>
        ${metaHtml}
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
               ${seg.type==='metro'?'subway':(seg.type==='rail'?'train':'directions_bus')}
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
          </div>
        </div>
      </div>
    `;
    
    if (!isLast) {
      const nextSeg = segments[idx+1];
      const isWalk = nextSeg.transferType === 'walking';
      
      html += `
        <div class="transfer-gap">
           <div class="walk-badge">
             <span class="material-symbols-rounded" style="font-size:14px">
               ${isWalk ? 'directions_walk' : 'transfer_within_a_station'}
             </span>
             <span>${isWalk ? '同名/出站换乘 (需步行)' : '站内换乘'}</span>
           </div>
        </div>
      `;
    }
  });

  // 7. 真实功能绑定：html2canvas & Notification
  // 由于 html2canvas 需要截图，我们传入 segments 用于 Notification 构建
  html += `
    <div class="modal-actions" data-html2canvas-ignore>
      <button class="action-btn tonal" id="btn-share-img">
        <span class="material-symbols-rounded">share</span> 分享图片
      </button>
      <button class="action-btn primary" id="btn-sub-push">
        <span class="material-symbols-rounded">notifications_active</span> 发送行程
      </button>
    </div>
  `;

  content.innerHTML = html;
  
  // 绑定事件 (为了能传递 segments 数据)
  document.getElementById('btn-share-img').onclick = () => shareRouteImage();
  document.getElementById('btn-sub-push').onclick = () => subscribePush(segments);

  backdrop.classList.add('visible');
  modal.classList.add('visible');
}

function closeRouteModal() {
  document.getElementById('modal-backdrop').classList.remove('visible');
  document.getElementById('route-modal').classList.remove('visible');
}

/* --- 7. Features: Real Share & Real Notify --- */

// 真实图片生成
function shareRouteImage() {
  const target = document.getElementById('capture-target'); // 包含 header 和 content 的容器
  if(!target) return;

  showToast("正在生成图片，请稍候...");
  
  html2canvas(target, {
    backgroundColor: getComputedStyle(document.body).getPropertyValue('--md-sys-color-surface'),
    scale: 2 // 高清
  }).then(canvas => {
    // 自动下载
    const link = document.createElement('a');
    link.download = `route_plan_${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("图片已生成并下载");
  }).catch(err => {
    console.error(err);
    showToast("图片生成失败");
  });
}

// 真实通知推送
function subscribePush(segments) {
  if (!('Notification' in window)) {
    showToast("您的浏览器不支持通知功能");
    return;
  }

  // 构建通知内容字符串
  // 格式：从xx出发，123路-》大桥站-〉888路-〉北揽站-》地铁2号线。到达xx目的地
  let msg = `从 ${segments[0].startStation} 出发，`;
  
  segments.forEach((seg, i) => {
    msg += `${seg.lineName}`;
    if (i < segments.length - 1) {
      msg += ` -> ${seg.endStation} (换乘) -> `;
    }
  });
  
  msg += `。到达 ${segments[segments.length-1].endStation}。`;

  Notification.requestPermission().then(permission => {
    if (permission === 'granted') {
      try {
        new Notification('行程方案', {
          body: msg,
          icon: '../data/logos_company.json' // 尝试使用默认图标，实际环境可能需要绝对路径
        });
        showToast("已发送至通知栏");
      } catch (e) {
        // Android Chrome 有时需要 Service Worker 才能发通知，这里做降级提示
        alert("通知内容：\n" + msg); 
      }
    } else {
      showToast("请允许通知权限以接收行程");
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
