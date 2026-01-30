/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffix: [] },
  currentView: 'home',
  // 从 LocalStorage 读取默认值
  selectedCity: localStorage.getItem('bus_city') || 'all', 
  selectedType: localStorage.getItem('bus_type') || 'all',
  planner: { start: '', end: '', rule: 'fastest' }
};

/* --- 1. Init & Parsing --- */
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
    restoreFilters(); // 恢复上次选择的UI状态
    renderHome();
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
    const color = line.match(/∮([0-9A-Fa-f]{6,8})∮/)?.[1];
    
    // 类型识别：地铁、铁路、公交
    const isMetro = line.includes("θ地铁θ");
    // 简单判断铁路：名字含铁路/城际 或 特殊标记 (如有)
    const isRail = line.includes("θ铁路θ") || name.includes("城际") || name.includes("铁路");
    const type = isMetro ? 'metro' : (isRail ? 'rail' : 'bus');

    // 解析站点
    const stationPart = line.replace(/^【.*?】/, "").split("-{")[0];
    const rawStations = stationPart.split("-").filter(s => s && s.trim());
    
    const stationsUp = [];
    rawStations.forEach(s => {
      if (!s.includes("↓")) stationsUp.push(s.replace(/[↑↓]/g, ""));
    });

    const stationsDown = [];
    [...rawStations].reverse().forEach(s => {
      if (!s.includes("↑")) stationsDown.push(s.replace(/[↑↓]/g, ""));
    });

    return {
      id: index,
      name, company, fare, city, startTime, endTime, color, type,
      stationsUp, stationsDown
    };
  });
}

/* --- 2. Routing Logic (Graph & Dijkstra) --- */

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

// 核心：构建图时，只加入与起点同城市的线路
function buildGraph(filterRule, targetCity) {
  const graph = {}; 
  appState.lines.forEach(line => {
    // 规则1：类型过滤 (仅公交等)
    if (filterRule === 'bus_only' && line.type === 'metro') return;
    
    // 规则2：同城锁死 (除非选了All，但要求是“同城规划”，这里我们根据起点城市过滤)
    if (targetCity && line.city !== targetCity) return;

    // 添加边
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
    graph[from].push({
      toNode: to,
      lineName: line.name,
      lineId: line.id,
      type: line.type,
      // 存储原始站点名称用于展示
      rawFrom: stations[i],
      rawTo: stations[i+1],
      lineInfo: line
    });
  }
}

function findRoute() {
  const rawStart = document.getElementById('plan-start').value;
  const rawEnd = document.getElementById('plan-end').value;
  const start = getCanonicalStationId(rawStart);
  const end = getCanonicalStationId(rawEnd);
  
  if (!start || !end) return;

  // 1. 确定起点所在的城市 (用于锁死区域)
  // 遍历所有线路，找到包含起点的线路，取其城市
  // 如果起点是“大桥”，可能多个城市都有，优先取当前选定区域，如果选定All，则取第一个匹配的。
  let originCity = null;
  if (appState.selectedCity !== 'all') {
    originCity = appState.selectedCity;
  } else {
    const matchLine = appState.lines.find(l => 
      l.stationsUp.map(getCanonicalStationId).includes(start) || 
      l.stationsDown.map(getCanonicalStationId).includes(start)
    );
    if (matchLine) originCity = matchLine.city;
  }

  const rule = document.getElementById('planner-filters').querySelector('.active').dataset.rule;
  const graph = buildGraph(rule, originCity);

  // Dijkstra
  const queue = [{ node: start, cost: 0, path: [] }];
  const visited = {};
  const results = [];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();

    // 简单剪枝
    if (current.cost > (visited[current.node] || Infinity)) continue;
    visited[current.node] = current.cost;

    if (current.node === end) {
      results.push(current);
      if (results.length >= 3) break; 
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      let stepCost = 1;
      let isTransfer = false;
      
      const lastStep = current.path[current.path.length - 1];
      
      // 核心去重/合并逻辑：如果还是同一条线，成本极低
      if (lastStep && lastStep.lineId === edge.lineId) {
        stepCost = 1; // 继续坐
      } else {
        stepCost = 15; // 换乘惩罚
        isTransfer = true;
      }
      
      if (rule === 'min_transfer') stepCost = isTransfer ? 100 : 1;

      const newCost = current.cost + stepCost;
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
  // Filters Persistence
  document.querySelectorAll('#transport-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#transport-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      appState.selectedType = e.currentTarget.dataset.type;
      localStorage.setItem('bus_type', appState.selectedType);
      renderHome();
    };
  });

  // Area Selection Persistence
  const areaBtn = document.getElementById('filter-area-btn');
  areaBtn.onclick = () => {
     renderAreaMenu();
     document.getElementById('area-menu').classList.toggle('open');
     document.getElementById('area-menu-backdrop').classList.toggle('open');
  };
  
  // Navigation
  document.getElementById('nav-back').onclick = () => switchView('home');
  document.getElementById('nav-planner').onclick = () => switchView('planner');
  document.getElementById('area-menu-backdrop').onclick = () => {
    document.getElementById('area-menu').classList.remove('open');
    document.getElementById('area-menu-backdrop').classList.remove('open');
  };

  // Search & Detail
  document.getElementById('line-search').addEventListener('input', renderHome);
  document.getElementById('btn-dir-up').onclick = () => renderStations('up');
  document.getElementById('btn-dir-down').onclick = () => renderStations('down');

  // Planner Inputs
  document.querySelectorAll('#planner-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#planner-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      findRoute();
    };
  });
  bindAutocomplete('plan-start');
  bindAutocomplete('plan-end');
  document.getElementById('btn-swap-stations').onclick = () => {
    const s = document.getElementById('plan-start');
    const e = document.getElementById('plan-end');
    [s.value, e.value] = [e.value, s.value];
    findRoute();
  };

  // Modal
  document.getElementById('close-modal').onclick = closeModal;
  document.getElementById('close-modal-btn').onclick = closeModal;
  document.getElementById('route-modal-backdrop').onclick = (e) => {
    if(e.target.id === 'route-modal-backdrop') closeModal();
  }
}

function restoreFilters() {
  // Restore Chips
  document.querySelectorAll('#transport-filters .chip').forEach(c => {
    if (c.dataset.type === appState.selectedType) c.classList.add('active');
    else c.classList.remove('active');
  });
  // Area is handled in renderHome filtering
}

function selectCity(city) {
  appState.selectedCity = city;
  localStorage.setItem('bus_city', city);
  document.getElementById('area-menu').classList.remove('open');
  document.getElementById('area-menu-backdrop').classList.remove('open');
  renderHome();
}

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  
  const backBtn = document.getElementById('nav-back');
  const title = document.getElementById('page-title');
  const navPlanner = document.getElementById('nav-planner');
  
  if (viewName === 'home') {
    backBtn.style.display = 'none';
    navPlanner.style.display = 'flex';
    title.innerText = '公交 / 地铁';
  } else {
    backBtn.style.display = 'flex';
    navPlanner.style.display = 'none'; // 详情页和规划页隐藏入口
    title.innerText = viewName === 'detail' ? '线路详情' : '出行规划';
  }
  appState.currentView = viewName;
}

/* --- Render Home --- */
function renderHome() {
  const container = document.getElementById('line-list');
  container.innerHTML = '';
  
  const search = document.getElementById('line-search').value.toLowerCase();
  
  const filtered = appState.lines.filter(l => {
    const matchCity = appState.selectedCity === 'all' || l.city === appState.selectedCity;
    const matchType = appState.selectedType === 'all' || 
                      (appState.selectedType === 'metro' && l.type === 'metro') ||
                      (appState.selectedType === 'bus' && l.type === 'bus') ||
                      (appState.selectedType === 'rail' && l.type === 'rail');
    const matchSearch = l.name.toLowerCase().includes(search);
    return matchCity && matchType && matchSearch;
  });

  filtered.forEach(line => {
    const card = document.createElement('div');
    card.className = 'card';
    const color = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';
    
    let icon = 'directions_bus';
    if(line.type === 'metro') icon = 'subway';
    if(line.type === 'rail') icon = 'train';
    
    // 公司 Logo 不在列表显示，地区 Logo 也不显示（因为有筛选）
    // 布局：Icon + (Title \n Start-End)
    card.innerHTML = `
      <div class="line-icon-badge" style="background:${color}">
        <span class="material-symbols-rounded">${icon}</span>
      </div>
      <div class="card-content">
        <div class="line-name">${line.name}</div>
        <div class="line-route">
          ${line.stationsUp[0]} - ${line.stationsUp[line.stationsUp.length-1]}
        </div>
      </div>
    `;
    card.onclick = () => openDetail(line);
    container.appendChild(card);
  });
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
      <div class="line-icon-badge" style="background:${badgeColor}; width:56px; height:56px;">
        ${line.name}
      </div>
      <div>
        <div style="font-size:20px; font-weight:bold;">
          ${line.name} 
          ${compLogo ? `<img src="${compLogo}" class="company-logo" alt="${line.company}">` : ''}
        </div>
        <div style="font-size:14px; opacity:0.8; margin-top:4px;">${line.company} · ${line.city}</div>
      </div>
    </div>
    <div style="font-size:13px; opacity:0.9; line-height:1.6;">
       ${line.fare ? `<div><span class="material-symbols-rounded" style="font-size:14px; vertical-align:middle;">payments</span> ${line.fare}</div>` : ''}
       <div><span class="material-symbols-rounded" style="font-size:14px; vertical-align:middle;">schedule</span> ${line.startTime} - ${line.endTime}</div>
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
    div.onclick = () => {
       if(!document.getElementById('plan-start').value) {
         document.getElementById('plan-start').value = s;
         showToast("已设为起点");
         switchView('planner');
       } else {
         document.getElementById('plan-end').value = s;
         showToast("已设为终点");
         switchView('planner');
         findRoute();
       }
    };
    list.appendChild(div);
  });
}

/* --- Planner Results --- */
function renderPlannerResults(results) {
  const container = document.getElementById('planner-results');
  container.innerHTML = '';
  
  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state">未找到方案 (请检查是否跨地区或无路可达)</div>';
    return;
  }

  results.forEach(res => {
    // 关键逻辑：合并同一条线路的连续站点
    const segments = [];
    let currentSeg = null;

    res.path.forEach(step => {
      // 如果当前没有段，或者线路ID变了，创建新段
      if (!currentSeg || currentSeg.lineId !== step.lineId) {
        if(currentSeg) segments.push(currentSeg);
        currentSeg = { 
          line: step.lineName, 
          lineInfo: step.lineInfo,
          from: step.from, 
          rawFrom: step.rawFrom, // 保留原始站名
          to: step.toNode,
          count: 1, 
          type: step.type 
        };
      } else {
        // 同一条线，只更新终点和站数
        currentSeg.to = step.toNode;
        currentSeg.rawTo = step.rawTo; // 更新原始终点站名
        currentSeg.count++;
      }
    });
    if(currentSeg) segments.push(currentSeg);

    // 渲染卡片
    const card = document.createElement('div');
    card.className = 'plan-result-card';
    
    // 估时：地铁2分/站，公交3分/站，换乘5分
    const timeEst = segments.reduce((acc, seg) => acc + (seg.count * (seg.type==='metro'?2:3)), 0) + (segments.length - 1) * 8;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <span style="font-size:20px; font-weight:bold;">${timeEst} 分钟</span>
        <span style="font-size:14px; color:gray">共${segments.reduce((a,b)=>a+b.count,0)}站</span>
      </div>
      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px; font-size:14px;">
        ${segments.map((seg, idx) => `
          <span style="font-weight:600; color:${seg.type==='metro'?'#006495':'#333'}">${seg.line}</span>
          ${idx < segments.length-1 ? '<span class="material-symbols-rounded" style="font-size:16px; color:#aaa;">arrow_right</span>' : ''}
        `).join('')}
      </div>
    `;
    
    // 点击弹出详情Modal
    card.onclick = () => openRouteModal(segments, timeEst);
    container.appendChild(card);
  });
}

/* --- 4. Modal Logic (模仿截图) --- */
function openRouteModal(segments, totalTime) {
  const modal = document.getElementById('route-modal-backdrop');
  const content = document.getElementById('route-detail-content');
  modal.style.display = 'flex'; // Flex to align bottom
  
  let html = '';
  segments.forEach((seg, idx) => {
    // 获取颜色
    const color = seg.lineInfo.color ? `#${seg.lineInfo.color.slice(0,6)}` : '#006495';
    const icon = seg.type === 'metro' ? 'subway' : (seg.type === 'rail'?'train':'directions_bus');
    
    html += `
      <div class="route-step">
        <div class="step-line" style="background:${color}; opacity:0.3;"></div>
        <div class="step-icon">
           <span class="material-symbols-rounded" style="color:${color}">${icon}</span>
        </div>
        <div class="step-info">
          <div class="step-header" style="color:${color}">${seg.line}</div>
          <div class="step-desc">
            从 <b>${getOriginalName(seg.from)}</b><br>
            坐 ${seg.count} 站<br>
            到 <b>${getOriginalName(seg.to)}</b>
          </div>
          ${seg.lineInfo.fare ? `<div class="step-meta">票价: ${seg.lineInfo.fare}</div>` : ''}
        </div>
      </div>
    `;
  });
  
  content.innerHTML = html;
}

function closeModal() {
  document.getElementById('route-modal-backdrop').style.display = 'none';
}

function getOriginalName(canonicalId) {
  // 简单反查，实际应用中最好在Path里存RawName，这里简化处理
  // Path中已经存储了 rawFrom，这里为了演示直接返回 ID (通常 ID 就是名字去掉后缀)
  // 为了更好的体验，我们在 segment 构造时已经尝试保留 rawFrom/rawTo，
  // 但因为 Graph 节点是 canonical 的，这里最好再做一次别名库匹配或直接显示 ID
  return canonicalId; 
}

/* --- Helpers --- */
function renderAreaMenu() {
  const menu = document.getElementById('area-menu');
  menu.innerHTML = `<div class="menu-item" onclick="selectCity('all')"><span>全部地区</span></div>`;
  const cities = [...new Set(appState.lines.map(l => l.city))];
  cities.forEach(c => {
    const logo = appState.logos.area[c] || '';
    menu.innerHTML += `
      <div class="menu-item" onclick="selectCity('${c}')">
        ${logo ? `<img src="${logo}">` : ''}
        <span>${c}</span>
        ${appState.selectedCity === c ? '<span class="material-symbols-rounded" style="margin-left:auto;">check</span>' : ''}
      </div>
    `;
  });
}

function bindAutocomplete(id) {
  const input = document.getElementById(id);
  const box = document.getElementById('suggestion-box');
  input.addEventListener('input', () => {
    const val = input.value.trim();
    if(val.length < 1) { box.classList.add('hidden'); return; }
    
    const allSt = new Set();
    appState.lines.forEach(l => {
      // 联想搜索也受限于城市选择吗？为了方便，建议搜索全部，但规划时报错
      // 或者这里只搜当前城市
      if(appState.selectedCity !== 'all' && l.city !== appState.selectedCity) return;
      
      l.stationsUp.forEach(s => allSt.add(s));
    });
    
    const matches = [...allSt].filter(s => s.includes(val)).slice(0, 5);
    box.innerHTML = '';
    if(matches.length > 0) box.classList.remove('hidden');
    else box.classList.add('hidden');

    matches.forEach(m => {
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      div.innerText = m;
      div.onclick = () => {
        input.value = m;
        box.classList.add('hidden');
        findRoute(); // 自动触发搜索
      };
      box.appendChild(div);
    });
  });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

init();
