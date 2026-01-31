/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffix: [] },
  currentView: 'home',
  // 3. 状态记忆：初始化时尝试从 localStorage 读取
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
    appState.aliases.manual = aliasData.manual_equivalents;
    appState.aliases.suffix = aliasData.auto_suffix_remove;

    parseLines(txt);
    setupUI();
    
    // 初始化 Datalist (10. 改为系统原生联想)
    populateStationDatalist();

    // 恢复之前的筛选状态
    applyFilters();
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
    // 8. 增加铁路识别 (假设含有"铁路"或"城际"字样，或者根据数据特征，此处做简单的扩展)
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
      // Metadata for filters
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
  // 按名称排序，方便查找
  [...allStations].sort().forEach(s => {
    const option = document.createElement('option');
    option.value = s;
    datalist.appendChild(option);
  });
}

/* --- 2. Logic: Aliasing & Routing --- */

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

// 1. 同地区限制 & 5. 路线合并预处理
function buildGraph(rule, startCity) {
  const graph = {}; 

  appState.lines.forEach(line => {
    // 1. 严格限制只能规划同地区的线路
    if (startCity && line.city !== startCity) return;

    if (rule === 'bus_only' && (line.isMetro || line.isRail)) return;
    
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
    
    // 边的权重计算
    // 普通公交每站权重为1，地铁为0.8(更快)，换乘将在路径查找时单独计算惩罚
    let weight = 1;
    if (line.isMetro) weight = 0.8;
    if (line.isRail) weight = 0.5;

    graph[from].push({
      toNode: to,
      lineName: line.name,
      lineId: line.id, // 用ID来判断是否是同一条线
      direction: dir,
      rawWeight: weight,
      type: line.type,
      // 存储完整信息以便后续合并
      fare: line.fare,
      intervals: line.startTime + '~' + line.endTime,
      fullLine: line 
    });
  }
}

function findRoute() {
  const startInput = document.getElementById('plan-start').value;
  const endInput = document.getElementById('plan-end').value;
  
  if (!startInput || !endInput) return;

  const startId = getCanonicalStationId(startInput);
  const endId = getCanonicalStationId(endInput);

  // 1. 获取起点所在城市，用于锁定地区
  const startLine = appState.lines.find(l => 
    l.stationsUp.some(s => getCanonicalStationId(s) === startId) || 
    l.stationsDown.some(s => getCanonicalStationId(s) === startId)
  );
  const regionLock = startLine ? startLine.city : null; 
  // 如果找不到起点的城市（比如输入了不存在的站点），则默认不锁，或者提示错误
  
  const rule = document.getElementById('planner-filters').querySelector('.active').dataset.rule;
  const graph = buildGraph(rule, regionLock);

  // Dijkstra
  // Queue Item: { node, cost, path: [] }
  const queue = [{ node: startId, cost: 0, path: [] }];
  const visited = {}; 
  const results = [];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    if (current.cost > (visited[current.node] || Infinity)) continue;
    visited[current.node] = current.cost;

    if (current.node === endId) {
      results.push(current);
      if (results.length >= 5) break; 
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      let stepCost = edge.rawWeight;
      let isTransfer = false;
      
      const lastStep = current.path[current.path.length - 1];
      
      // 5. 核心：如果上一条线路ID与当前不同，则是换乘
      if (lastStep && lastStep.lineId !== edge.lineId) {
        stepCost += 15; // 换乘惩罚加大，倾向于少换乘
        isTransfer = true;
      } else {
        // 同一条线，成本很低
        stepCost = edge.rawWeight;
      }
      
      if (rule === 'min_transfer' && isTransfer) stepCost += 50; 

      const newCost = current.cost + stepCost;
      
      // 构建Path时记录原始站点名称，用于展示
      const newPath = [...current.path, { 
        ...edge, 
        fromName: current.node, // 注意：这里是规范化后的ID，展示时可能需要反查原始名，或者直接用
        toName: edge.toNode
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

  // 处理结果，合并同类项
  const formattedResults = results.map(res => compressPath(res.path));
  renderPlannerResults(formattedResults);
}

// 5. 合并路径逻辑：将连续的同一线路合并为一个Segment
function compressPath(rawPath) {
  if (rawPath.length === 0) return [];

  const segments = [];
  let currentSeg = null;

  rawPath.forEach(step => {
    if (!currentSeg) {
      // 初始化第一段
      currentSeg = {
        lineName: step.lineName,
        lineId: step.lineId,
        type: step.type,
        startStation: step.fromName,
        endStation: step.toNode,
        stopCount: 1,
        direction: step.direction,
        meta: step.fullLine // 保存线路元数据用于详情展示
      };
    } else if (step.lineId === currentSeg.lineId && step.direction === currentSeg.direction) {
      // 5. 同线路、同方向：合并
      currentSeg.endStation = step.toNode;
      currentSeg.stopCount++;
    } else {
      // 换乘：推入上一段，开始新一段
      segments.push(currentSeg);
      currentSeg = {
        lineName: step.lineName,
        lineId: step.lineId,
        type: step.type,
        startStation: step.fromName,
        endStation: step.toNode,
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
  // Navigation
  // 2. 返回按钮逻辑：返回到我的门户网页 (history.back 或指定 URL)
  document.getElementById('nav-back').onclick = () => {
    // 假设这是子页面，返回上一级
    window.history.back(); 
    // 或者 window.location.href = 'portal.html';
  };
  
  document.getElementById('nav-planner').onclick = () => switchView('planner');
  
  // Filters
  document.querySelectorAll('#transport-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#transport-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      appState.selectedType = e.currentTarget.dataset.type;
      // 3. 记忆选择
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
     // 聚焦搜索框
     setTimeout(() => document.getElementById('area-search-input').focus(), 100);
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
  
  // 10. 移除旧的联想逻辑，使用原生 datalist，只需处理 Swap
  document.getElementById('btn-swap-stations').onclick = () => {
    const s = document.getElementById('plan-start');
    const e = document.getElementById('plan-end');
    [s.value, e.value] = [e.value, s.value];
    findRoute();
  };

  // Close Route Modal
  document.getElementById('modal-close').onclick = closeRouteModal;
  document.getElementById('modal-backdrop').onclick = closeRouteModal;
}

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  
  const title = document.getElementById('page-title');
  const plannerBtn = document.getElementById('nav-planner');
  
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
  // 应用记忆的过滤器状态
  const typeChip = document.querySelector(`#transport-filters .chip[data-type="${appState.selectedType}"]`);
  if(typeChip) {
    document.querySelectorAll('#transport-filters .chip').forEach(c => c.classList.remove('active'));
    typeChip.classList.add('active');
  }
  // 城市筛选在 renderHome 内部处理，但需要更新 UI 状态（如果需要）
  renderHome();
}

/* --- Render Home --- */
function renderHome() {
  const container = document.getElementById('line-list');
  container.innerHTML = '';
  
  const search = document.getElementById('line-search').value.toLowerCase();
  
  const filtered = appState.lines.filter(l => {
    const matchCity = appState.selectedCity === 'all' || l.city === appState.selectedCity;
    const matchType = appState.selectedType === 'all' || 
                      (appState.selectedType === 'metro' && l.isMetro) ||
                      (appState.selectedType === 'rail' && l.isRail) || // 8. 铁路筛选
                      (appState.selectedType === 'bus' && !l.isMetro && !l.isRail);
    const matchSearch = l.name.toLowerCase().includes(search) || l.stationsUp.join('').includes(search);
    return matchCity && matchType && matchSearch;
  });

  filtered.forEach(line => {
    const card = document.createElement('div');
    card.className = 'card';
    const color = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';
    
    // Icon Logic
    let icon = 'directions_bus';
    if(line.isMetro) icon = 'subway';
    if(line.isRail) icon = 'train';
    
    // 4. 将 始发-终点 挪到 line-name 下方作为 subtitle
    // 9. 移除 card 中的公司 Logo
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

/* --- Area Menu with Search --- */
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

  // Initial render
  renderItems('');

  // 11. 搜索功能绑定
  searchInput.oninput = (e) => renderItems(e.target.value.trim());
}

function selectCity(city) {
  appState.selectedCity = city;
  // 3. 记忆选择
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

  // 9. 详细页面显示公司 Logo
  header.innerHTML = `
    <div class="dh-top">
      <div class="line-icon-badge large" style="background:${badgeColor}">
        ${line.name}
      </div>
      <div>
        <div class="dh-title-row">
          <div class="dh-name">${line.name}</div>
          ${compLogo ? `<img src="${compLogo}" class="company-logo-detail" alt="${line.company}">` : `<span class="company-text">${line.company}</span>`}
        </div>
        <div class="dh-sub">${line.city}</div>
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

/* --- Planner Results --- */

function renderPlannerResults(segmentsList) {
  const container = document.getElementById('planner-results');
  container.innerHTML = '';
  
  if (segmentsList.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <span class="material-symbols-rounded" style="font-size:48px; color:var(--md-sys-color-outline)">alt_route</span>
      <p>未找到合适方案，请尝试更换筛选条件或同地区查询</p>
    </div>`;
    return;
  }

  segmentsList.forEach((segments, index) => {
    const card = document.createElement('div');
    card.className = 'plan-result-card';
    
    // 计算总时间：累计每段的耗时 + 换乘次数 * 5分钟
    const totalStops = segments.reduce((sum, seg) => sum + seg.stopCount, 0);
    const transfers = segments.length - 1;
    let totalTime = 0;
    segments.forEach(seg => {
      const perStop = seg.type === 'metro' ? 2.5 : (seg.type === 'rail' ? 5 : 3.5);
      totalTime += Math.ceil(seg.stopCount * perStop);
    });
    totalTime += transfers * 8; // 换乘时间

    // 构建摘要视图 (例如: 22路 > 39路)
    const routeSummary = segments.map((seg, i) => `
      <div class="route-step-pill">
        <span class="step-icon material-symbols-rounded">
          ${seg.type==='metro'?'subway':(seg.type==='rail'?'train':'directions_bus')}
        </span>
        <span class="step-name">${seg.lineName}</span>
      </div>
      ${i < segments.length - 1 ? '<span class="material-symbols-rounded step-arrow">arrow_forward</span>' : ''}
    `).join('');

    card.innerHTML = `
      <div class="plan-header">
        <div class="plan-time-big">${totalTime} <span style="font-size:14px; font-weight:normal">分钟</span></div>
        <div class="plan-meta">${totalStops}站 · 换乘 ${transfers} 次</div>
      </div>
      <div class="plan-route-visual">
        ${routeSummary}
      </div>
      <div class="plan-desc">
        从 ${segments[0].startStation} 出发
      </div>
    `;
    
    // 7. 点击卡片，显示详细模态窗
    card.onclick = () => openRouteModal(segments, totalTime);
    
    container.appendChild(card);
  });
}

/* --- 7. Route Detail Modal (Bottom Sheet) --- */
function openRouteModal(segments, time) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('route-modal');
  const content = document.getElementById('modal-content-body');
  
  // 渲染详细步骤 (参考用户提供的 UI)
  let html = `
    <div class="modal-summary">
       <div class="ms-time">${time}分钟</div>
       <div class="ms-meta">共 ${segments.reduce((a,b)=>a+b.stopCount,0)} 站 · 步行少</div>
    </div>
  `;
  
  segments.forEach((seg, idx) => {
    const isLast = idx === segments.length - 1;
    const color = seg.meta.color ? `#${seg.meta.color.slice(0,6)}` : '#006495';
    
    html += `
      <div class="step-card">
        <div class="step-left-line" style="background:${color}"></div>
        <div class="step-icon-box" style="background:${color}">
             <span class="material-symbols-rounded" style="color:white; font-size:16px;">
               ${seg.type==='metro'?'subway':(seg.type==='rail'?'train':'directions_bus')}
             </span>
        </div>
        
        <div class="step-content">
          <div class="step-title-row">
            <span class="step-line-name" style="color:${color}">${seg.lineName}</span>
            <span class="step-dir">开往 ${seg.direction==='up'?seg.meta.stationsUp[seg.meta.stationsUp.length-1]:seg.meta.stationsDown[seg.meta.stationsDown.length-1]}</span>
          </div>
          
          <div class="step-detail-row">
            从 <strong>${seg.startStation}</strong> 到 <strong>${seg.endStation}</strong>
          </div>
          
          <div class="step-sub-info">
            坐 ${seg.stopCount} 站 · ${seg.meta.fare || '按段收费'}
            <br>
            <span style="opacity:0.7">首 ${seg.meta.startTime} 末 ${seg.meta.endTime}</span>
          </div>
        </div>
      </div>
    `;
    
    if (!isLast) {
      html += `
        <div class="transfer-gap">
           <span class="material-symbols-rounded">transfer_within_a_station</span>
           <span>站内换乘 / 步行</span>
        </div>
      `;
    }
  });

  // 7. 增加分享和通知按钮
  html += `
    <div class="modal-actions">
      <button class="action-btn tonal" onclick="shareRouteImage()">
        <span class="material-symbols-rounded">share</span> 分享图片
      </button>
      <button class="action-btn primary" onclick="subscribePush('换乘提醒')">
        <span class="material-symbols-rounded">notifications_active</span> 开启换乘提醒
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

function shareRouteImage() {
  // 实际项目中可使用 html2canvas
  showToast("正在生成图片... (模拟)");
}

function subscribePush(msg) {
  if ('Notification' in window) {
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
         new Notification('提醒设置成功', { body: '将在您接近换乘站时发送通知' });
         showToast("已开启换乘提醒");
      } else {
        showToast("请允许通知权限");
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
