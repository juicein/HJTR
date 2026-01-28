/* ================= 全局状态 ================= */
const APP = {
    routes: [],     // 所有线路对象
    stations: {},   // 站点名 -> 包含该站点的线路列表 (用于搜索和图构建)
    graph: {},      // 图数据结构：Station -> { neighbor: Cost, line: LineID }
    aliases: {},    // 别名映射
    currentRegion: null,
    regions: new Set(),
};

// 允许的交通类型映射
const TYPE_MAP = {
    'subway': 'directions_subway',
    'bus': 'directions_bus',
    'tram': 'tram',
    'other': 'commute'
};

/* ================= 1. 数据解析与加载 ================= */

async function init() {
    try {
        // 并行加载数据
        const [txtRes, aliasRes, regionRes, companyRes] = await Promise.all([
            fetch('/data/bus_data.txt'),
            fetch('../data/aliases.json').catch(()=>({json:()=>({})})), // 容错
            fetch('../data/regions.json').catch(()=>({json:()=>({})})),
            fetch('../data/companies.json').catch(()=>({json:()=>({})}))
        ]);

        const text = await txtRes.text();
        APP.aliases = await aliasRes.json();
        // LOGO映射数据预留
        // const regionLogos = await regionRes.json(); 

        parseData(text);
        buildGraph();
        renderHome();
        setupEventListeners();
    } catch (e) {
        console.error("初始化失败:", e);
        alert("无法加载数据，请检查 data/bus_data.txt 是否存在。");
    }
}

function parseData(text) {
    const lines = text.split('\n').filter(l => l.trim() !== '');
    
    lines.forEach(lineStr => {
        // 使用正则提取各个字段
        // 格式: 【Name】Stations...{Company}《Price/Time》『Region』§Start§@End@∮Color∮θTypeθ
        
        const extract = (regex) => {
            const match = lineStr.match(regex);
            return match ? match[1] : null;
        };

        const name = extract(/【(.*?)】/);
        const region = extract(/『(.*?)』/) || '通用';
        const company = extract(/\{(.*?)\}/);
        const info = extract(/《(.*?)》/);
        const startTime = extract(/§(.*?)§/);
        const endTime = extract(/@(.*?)@/);
        const color = extract(/∮(.*?)∮/); // 十六进制
        const typeTag = extract(/θ(.*?)θ/);
        
        // 确定类型
        let type = 'bus';
        if (typeTag && typeTag.includes('地铁')) type = 'subway';
        // 可以扩展更多类型逻辑

        // 提取站点部分 (移除所有元数据标签后，剩下的主体按 '-' 分割)
        // 简单做法：找到第一个【之后，截取到第一个特殊符号前
        // 但最稳妥是先把已知标签replace掉
        let stationStr = lineStr
            .replace(/【.*?】/, '')
            .replace(/\{.*?\}/, '')
            .replace(/《.*?》/, '')
            .replace(/『.*?』/, '')
            .replace(/§.*?§/, '')
            .replace(/@.*?@/, '')
            .replace(/∮.*?∮/, '')
            .replace(/θ.*?θ/, '');
            
        const rawStations = stationStr.split('-').map(s => s.trim()).filter(s => s);
        
        // 处理站点上下行箭头 (仅用于展示，逻辑上我们会清洗出标准站名)
        const stations = rawStations.map(s => {
            const cleanName = s.replace('↑', '').replace('↓', '');
            return {
                display: s,
                name: cleanName,
                // 自动归一化逻辑入口
                id: getStationId(cleanName) 
            };
        });

        const routeObj = {
            id: name,
            name, region, company, info, startTime, endTime, color, type,
            stations: stations
        };

        APP.routes.push(routeObj);
        APP.regions.add(region);

        // 索引站点
        stations.forEach(st => {
            if (!APP.stations[st.id]) APP.stations[st.id] = [];
            APP.stations[st.id].push(routeObj);
        });
    });
}

// 站点ID归一化 (别名处理核心)
function getStationId(rawName) {
    // 1. 查手工表
    if (APP.aliases[rawName]) return APP.aliases[rawName];
    
    // 2. 自动规则：移除 "地铁站", "火车站", "站" (需谨慎，如 "前门" vs "前门站")
    // 这里实现一个保守的逻辑：如果是 "XX地铁站"，转为 "XX"
    let id = rawName;
    if (id.endsWith('地铁站')) id = id.replace('地铁站', '');
    else if (id.endsWith('火车站')) id = id.replace('火车站', '');
    else if (id.endsWith('站') && id.length > 2) id = id.replace(/站$/, ''); // 避免 "总站" 被切
    
    return id;
}

/* ================= 2. 路由与视图控制 ================= */

function navigateTo(viewId, data = null) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');
    
    const backBtn = document.getElementById('backBtn');
    const title = document.getElementById('pageTitle');
    const actions = document.querySelector('.actions');

    if (viewId === 'home') {
        backBtn.style.display = 'none';
        title.innerText = '交通';
        actions.style.visibility = 'visible';
    } else {
        backBtn.style.display = 'block';
        actions.style.visibility = 'hidden';
        
        if (viewId === 'detail') renderDetailView(data);
        if (viewId === 'planner') {
            title.innerText = '出行方案';
            if(data) { // data contains start/end from detail page
                document.getElementById('plan-start').value = data.start || '';
                document.getElementById('plan-end').value = data.end || '';
            }
        }
    }
}

/* ================= 3. 渲染逻辑 (UI) ================= */

function renderHome() {
    const container = document.getElementById('route-list');
    container.innerHTML = '';
    
    // 筛选逻辑
    const activeType = document.querySelector('.chip[data-type].active').dataset.type;
    
    const filtered = APP.routes.filter(r => {
        const typeMatch = activeType === 'all' || r.type === activeType;
        const regionMatch = !APP.currentRegion || r.region === APP.currentRegion;
        return typeMatch && regionMatch;
    });

    filtered.forEach(route => {
        const icon = TYPE_MAP[route.type] || 'directions_bus';
        // 使用配置的颜色，如果没有则根据类型给默认
        const color = route.color ? `#${route.color}` : (route.type === 'subway' ? '#006495' : '#72777f');
        
        const card = document.createElement('div');
        card.className = 'route-card';
        card.innerHTML = `
            <div class="color-strip" style="background:${color}"></div>
            <div class="route-icon" style="color:${color}">
                <span class="material-symbols-rounded">${icon}</span>
            </div>
            <div class="route-info">
                <div class="route-name">${route.name}</div>
                <div class="route-endpoints">
                    ${route.stations[0].display} - ${route.stations[route.stations.length-1].display}
                </div>
            </div>
        `;
        card.onclick = () => navigateTo('detail', route);
        container.appendChild(card);
    });
}

function renderDetailView(route) {
    document.getElementById('detail-route-name').innerText = route.name;
    document.getElementById('detail-route-company').innerText = route.company || '未知公司';
    document.getElementById('detail-time').innerText = 
        `${route.startTime || '--:--'} - ${route.endTime || '--:--'}`;
    document.getElementById('detail-price').innerText = route.info || '详见票价表';
    
    const list = document.getElementById('detail-stations');
    list.innerHTML = '';
    
    const color = route.color ? `#${route.color}` : 'var(--md-sys-color-primary)';

    route.stations.forEach((st, index) => {
        const item = document.createElement('div');
        item.className = 'station-item';
        // 动态设置圆点颜色
        item.style.setProperty('--md-sys-color-primary', color);
        
        item.innerHTML = `<div class="station-name">${st.display}</div>`;
        
        // 点击站点：设置为起点/终点
        item.onclick = () => {
            if(confirm(`将 "${st.name}" 设为哪里？\n确定：设为起点\n取消：设为终点`)) {
                 navigateTo('planner', { start: st.name });
            } else {
                 navigateTo('planner', { end: st.name });
            }
        };
        list.appendChild(item);
    });
}

/* ================= 4. 路径规划算法 (核心) ================= */

function buildGraph() {
    // 构建邻接表: Node -> [{ neighbor, line, cost }]
    APP.graph = {};
    
    APP.routes.forEach(route => {
        for(let i=0; i < route.stations.length - 1; i++) {
            const u = route.stations[i].id;
            const v = route.stations[i+1].id;
            
            if(!APP.graph[u]) APP.graph[u] = [];
            if(!APP.graph[v]) APP.graph[v] = [];
            
            // 默认双向，除非明确单向 (此处简化为双向)
            // cost = 1 (站点数) + 换乘惩罚(在搜索时计算)
            APP.graph[u].push({ to: v, line: route.id, type: route.type });
            APP.graph[v].push({ to: u, line: route.id, type: route.type });
        }
    });
}

function findPath(startName, endName, strategy = 'fastest') {
    const startId = getStationId(startName);
    const endId = getStationId(endName);
    
    if(!APP.graph[startId] || !APP.graph[endId]) return [];
    
    // 使用 BFS 寻找最少换乘 / 最短路径
    // Queue: [ { current, path: [], linesChanged: 0, lastLine: null } ]
    let queue = [{ curr: startId, path: [], transfers: 0, lastLine: null }];
    let visited = new Set();
    // 注意：为了找到换乘最少的，标准BFS找的是跳数最少（站最少）。
    // 若要换乘最少，需将“换乘”视为边权很大的图。这里用简化版 BFS，优先队列略复杂，
    // 这里实现一个 限制深度的 BFS 变体来找几条路径。
    
    let results = [];
    let maxDepth = 30; // 防止无限搜索
    
    // 简单实现：只找最短几条，然后在结果中排序
    // 实际生产环境需要 Dijkstra，权重 = (1 if same_line else 100)
    
    // 这里使用简化 Dijkstra (Priority Queue based on Cost)
    // Cost = hops + (transfers * 1000)
    
    let costs = {}; // node -> minCost
    let pq = [{ u: startId, cost: 0, path: [], lastLine: null, transfers: 0 }];
    
    while(pq.length > 0) {
        // 简易优先队列取出 cost 最小的
        pq.sort((a,b) => a.cost - b.cost);
        const { u, cost, path, lastLine, transfers } = pq.shift();
        
        if (cost > (costs[u] || Infinity) + 2000) continue; // 剪枝
        costs[u] = cost;
        
        if (u === endId) {
            results.push({
                path: [...path, { station: u, line: null }],
                transfers,
                score: cost
            });
            if (results.length >= 5) break; // 只要前5条
            continue;
        }
        
        if (path.length > maxDepth) continue;

        const neighbors = APP.graph[u] || [];
        for (let edge of neighbors) {
            // 策略过滤
            if (strategy === 'rail_first' && edge.type !== 'subway' && lastLine === null) {
                // 如果是铁路优先，且还没上车，倾向于选地铁（加权逻辑）
            }

            const isTransfer = (lastLine !== null && edge.line !== lastLine);
            const moveCost = 1;
            const transferCost = isTransfer ? 1000 : 0;
            const newCost = cost + moveCost + transferCost;
            
            const newTransfers = transfers + (isTransfer ? 1 : 0);
            
            // 允许稍微绕路以换取更少换乘，所以只有显著更差才丢弃
            // 这里的 visited 逻辑比较宽松
            
            // 记录路径：保存当前站和到达该站用的线路
            let newPath = [...path, { station: u, line: edge.line }];
            
            pq.push({
                u: edge.to,
                cost: newCost,
                path: newPath,
                lastLine: edge.line,
                transfers: newTransfers
            });
        }
    }
    
    return results;
}

function renderPlanResults(results) {
    const container = document.getElementById('plan-results');
    container.innerHTML = '';
    
    if(results.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#999">未找到合适路线或站点不连通</div>';
        return;
    }

    results.forEach((res, idx) => {
        // 格式化输出：合并同一线路的站点
        // res.path = [{station:A, line:1}, {station:B, line:1}, {station:C, line:2}...]
        
        let displaySegments = [];
        let currentLine = null;
        let startSt = null;
        
        res.path.forEach((node, i) => {
            if (i === 0) {
                currentLine = node.line;
                startSt = node.station;
            } else if (node.line !== currentLine || i === res.path.length -1) {
                // 线路变更或结束
                displaySegments.push({
                    line: currentLine,
                    from: startSt,
                    to: node.station
                });
                currentLine = node.line;
                startSt = node.station;
            }
        });
        
        // 最后一段修正 (因为上面的循环逻辑有点小瑕疵，简化处理用于展示)
        // 实际上我们只需展示：Line 1 (5站) -> Line 2 (3站)
        
        // 重新整理用于显示的 HTML
        let htmlChain = '';
        let lastL = null;
        let stopCount = 0;
        
        res.path.forEach((p, i) => {
            if (p.line && p.line !== lastL) {
                if (lastL) htmlChain += ` <span class="material-symbols-rounded" style="font-size:14px">arrow_forward</span> `;
                htmlChain += `<span style="font-weight:bold;color:var(--md-sys-color-primary)">${p.line}</span>`;
                lastL = p.line;
            }
        });

        const card = document.createElement('div');
        card.className = 'plan-card';
        card.innerHTML = `
            <div class="plan-summary">
                <span>方案 ${idx + 1}</span>
                <span>${res.transfers} 次换乘</span>
            </div>
            <div class="plan-route-chain">
                <span class="material-symbols-rounded">directions_walk</span>
                ${htmlChain}
                <span class="material-symbols-rounded" style="font-size:14px">arrow_forward</span>
                目的地
            </div>
            <div style="margin-top:8px; text-align:right;">
                 <button class="notify-btn" onclick="scheduleNotification('${res.path[0].line} 出行提醒')">
                    <span class="material-symbols-rounded">notifications_active</span> 添加提醒
                 </button>
            </div>
        `;
        container.appendChild(card);
    });
}

/* ================= 5. 事件交互 ================= */

function setupEventListeners() {
    // 顶部按钮
    document.getElementById('backBtn').onclick = () => {
        navigateTo('home');
        document.getElementById('view-detail').classList.remove('active'); // hack fix
    };
    
    document.getElementById('searchBtn').onclick = () => navigateTo('planner');
    
    // 筛选 Chips
    document.querySelectorAll('#view-home .chip').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('#view-home .chip').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderHome();
        };
    });
    
    // 规划输入联想
    const setupInput = (id) => {
        const input = document.getElementById(id);
        const list = document.getElementById('suggestion-list');
        
        input.oninput = () => {
            const val = input.value.trim();
            if (!val) { list.style.display = 'none'; return; }
            
            // 搜索站点
            const matches = Object.keys(APP.stations).filter(k => k.includes(val)).slice(0, 5);
            list.innerHTML = matches.map(m => `<li>${m}</li>`).join('');
            list.style.display = 'block';
            
            // 点击建议
            list.querySelectorAll('li').forEach(li => {
                li.onclick = () => {
                    input.value = li.innerText;
                    list.style.display = 'none';
                    triggerPlan();
                };
            });
        };
    };
    setupInput('plan-start');
    setupInput('plan-end');
    
    // 地区筛选 Modal
    const modal = document.getElementById('region-modal');
    document.getElementById('regionFilterBtn').onclick = () => {
        const list = document.getElementById('region-list');
        list.innerHTML = `<button class="chip ${!APP.currentRegion?'active':''}" onclick="setRegion(null)">全部地区</button>`;
        APP.regions.forEach(r => {
            list.innerHTML += `<button class="chip ${APP.currentRegion===r?'active':''}" onclick="setRegion('${r}')">${r}</button>`;
        });
        modal.style.display = 'flex';
    };
    document.getElementById('closeRegionModal').onclick = () => modal.style.display = 'none';
}

window.setRegion = (r) => {
    APP.currentRegion = r;
    document.getElementById('region-modal').style.display = 'none';
    renderHome();
};

function triggerPlan() {
    const s = document.getElementById('plan-start').value;
    const e = document.getElementById('plan-end').value;
    if(s && e) {
        const strategy = document.querySelector('#view-planner .chip.active').dataset.strategy;
        const res = findPath(s, e, strategy);
        renderPlanResults(res);
    }
}

// 简单的 Web Notification 模拟
window.scheduleNotification = (msg) => {
    if ("Notification" in window) {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification("行程提醒", { body: msg + "，请准备出发！" });
            }
        });
    } else {
        alert("提醒已添加：" + msg);
    }
};

// 启动
init();
