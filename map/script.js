let mapConfig = { minZoom: -6, maxZoom: 0, defaultZoom: -1, imageFormat: "webp" };
let appState = { x: 0, z: 0, zoom: -1, showCrosshair: true, showCoords: true, memoryEnabled: true, layerMode: 'all' };
let mapData = { regions: [], pois: [], roads: [], subways: [] };

// 路由与寻路状态
let routeState = { active: false, start: null, end: null, path: [], mode: 'drive', inputFocus: 'start' };
let roadGraph = new Map(); // 道路网
let transitGraph = new Map(); // 地铁网

// 交互状态
let isDragging = false;
let dragStartX, dragStartZ, dragStartMouseX, dragStartMouseY;
let longPressTimer;
let initialPinchDist = null, initialZoom = 0;

const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const lineLayer = document.getElementById('line-layer');
const bottomSheet = document.getElementById('bottom-sheet');
const routeSheet = document.getElementById('route-sheet');
const contextMenu = document.getElementById('context-menu');

const POI_TYPES = {
    'supermarket': '超市', 'hotel': '酒店', 'bank': '银行', 
    'school': '学校', 'government': '政府机关', 'mall': '商场', 
    'subway_station': '地铁站', 'hospital': '医院'
};

function init() {
    loadSettings();
    document.querySelector(`input[value="${appState.layerMode}"]`).checked = true;
    
    fetch('map_data.json').then(res => res.json()).then(data => {
        mapData = data;
        if (!appState.memoryEnabled && data.settings?.origin) {
            appState.x = data.settings.origin.x; appState.z = data.settings.origin.z;
        }
        buildGraphs();
        updateMap();
    }).catch(e => { console.error("加载地图数据失败", e); });
}

// ================= 路网与多模态寻路 =================
function buildGraphs() {
    roadGraph.clear(); transitGraph.clear();
    
    const addEdge = (graph, p1, p2, type, name) => {
        const k1 = `${p1.x},${p1.z}`; const k2 = `${p2.x},${p2.z}`;
        const dist = Math.hypot(p1.x - p2.x, p1.z - p2.z);
        if(!graph.has(k1)) graph.set(k1, []);
        if(!graph.has(k2)) graph.set(k2, []);
        graph.get(k1).push({ node: k2, dist, x: p2.x, z: p2.z, type, name });
        graph.get(k2).push({ node: k1, dist, x: p1.x, z: p1.z, type, name });
    };

    mapData.roads.forEach(road => {
        for (let i = 0; i < road.points.length - 1; i++) addEdge(roadGraph, road.points[i], road.points[i+1], road.type, road.name);
    });
    mapData.subways.forEach(sub => {
        for (let i = 0; i < sub.points.length - 1; i++) addEdge(transitGraph, sub.points[i], sub.points[i+1], 'subway', sub.name);
    });
}

function getNearestNode(graph, px, pz) {
    let nearest = null; let minD = Infinity;
    graph.forEach((edges, key) => {
        const [x, z] = key.split(',').map(Number);
        const d = Math.hypot(x - px, z - pz);
        if(d < minD) { minD = d; nearest = {x, z, key}; }
    });
    return nearest;
}

function calculateRoute(startX, startZ, endX, endZ, mode = 'drive') {
    const graph = mode === 'drive' ? roadGraph : transitGraph;
    const startNode = getNearestNode(graph, startX, startZ);
    const endNode = getNearestNode(graph, endX, endZ);
    
    if (!startNode || !endNode) return { path: [], dist: 0 };

    const distances = new Map(); const previous = new Map(); const unvisited = new Set();
    graph.forEach((_, key) => { distances.set(key, Infinity); unvisited.add(key); });
    distances.set(startNode.key, 0);

    while (unvisited.size > 0) {
        let currKey = null; let minD = Infinity;
        unvisited.forEach(key => { if (distances.get(key) < minD) { minD = distances.get(key); currKey = key; } });
        if (!currKey || currKey === endNode.key) break;
        unvisited.delete(currKey);

        graph.get(currKey).forEach(neighbor => {
            const alt = distances.get(currKey) + neighbor.dist;
            if (alt < distances.get(neighbor.node)) {
                distances.set(neighbor.node, alt); previous.set(neighbor.node, currKey);
            }
        });
    }

    const path = []; let curr = endNode.key; let totalDist = distances.get(endNode.key);
    if (previous.has(curr) || curr === startNode.key) {
        while (curr) {
            const [x, z] = curr.split(',').map(Number);
            path.unshift({x, z}); curr = previous.get(curr);
        }
    }
    return { path: path.length > 1 ? path : [], dist: totalDist === Infinity ? 0 : totalDist };
}

// ================= 渲染引擎 =================
function updateMap() {
    const scale = Math.pow(2, appState.zoom);
    const width = container.offsetWidth; const height = container.offsetHeight;
    const cx = appState.x * scale; const cz = appState.z * scale;
    
    document.getElementById('coords-display').textContent = `X: ${Math.round(appState.x)}, Z: ${Math.round(appState.z)}`;
    saveSettings();

    renderTiles(cx, cz, scale, width, height);
    renderRegions(cx, cz, scale, width, height);
    renderLines(cx, cz, scale, width, height);
    renderMarkers(cx, cz, scale, width, height);
    renderActiveRoute(cx, cz, scale, width, height);
}

// 贝塞尔平滑弯道生成 (控制半径)
function generateSmoothPathD(points, scale, cx, cz, width, height, baseRadius = 80) {
    if (points.length < 2) return "";
    let d = "";
    const getScreenPt = (pt) => ({ x: (width / 2) + (pt.x * scale - cx), y: (height / 2) + (pt.z * scale - cz) });

    for (let i = 0; i < points.length; i++) {
        const p = getScreenPt(points[i]);
        if (i === 0) { d += `M ${p.x} ${p.y} `; } 
        else if (i === points.length - 1) { d += `L ${p.x} ${p.y}`; } 
        else {
            const pPrev = getScreenPt(points[i-1]); const pNext = getScreenPt(points[i+1]);
            const d1 = Math.hypot(p.x - pPrev.x, p.y - pPrev.y);
            const d2 = Math.hypot(pNext.x - p.x, pNext.y - p.y);
            // 弯道半径随缩放比例变化，且受到实际线段长度限制
            const r = Math.min(baseRadius * scale, d1/2.2, d2/2.2); 
            
            const q1x = p.x - (p.x - pPrev.x) * (r / d1); const q1y = p.y - (p.y - pPrev.y) * (r / d1);
            const q2x = p.x + (pNext.x - p.x) * (r / d2); const q2y = p.y + (pNext.y - p.y) * (r / d2);
            
            d += `L ${q1x} ${q1y} Q ${p.x} ${p.y} ${q2x} ${q2y} `;
        }
    }
    return d;
}

function renderLines(cx, cz, scale, width, height) {
    lineLayer.innerHTML = '';
    const mode = appState.layerMode;
    if (mode === 'none') return;

    const drawLine = (lineData, isSubway) => {
        if (appState.zoom < lineData.minZoom || appState.zoom > lineData.maxZoom) return;
        
        // 动态粗细计算
        let baseW = isSubway ? 6 : (lineData.type === 'highway' ? 12 : (lineData.type === 'expressway' ? 8 : (lineData.type === 'main' ? 5 : 3)));
        let lw = Math.max(1.5, baseW * Math.pow(1.2, appState.zoom + 2)); // 缩放时线条粗细柔和变化
        
        // 渲染路径
        const pathD = generateSmoothPathD(lineData.points, scale, cx, cz, width, height, isSubway ? 120 : 60);
        const pathId = `path-${lineData.id}`;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('id', pathId); path.setAttribute('d', pathD); path.setAttribute('fill', 'none');
        
        if (isSubway) {
            path.setAttribute('stroke', lineData.color || '#E53935');
        } else {
            let color = lineData.type === 'highway' ? 'rgba(255, 179, 0, 0.9)' : 'rgba(255, 255, 255, 0.8)';
            if(lineData.type === 'path') path.setAttribute('stroke-dasharray', '5,5');
            path.setAttribute('stroke', color);
        }
        path.setAttribute('stroke-width', lw);
        path.setAttribute('stroke-linecap', 'round');
        lineLayer.appendChild(path);

        // 沿线文字多重标注
        if (lineData.name && scale >= 0.15) {
            let totalLen = 0;
            for(let i=0; i<lineData.points.length-1; i++) {
                totalLen += Math.hypot(lineData.points[i].x - lineData.points[i+1].x, lineData.points[i].z - lineData.points[i+1].z);
            }
            let screenLen = totalLen * scale;
            let labelCount = Math.max(1, Math.floor(screenLen / 600)); // 屏幕上每 600px 放置一个名称
            
            for(let i=1; i<=labelCount; i++) {
                let pct = (i / (labelCount + 1)) * 100;
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('class', isSubway ? 'subway-text' : 'road-text');
                text.setAttribute('dy', isSubway ? -lw/2 - 2 : 4); // 地铁字在上方，道路字居中
                if (isSubway) text.setAttribute('fill', lineData.color || '#fff');
                text.innerHTML = `<textPath href="#${pathId}" startOffset="${pct}%">${lineData.name}</textPath>`;
                lineLayer.appendChild(text);
            }
        }
    };

    if (mode === 'all' || mode === 'drive') mapData.roads.forEach(r => drawLine(r, false));
    if (mode === 'all' || mode === 'transit') mapData.subways.forEach(s => drawLine(s, true));
}

function renderActiveRoute(cx, cz, scale, width, height) {
    if (!routeState.active || !routeState.start || !routeState.end) return;
    const getScreenPt = (x, z) => `${(width / 2) + (x * scale - cx)},${(height / 2) + (z * scale - cz)}`;

    const strokeColor = routeState.mode === 'transit' ? '#9C27B0' : '#1976D2';

    if (routeState.path.length > 0) {
        const pathD = generateSmoothPathD(routeState.path, scale, cx, cz, width, height, 40);
        lineLayer.innerHTML += `<path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="8" stroke-linecap="round" />`;
        
        const first = getScreenPt(routeState.path[0].x, routeState.path[0].z);
        const last = getScreenPt(routeState.path[routeState.path.length-1].x, routeState.path[routeState.path.length-1].z);
        const sPx = getScreenPt(routeState.start.x, routeState.start.z);
        const ePx = getScreenPt(routeState.end.x, routeState.end.z);
        
        lineLayer.innerHTML += `<path d="M ${sPx} L ${first}" stroke="${strokeColor}" stroke-width="5" stroke-dasharray="8,8" />`;
        lineLayer.innerHTML += `<path d="M ${last} L ${ePx}" stroke="${strokeColor}" stroke-width="5" stroke-dasharray="8,8" />`;
    } else {
        const sPx = getScreenPt(routeState.start.x, routeState.start.z);
        const ePx = getScreenPt(routeState.end.x, routeState.end.z);
        lineLayer.innerHTML += `<path d="M ${sPx} L ${ePx}" stroke="${strokeColor}" stroke-width="5" stroke-dasharray="8,8" />`;
    }
}

function renderRegions(cx, cz, scale, width, height) {
    mapData.regions.forEach(reg => {
        if (appState.zoom < reg.minZoom || appState.zoom > reg.maxZoom) return;
        const sx = (width / 2) + (reg.x * scale - cx);
        const sy = (height / 2) + (reg.z * scale - cz);
        if (sx < -200 || sx > width + 200 || sy < -200 || sy > height + 200) return;
        
        const el = document.createElement('div');
        el.className = 'marker-region';
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        el.textContent = reg.name;
        markerContainer.appendChild(el);
    });
}

function renderMarkers(cx, cz, scale, width, height) {
    let allPois = [...mapData.pois];
    mapData.subways.forEach(sub => {
        if(sub.stations) sub.stations.forEach(st => allPois.push({ ...st, type: 'subway_station', companyLogo: sub.logo }));
    });

    allPois.forEach(poi => {
        if (appState.zoom < (poi.minZoom || -3) || appState.zoom > (poi.maxZoom || 0)) return;
        const sx = (width / 2) + (poi.x * scale - cx);
        const sy = (height / 2) + (poi.z * scale - cz);
        if (sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50) return; 
        
        const el = document.createElement('div');
        el.className = 'map-marker';
        // 边界碰撞检测：如果在屏幕最右侧，文字显示在左侧
        if (sx > width - 120) el.classList.add('reverse');
        
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        
        let icon = 'location_on'; let bgColor = 'var(--md-sys-color-primary)';
        if(poi.type === 'supermarket') icon = 'shopping_cart';
        if(poi.type === 'hotel') { icon = 'bed'; bgColor = '#8E24AA'; }
        if(poi.type === 'bank') icon = 'account_balance';
        if(poi.type === 'subway_station') { icon = 'directions_subway'; bgColor = '#E53935'; }

        let iconHtml = `<div class="marker-icon" style="background:${bgColor}"><span class="material-symbols-rounded" style="font-size: 18px;">${icon}</span></div>`;
        if (poi.companyLogo) iconHtml = `<div class="marker-icon"><img src="${poi.companyLogo}" class="transit-logo"></div>`;

        el.innerHTML = `${iconHtml}<div class="marker-label">${poi.name}</div>`;
        el.onclick = (e) => { e.stopPropagation(); handlePoiClick(poi); };
        markerContainer.appendChild(el);
    });
}

// ================= 交互与手势 =================
container.addEventListener('mousedown', startDrag);
container.addEventListener('touchstart', startDrag, { passive: false });
window.addEventListener('mousemove', drag);
window.addEventListener('touchmove', drag, { passive: false });
window.addEventListener('mouseup', endDrag);
window.addEventListener('touchend', endDrag);

function startDrag(e) {
    if (e.target.closest('.bottom-sheet') || e.target.closest('.context-menu')) return;
    
    // 鼠标中键直接呼出菜单
    if (e.button === 1) { e.preventDefault(); showContextMenu(e.clientX, e.clientY); return; }
    
    hideMenus();
    if (e.type === 'touchstart' && e.touches.length === 2) {
        initialPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        initialZoom = appState.zoom;
        return;
    }

    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    
    isDragging = true; dragStartMouseX = clientX; dragStartMouseY = clientY;
    dragStartX = appState.x; dragStartZ = appState.z;
    
    // 严格长按检测
    longPressTimer = setTimeout(() => {
        isDragging = false; showContextMenu(clientX, clientY);
    }, 600);
}

function drag(e) {
    // 双指缩放
    if (e.type === 'touchmove' && e.touches.length === 2) {
        e.preventDefault(); clearTimeout(longPressTimer);
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (initialPinchDist) {
            const zoomDelta = Math.log2(dist / initialPinchDist);
            const newZoom = Math.max(mapConfig.minZoom, Math.min(mapConfig.maxZoom, initialZoom + zoomDelta));
            if (Math.abs(newZoom - appState.zoom) > 0.1) {
                appState.zoom = newZoom; updateMap();
            }
        }
        return;
    }

    if (!isDragging) return;
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    
    if (Math.abs(clientX - dragStartMouseX) > 5 || Math.abs(clientY - dragStartMouseY) > 5) {
        clearTimeout(longPressTimer);
    }

    const scale = Math.pow(2, appState.zoom);
    appState.x = dragStartX - ((clientX - dragStartMouseX) / scale);
    appState.z = dragStartZ - ((clientY - dragStartMouseY) / scale);
    requestAnimationFrame(updateMap);
}

function endDrag() { clearTimeout(longPressTimer); isDragging = false; initialPinchDist = null; }

function setZoom(newZoom) {
    newZoom = Math.max(mapConfig.minZoom, Math.min(mapConfig.maxZoom, newZoom));
    if (newZoom === appState.zoom) return;
    appState.zoom = Math.round(newZoom); tileContainer.innerHTML = ''; updateMap();
}
document.getElementById('btn-zoom-in').onclick = () => setZoom(appState.zoom + 1);
document.getElementById('btn-zoom-out').onclick = () => setZoom(appState.zoom - 1);
container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0) setZoom(appState.zoom - 1); else if (e.deltaY < 0) setZoom(appState.zoom + 1);
}, { passive: false });

// ================= UI 与 路由面版 =================
function showContextMenu(screenX, screenY) {
    const scale = Math.pow(2, appState.zoom);
    const targetX = Math.round(appState.x + (screenX - container.offsetWidth/2) / scale);
    const targetZ = Math.round(appState.z + (screenY - container.offsetHeight/2) / scale);
    
    document.getElementById('ctx-coords').textContent = `${targetX}, ${targetZ}`;
    window.lastClickedCoords = {x: targetX, z: targetZ};
    
    // 边界限制防止出界
    const menuWidth = 220; const menuHeight = 210;
    let left = screenX; let top = screenY;
    if(left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 16;
    if(top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 16;
    
    contextMenu.style.left = `${left}px`; contextMenu.style.top = `${top}px`;
    contextMenu.style.display = 'block';
}

function handlePoiClick(poi) {
    if (routeSheet.classList.contains('active')) {
        // 如果在选点模式，填充输入框
        if (routeState.inputFocus === 'start') {
            routeState.start = {x: poi.x, z: poi.z, name: poi.name};
            document.getElementById('route-start-input').value = poi.name;
        } else {
            routeState.end = {x: poi.x, z: poi.z, name: poi.name};
            document.getElementById('route-end-input').value = poi.name;
        }
        generateRouteOptions();
        return;
    }
    openBottomSheet(poi);
}

function openBottomSheet(poi) {
    const typeLabel = POI_TYPES[poi.type] || '地点';
    const brandHtml = poi.companyLogo ? `<img src="${poi.companyLogo}" class="brand-logo">` : '';
    let imagesHtml = poi.images ? `<div class="sheet-images">${poi.images.map(img => `<img src="${img}">`).join('')}</div>` : '';

    document.getElementById('sheet-content').innerHTML = `
        <div class="sheet-header-row">
            <div class="sheet-header">
                <h2>${poi.name}</h2>
                <div class="poi-type">${typeLabel} ${poi.status ? `· <span style="font-weight:normal; color:var(--md-sys-color-outline)">${poi.status}</span>` : ''}</div>
            </div>
            ${brandHtml}
        </div>
        <div class="action-buttons">
            <button class="action-btn" onclick="openRoutePlanner('end', ${poi.x}, ${poi.z}, '${poi.name}')"><div class="icon"><span class="material-symbols-rounded">directions</span></div>路线</button>
            ${poi.website ? `<button class="action-btn" onclick="window.open('${poi.website}')"><div class="icon"><span class="material-symbols-rounded">language</span></div>网站</button>` : ''}
            <button class="action-btn" onclick="copyCoords()"><div class="icon"><span class="material-symbols-rounded">share</span></div>分享</button>
        </div>
        ${imagesHtml}
        ${poi.remarks ? `<p style="color: var(--md-sys-color-outline); line-height: 1.5; border-top: 1px solid var(--md-sys-color-surface-container); padding-top: 16px;">${poi.remarks}</p>` : ''}
    `;
    bottomSheet.classList.add('active');
}

// 路线规划核心 UI
function openRoutePlanner(focus, x, z, name) {
    hideMenus();
    routeSheet.classList.add('active');
    document.getElementById('btn-exit-route').style.display = 'flex';
    
    let targetCoords = (x !== undefined) ? {x, z, name: name || `${x}, ${z}`} : {x: window.lastClickedCoords.x, z: window.lastClickedCoords.z, name: "已选地图位置"};
    
    if (focus === 'start') {
        routeState.start = targetCoords; document.getElementById('route-start-input').value = targetCoords.name;
        focusRouteInput('end');
    } else {
        routeState.end = targetCoords; document.getElementById('route-end-input').value = targetCoords.name;
        if(!routeState.start) focusRouteInput('start'); else focusRouteInput('none');
    }
    generateRouteOptions();
}

function focusRouteInput(type) {
    routeState.inputFocus = type;
    document.getElementById('route-start-input').classList.toggle('active', type === 'start');
    document.getElementById('route-end-input').classList.toggle('active', type === 'end');
}

function swapRoute() {
    let temp = routeState.start; routeState.start = routeState.end; routeState.end = temp;
    document.getElementById('route-start-input').value = routeState.start ? routeState.start.name : '';
    document.getElementById('route-end-input').value = routeState.end ? routeState.end.name : '';
    generateRouteOptions();
}

function generateRouteOptions() {
    if (!routeState.start || !routeState.end) return;
    
    const driveResult = calculateRoute(routeState.start.x, routeState.start.z, routeState.end.x, routeState.end.z, 'drive');
    const transitResult = calculateRoute(routeState.start.x, routeState.start.z, routeState.end.x, routeState.end.z, 'transit');
    
    // 简单估算时间 (假设 Minecraft 距离单位为米)
    const driveTime = Math.ceil(driveResult.dist / 15); // 约 54km/h
    const transitTime = Math.ceil(transitResult.dist / 20) + 5; // 加上进站时间

    let html = '';
    html += `
        <div class="route-option ${routeState.mode === 'drive' ? 'selected' : ''}" onclick="applyRoute('drive', ${JSON.stringify(driveResult.path)})">
            <span class="material-symbols-rounded icon">directions_car</span>
            <div class="route-details">
                <div class="time">${driveTime > 0 ? driveTime + ' 分钟' : '无直达道路'}</div>
                <div class="desc">推荐驾驶路线</div>
            </div>
        </div>`;
        
    html += `
        <div class="route-option ${routeState.mode === 'transit' ? 'selected' : ''}" onclick="applyRoute('transit', ${JSON.stringify(transitResult.path)})">
            <span class="material-symbols-rounded icon">directions_subway</span>
            <div class="route-details">
                <div class="time">${transitTime > 5 ? transitTime + ' 分钟' : '无轨道交通'}</div>
                <div class="desc">轨道交通路线</div>
            </div>
        </div>`;
        
    document.getElementById('route-options-list').innerHTML = html;
    
    // 默认应用第一种可行的
    applyRoute(routeState.mode, routeState.mode === 'drive' ? driveResult.path : transitResult.path);
}

function applyRoute(mode, path) {
    routeState.mode = mode; routeState.path = path; routeState.active = true;
    generateRouteOptions(); // 刷新 UI 选中状态
    updateMap();
}

document.getElementById('btn-exit-route').onclick = () => {
    routeState = { active: false, start: null, end: null, path: [], mode: 'drive', inputFocus: 'start' };
    document.getElementById('route-start-input').value = '';
    document.getElementById('route-end-input').value = '';
    document.getElementById('route-options-list').innerHTML = '';
    document.getElementById('btn-exit-route').style.display = 'none';
    routeSheet.classList.remove('active');
    updateMap();
}

// ================= 图层切换及其他工具 =================
document.getElementById('btn-layers').onclick = () => {
    const menu = document.getElementById('layer-menu');
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
};
document.querySelectorAll('input[name="map_layer"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        appState.layerMode = e.target.value;
        document.getElementById('layer-menu').style.display = 'none';
        updateMap();
    });
});

function hideMenus() { 
    bottomSheet.classList.remove('active'); 
    contextMenu.style.display = 'none';
    document.getElementById('layer-menu').style.display = 'none';
}
function copyCoords() {
    const text = `${window.lastClickedCoords.x}, ${window.lastClickedCoords.z}`;
    navigator.clipboard.writeText(text); hideMenus(); alert("坐标已复制: " + text);
}
function addLocationRedirect() {
    window.location.href = `add_marker.html?x=${window.lastClickedCoords.x}&z=${window.lastClickedCoords.z}`;
}

// (保留之前的 renderTiles, loadSettings, saveSettings 等通用函数)
function renderTiles(cx, cz, scale, width, height) {
    const txC = Math.floor(cx / 256); const tzC = Math.floor(cz / 256);
    const rX = Math.ceil(width / 2 / 256) + 1; const rZ = Math.ceil(height / 2 / 256) + 1;
    const needed = new Set();
    for (let tx = txC - rX; tx <= txC + rX; tx++) {
        for (let tz = tzC - rZ; tz <= tzC + rZ; tz++) {
            const key = `${appState.zoom}_${tx}_${tz}`; needed.add(key);
            let img = tileContainer.querySelector(`img[data-key="${key}"]`);
            if (!img) {
                img = document.createElement('img'); img.dataset.key = key;
                img.src = `./tiles/zoom.${appState.zoom}/${Math.floor(tx/10)}/${Math.floor(tz/10)}/tile.${tx}.${tz}.${mapConfig.imageFormat}`;
                img.onerror = () => img.style.display = 'none'; tileContainer.appendChild(img);
            }
            img.style.left = `${Math.round((width / 2) + (tx * 256 - cx))}px`; img.style.top = `${Math.round((height / 2) + (tz * 256 - cz))}px`;
        }
    }
    Array.from(tileContainer.children).forEach(img => { if (!needed.has(img.dataset.key)) img.remove(); });
}

function loadSettings() { const saved = localStorage.getItem('mapAppState'); if (saved) Object.assign(appState, JSON.parse(saved)); }
function saveSettings() { localStorage.setItem('mapAppState', JSON.stringify(appState)); }

document.getElementById('btn-my-location').onclick = () => { appState.x = 0; appState.z = 0; updateMap(); };
init();
