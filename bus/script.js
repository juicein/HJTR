/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], groups: {} },
  currentView: 'home',
  // 3. 状态记忆：从 localStorage 读取，默认为 'all'
  selectedCity: localStorage.getItem('bus_pref_city') || 'all',
  selectedType: localStorage.getItem('bus_pref_type') || 'all',
  planner: { start: '', end: '', rule: 'fastest' }
};

/* --- 1. Data Loading --- */
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
    appState.aliases.groups = aliasData.auto_suffix_groups;

    parseLines(txt);
    setupUI();
    
    // 恢复之前的筛选状态
    updateFilterUI();
    renderHome();
  } catch (e) {
    console.error("Init failed:", e);
    showToast("数据加载失败");
  }
}

function parseLines(rawText) {
  const lines = rawText.trim().split(/\n+/);
  appState.lines = lines.map((line, index) => {
    // 增加 θ铁路θ 识别逻辑 (假设文本中可能有, 否则默认为 False)
    const isMetro = line.includes("θ地铁θ");
    const isRail = line.includes("θ铁路θ") || line.includes("θ火车θ");
    
    // 线路类型推断
    let type = 'bus';
    if(isMetro) type = 'metro';
    else if(isRail) type = 'rail';

    const stationPart = line.replace(/^【.*?】/, "").split("-{")[0];
    const rawStations = stationPart.split("-").filter(s => s && s.trim());
    
    // 解析上下行
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
      name: line.match(/【(.*?)】/)?.[1] || "未命名",
      company: line.match(/\{(.*?)\}/)?.[1] || "",
      fare: line.match(/《(.*?)》/)?.[1] || "",
      city: line.match(/『(.*?)』/)?.[1] || "其他",
      startTime: line.match(/§(.*?)§/)?.[1] || "",
      endTime: line.match(/@(.*?)@/)?.[1] || "",
      color: line.match(/∮([0-9A-Fa-f]{6,8})∮/)?.[1],
      isMetro, isRail, type,
      stationsUp, stationsDown
    };
  });
}

/* --- 2. Logic: Aliasing & Graph --- */

// 12. 同源词逻辑：返回 { base: "大桥", suffix: "北" }
function parseStationName(name) {
  let n = name.trim();
  let foundSuffix = null;
  
  // Group 1: 完全等价后缀 (如 "站") -> 直接剔除
  for (const s of appState.aliases.groups.station_type || []) {
    if (n.endsWith(s)) {
      n = n.substring(0, n.length - s.length);
      break;
    }
  }

  // Group 2: 出站换乘后缀 (如 "北") -> 提取后缀
  for (const s of appState.aliases.groups.location_type || []) {
    if (n.endsWith(s)) {
      foundSuffix = s;
      n = n.substring(0, n.length - s.length);
      break;
    }
  }
  
  return { base: n, suffix: foundSuffix, original: name };
}

// 获取规范化ID (用于Dijkstra节点)
function getCanonicalId(name) {
  // 手动映射优先
  for (const group of appState.aliases.manual) {
    if (group.includes(name)) return group[0];
  }
  // 自动处理
  const parsed = parseStationName(name);
  if (parsed.suffix) {
    // 如果有方位词(大桥北)，ID就是 "大桥北" (不合并到大桥，除非有步行边)
    // 这里为了简化图构建，我们暂且把所有变体都视为独立节点，
    // 但是在图构建时，会为同一Base的节点添加步行边。
    return parsed.original;
  }
  return parsed.base; 
}

// 1. 地区防火墙：只构建特定城市的图
function buildGraph(targetCity, rule) {
  const graph = {}; 

  // 1. 添加线路边
  appState.lines.forEach(line => {
    // 过滤城市
    if (line.city !== targetCity) return;
    
    // 过滤类型
    if (rule === 'bus_only' && (line.isMetro || line.isRail)) return;
    if (rule === 'rail_priority') { /* Logic handled in weighting */ }

    addLineEdges(graph, line, line.stationsUp, 'up', rule);
    addLineEdges(graph, line, line.stationsDown, 'down', rule);
  });

  // 2. 添加步行换乘边 (同源不同名的站点)
  // 找出所有出现在该图中的节点
  const nodes = Object.keys(graph);
  const baseMap = {}; // { "大桥": ["大桥北", "大桥南"] }

  nodes.forEach(node => {
    const p = parseStationName(node);
    if (!baseMap[p.base]) baseMap[p.base] = [];
    baseMap[p.base].push(node);
  });

  // 对同一 Base 的节点两两连接
  Object.values(baseMap).forEach(group => {
    if (group.length > 1) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const u = group[i];
          const v = group[j];
          // 添加双向步行边
          addWalkingEdge(graph, u, v);
          addWalkingEdge(graph, v, u);
        }
      }
    }
  });

  return graph;
}

function addLineEdges(graph, line, stations, dir, rule) {
  for (let i = 0; i < stations.length - 1; i++) {
    const from = getCanonicalId(stations[i]);
    const to = getCanonicalId(stations[i+1]);
    
    if (!graph[from]) graph[from] = [];
    
    // 权重计算
    let weight = 1; // 默认一站1分
    if (rule === 'rail_priority') {
      if (line.isMetro || line.isRail) weight = 0.8; // 轨道更优先
      else weight = 1.2;
    }
    
    graph[from].push({
      toNode: to,
      lineName: line.name,
      lineId: line.id,
      lineType: line.type,
      direction: dir,
      isWalk: false,
      weight: weight
    });
  }
}

function addWalkingEdge(graph, from, to) {
  if (!graph[from]) graph[from] = [];
  graph[from].push({
    toNode: to,
    lineName: "步行换乘",
    lineId: "walk",
    lineType: "walk",
    isWalk: true,
    weight: 5 // 步行惩罚较大
  });
}

/* --- Routing Algorithm --- */
function findRoute() {
  const startInput = document.getElementById('plan-start').value;
  const endInput = document.getElementById('plan-end').value;
  
  if(!startInput || !endInput) { showToast("请输入起点和终点"); return; }

  // 确定城市 (根据起点)
  let startCity = null;
  // 简单遍历找到起点所在的城市
  for (const l of appState.lines) {
    if (l.stationsUp.includes(startInput) || l.stationsDown.includes(startInput)) {
      startCity = l.city;
      break;
    }
  }

  if (!startCity) { showToast("未找到起点所在城市，请检查输入"); return; }

  const startNode = getCanonicalId(startInput);
  const endNode = getCanonicalId(endInput);
  const rule = document.getElementById('planner-filters').querySelector('.active').dataset.rule;
  
  // 构建该城市的图
  const graph = buildGraph(startCity, rule);

  // Dijkstra
  const queue = [{ node: startNode, cost: 0, path: [] }];
  const visited = {};
  const results = [];
  
  // 限制搜索
  let maxIterations = 5000; 

  while (queue.length > 0 && maxIterations-- > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    if (current.cost > (visited[current.node] || Infinity)) continue;
    visited[current.node] = current.cost;

    if (current.node === endNode) {
      results.push(current);
      if (results.length >= 3) break; 
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      // 换乘惩罚
      let transferCost = 0;
      const lastStep = current.path[current.path.length - 1];
      
      if (lastStep) {
        if (lastStep.lineId !== edge.lineId) {
          transferCost = 15; // 换乘代价
          if (rule === 'min_transfer') transferCost = 50; // 少换乘模式加大惩罚
        }
      }

      const newCost = current.cost + edge.weight + transferCost;
      
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

/* --- 3. UI Logic --- */

function setupUI() {
  // 2. Top Bar Navigation Logic
  document.getElementById('nav-back').onclick = () => {
    if (appState.currentView === 'home') {
      window.location.href = '../index.html'; // 返回门户
    } else {
      switchView('home');
    }
  };

  document.getElementById('nav-planner').onclick = () => switchView('planner');
  
  // 地区筛选
  const areaBtn = document.getElementById('filter-area-btn');
  const backdrop = document.getElementById('area-menu-backdrop');
  areaBtn.onclick = () => {
     renderAreaMenu();
     document.getElementById('area-menu').classList.toggle('open');
     backdrop.classList.toggle('open');
  };
  backdrop.onclick = () => {
    document.getElementById('area-menu').classList.remove('open');
    backdrop.classList.remove('open');
  };
  
  // 11. Area Search
  document.getElementById('area-search-input').addEventListener('input', (e) => {
    renderAreaMenu(e.target.value);
  });

  // Transport Filters
  document.querySelectorAll('#transport-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      const type = e.currentTarget.dataset.type;
      appState.selectedType = type;
      localStorage.setItem('bus_pref_type', type); // Memory
      updateFilterUI();
      renderHome();
    };
  });

  // Planner
  document.getElementById('btn-start-search').onclick = findRoute;
  document.getElementById('btn-swap-stations').onclick = () => {
    const s = document.getElementById('plan-start');
    const e = document.getElementById('plan-end');
    [s.value, e.value] = [e.value, s.value];
  };

  document.querySelectorAll('#planner-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#planner-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      if(document.getElementById('plan-start').value) findRoute();
    };
  });

  // Detail Toggle
  document.getElementById('btn-dir-up').onclick = () => renderStations('up');
  document.getElementById('btn-dir-down').onclick = () => renderStations('down');
  
  // Modal
  document.getElementById('close-modal').onclick = () => {
    document.getElementById('route-modal').close();
  };
  
  // 7. Share Image
  document.getElementById('btn-share-img').onclick = () => {
    const area = document.getElementById('route-capture-area');
    html2canvas(area).then(canvas => {
      const link = document.createElement('a');
      link.download = '出行方案.png';
      link.href = canvas.toDataURL();
      link.click();
    });
  };

  // 7. Notify
  document.getElementById('btn-notify-route').onclick = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(p => {
        if(p==='granted') new Notification("换乘提醒已设置", { body: "我们将在您接近换乘站时通知您。" });
      });
    }
    showToast("提醒已添加至通知栏");
  };
}

function updateFilterUI() {
  document.querySelectorAll('#transport-filters .chip').forEach(c => {
    c.classList.toggle('active', c.dataset.type === appState.selectedType);
  });
  const areaLabel = appState.selectedCity === 'all' ? '全部' : appState.selectedCity;
  document.getElementById('current-area-label').innerText = areaLabel;
}

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  appState.currentView = viewName;
  
  // Back button logic
  const backBtn = document.getElementById('nav-back');
  // Always show back button, but behavior changes
  backBtn.style.display = 'flex'; 
}

/* --- Render Home --- */
function renderHome() {
  const container = document.getElementById('line-list');
  container.innerHTML = '';
  const search = document.getElementById('line-search').value.toLowerCase();
  
  // 10. Update Datalist for autocomplete
  const allStations = new Set();
  
  const filtered = appState.lines.filter(l => {
    const matchCity = appState.selectedCity === 'all' || l.city === appState.selectedCity;
    const matchType = appState.selectedType === 'all' || 
                      (appState.selectedType === 'metro' && l.isMetro) ||
                      (appState.selectedType === 'rail' && l.isRail) ||
                      (appState.selectedType === 'bus' && !l.isMetro && !l.isRail);
    const matchSearch = l.name.toLowerCase().includes(search);
    
    if (matchCity) {
      l.stationsUp.forEach(s => allStations.add(s));
      l.stationsDown.forEach(s => allStations.add(s));
    }

    return matchCity && matchType && matchSearch;
  });
  
  // Update Datalist
  const datalist = document.getElementById('stations-datalist');
  datalist.innerHTML = '';
  [...allStations].forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    datalist.appendChild(opt);
  });

  filtered.forEach(line => {
    const card = document.createElement('div');
    card.className = 'card';
    const color = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';
    
    let icon = 'directions_bus';
    if(line.isMetro) icon = 'subway';
    if(line.isRail) icon = 'train';

    // 9. No company logo here, only text info
    card.innerHTML = `
      <div class="line-icon-badge" style="background:${color}">
        <span class="material-symbols-rounded">${icon}</span>
      </div>
      <div class="card-content">
        <div class="line-name">${line.name}</div>
        <div class="line-route">
          ${line.city} · ${line.stationsUp[0]} - ${line.stationsUp[line.stationsUp.length-1]}
        </div>
      </div>
    `;
    card.onclick = () => openDetail(line);
    container.appendChild(card);
  });
}

function renderAreaMenu(filter = "") {
  const list = document.getElementById('area-menu-list');
  list.innerHTML = '';
  
  // "All" option
  if("全部地区".includes(filter)) {
    const div = document.createElement('div');
    div.className = 'menu-item';
    div.innerText = "全部地区";
    div.onclick = () => selectCity('all');
    list.appendChild(div);
  }

  const cities = [...new Set(appState.lines.map(l => l.city))];
  cities.filter(c => c.includes(filter)).forEach(c => {
    const logo = appState.logos.area[c];
    const div = document.createElement('div');
    div.className = 'menu-item';
    div.innerHTML = `${logo ? `<img src="${logo}">` : ''} <span>${c}</span>`;
    div.onclick = () => selectCity(c);
    list.appendChild(div);
  });
}

function selectCity(city) {
  appState.selectedCity = city;
  localStorage.setItem('bus_pref_city', city);
  document.getElementById('area-menu-backdrop').click();
  updateFilterUI();
  renderHome();
}

/* --- Detail View --- */
let currentLine = null;
function openDetail(line) {
  currentLine = line;
  switchView('detail');
  
  const header = document.getElementById('detail-header');
  const compLogo = appState.logos.company[line.company];
  const color = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';
  
  // 9. Company Logo in Detail
  header.innerHTML = `
    <div class="dh-row">
      <div>
        <div style="font-size:24px; font-weight:700;">${line.name}</div>
        <div class="company-info">
          ${compLogo ? `<img src="${compLogo}">` : ''}
          ${line.company}
        </div>
      </div>
      <div class="line-icon-badge" style="background:${color}; width:56px; height:56px;">
        <span class="material-symbols-rounded" style="font-size:24px">
          ${line.isMetro ? 'subway' : (line.isRail ? 'train' : 'directions_bus')}
        </span>
      </div>
    </div>
    <div style="font-size:13px; margin-top:12px; display:flex; gap:12px; flex-wrap:wrap;">
      <span>票价: ${line.fare || '未知'}</span>
      <span>首末: ${line.startTime} - ${line.endTime}</span>
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

/* --- Planner Result & Consolidation --- */

// 5. 核心：路线聚合 (防止重复显示)
function consolidatePath(path) {
  const segments = [];
  if (path.length === 0) return segments;

  // Path is array of edges: { toNode, lineName, lineId, isWalk... }
  // We need to group sequential edges with same lineId
  
  let currentSeg = null;

  path.forEach(edge => {
    if (!currentSeg) {
      // First segment
      currentSeg = {
        lineName: edge.lineName,
        lineId: edge.lineId,
        type: edge.lineType,
        isWalk: edge.isWalk,
        from: edge.from,
        to: edge.toNode,
        stops: 1
      };
    } else {
      // Check if continuation
      const sameLine = edge.lineId === currentSeg.lineId;
      // Also ensure it's not a transfer (sometimes same line ID but different direction/split, usually handled by ID)
      
      if (sameLine) {
        currentSeg.to = edge.toNode;
        currentSeg.stops++;
      } else {
        segments.push(currentSeg);
        currentSeg = {
          lineName: edge.lineName,
          lineId: edge.lineId,
          type: edge.lineType,
          isWalk: edge.isWalk,
          from: edge.from,
          to: edge.toNode,
          stops: 1
        };
      }
    }
  });
  
  if (currentSeg) segments.push(currentSeg);
  return segments;
}

function renderPlannerResults(results) {
  const container = document.getElementById('planner-results');
  container.innerHTML = '';
  
  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到相关路线</div>';
    return;
  }

  results.forEach(res => {
    const segments = consolidatePath(res.path);
    
    // Calculate Time (Estimate)
    let totalMins = 0;
    segments.forEach(seg => {
      if(seg.isWalk) totalMins += 5; // Walk transfer
      else if(seg.type === 'metro') totalMins += seg.stops * 2.5;
      else if(seg.type === 'rail') totalMins += seg.stops * 4;
      else totalMins += seg.stops * 3.5; // Bus
    });
    // Add transfer waiting time
    totalMins += (segments.length - 1) * 5;
    totalMins = Math.round(totalMins);

    const card = document.createElement('div');
    card.className = 'plan-result-card';
    card.onclick = () => showRouteModal(segments, totalMins);

    card.innerHTML = `
      <div class="plan-summary">
        <div class="plan-time">${totalMins} 分钟</div>
        <div style="font-weight:500;">步行 ${countWalks(segments)} · 换乘 ${segments.filter(s=>!s.isWalk).length - 1}</div>
      </div>
      <div class="plan-route-overview">
        ${segments.map((seg, i) => {
           if(seg.isWalk) return `<span class="material-symbols-rounded" style="font-size:14px">directions_walk</span>`;
           return `<span>${seg.lineName}</span>${i < segments.length-1 ? '<span class="material-symbols-rounded" style="font-size:12px">arrow_right</span>' : ''}`;
        }).join('')}
      </div>
    `;
    container.appendChild(card);
  });
}

function countWalks(segs) {
  return segs.filter(s => s.isWalk).length;
}

/* --- 7. Modal Rendering --- */
function showRouteModal(segments, totalMins) {
  const modal = document.getElementById('route-modal');
  const summary = document.getElementById('modal-route-summary');
  const steps = document.getElementById('modal-route-steps');
  
  summary.innerHTML = `<div class="plan-time">${totalMins} 分钟</div><div>${segments[0].from} <span class="material-symbols-rounded" style="vertical-align:middle; font-size:16px;">arrow_forward</span> ${segments[segments.length-1].to}</div>`;
  
  steps.innerHTML = segments.map(seg => {
    let iconClass = 'bus';
    let iconName = 'directions_bus';
    if(seg.type === 'metro') { iconClass = 'bus'; iconName = 'subway'; } // color shared or separate
    if(seg.type === 'rail') { iconClass = 'rail'; iconName = 'train'; }
    if(seg.isWalk) { iconClass = 'walk'; iconName = 'directions_walk'; }
    
    const colorStyle = seg.type === 'rail' ? 'color:var(--rail-color)' : (seg.isWalk ? 'color:gray' : 'color:var(--md-sys-color-primary)');

    if (seg.isWalk) {
      return `
        <div class="step-card walk">
          <div class="step-header" style="color:gray">
             <span class="material-symbols-rounded">${iconName}</span> 站内/出站换乘
          </div>
          <div class="step-desc">
             从 ${seg.from} 步行至 ${seg.to}
          </div>
        </div>
      `;
    }

    return `
      <div class="step-card ${iconClass}">
        <div class="step-header" style="${colorStyle}">
           <span class="material-symbols-rounded">${iconName}</span> ${seg.lineName}
        </div>
        <div class="step-desc">
           <strong>${seg.from}</strong> 上车 <br>
           <span style="font-size:12px; opacity:0.6">经过 ${seg.stops} 站</span> <br>
           <strong>${seg.to}</strong> 下车
        </div>
      </div>
    `;
  }).join('');
  
  modal.showModal();
}

// Start
init();
