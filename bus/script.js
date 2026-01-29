/* 全局状态 */
const APP = {
    lines: [],          // 解析后的线路数据
    regions: new Set(), // 地区列表
    logos: { region: {}, company: {} },
    aliases: [],        // 手动别名
    graph: null,        // 路由图
    currentRegion: null,
    currentFilter: 'all' // all, bus, subway
};

/* --- 1. 数据加载与解析 --- */
async function init() {
    try {
        // 并行加载所有数据
        const [txtRes, aliasRes, regionLogoRes, companyLogoRes] = await Promise.all([
            fetch('../data/bus_data.txt'),
            fetch('../data/station_aliases.json'),
            fetch('../data/region_logos.json'),
            fetch('../data/company_logos.json')
        ]);

        const txt = await txtRes.text();
        APP.aliases = await aliasRes.json();
        APP.logos.region = await regionLogoRes.json();
        APP.logos.company = await companyLogoRes.json();

        parseData(txt);
        renderHome();
        initEvents();
        
        // 默认显示第一个地区（如果存在）
        if(APP.regions.size > 0) {
            APP.currentRegion = Array.from(APP.regions)[0];
            updateList();
        }
    } catch (e) {
        console.error("初始化失败:", e);
        document.querySelector('.loading').textContent = "数据加载失败，请检查文件路径";
    }
}

function parseData(text) {
    const lines = text.split('\n').filter(l => l.trim() !== '');
    
    lines.forEach(lineStr => {
        // 正则解析：提取关键字段
        // 格式示例: 【203路】Stop1-Stop2-{Company}《Info》『Region』§Start§@End@∮Color∮
        const nameMatch = lineStr.match(/【(.*?)】/);
        const companyMatch = lineStr.match(/\{(.*?)\}/);
        const infoMatch = lineStr.match(/《(.*?)》/);
        const regionMatch = lineStr.match(/『(.*?)』/);
        const startMatch = lineStr.match(/§(.*?)§/);
        const endMatch = lineStr.match(/@(.*?)@/);
        const colorMatch = lineStr.match(/∮(.*?)∮/);
        const typeMatch = lineStr.match(/θ(.*?)θ/);

        if (!nameMatch) return;

        // 提取中间的站点部分：去掉所有标记，只留站点串
        let mainPart = lineStr
            .replace(/【.*?】/, '')
            .replace(/\{.*?\}/, '')
            .replace(/《.*?》/, '')
            .replace(/『.*?』/, '')
            .replace(/§.*?§/, '')
            .replace(/@.*?@/, '')
            .replace(/∮.*?∮/, '')
            .replace(/θ.*?θ/, '');

        // 处理站点箭头和分割
        // 假设 "-" 分割，可能有 ↓ ↑ 表示单向
        const rawStops = mainPart.split('-').map(s => s.trim()).filter(s => s);
        
        // 简单处理：去掉上下行标记作为纯站点名用于搜索
        const stops = rawStops.map(s => s.replace(/[↓↑]/g, ''));

        const lineObj = {
            id: nameMatch[1],
            name: nameMatch[1],
            company: companyMatch ? companyMatch[1] : '',
            info: infoMatch ? infoMatch[1] : '',
            region: regionMatch ? regionMatch[1] : '未知',
            startTime: startMatch ? startMatch[1] : '',
            endTime: endMatch ? endMatch[1] : '',
            color: colorMatch ? '#' + colorMatch[1] : null,
            type: typeMatch ? typeMatch[1] : (nameMatch[1].includes('号线') ? '地铁' : '公交'),
            rawStops: rawStops,
            stops: stops
        };

        APP.lines.push(lineObj);
        APP.regions.add(lineObj.region);
    });
}

/* --- 2. 核心逻辑：别名识别与图构建 --- */

// 规范化站点名称（解决别名问题）
function normalizeStation(name) {
    // 1. 查手动表
    for (const group of APP.aliases) {
        if (group.includes(name)) return group[0]; // 返回组内第一个作为标准名
    }
    
    // 2. 自动识别：去掉“站”、“地铁站”、“火车站”等后缀进行模糊匹配
    // 这里为了演示，简单去除后缀比较。实际中应建立更复杂的索引。
    const cleanName = name.replace(/(地铁站|火车站|站|客运站)$/, '');
    
    // 如果cleanName非常短（如1个字），可能误判，这里简单略过
    if (cleanName.length < 2) return name;

    return cleanName; // 返回清洗后的名称作为“主要”键值，但为了精确，这里仅做简易版
    // 更严谨的做法是把所有已知站点存入Set，然后查找
}

/* --- 3. UI 渲染 --- */

function renderHome() {
    // 渲染地区菜单
    const menu = document.getElementById('regionMenu');
    menu.innerHTML = '';
    APP.regions.forEach(region => {
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        // 查找logo
        const logoUrl = APP.logos.region[region];
        if (logoUrl) {
            div.innerHTML = `<img src="${logoUrl}" alt="${region}">${region}`;
        } else {
            div.textContent = region;
        }
        div.onclick = () => {
            APP.currentRegion = region;
            updateList();
            menu.classList.add('hidden');
        };
        menu.appendChild(div);
    });
    
    updateList();
}

function updateList() {
    const container = document.getElementById('line-list');
    container.innerHTML = '';

    const filtered = APP.lines.filter(l => {
        // 地区筛选
        if (APP.currentRegion && l.region !== APP.currentRegion) return false;
        // 类型筛选
        if (APP.currentFilter === 'bus' && l.type === '地铁') return false;
        if (APP.currentFilter === 'subway' && l.type !== '地铁') return false;
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center;">该地区暂无此类型线路</div>';
        return;
    }

    filtered.forEach(line => {
        const el = document.createElement('div');
        el.className = 'line-card';
        if (line.color) el.style.setProperty('--line-color', line.color);
        
        let iconName = 'directions_bus';
        if (line.type === '地铁') iconName = 'subway';
        else if (line.type === '铁路') iconName = 'train';

        el.innerHTML = `
            <span class="material-symbols-rounded card-icon">${iconName}</span>
            <div class="card-content">
                <div class="card-title">${line.name}</div>
                <div class="card-subtitle">${line.stops[0]} <span class="material-symbols-rounded" style="font-size:10px; vertical-align:middle">arrow_forward</span> ${line.stops[line.stops.length-1]}</div>
            </div>
        `;
        el.onclick = () => showDetail(line);
        container.appendChild(el);
    });
}

function showDetail(line) {
    document.getElementById('backBtn').style.display = 'flex';
    document.querySelector('.page-title').textContent = line.name;
    
    // 头部信息
    const header = document.getElementById('detail-header');
    const companyLogo = APP.logos.company[line.company];
    const logoHtml = companyLogo ? `<img src="${companyLogo}" class="company-logo">` : '';
    
    header.innerHTML = `
        <div class="detail-title" style="color:${line.color || 'var(--md-sys-color-primary)'}">
            ${line.name} <span style="font-size:14px; background:${line.color || '#ccc'}; color:#fff; padding:2px 6px; border-radius:4px;">${line.type}</span>
        </div>
        <div class="detail-meta">
            ${logoHtml} ${line.company}<br>
            首班: ${line.startTime || '--'} / 末班: ${line.endTime || '--'}<br>
            ${line.info}
        </div>
    `;

    // 站点列表
    const ul = document.getElementById('station-list');
    ul.innerHTML = '';
    
    // 设置时间线颜色
    ul.style.setProperty('--md-sys-color-primary', line.color || '#006495');

    line.rawStops.forEach((stopName, index) => {
        const li = document.createElement('li');
        li.className = 'station-item';
        
        const cleanName = stopName.replace(/[↓↑]/g, '');
        const isDown = stopName.includes('↓');
        const isUp = stopName.includes('↑');
        let suffix = '';
        if(isDown) suffix = ' (仅下行)';
        if(isUp) suffix = ' (仅上行)';

        li.innerHTML = `
            <div class="station-name">${cleanName}${suffix}</div>
            <div class="station-actions">
                <button class="small-btn" onclick="setPlanner('${cleanName}', 'start')">设为起点</button>
                <button class="small-btn" onclick="setPlanner('${cleanName}', 'end')">设为终点</button>
            </div>
        `;
        li.onclick = (e) => {
            // Toggle active state
            document.querySelectorAll('.station-item').forEach(i => i.classList.remove('active'));
            li.classList.add('active');
        };
        ul.appendChild(li);
    });

    switchView('view-detail');
}

function setPlanner(stationName, type) {
    if(type === 'start') document.getElementById('startInput').value = stationName;
    else document.getElementById('endInput').value = stationName;
    
    showPlanner();
}

function showPlanner() {
    document.getElementById('backBtn').style.display = 'flex';
    document.querySelector('.page-title').textContent = "出行方案";
    switchView('view-planner');
}

/* --- 4. 路由算法 (Dijkstra) --- */

function buildGraph() {
    if (APP.graph) return APP.graph;
    
    const adj = {}; // { StationName: [ {to, line, type, cost} ] }

    // 辅助：添加边
    const addEdge = (u, v, line, cost) => {
        const uNorm = normalizeStation(u);
        const vNorm = normalizeStation(v);
        
        if (!adj[uNorm]) adj[uNorm] = [];
        adj[uNorm].push({ to: vNorm, line: line.name, type: line.type, cost: cost, rawTo: v });
    };

    APP.lines.forEach(line => {
        const stops = line.stops;
        for (let i = 0; i < stops.length - 1; i++) {
            // 假设相邻站点耗时 3 分钟 (简化)
            addEdge(stops[i], stops[i+1], line, 3);
            addEdge(stops[i+1], stops[i], line, 3); // 双向
        }
    });
    
    APP.graph = adj;
    return adj;
}

function calculateRoute(start, end, strategy) {
    const graph = buildGraph();
    const startNode = normalizeStation(start);
    const endNode = normalizeStation(end);

    if (!graph[startNode] || !graph[endNode]) return null;

    // Dijkstra
    const costs = {};
    const previous = {};
    const queue = [];

    // 初始化
    Object.keys(graph).forEach(node => {
        costs[node] = Infinity;
        previous[node] = null;
    });
    costs[startNode] = 0;
    queue.push({ node: startNode, cost: 0, lastLine: null });

    while (queue.length > 0) {
        // 简单排序模拟优先队列
        queue.sort((a, b) => a.cost - b.cost);
        const current = queue.shift();
        
        if (current.node === endNode) break;

        const neighbors = graph[current.node] || [];
        for (const edge of neighbors) {
            let edgeCost = edge.cost;
            
            // 策略权重调整
            if (strategy === 'min_transfer' && edge.line !== current.lastLine && current.lastLine !== null) {
                edgeCost += 50; // 换乘惩罚极大
            }
            if (strategy === 'rail_first' && edge.type !== '地铁') {
                edgeCost += 20; // 非铁路惩罚
            }
            if (edge.line !== current.lastLine && current.lastLine !== null) {
                edgeCost += 5; // 基础换乘时间惩罚
            }

            const newCost = costs[current.node] + edgeCost;
            if (newCost < costs[edge.to]) {
                costs[edge.to] = newCost;
                previous[edge.to] = { from: current.node, line: edge.line, raw: edge.rawTo };
                queue.push({ node: edge.to, cost: newCost, lastLine: edge.line });
            }
        }
    }

    // 回溯路径
    const path = [];
    let curr = endNode;
    if (costs[endNode] === Infinity) return null; // 无法到达

    while (curr !== startNode) {
        const prevInfo = previous[curr];
        path.unshift({ station: curr, line: prevInfo.line });
        curr = prevInfo.from;
    }
    path.unshift({ station: startNode, line: 'Start' });
    
    return compressPath(path);
}

// 将逐站路径压缩为换乘段: A -> B (Line 1) -> C (Line 2)
function compressPath(fullPath) {
    const segments = [];
    if (fullPath.length === 0) return segments;

    let currentLine = fullPath[1].line;
    let startStation = fullPath[0].station;
    let count = 0;

    for (let i = 1; i < fullPath.length; i++) {
        if (fullPath[i].line !== currentLine) {
            segments.push({
                line: currentLine,
                from: startStation,
                to: fullPath[i-1].station,
                count: count
            });
            currentLine = fullPath[i].line;
            startStation = fullPath[i-1].station;
            count = 0;
        }
        count++;
    }
    // 添加最后一段
    segments.push({
        line: currentLine,
        from: startStation,
        to: fullPath[fullPath.length-1].station,
        count: count
    });

    return segments;
}

function renderRoutes() {
    const s = document.getElementById('startInput').value.trim();
    const e = document.getElementById('endInput').value.trim();
    const strategy = document.querySelector('.filter-btn.active').dataset.strategy;

    if(!s || !e) return;

    const resultDiv = document.getElementById('route-results');
    resultDiv.innerHTML = '<div class="loading">规划中...</div>';

    // 延迟一下以免卡顿UI
    setTimeout(() => {
        const segments = calculateRoute(s, e, strategy);
        resultDiv.innerHTML = '';

        if (!segments) {
            resultDiv.innerHTML = '<div style="padding:16px;text-align:center">未找到合适路线或站点不存在</div>';
            return;
        }

        // 渲染单个结果卡片 (这里只生成一条最优，实际可扩展多条)
        const card = document.createElement('div');
        card.className = 'route-card';
        
        let html = '<div class="route-summary">';
        segments.forEach((seg, idx) => {
            const lineData = APP.lines.find(l => l.name === seg.line);
            const color = lineData ? lineData.color : '#666';
            
            html += `<span class="route-tag" style="background:${color}">${seg.line}</span>`;
            if (idx < segments.length - 1) html += ' <span class="route-arrow">→</span> ';
        });
        html += '</div>';
        
        html += `<div class="route-details">共 ${segments.length} 次换乘 · 约 ${segments.reduce((a,b)=>a+b.count,0) * 3} 分钟</div>`;
        html += `<button class="notify-btn" onclick="sendNotify('${s} 到 ${e}')"><span class="material-symbols-rounded">notifications</span></button>`;

        // 详细步骤
        html += '<ul style="margin-top:12px; padding-left:20px; color:var(--md-sys-color-on-surface-variant); font-size:14px;">';
        segments.forEach(seg => {
            html += `<li>乘坐 <b>${seg.line}</b> 从 ${seg.from} 到 ${seg.to} (${seg.count}站)</li>`;
        });
        html += '</ul>';

        card.innerHTML = html;
        resultDiv.appendChild(card);
    }, 100);
}

/* --- 5. 事件处理 & 杂项 --- */

function initEvents() {
    // 视图切换
    window.switchView = (id) => {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        if(id === 'view-home') {
            document.getElementById('backBtn').style.display = 'none';
            document.querySelector('.page-title').textContent = "交通";
        }
    };

    document.getElementById('backBtn').onclick = () => {
        switchView('view-home');
    };

    // 筛选 Chips
    document.querySelectorAll('.chip').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            APP.currentFilter = btn.dataset.type;
            updateList();
        };
    });

    // 地区菜单
    document.getElementById('regionFilterBtn').onclick = (e) => {
        e.stopPropagation();
        document.getElementById('regionMenu').classList.toggle('hidden');
    };
    document.body.onclick = () => document.getElementById('regionMenu').classList.add('hidden');

    // 搜索 (简单跳转到规划页)
    document.getElementById('searchBtn').onclick = () => showPlanner();

    // 规划页输入联想
    setupAutocomplete('startInput', 'startSuggest');
    setupAutocomplete('endInput', 'endSuggest');

    // 规划策略切换
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderRoutes();
        };
    });
    
    document.getElementById('swapBtn').onclick = () => {
        const s = document.getElementById('startInput');
        const e = document.getElementById('endInput');
        [s.value, e.value] = [e.value, s.value];
        renderRoutes();
    }
}

function setupAutocomplete(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);

    input.addEventListener('input', () => {
        const val = input.value.trim();
        if(!val) { list.style.display = 'none'; return; }

        const matches = new Set(); // 去重
        APP.lines.forEach(l => {
            l.stops.forEach(s => {
                if(s.includes(val)) matches.add(s);
            });
        });

        list.innerHTML = '';
        if(matches.size > 0) {
            list.style.display = 'block';
            Array.from(matches).slice(0, 5).forEach(m => {
                const li = document.createElement('li');
                li.textContent = m;
                li.onclick = () => {
                    input.value = m;
                    list.style.display = 'none';
                    renderRoutes();
                };
                list.appendChild(li);
            });
        } else {
            list.style.display = 'none';
        }
    });
}

// Web Push 模拟
window.sendNotify = (msg) => {
    if (!("Notification" in window)) {
        alert("浏览器不支持通知");
    } else if (Notification.permission === "granted") {
        new Notification("出行提醒", { body: msg + " 的路线已添加到行程" });
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification("出行提醒", { body: msg + " 的路线已添加到行程" });
            }
        });
    }
};

// 启动
init();
