/* --- 配置与状态 --- */
const DATA_URL = '../data/bus_data.txt';
const ALIAS_URL = '../data/station_alias.json';
const LOGO_REGION_URL = '../data/region_logos.json';
const LOGO_COMPANY_URL = '../data/company_logos.json';

const state = {
    lines: [],         // 所有线路数据
    aliases: [],       // 站点别名
    logos: { region: {}, company: {} },
    currentRegion: localStorage.getItem('pref_region') || '全部', // 记忆地区
    currentFilter: 'all', // all, bus, subway, rail
    navStack: [],      // 简单的路由栈
    plan: { start: null, end: null } // 规划起终点
};

// 页面元素
const els = {
    app: document.getElementById('app'),
    title: document.getElementById('pageTitle'),
    backBtn: document.getElementById('backBtn'),
    regionBtn: document.getElementById('regionBtn'),
    regionLabel: document.getElementById('currentRegionLabel'),
    filterBar: document.getElementById('filterBar'),
    regionDialog: document.getElementById('regionDialog')
};

/* --- 1. 数据解析核心 --- */
async function init() {
    try {
        const [txtRes, aliasRes, regLogoRes, comLogoRes] = await Promise.all([
            fetch(DATA_URL).then(r => r.text()),
            fetch(ALIAS_URL).then(r => r.json()).catch(() => []),
            fetch(LOGO_REGION_URL).then(r => r.json()).catch(() => ({})),
            fetch(LOGO_COMPANY_URL).then(r => r.json()).catch(() => ({}))
        ]);

        state.aliases = aliasRes;
        state.logos.region = regLogoRes;
        state.logos.company = comLogoRes;
        state.lines = parseBusData(txtRes);
        
        // 初始化UI
        updateRegionUI();
        renderHome();
        setupListeners();
    } catch (e) {
        console.error("初始化失败", e);
        els.app.innerHTML = `<p style="text-align:center; padding:20px;">数据加载失败，请检查文件路径。</p>`;
    }
}

function parseBusData(text) {
    const lines = [];
    // 按行分割，去除空行
    const rows = text.split('\n').filter(r => r.trim().length > 0);

    rows.forEach(row => {
        // 正则提取
        const nameMatch = row.match(/【(.*?)】/);
        const companyMatch = row.match(/\{(.*?)\}/);
        const infoMatch = row.match(/《(.*?)》/);
        const regionMatch = row.match(/『(.*?)』/);
        const startMatch = row.match(/§(.*?)§/);
        const endMatch = row.match(/@(.*?)@/);
        const typeMatch = row.match(/θ(.*?)θ/);
        const colorMatch = row.match(/∮(.*?)∮/);

        // 提取站点：去除所有特殊标记后处理
        // 逻辑：提取【】之后，{ 或者 《 之前的部分作为站点区域
        let stationStr = row.replace(/【.*?】/, '').split(/[\{《『§@θ∮]/)[0];
        
        // 分割站点 (支持 - 或 箭头)
        let stationsRaw = stationStr.split(/-|→/).map(s => s.trim()).filter(s => s);
        
        // 处理站点名称中的箭头 (↓/↑) 用于显示，但存储纯净名称用于搜索
        const stations = stationsRaw.map(s => {
            const dir = s.includes('↓') ? 'down' : (s.includes('↑') ? 'up' : 'both');
            const cleanName = s.replace(/[↓↑]/g, '');
            return { name: cleanName, raw: s, dir };
        });

        // 识别类型
        let type = 'bus'; // 默认
        let typeRaw = typeMatch ? typeMatch[1] : '';
        if (typeRaw.includes('地铁')) type = 'subway';
        else if (typeRaw.includes('铁路') || typeRaw.includes('火车')) type = 'rail';
        
        // 自动识别：如果没标签，但名字里有"号线"可能是地铁
        if (!typeMatch && nameMatch && nameMatch[1].includes('号线')) type = 'subway';

        if (nameMatch) {
            lines.push({
                id: Math.random().toString(36).substr(2, 9),
                name: nameMatch[1],
                stations: stations,
                company: companyMatch ? companyMatch[1] : '',
                info: infoMatch ? infoMatch[1] : '',
                region: regionMatch ? regionMatch[1] : '未知',
                startTime: startMatch ? startMatch[1] : '',
                endTime: endMatch ? endMatch[1] : '',
                type: type, // bus, subway, rail
                color: colorMatch ? `#${colorMatch[1]}` : null,
                originalStr: row
            });
        }
    });
    return lines;
}

/* --- 2. 路由与视图控制 --- */
function navigateTo(view, data = null) {
    state.navStack.push({ view, data });
    renderView(view, data);
    updateTopBar(view);
}

function goBack() {
    if (state.navStack.length > 1) {
        state.navStack.pop();
        const prev = state.navStack[state.navStack.length - 1];
        renderView(prev.view, prev.data);
        updateTopBar(prev.view);
    }
}

function updateTopBar(view) {
    if (view === 'home') {
        els.backBtn.style.display = 'none';
        els.regionBtn.style.display = 'flex';
        els.filterBar.style.display = 'flex';
        els.title.innerText = '公交查询';
    } else {
        els.backBtn.style.display = 'flex';
        els.regionBtn.style.display = 'none';
        els.filterBar.style.display = 'none';
        els.title.innerText = view === 'detail' ? '线路详情' : '出行方案';
    }
}

function renderView(view, data) {
    els.app.innerHTML = '';
    window.scrollTo(0, 0);
    if (view === 'home') renderHome();
    else if (view === 'detail') renderDetail(data);
    else if (view === 'planner') renderPlanner(data);
}

/* --- 3. 首页逻辑 --- */
function renderHome() {
    // 过滤数据
    const filtered = state.lines.filter(l => {
        const regionMatch = state.currentRegion === '全部' || l.region === state.currentRegion;
        const typeMatch = state.currentFilter === 'all' || l.type === state.currentFilter;
        return regionMatch && typeMatch;
    });

    if (filtered.length === 0) {
        els.app.innerHTML = `<div style="text-align:center; padding:40px; color:var(--md-sys-color-outline)">暂无该区域线路</div>`;
        return;
    }

    const list = document.createElement('div');
    filtered.forEach(line => {
        const card = document.createElement('div');
        card.className = 'card';
        card.onclick = () => navigateTo('detail', line);

        // 颜色条
        if (line.color) {
            const strip = document.createElement('div');
            strip.className = 'card-color-strip';
            strip.style.backgroundColor = line.color;
            card.appendChild(strip);
        }

        // 图标
        const iconMap = { 'bus': 'directions_bus', 'subway': 'subway', 'rail': 'train' };
        const icon = iconMap[line.type] || 'directions_bus';
        
        card.innerHTML += `
            <div class="line-icon" style="${line.color ? `color:${line.color};` : ''}">
                <span class="material-symbols-rounded">${icon}</span>
            </div>
            <div class="line-info">
                <div class="line-name">${line.name}</div>
                <div class="line-route">
                    ${line.stations[0].name} <span class="material-symbols-rounded" style="font-size:12px; vertical-align:middle">arrow_forward</span> ${line.stations[line.stations.length-1].name}
                </div>
            </div>
        `;
        list.appendChild(card);
    });
    
    // 添加出行规划入口卡片
    const plannerEntry = document.createElement('div');
    plannerEntry.className = 'card';
    plannerEntry.style.background = 'var(--md-sys-color-primary-container)';
    plannerEntry.style.color = 'var(--md-sys-color-on-primary-container)';
    plannerEntry.innerHTML = `
        <div class="line-icon" style="background:rgba(255,255,255,0.2); color:inherit">
            <span class="material-symbols-rounded">alt_route</span>
        </div>
        <div class="line-info">
            <div class="line-name">智能出行规划</div>
            <div class="line-route" style="color:inherit; opacity:0.8">查询最优换乘方案</div>
        </div>
    `;
    plannerEntry.onclick = () => navigateTo('planner');
    
    els.app.prepend(plannerEntry);
    els.app.appendChild(list);
}

/* --- 4. 详情页逻辑 --- */
function renderDetail(line) {
    const container = document.createElement('div');
    
    // Header
    const colorStyle = line.color ? `color: ${line.color};` : '';
    const logoUrl = state.logos.company[line.company];
    
    container.innerHTML = `
        <div class="detail-header">
            <h2 style="font-size:28px; ${colorStyle}">${line.name}</h2>
            <div style="font-size:14px; color:var(--md-sys-color-outline); margin-top:4px;">
                ${line.company} ${logoUrl ? `<img src="${logoUrl}" style="height:16px; vertical-align:middle">` : ''}
            </div>
            <div class="tag-row">
                ${line.info ? `<span class="tag">${line.info}</span>` : ''}
                <span class="tag">首 ${line.startTime || '--'}</span>
                <span class="tag">末 ${line.endTime || '--'}</span>
            </div>
        </div>
        <div class="timeline" id="stationTimeline"></div>
        
        <div style="position:fixed; bottom:20px; left:0; right:0; padding:0 20px; text-align:center;">
             <button class="btn-primary" style="width:100%; height:56px; font-size:18px; box-shadow:0 4px 10px rgba(0,0,0,0.2)" onclick="alert('即将跳转乘车码...')">
                乘车
             </button>
        </div>
        <div style="height: 80px;"></div>
    `;

    const timeline = container.querySelector('#stationTimeline');
    line.stations.forEach((st, index) => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        if (index === 0) item.classList.add('start');
        
        item.innerHTML = `
            <div class="station-name">${st.raw}</div>
            <div class="station-actions">
                <button class="btn-primary btn-small" onclick="setPlanNode('${st.name}', 'start')">设为起点</button>
                <button class="btn-primary btn-small" style="background:var(--md-sys-color-outline)" onclick="setPlanNode('${st.name}', 'end')">设为终点</button>
            </div>
        `;
        // 点击展开操作
        item.querySelector('.station-name').onclick = (e) => {
            document.querySelectorAll('.timeline-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
        };
        timeline.appendChild(item);
    });

    els.app.appendChild(container);
}

window.setPlanNode = (name, type) => {
    state.plan[type] = name;
    navigateTo('planner');
};

/* --- 5. 出行规划 (算法核心) --- */
function renderPlanner() {
    const container = document.createElement('div');
    container.innerHTML = `
        <div class="planner-box">
            <div class="input-group">
                <span class="material-symbols-rounded" style="color:#4CAF50">trip_origin</span>
                <input type="text" id="planStart" placeholder="输入起点" value="${state.plan.start || ''}">
            </div>
            <div class="input-group">
                <span class="material-symbols-rounded" style="color:#F44336">location_on</span>
                <input type="text" id="planEnd" placeholder="输入终点" value="${state.plan.end || ''}">
            </div>
            
            <div style="display:flex; gap:8px; margin-top:8px;">
                <button class="chip active" id="algoFast">换乘最少</button>
                <button class="chip" id="algoBus">公交优先</button>
            </div>

            <button class="btn-primary" id="btnSearch" style="margin-top:8px;">查询路线</button>
        </div>
        <div id="planResults"></div>
    `;

    els.app.appendChild(container);

    // 绑定事件
    const startInput = container.querySelector('#planStart');
    const endInput = container.querySelector('#planEnd');
    
    // 简单的自动补全 (此处略写，实际可用 datalist)
    
    container.querySelector('#btnSearch').onclick = () => {
        const s = startInput.value.trim();
        const e = endInput.value.trim();
        if(!s || !e) return alert("请输入起终点");
        
        const results = calculateRoute(s, e);
        renderRouteResults(results);
    };
}

/* --- 算法实现: BFS 寻找换乘 --- */
function calculateRoute(startName, endName) {
    // 1. 标准化站点名 (处理别名)
    const normalize = (name) => {
        // 先查 Alias 表
        for (let group of state.aliases) {
            if (group.includes(name)) return group[0]; // 返回组里第一个作为主键
        }
        // 简单去后缀
        return name.replace(/(站|地铁站|火车站|交通中心|枢纽)$/, '');
    };

    const sKey = normalize(startName);
    const eKey = normalize(endName);
    
    if (sKey === eKey) return [];

    // 2. 建图: Node = StationKey, Edge = LineID
    const graph = {}; 
    // 预处理所有站点所属线路
    const stationToLines = {}; 
    
    state.lines.forEach(line => {
        line.stations.forEach(st => {
            const k = normalize(st.name);
            if (!stationToLines[k]) stationToLines[k] = [];
            stationToLines[k].push({ lineId: line.id, lineName: line.name, index: line.stations.indexOf(st), color: line.color });
        });
    });

    // 3. BFS 搜索
    let queue = [[sKey]]; // 路径数组
    let visited = new Set([sKey]);
    let solutions = [];
    
    // 限制深度为 3 (最多换乘2次，防止浏览器卡死)
    let maxDepth = 4; 

    while (queue.length > 0) {
        let path = queue.shift();
        let curr = path[path.length - 1];

        if (path.length > maxDepth) continue;

        if (curr === eKey) {
            solutions.push(path);
            if (solutions.length >= 3) break; // 找到3条就停
            continue;
        }

        // 查找邻居
        const myLines = stationToLines[curr] || [];
        myLines.forEach(info => {
            // 找到这条线上的所有站点
            const lineObj = state.lines.find(l => l.id === info.lineId);
            if (!lineObj) return;

            lineObj.stations.forEach(nextSt => {
                const nextKey = normalize(nextSt.name);
                if (!path.includes(nextKey)) { // 避免环
                     // 简单优化：只添加未访问过的或目标点
                     if (!visited.has(nextKey) || nextKey === eKey) {
                         visited.add(nextKey);
                         queue.push([...path, nextKey]);
                     }
                }
            });
        });
    }

    // 4. 将站点路径转换为线路路径 (Post-processing)
    // 这是一个简化版，实际需要计算具体的乘坐区间
    // 这里的 BFS 返回的是站点序列，我们需要将其合并为 "乘坐 A线 从 X 到 Y"
    
    // 由于纯 BFS 对 "同一条线连续坐多站" 这种逻辑处理较弱，
    // 这里采用更实用的 "线路-站点" 搜索法：
    // 起点 -> [线路A] -> 中转点 -> [线路B] -> 终点
    
    return findRoutesByLines(sKey, eKey, stationToLines);
}

// 优化的路由查找 (基于换乘次数)
function findRoutesByLines(start, end, map) {
    let results = [];
    
    // 直达
    const startLines = map[start] || [];
    const endLines = map[end] || [];
    
    // 1. 查找直达
    startLines.forEach(sl => {
        endLines.forEach(el => {
            if (sl.lineId === el.lineId) {
                // 检查方向 (简单起见，假设双向或根据索引判断)
                results.push({
                    type: 'direct',
                    segments: [{
                        line: sl.lineName, 
                        from: start, 
                        to: end, 
                        stops: Math.abs(sl.index - el.index),
                        color: sl.color
                    }]
                });
            }
        });
    });

    // 2. 一次换乘
    if (results.length < 2) {
        startLines.forEach(sl => {
            // 遍历该线路所有站点寻找中转
            const lineObj = state.lines.find(l => l.id === sl.lineId);
            lineObj.stations.forEach(midSt => {
                // 简单的标准化
                let midName = midSt.name.replace(/(站|地铁站|火车站)$/, '');
                // 如果中转站有到达终点的车
                const midLines = map[midName];
                if(midLines) {
                    midLines.forEach(ml => {
                         if (ml.lineId !== sl.lineId) { // 必须换线
                             // 检查 ml 是否通往 end
                             endLines.forEach(el => {
                                 if (el.lineId === ml.lineId) {
                                     results.push({
                                         type: 'transfer_1',
                                         segments: [
                                             { line: sl.lineName, from: start, to: midName, color: sl.color },
                                             { line: ml.lineName, from: midName, to: end, color: ml.color }
                                         ]
                                     });
                                 }
                             });
                         }
                    });
                }
            });
        });
    }

    // 去重并切片
    return results.slice(0, 5);
}

function renderRouteResults(routes) {
    const box = document.getElementById('planResults');
    box.innerHTML = '';
    
    if (routes.length === 0) {
        box.innerHTML = '<div style="padding:20px; text-align:center; color:gray">未找到合适方案，尝试减少换乘或检查站点名称。</div>';
        return;
    }

    routes.forEach((r, i) => {
        const card = document.createElement('div');
        card.className = 'plan-result-card';
        
        let html = `<div style="font-weight:bold; margin-bottom:8px;">方案 ${i+1} <span style="font-weight:normal; font-size:12px; color:gray">${r.type === 'direct' ? '直达' : '换乘 1 次'}</span></div>`;
        html += `<div class="plan-segments">`;
        
        r.segments.forEach((seg, idx) => {
            if (idx > 0) html += `<span class="material-symbols-rounded arrow">arrow_forward</span>`;
            
            // 颜色胶囊
            const bg = seg.color || '#666';
            html += `
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <span style="background:${bg}; color:#fff; padding:2px 8px; border-radius:4px; font-size:12px;">${seg.line}</span>
                    <span style="font-size:12px; margin-top:2px;">${seg.from}</span>
                </div>
            `;
            if (idx === r.segments.length - 1) {
                html += `<span class="material-symbols-rounded arrow">arrow_forward</span>`;
                html += `<span style="font-size:12px;">${seg.to}</span>`;
            }
        });
        
        html += `</div>`;
        
        // 提醒按钮
        html += `
            <div style="margin-top:12px; border-top:1px solid #eee; padding-top:8px; display:flex; justify-content:flex-end;">
                 <button class="btn-text" style="color:var(--md-sys-color-primary); border:none; background:none; font-size:14px; font-weight:500; display:flex; align-items:center;" onclick="addNotification('${r.segments[0].line}')">
                    <span class="material-symbols-rounded" style="font-size:16px; margin-right:4px;">notifications</span>
                    添加提醒
                 </button>
            </div>
        `;

        card.innerHTML = html;
        box.appendChild(card);
    });
}

window.addNotification = (lineName) => {
    // 模拟 Web Push 权限请求
    if ("Notification" in window) {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification("出行提醒已设置", {
                    body: `当 ${lineName} 接近时我们会通知您 (模拟)`,
                    icon: '/icon.png'
                });
            }
        });
    } else {
        alert("浏览器不支持通知");
    }
}

/* --- 6. 事件监听与辅助 --- */
function setupListeners() {
    // Top Bar Back
    els.backBtn.onclick = goBack;

    // Filter Chips
    els.filterBar.querySelectorAll('.chip').forEach(btn => {
        btn.onclick = () => {
            els.filterBar.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentFilter = btn.dataset.type;
            renderHome();
        };
    });

    // Region Dialog
    els.regionBtn.onclick = () => {
        // 提取所有地区
        const regions = [...new Set(state.lines.map(l => l.region))].filter(r => r);
        const list = document.getElementById('regionList');
        list.innerHTML = `<button onclick="selectRegion('全部')">全部地区</button>`;
        regions.forEach(r => {
            list.innerHTML += `<button onclick="selectRegion('${r}')">${r}</button>`;
        });
        els.regionDialog.showModal();
    };

    document.getElementById('closeRegionDialog').onclick = () => els.regionDialog.close();
}

window.selectRegion = (r) => {
    state.currentRegion = r;
    localStorage.setItem('pref_region', r);
    els.regionLabel.innerText = r;
    els.regionDialog.close();
    renderHome();
};

// 启动
state.navStack.push({ view: 'home' });
init();
