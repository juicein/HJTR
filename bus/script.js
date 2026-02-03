/* State Management */
const appState = {
  lines: [],
  logos: { area: {}, company: {} },
  aliases: { manual: [], suffixGroups: [] },
  currentView: 'home',
  selectedCity: localStorage.getItem('bus_selected_city') || 'all',
  selectedType: localStorage.getItem('bus_selected_type') || 'all', 
  planner: { start: '', end: '', rule: 'all' }
};

/* --- 1. Data Loading & Initialization --- */
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
    
    // 3. URL Routing Logic
    handleUrlRouting();

  } catch (e) {
    console.error("Initialization failed:", e);
    showToast("数据加载失败");
  }
}

// URL 路由处理
function handleUrlRouting() {
  const urlParams = new URLSearchParams(window.location.search);
  const path = window.location.pathname;

  // 匹配 /bus/planning?=startStation
  if (path.includes('/planning') || urlParams.has('planning')) {
    // 兼容 ?planning=站点名 或 /planning?start=站点名
    const startStation = urlParams.get('start') || urlParams.get('planning');
    if (startStation) {
      document.getElementById('plan-start').value = decodeURIComponent(startStation);
      switchView('planner');
      // 如果同时有 end 参数，自动搜索
      if (urlParams.has('end')) {
        document.getElementById('plan-end').value = decodeURIComponent(urlParams.get('end'));
        findRoute();
      }
    }
  } 
  // 匹配 /bus/search?=LineName
  else if (path.includes('/search') || urlParams.has('search')) {
    const query = urlParams.get('q') || urlParams.get('search');
    if (query) {
      const decodedQuery = decodeURIComponent(query);
      document.getElementById('line-search').value = decodedQuery;
      
      // 检查是否精确匹配某条线路，如果是直接打开详情
      const exactMatch = appState.lines.find(l => l.name === decodedQuery);
      if (exactMatch) {
        openDetail(exactMatch);
      } else {
        renderHome();
      }
    }
  }
}

// 8. 解析逻辑更新：支持单轨、胶轮、BRT
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

    // 类型判断
    const isMonorail = line.includes("θ单轨θ");
    const isRubber = line.includes("θ胶轮θ");
    const isMetroBasic = line.includes("θ地铁θ");
    const isRail = line.includes("θ铁路θ") || name.includes("城际") || name.includes("高铁"); 
    const isBRT = line.includes("θBRTθ");
    
    // 归类: 单轨/胶轮 -> Metro, BRT -> Bus
    const isMetro = isMetroBasic || isMonorail || isRubber;
    
    // 子类型用于图标显示
    let subType = 'bus'; // default
    if (isRail) subType = 'rail';
    else if (isMonorail) subType = 'monorail';
    else if (isRubber) subType = 'rubber';
    else if (isMetro) subType = 'metro';
    else if (isBRT) subType = 'brt';

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
      isMetro, isRail, isMonorail, isRubber, isBRT,
      color, stationsUp, stationsDown,
      type: isMetro ? 'metro' : (isRail ? 'rail' : 'bus'),
      subType // 'metro', 'monorail', 'rubber', 'rail', 'brt', 'bus'
    };
  });
}

function getIconForSubType(subType) {
  switch (subType) {
    case 'monorail': return 'monorail'; // Material Symbol "monorail"
    case 'rubber': return 'subway'; // 胶轮通常也是地铁样式
    case 'metro': return 'subway';
    case 'rail': return 'train';
    case 'brt': return 'directions_bus_filled'; // BRT用实心
    default: return 'directions_bus';
  }
}

// 2. 运营时间判断逻辑
function isLineOperating(line) {
  if (!line.startTime || !line.endTime) return true; // 无数据视为运营

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const parseTime = (tStr) => {
    const [h, m] = tStr.split(/[:：]/).map(Number);
    return h * 60 + m;
  };

  const start = parseTime(line.startTime);
  let end = parseTime(line.endTime);

  // 处理跨夜 (例如 23:00 - 01:00)
  if (end < start) end += 24 * 60; 
  
  // 处理当前时间跨夜 (比如现在是 00:30，运营到 01:00)
  let checkTime = currentMinutes;
  if (checkTime < start && (checkTime + 24 * 60) <= end) {
      checkTime += 24 * 60;
  }

  return checkTime >= start && checkTime <= end;
}

/* ... (populateStationDatalist, getCanonicalStationId, getTransferType 保持不变) ... */
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

function getTransferType(rawNameA, rawNameB) {
  if (rawNameA === rawNameB) return 'same_station';
  return 'walking';
}

/* --- Routing Logic Updates --- */

function buildGraph(rule, startCity) {
  const graph = {}; 
  appState.lines.forEach(line => {
    if (startCity && line.city !== startCity) return;
    if (rule === 'bus_only' && (line.isMetro || line.isRail)) return;
    
    // 权重计算 (基础权重为时间，单位：分钟)
    // 假设：地铁/单轨 2.5分/站, 铁路 5分/站, 公交 3.5分/站
    let timeWeight = 3.5; 
    if (line.isMetro) timeWeight = 2.5; 
    if (line.isRail) timeWeight = 5.0; // 站间距大
    if (line.isBRT) timeWeight = 3.0;

    // 针对 "轨道优先" 的策略调整：减少轨道的感知成本
    let algoWeight = timeWeight;
    if (rule === 'rail_priority') {
      if (line.isMetro || line.isRail) algoWeight *= 0.5; // 倾向选择
      else algoWeight *= 1.5; // 惩罚公交
    }

    addLineEdges(graph, line, line.stationsUp, 'up', algoWeight, timeWeight);
    addLineEdges(graph, line, line.stationsDown, 'down', algoWeight, timeWeight);
  });
  return graph;
}

function addLineEdges(graph, line, stations, dir, algoWeight, realTimeWeight) {
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
      weight: algoWeight,       // 用于 Dijkstra 排序
      timeCost: realTimeWeight, // 用于显示真实时间
      type: line.type,
      fullLine: line 
    });
  }
}

function findRoute() {
  const startInput = document.getElementById('plan-start').value;
  const endInput = document.getElementById('plan-end').value;
  if (!startInput || !endInput) { showToast("请输入起点和终点"); return; }

  const startId = getCanonicalStationId(startInput);
  const endId = getCanonicalStationId(endInput);

  if (startId === endId) { showToast("起点终点看起来是同一个地方"); return; }

  const startLine = appState.lines.find(l => 
    l.stationsUp.some(s => getCanonicalStationId(s) === startId) || 
    l.stationsDown.some(s => getCanonicalStationId(s) === startId)
  );
  const regionLock = startLine ? startLine.city : null; 
  
  const activeChip = document.getElementById('planner-filters').querySelector('.active');
  const rule = activeChip ? activeChip.dataset.rule : 'all';
  
  const graph = buildGraph(rule, regionLock);

  const queue = [{ node: startId, score: 0, realTime: 0, path: [] }];
  const visited = {}; 
  const results = [];

  let loops = 0;
  while (queue.length > 0 && loops < 6000) {
    loops++;
    queue.sort((a, b) => a.score - b.score);
    const current = queue.shift();

    if (current.score > (visited[current.node] || Infinity)) continue;
    visited[current.node] = current.score;

    if (current.node === endId) {
      results.push(current);
      if (results.length >= 10) break; // 获取更多结果以便排序
      continue;
    }

    const neighbors = graph[current.node] || [];
    neighbors.forEach(edge => {
      let stepScore = edge.weight;
      let stepTime = edge.timeCost;
      let isTransfer = false;
      let transferType = 'none';
      
      const lastStep = current.path[current.path.length - 1];
      if (lastStep) {
        if (lastStep.lineId !== edge.lineId) {
          isTransfer = true;
          transferType = getTransferType(lastStep.toRawName, edge.fromRawName);
          
          let transferPenalty = 0;
          let transferTime = 0;

          if (transferType === 'walking') {
            transferTime = 10;
            transferPenalty = 20; 
          } else {
            transferTime = 5; 
            transferPenalty = 10;
          }
          
          if (rule === 'min_transfer') transferPenalty += 100; // 重罚换乘

          stepScore += transferPenalty;
          stepTime += transferTime;
        }
      }
      
      const newScore = current.score + stepScore;
      const newTime = current.realTime + stepTime;
      
      const newPath = [...current.path, { 
        ...edge, 
        transferType: isTransfer ? transferType : 'none'
      }];

      if (newScore < (visited[edge.toNode] || Infinity)) {
         queue.push({ 
           node: edge.toNode, 
           score: newScore,
           realTime: newTime,
           path: newPath 
         });
      }
    });
  }

  const formattedResults = results.map(res => compressPath(res.path, res.realTime));
  
  // 排序逻辑
  if (rule === 'fastest') {
    formattedResults.sort((a, b) => a.totalTime - b.totalTime);
  } else if (rule === 'min_transfer') {
    formattedResults.sort((a, b) => a.transfers - b.transfers || a.totalTime - b.totalTime);
  } else {
    // All Plans: 综合排序 (score) 已在 Dijkstra 中大致完成，这里按时间微调
    formattedResults.sort((a, b) => a.totalTime - b.totalTime);
  }

  renderPlannerResults(formattedResults.slice(0, 5)); // 显示前5个
}

function compressPath(rawPath, totalTime) {
  if (rawPath.length === 0) return { segments: [], totalTime: 0, transfers: 0 };

  const segments = [];
  let currentSeg = null;

  rawPath.forEach(step => {
    if (!currentSeg) {
      currentSeg = {
        lineName: step.lineName,
        lineId: step.lineId,
        type: step.type,
        subType: step.fullLine.subType, // 传递子类型
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
        subType: step.fullLine.subType,
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
  
  return { 
    segments, 
    totalTime: Math.ceil(totalTime),
    transfers: segments.length - 1
  };
}

/* --- UI Rendering Updates --- */

function renderPlannerResults(planList) {
  const container = document.getElementById('planner-results');
  container.innerHTML = '';
  
  if (planList.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <span class="material-symbols-rounded" style="font-size:48px; opacity:0.3">alt_route</span>
      <p>未找到合适方案</p>
    </div>`;
    return;
  }

  planList.forEach((plan, index) => {
    const segments = plan.segments;
    const card = document.createElement('div');
    card.className = 'plan-result-card';
    
    const totalStops = segments.reduce((sum, seg) => sum + seg.stopCount, 0);
    
    // 2. 检查运营状态
    let isAllOperating = true;
    segments.forEach(seg => {
      if (!isLineOperating(seg.meta)) isAllOperating = false;
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

    card.innerHTML = `
      <div class="plan-header">
        <div class="plan-time-big">${plan.totalTime} <span style="font-size:14px; font-weight:normal">分钟</span></div>
        <div class="plan-meta">
          ${totalStops}站 · 换乘 ${plan.transfers} 次
          ${!isAllOperating ? '<span class="out-of-service">不在运营时段</span>' : ''}
        </div>
      </div>
      <div class="plan-route-visual">
        ${routeSummary}
      </div>
      <div class="plan-desc">
        从 ${segments[0].startStation} 出发
      </div>
    `;
    card.onclick = () => openRouteModal(segments, plan.totalTime);
    container.appendChild(card);
  });
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
    
    // 8. 不同的子类型图标
    const icon = getIconForSubType(line.subType);
    
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

function openDetail(line) {
  currentLine = line;
  switchView('detail');
  
  const header = document.getElementById('detail-header');
  const compLogo = appState.logos.company[line.company];
  const badgeColor = line.color ? `#${line.color.slice(0,6)}` : 'var(--md-sys-color-primary)';

  // 9. 公司名称+Logo 显示
  const companyBadge = `
    <div class="company-badge-container">
      ${compLogo ? `<img src="${compLogo}" class="company-logo-detail" alt="${line.company}">` : ''}
      <span class="company-text">${line.company}</span>
    </div>
  `;

  header.innerHTML = `
    <div class="dh-top">
      <div class="line-icon-badge large" style="background:${badgeColor}">
        ${line.name}
      </div>
      <div style="flex:1">
        <div class="dh-title-row">
          <div class="dh-name">${line.name}</div>
          ${companyBadge}
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

/* --- Features: Real Sharing & Notification --- */

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
    const icon = getIconForSubType(seg.subType);
    
    html += `
      <div class="step-card">
        <div class="step-left-line"></div>
        <div class="step-icon-box" style="background:${color}">
             <span class="material-symbols-rounded" style="color:white; font-size:16px;">
               ${icon}
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

  // 真实的分享和通知按钮
  html += `
    <div class="modal-actions" data-html2canvas-ignore>
      <button class="action-btn tonal" id="btn-share-img">
        <span class="material-symbols-rounded">share</span> 分享图片
      </button>
      <button class="action-btn primary" id="btn-notify-push">
        <span class="material-symbols-rounded">notifications_active</span> 发送提醒
      </button>
    </div>
  `;

  content.innerHTML = html;
  backdrop.classList.add('visible');
  modal.classList.add('visible');

  // 绑定事件 (使用 addEventListener 防止覆盖)
  document.getElementById('btn-share-img').onclick = () => shareRealImage();
  document.getElementById('btn-notify-push').onclick = () => sendRealNotification(segments);
}

// 4. 真实图片分享 (html2canvas)
async function shareRealImage() {
  const element = document.getElementById('route-modal');
  if (!element) return;

  showToast("正在生成图片，请稍候...");
  
  try {
    // 临时调整样式以确保截取完整 (白色背景)
    const originalBg = element.style.background;
    element.style.background = "#fdfcff"; 
    
    const canvas = await html2canvas(element, {
      scale: 2, // 高清
      backgroundColor: "#fdfcff",
      useCORS: true,
      ignoreElements: (node) => node.hasAttribute('data-html2canvas-ignore') // 忽略按钮区
    });

    element.style.background = originalBg;

    // 转换并下载
    const link = document.createElement('a');
    link.download = `route_plan_${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("图片已生成并下载");
    
  } catch (err) {
    console.error(err);
    showToast("生成图片失败");
  }
}

// 5. 真实通知推送 (Notification API)
function sendRealNotification(segments) {
  if (!('Notification' in window)) {
    showToast("当前浏览器不支持通知");
    return;
  }

  // 构建详细字符串
  // 例子：乘坐的线路：从xx出发，123路-》大桥站-〉888路-〉北揽站-》地铁2号线。到达xx目的地
  const start = segments[0].startStation;
  const end = segments[segments.length - 1].endStation;
  
  let routeStr = `从 ${start} 出发，`;
  segments.forEach((seg, i) => {
    routeStr += `${seg.lineName}`;
    if (i < segments.length - 1) {
      routeStr += ` -> ${seg.endStation} (换乘) -> `;
    }
  });
  routeStr += ` -> 到达 ${end}`;

  // 请求权限
  Notification.requestPermission().then(permission => {
    if (permission === 'granted') {
      new Notification('行程规划提醒', {
        body: routeStr,
        icon: '../data/logos_company.json', // 这是一个占位符，实际可以指向具体的app icon
        vibrate: [200, 100, 200]
      });
      showToast("提醒已发送至通知栏");
    } else {
      showToast("请允许通知权限");
    }
  });
}

/* ... (setupUI, renderStations, closeRouteModal, showToast 等其他辅助函数保持不变，需确保 setupUI 中的绑定逻辑正确) ... */

function setupUI() {
  // Navigation
  document.getElementById('nav-back').onclick = () => {
    if (appState.currentView === 'home') window.history.back();
    else switchView('home');
  };
  document.getElementById('nav-to-planner').onclick = () => switchView('planner');

  // Filters
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
  areaBtn.onclick = () => {
     renderAreaMenu();
     document.getElementById('area-menu').classList.toggle('open');
     document.getElementById('area-menu-backdrop').classList.toggle('open');
     setTimeout(() => document.getElementById('area-search-input').focus(), 100);
  };
  document.getElementById('area-menu-backdrop').onclick = () => {
    document.getElementById('area-menu').classList.remove('open');
    document.getElementById('area-menu-backdrop').classList.remove('open');
  };

  // Search Input
  document.getElementById('line-search').addEventListener('input', renderHome);

  // Detail Toggle
  document.getElementById('btn-dir-up').onclick = () => renderStations('up');
  document.getElementById('btn-dir-down').onclick = () => renderStations('down');

  // Planner Filter Logic
  document.querySelectorAll('#planner-filters .chip').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('#planner-filters .chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      // 如果已经有起终点，立即刷新
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

  // Modal Close
  const close = () => {
    document.getElementById('modal-backdrop').classList.remove('visible');
    document.getElementById('route-modal').classList.remove('visible');
  };
  document.getElementById('modal-close').onclick = close;
  document.getElementById('modal-backdrop').onclick = close;
}

// 辅助函数：视图切换
function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  appState.currentView = viewName;
  
  const title = document.getElementById('page-title');
  const plannerBtn = document.getElementById('nav-to-planner');
  
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

// Area Menu 渲染
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
       // 如果是从详情页点进来的，先跳去规划页
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

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// 启动
init();
