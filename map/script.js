let mapConfig = { minZoom: -6, maxZoom: 1, imageFormat: "webp" };
let appState = { x: 0, z: 0, zoom: -1 };
let mapData = { regions: [], pois: [], roads: [], subways: [] };
let activeLayer = 'all'; // all, travel, transit, none

// 路由系统
let routeState = { active: false, mode: 'drive', start: null, end: null, path: [] };
let graphs = { drive: new Map(), transit: new Map() };

let isDragging = false;
let dragStartX, dragStartZ, dragStartMouseX, dragStartMouseY;
let initialPinchDist = null, initialZoom = null;
let longPressTimer;
const LONG_PRESS_DURATION = 500;

// 曲率平滑配置 (可调节)
const BEZIER_RADIUS = 80; 

const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.getElementById('marker-container');
const lineLayer = document.getElementById('line-layer');
const regionContainer = document.getElementById('region-container');
const bottomSheet = document.getElementById('bottom-sheet');

const POI_TYPES = {
    'supermarket': '超市', 'hotel': '酒店', 'bank': '银行', 'school': '学校', 
    'government': '政府机关', 'mall': '商场', 'museum': '博物馆', 'park': '公园', 
    'restaurant': '餐厅', 'subway_station': '地铁站'
};

function init() {
    fetch('map_data.json').then(res => res.json()).then(data => {
        mapData = data;
        if (data.settings?.origin) { appState.x = data.settings.origin.x; appState.z = data.settings.origin.z; }
        buildGraphs();
        updateMap();
    }).catch(e => console.error("Data load failed", e));
}

// ================= 路网与寻路 (分离双图) =================
function buildGraphs() {
    graphs.drive.clear(); graphs.transit.clear();
    
    const addEdge = (graph, p1, p2) => {
        const k1 = `${p1.x},${p1.z}`; const k2 = `${p2.x},${p2.z}`;
        const dist = Math.hypot(p1.x - p2.x, p1.z - p2.z);
        if(!graph.has(k1)) graph.set(k1, []); if(!graph.has(k2)) graph.set(k2, []);
        graph.get(k1).push({ node: k2, dist, x: p2.x, z: p2.z });
        graph.get(k2).push({ node: k1, dist, x: p1.x, z: p1.z });
    };

    mapData.roads.forEach(road => {
        for(let i=0; i<road.points.length-1; i++) addEdge(graphs.drive, road.points[i], road.points[i+1]);
    });
    mapData.subways.forEach(line => {
        for(let i=0; i<line.points.length-1; i++) addEdge(graphs.transit, line.points[i], line.points[i+1]);
    });
}

function getNearestNode(graph, px, pz) {
    let nearest = null; let minD = Infinity;
    graph.forEach((_, key) => {
        const [x, z] = key.split(',').map(Number);
        const d = Math.hypot(x - px, z - pz);
        if(d < minD) { minD = d; nearest = {x, z, key}; }
    });
    return nearest;
}

function calculateRouteDijkstra(graph, startPt, endPt) {
    const startNode = getNearestNode(graph, startPt.x, startPt.z);
    const endNode = getNearestNode(graph, endPt.x, endPt.z);
    if (!startNode || !endNode) return null;

    const distances = new Map(); const previous = new Map(); const unvisited = new Set();
    graph.forEach((_, key) => { distances.set(key, Infinity); unvisited.add(key); });
    distances.set(startNode.key, 0);

    while (unvisited.size > 0) {
        let currKey = null; let minD = Infinity;
        unvisited.forEach(key => { if (distances.get(key) < minD) { minD = distances.get(key); currKey = key; }});
        if (!currKey || currKey === endNode.key) break;
        unvisited.delete(currKey);

        graph.get(currKey).forEach(neighbor => {
            const alt = distances.get(currKey) + neighbor.dist;
            if (alt < distances.get(neighbor.node)) { distances.set(neighbor.node, alt); previous.set(neighbor.node, currKey); }
        });
    }

    const path = []; let curr = endNode.key; let totalDist = distances.get(endNode.key);
    if (previous.has(curr) || curr === startNode.key) {
        while (curr) {
            const [x, z] = curr.split(',').map(Number);
            path.unshift({x, z});
            curr = previous.get(curr);
        }
    }
    return { path, dist: totalDist, startNode, endNode };
}

// ================= 核心渲染 =================
function updateMap() {
    const scale = Math.pow(2, appState.zoom);
    const w = container.offsetWidth; const h = container.offsetHeight;
    const cx = appState.x * scale; const cz = appState.z * scale;
    
    document.getElementById('coords-display').textContent = `X: ${Math.round(appState.x)}, Z: ${Math.round(appState.z)}`;
    
    renderTiles(cx, cz, scale, w, h);
    renderLines(cx, cz, scale, w, h);
    renderRegions(cx, cz, scale, w, h);
    renderMarkers(cx, cz, scale, w, h);
    renderActiveRoute(cx, cz, scale, w, h);
}

// 贝塞尔大曲率计算 (Q曲线平滑处理)
function generateSmoothPathD(points, scale, cx, cz, w, h) {
    if (points.length < 2) return "";
    let d = "";
    const getScreenPt = (pt) => ({ x: (w/2) + (pt.x*scale - cx), y: (h/2) + (pt.z*scale - cz) });

    for (let i = 0; i < points.length; i++) {
        const p = getScreenPt(points[i]);
        if (i === 0) { d += `M ${p.x} ${p.y} `; }
        else if (i === points.length - 1) { d += `L ${p.x} ${p.y}`; }
        else {
            const pPrev = getScreenPt(points[i-1]); const pNext = getScreenPt(points[i+1]);
            const d1 = Math.hypot(p.x - pPrev.x, p.y - pPrev.y);
            const d2 = Math.hypot(pNext.x - p.x, pNext.y - p.y);
            // 动态大曲率半径
            const r = Math.min(BEZIER_RADIUS * scale, d1/2.2, d2/2.2); 
            
            const q1x = p.x - (p.x - pPrev.x) * (r / d1); const q1y = p.y - (p.y - pPrev.y) * (r / d1);
            const q2x = p.x + (pNext.x - p.x) * (r / d2); const q2y = p.y + (pNext.y - p.y) * (r / d2);
            
            d += `L ${q1x} ${q1y} Q ${p.x} ${p.y} ${q2x} ${q2y} `;
        }
    }
    return d;
}

function renderLines(cx, cz, scale, w, h) {
    lineLayer.innerHTML = '';
    if (activeLayer === 'none') return;

    const drawLine = (lineData, isSubway) => {
        if (isSubway && activeLayer === 'travel') return;
        if (!isSubway && activeLayer === 'transit') return;
        if (appState.zoom < lineData.minZoom || appState.zoom > lineData.maxZoom) return;
        
        const pathD = generateSmoothPathD(lineData.points, scale, cx, cz, w, h);
        const pathId = `path-${lineData.id}`;
        
        // 动态粗细: 随地图放大变粗，缩小变细 (保证下限)
        let baseW = isSubway ? 6 : (lineData.type === 'highway' ? 10 : (lineData.type === 'expressway' ? 8 : 5));
        let lw = Math.max(isSubway ? 3 : 2, baseW * scale * 1.5);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('id', pathId); path.setAttribute('d', pathD); path.setAttribute('fill', 'none');
        path.setAttribute('stroke', isSubway ? (lineData.color || '#E53935') : (lineData.type === 'highway' ? '#FFB300' : '#FFFFFF'));
        path.setAttribute('stroke-width', lw);
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        lineLayer.appendChild(path);

        // 动态多标签渲染
        if (lineData.name && scale >= 0.25) {
            // 计算屏幕上路径的大致长度，决定放置几个标签
            let pathLen = 0;
            for(let i=1; i<lineData.points.length; i++) {
                pathLen += Math.hypot(lineData.points[i].x - lineData.points[i-1].x, lineData.points[i].z - lineData.points[i-1].z) * scale;
            }
            
            let labelCount = 1;
            if (pathLen > 800) labelCount = 3;
            else if (pathLen > 400) labelCount = 2;

            const offsets = labelCount === 3 ? ["20%", "50%", "80%"] : (labelCount === 2 ? ["33%", "66%"] : ["50%"]);
            
            offsets.forEach(offset => {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('class', isSubway ? 'transit-text' : 'road-text');
                if(isSubway) text.style.stroke = lineData.color || '#E53935'; // 地铁字描边和线同色
                text.setAttribute('dy', isSubway ? 5 : 4);
                text.innerHTML = `<textPath href="#${pathId}" startOffset="${offset}">${lineData.name}</textPath>`;
                lineLayer.appendChild(text);
            });
        }
    };

    mapData.roads.forEach(r => drawLine(r, false));
    mapData.subways.forEach(s => drawLine(s, true));
}

function renderRegions(cx, cz, scale, w, h) {
    regionContainer.innerHTML = '';
    mapData.regions.forEach(reg => {
        if (appState.zoom < reg.minZoom || appState.zoom > reg.maxZoom) return;
        const sx = (w/2) + (reg.x * scale - cx); const sy = (h/2) + (reg.z * scale - cz);
        const el = document.createElement('div'); el.className = 'region-label';
        el.textContent = reg.name;
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        el.style.fontSize = `${24 * scale}px`; // 随缩放改变字体大小
        regionContainer.appendChild(el);
    });
}

function renderMarkers(cx, cz, scale, w, h) {
    markerContainer.innerHTML = '';
    
    let allPois = [...mapData.pois];
    mapData.subways.forEach(sub => {
        if(sub.stations) sub.stations.forEach(st => allPois.push({ ...st, type: 'subway_station', brandLogo: sub.logo }));
    });

    allPois.forEach(poi => {
        if (appState.zoom < (poi.minZoom || -3) || appState.zoom > (poi.maxZoom || 0)) return;
        const sx = (w/2) + (poi.x * scale - cx); const sy = (h/2) + (poi.z * scale - cz);
        if (sx < -100 || sx > w + 100 || sy < -100 || sy > h + 100) return; 
        
        const el = document.createElement('div'); el.className = 'map-marker';
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;

        // 防碰撞逻辑 (贴近屏幕右侧时，文字翻转到左侧)
        if (sx > w - 150) el.classList.add('label-left');
        
        let icon = 'location_on'; let bgColor = 'var(--md-sys-color-primary)';
        if(poi.type === 'supermarket') icon = 'shopping_cart';
        if(poi.type === 'hotel') { icon = 'hotel'; bgColor = '#8E24AA'; }
        if(poi.type === 'subway_station') { icon = 'directions_subway'; bgColor = '#E53935'; }

        let iconHtml = `<div class="marker-icon" style="background:${bgColor}"><span class="material-symbols-rounded" style="font-size: 18px;">${icon}</span></div>`;
        if (poi.brandLogo) iconHtml = `<div class="marker-icon"><img src="${poi.brandLogo}" class="brand-logo-pin"></div>`;

        el.innerHTML = `${iconHtml}<div class="marker-label">${poi.name}</div>`;
        el.onclick = (e) => { e.stopPropagation(); openPoiDialog(poi); };
        markerContainer.appendChild(el);
    });
}

// ================= 交互事件 (双指缩放 & 长按) =================
container.addEventListener('mousedown', startInteraction);
container.addEventListener('touchstart', startInteraction, { passive: false });
window.addEventListener('mousemove', drag);
window.addEventListener('touchmove', drag, { passive: false });
window.addEventListener('mouseup', endInteraction);
window.addEventListener('touchend', endInteraction);
container.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY); });

function startInteraction(e) {
    if (e.target.closest('.bottom-sheet') || e.target.closest('.context-menu') || e.target.closest('.layer-menu')) return;
    closeMenus();

    // 中键呼出菜单 (电脑端)
    if (e.button === 1) { e.preventDefault(); showContextMenu(e.clientX, e.clientY); return; }

    const isTouch = e.type === 'touchstart';
    const touches = isTouch ? e.touches : null;
    
    // 双指手势
    if (isTouch && touches.length === 2) {
        clearTimeout(longPressTimer);
        isDragging = false;
        initialPinchDist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        initialZoom = appState.zoom;
        return;
    }

    isDragging = true;
    dragStartMouseX = isTouch ? touches[0].clientX : e.clientX;
    dragStartMouseY = isTouch ? touches[0].clientY : e.clientY;
    dragStartX = appState.x; dragStartZ = appState.z;
    
    // 长按判定 (500ms 内没有大范围移动则触发)
    longPressTimer = setTimeout(() => {
        isDragging = false; showContextMenu(dragStartMouseX, dragStartMouseY);
    }, LONG_PRESS_DURATION);
}

function drag(e) {
    const isTouch = e.type.startsWith('touch');
    if (isTouch && e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (initialPinchDist) {
            const zoomDelta = Math.log2(dist / initialPinchDist);
            const newZoom = Math.round(initialZoom + zoomDelta);
            if (newZoom !== appState.zoom) setZoom(newZoom);
        }
        return;
    }

    if (!isDragging) return;
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    
    if (Math.hypot(clientX - dragStartMouseX, clientY - dragStartMouseY) > 10) clearTimeout(longPressTimer);

    const scale = Math.pow(2, appState.zoom);
    appState.x = dragStartX - ((clientX - dragStartMouseX) / scale);
    appState.z = dragStartZ - ((clientY - dragStartMouseY) / scale);
    requestAnimationFrame(updateMap);
}

function endInteraction(e) { 
    clearTimeout(longPressTimer); isDragging = false; 
    if (e.type === 'touchend' && e.touches.length < 2) initialPinchDist = null;
}

function setZoom(newZ) {
    appState.zoom = Math.max(mapConfig.minZoom, Math.min(mapConfig.maxZoom, newZ));
    tileContainer.innerHTML = ''; updateMap();
}
container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0) setZoom(appState.zoom - 1); else if (e.deltaY < 0) setZoom(appState.zoom + 1);
}, { passive: false });

// ================= UI 与 路由模块 =================
function showContextMenu(screenX, screenY) {
    const scale = Math.pow(2, appState.zoom);
    const targetX = Math.round(appState.x + (screenX - w/2) / scale);
    const targetZ = Math.round(appState.z + (screenY - h/2) / scale);
    
    const menu = document.getElementById('context-menu');
    document.getElementById('ctx-coords').textContent = `${targetX}, ${targetZ}`;
    
    // 动画位移防止出屏幕
    menu.style.display = 'block';
    let mx = screenX; let my = screenY;
    if (mx + menu.offsetWidth > window.innerWidth) mx = window.innerWidth - menu.offsetWidth - 16;
    if (my + menu.offsetHeight > window.innerHeight) my = window.innerHeight - menu.offsetHeight - 16;
    menu.style.left = `${mx}px`; menu.style.top = `${my}px`;
    
    window.lastClickedCoords = {x: targetX, z: targetZ, name: `坐标 (${targetX}, ${targetZ})`};
}

// 打开地点对话框
function openPoiDialog(poi) {
    document.getElementById('sheet-route').style.display = 'none';
    const content = document.getElementById('sheet-poi');
    content.style.display = 'flex';
    
    const typeLabel = POI_TYPES[poi.type] || '地点';
    const brandHtml = poi.brandLogo ? `<img src="${poi.brandLogo}" class="brand-logo">` : '';

    content.innerHTML = `
        <div class="sheet-header-row">
            <div class="sheet-header">
                <h2>${poi.name}</h2>
                <div class="poi-type">${typeLabel}</div>
            </div>
            ${brandHtml}
        </div>
        <div class="action-buttons">
            <button class="action-btn" onclick="openRouteDialog(null, {x:${poi.x}, z:${poi.z}, name:'${poi.name}'})">
                <span class="material-symbols-rounded">directions</span>路线
            </button>
            <button class="action-btn secondary" onclick="copyCoordsFromPOI(${poi.x}, ${poi.z})">
                <span class="material-symbols-rounded">content_copy</span>复制坐标
            </button>
        </div>
    `;
    bottomSheet.classList.add('active');
}

// 路线引擎对话框
function openRouteDialog(startData, endData) {
    closeMenus();
    document.getElementById('sheet-poi').style.display = 'none';
    document.getElementById('sheet-route').style.display = 'flex';
    
    if (startData) routeState.start = startData;
    if (endData) routeState.end = endData;
    
    document.getElementById('route-start-input').value = routeState.start ? routeState.start.name : '';
    document.getElementById('route-end-input').value = routeState.end ? routeState.end.name : '';

    bottomSheet.classList.add('active');
    calculateAndRenderRoute();
}

function setRouteMode(mode) {
    routeState.mode = mode;
    document.getElementById('tab-drive').classList.toggle('active', mode === 'drive');
    document.getElementById('tab-transit').classList.toggle('active', mode === 'transit');
    calculateAndRenderRoute();
}

function calculateAndRenderRoute() {
    if (!routeState.start || !routeState.end) return;
    
    const graph = graphs[routeState.mode];
    const res = calculateRouteDijkstra(graph, routeState.start, routeState.end);
    
    const resultsDiv = document.getElementById('route-results');
    if (!res || res.path.length === 0) {
        // 没有找到依托于道路/轨交的路径，提示仅可使用虚线直达
        routeState.path = [];
        routeState.active = true;
        resultsDiv.innerHTML = `
            <div class="route-card active" onclick="closeBottomSheet()">
                <div>
                    <div class="route-card-title">无对应路线</div>
                    <div class="route-card-sub">直线距离 ${Math.round(Math.hypot(routeState.start.x - routeState.end.x, routeState.start.z - routeState.end.z))}</div>
                </div>
                <span class="material-symbols-rounded">arrow_forward</span>
            </div>`;
    } else {
        routeState.path = res.path;
        routeState.active = true;
        const min = Math.round(res.dist / (routeState.mode === 'drive' ? 30 : 60)) + 1; // 假设计算时间
        resultsDiv.innerHTML = `
            <div class="route-card active" onclick="closeBottomSheet()">
                <div>
                    <div class="route-card-title">${min} 分钟</div>
                    <div class="route-card-sub">建议路线 · ${Math.round(res.dist)} 米</div>
                </div>
                <span class="material-symbols-rounded" style="color:var(--md-sys-color-primary)">my_location</span>
            </div>`;
    }
    updateMap();
}

function renderActiveRoute(cx, cz, scale, w, h) {
    if (!routeState.active) return;
    const getScreenPt = (x, z) => `${(w/2) + (x*scale - cx)},${(h/2) + (z*scale - cz)}`;

    const startPx = getScreenPt(routeState.start.x, routeState.start.z);
    const endPx = getScreenPt(routeState.end.x, routeState.end.z);
    const color = routeState.mode === 'drive' ? '#0a56d9' : '#E53935';

    if (routeState.path.length > 0) {
        const pathD = generateSmoothPathD(routeState.path, scale, cx, cz, w, h);
        const rp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rp.setAttribute('d', pathD); rp.setAttribute('fill', 'none');
        rp.setAttribute('stroke', color); rp.setAttribute('stroke-width', 8); rp.setAttribute('stroke-linecap', 'round');
        lineLayer.appendChild(rp);

        // 虚线连接头尾
        const firstNode = getScreenPt(routeState.path[0].x, routeState.path[0].z);
        const lastNode = getScreenPt(routeState.path[routeState.path.length-1].x, routeState.path[routeState.path.length-1].z);
        lineLayer.innerHTML += `<path d="M ${startPx} L ${firstNode}" stroke="${color}" stroke-width="6" stroke-dasharray="8,8" />`;
        lineLayer.innerHTML += `<path d="M ${lastNode} L ${endPx}" stroke="${color}" stroke-width="6" stroke-dasharray="8,8" />`;
    } else {
        lineLayer.innerHTML += `<path d="M ${startPx} L ${endPx}" stroke="#0a56d9" stroke-width="6" stroke-dasharray="8,8" />`;
    }
}

function switchLayer(layer) {
    activeLayer = layer;
    document.querySelectorAll('.layer-menu button').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
    document.getElementById('layer-menu').style.display = 'none';
    updateMap();
}
document.getElementById('btn-layers').onclick = () => {
    const m = document.getElementById('layer-menu');
    m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
};

function closeMenus() { 
    document.getElementById('context-menu').style.display = 'none'; 
    document.getElementById('layer-menu').style.display = 'none'; 
}
function closeBottomSheet() { bottomSheet.classList.remove('active'); }
function copyCoords() { navigator.clipboard.writeText(`${window.lastClickedCoords.x}, ${window.lastClickedCoords.z}`); closeMenus(); }
function copyCoordsFromPOI(x, z) { navigator.clipboard.writeText(`${x}, ${z}`); alert("已复制"); }
function addLocationRedirect() { window.location.href = `add_marker.html?x=${window.lastClickedCoords.x}&z=${window.lastClickedCoords.z}`; }

// --- Tile Logic (保持与原版核心一致) ---
function renderTiles(cx, cz, scale, w, h) { /* 使用与之前相同的 Tile 加载逻辑 */ }

init();
