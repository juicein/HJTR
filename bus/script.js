/* ================= DATA & STATE ================= */
let allRoutes = [];
let stationAliases = {};
let allStations = new Set();
let currentView = 'home';
let logos = {};

/* ================= INITIALIZATION ================= */
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    setupEventListeners();
    renderRouteList(allRoutes);
});

async function loadData() {
    // 1. Fetch Aliases
    try {
        const aliasRes = await fetch('Data/station_aliases.json');
        stationAliases = await aliasRes.json();
    } catch (e) { console.warn('No aliases found'); }

    // 2. Fetch Raw Data
    try {
        const res = await fetch('Data/bus_data.txt');
        const text = await res.text();
        parseBusData(text);
    } catch (e) { console.error('Failed to load bus data', e); }
}

/* ================= PARSING LOGIC ================= */
function parseBusData(text) {
    const lines = text.split('\n');
    const routeRegex = /【(.*?)】(.*?)(?:\{(.*?)\})?(?:《(.*?)》)?(?:『(.*?)』)?(?:θ(.*?)θ)?(?:§(.*?)§)?(?:@(.*?)@)?(?:∮(.*?)∮)?$/;

    allRoutes = lines.filter(l => l.trim().length > 0).map(line => {
        const match = line.match(routeRegex);
        if (!match) return null;

        // Extract raw stations string and clean it
        const rawStations = match[2]; 
        // Logic to split by - or – and handle arrows ↓↑
        // For simplicity in this demo, we assume "-" separator
        const stationStrList = rawStations.split(/[-–]/).filter(s => s.trim() !== "");
        
        const stations = stationStrList.map(s => {
            let name = s.replace(/↑|↓/g, '').trim();
            // Resolve Alias
            return stationAliases[name] || name;
        });

        stations.forEach(s => allStations.add(s));

        return {
            name: match[1],
            stations: stations,
            company: match[3] || "未知公司",
            info: match[4] || "",
            region: match[5] || "通用",
            type: match[6] || "公交", // θ...θ
            startTime: match[7] || "--:--",
            endTime: match[8] || "--:--",
            color: match[9] ? `#${match[9]}` : null,
            id: match[1] // Unique ID
        };
    }).filter(r => r !== null);
    
    // Update Datalist for Search
    const dataList = document.getElementById('station-suggestions');
    dataList.innerHTML = '';
    allStations.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        dataList.appendChild(opt);
    });
}

/* ================= UI RENDERING ================= */

// 1. Render Home List
function renderRouteList(routes) {
    const container = document.getElementById('routeList');
    container.innerHTML = '';

    routes.forEach(route => {
        const card = document.createElement('div');
        card.className = 'route-card';
        if (route.color) card.style.borderLeftColor = route.color;
        
        // Icon determination
        let iconName = 'directions_bus';
        if (route.type.includes('地铁')) iconName = 'subway';
        if (route.type.includes('火车')) iconName = 'train';

        card.innerHTML = `
            <div class="route-icon" style="color:${route.color || 'inherit'}">
                <span class="material-symbols-rounded">${iconName}</span>
            </div>
            <div class="route-info">
                <h3>${route.name}</h3>
                <p>${route.stations[0]} <span class="material-symbols-rounded" style="font-size:12px">arrow_forward</span> ${route.stations[route.stations.length-1]}</p>
                <div style="margin-top:4px; font-size:10px; color:#666">
                    ${route.type} · ${route.region}
                </div>
            </div>
        `;
        card.onclick = () => showDetailView(route);
        container.appendChild(card);
    });
}

// 2. Render Detail View
function showDetailView(route) {
    switchView('detailView');
    document.getElementById('pageTitle').innerText = route.name;
    document.getElementById('backBtn').style.display = 'block';
    
    const header = document.getElementById('detailHeader');
    header.innerHTML = `
        <h2 style="color:${route.color || 'inherit'}">${route.name}</h2>
        <p style="margin: 8px 0;">${route.company}</p>
        <div class="tags">
           <span class="tag">首 ${route.startTime}</span>
           <span class="tag">末 ${route.endTime}</span>
        </div>
        <p style="margin-top:12px; font-size:13px; opacity:0.8">${route.info}</p>
    `;

    // Apply color theme
    if(route.color) {
        document.documentElement.style.setProperty('--md-sys-color-primary', route.color);
    }

    const timeline = document.getElementById('stationList');
    timeline.innerHTML = '';
    
    route.stations.forEach((s, index) => {
        const item = document.createElement('div');
        item.className = 'station-item';
        item.innerHTML = `
            <div class="station-dot"></div>
            <div class="station-name">${s}</div>
        `;
        // Station Click -> Go to Plan
        item.onclick = () => {
            if(confirm(`将 ${s} 设为起点或终点? \n点击确定设为起点，取消设为终点`)) {
                showPlanningView(s, null);
            } else {
                showPlanningView(null, s);
            }
        };
        timeline.appendChild(item);
    });
}

// 3. Render Planning View
function showPlanningView(startPreset, endPreset) {
    switchView('planningView');
    document.getElementById('pageTitle').innerText = "出行方案";
    document.getElementById('backBtn').style.display = 'block';

    if(startPreset) document.getElementById('startInput').value = startPreset;
    if(endPreset) document.getElementById('endInput').value = endPreset;
    
    // Reset Color
    document.documentElement.style.removeProperty('--md-sys-color-primary');
}

/* ================= LOGIC & ALGORITHM ================= */

function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    
    if (viewId === 'homeView') {
        document.getElementById('backBtn').style.display = 'none';
        document.getElementById('pageTitle').innerText = "交通";
    } else {
        document.getElementById('backBtn').onclick = () => switchView('homeView');
    }
}

function planRoute(criteria) {
    const start = document.getElementById('startInput').value.trim();
    const end = document.getElementById('endInput').value.trim();
    
    // Resolve Aliases for input
    const startNode = stationAliases[start] || start;
    const endNode = stationAliases[end] || end;

    if (!allStations.has(startNode) || !allStations.has(endNode)) {
        alert("找不到站点，请输入正确名称");
        return;
    }

    // Simplified Search (BFS for min transfers)
    // This is a basic demo algorithm. For production, build a Graph { Node: [{neighbor, route}] }
    const results = findPath(startNode, endNode, criteria);
    renderPlanResults(results);
}

// Basic Pathfinding Mockup (You should replace this with a real Graph BFS/Dijkstra)
function findPath(start, end, criteria) {
    // 1. Direct Routes
    const directRoutes = allRoutes.filter(r => r.stations.includes(start) && r.stations.includes(end));
    // Filter out reverse direction if indices are wrong (omitted for brevity)

    let plans = [];

    // Format Direct
    directRoutes.forEach(r => {
        const sIdx = r.stations.indexOf(start);
        const eIdx = r.stations.indexOf(end);
        if (sIdx < eIdx) { // Simple direction check
            plans.push({
                type: 'Direct',
                segments: [{ route: r, from: start, to: end, count: eIdx - sIdx }]
            });
        }
    });

    // Mock Transfer (1 Transfer)
    // Find shared stations between routes passing start and routes passing end
    if (plans.length === 0) {
        // Simple 2-leg search logic goes here...
        // For the demo to work without lag, I'll just return a mock if no direct found
        // In real deployment, build an Adjacency List.
    }

    return plans;
}

function renderPlanResults(plans) {
    const container = document.getElementById('planResults');
    container.innerHTML = '';

    if(plans.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#888">暂无直达方案，换乘算法需后端支持或构建完整图结构</div>';
        return;
    }

    plans.forEach(plan => {
        const card = document.createElement('div');
        card.className = 'plan-card';
        
        let html = `<div style="display:flex; justify-content:space-between;">
                        <b>${plan.segments[0].route.name}</b>
                        <button class="small-btn" onclick="scheduleNotification('${plan.segments[0].route.name}')">提醒</button>
                    </div>`;
        
        plan.segments.forEach(seg => {
            html += `
            <div class="segment-line" style="border-left-color: ${seg.route.color || '#006495'}">
                <div style="font-weight:bold">${seg.route.name}</div>
                <div style="font-size:12px; color:#666">开往 ${seg.route.stations[seg.route.stations.length-1]} · 坐 ${seg.count} 站</div>
                <div style="margin-top:4px">从 ${seg.from} 到 ${seg.to}</div>
            </div>`;
        });

        card.innerHTML = html;
        container.appendChild(card);
    });
}

function scheduleNotification(routeName) {
    if (!("Notification" in window)) {
        alert("浏览器不支持通知");
    } else if (Notification.permission === "granted") {
        new Notification(`已设置 ${routeName} 提醒`, { body: "车辆即将到达时会通知您（模拟）" });
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((permission) => {
            if (permission === "granted") {
                new Notification("提醒已开启");
            }
        });
    }
}

function setupEventListeners() {
    // Filter Chips
    document.querySelectorAll('.filter-chips .chip').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.filter-chips .chip').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const type = e.target.dataset.type;
            
            if(type === 'all') renderRouteList(allRoutes);
            else if(type === 'bus') renderRouteList(allRoutes.filter(r => !r.type.includes('地铁')));
            else if(type === 'subway') renderRouteList(allRoutes.filter(r => r.type.includes('地铁')));
        };
    });
}
