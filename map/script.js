let mapConfig = { minZoom: -6, maxZoom: 0, defaultZoom: -1, imageFormat: "webp", curveRadius: 50 };
let appState = { x: 0, z: 0, zoom: -1, showCrosshair: true, showCoords: true, memoryEnabled: true };
let mapData = { regions: [], pois: [], roads: [], subways: [] };

// 图层模式: 'all', 'raw', 'transit', 'travel'
let currentLayerMode = 'all';

// 路由状态
let routeState = { active: false, start: null, end: null, path: [] };
let roadGraph = new Map();

// 手势交互
let isDragging = false;
let dragStartX, dragStartZ, dragStartMouseX, dragStartMouseY;
let longPressTimer;
let initialPinchDistance = null;
let initialPinchZoom = null;

const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const lineLayer = document.getElementById('line-layer');
const coordsDisplay = document.getElementById('coords-display');
const bottomSheet = document.getElementById('bottom-sheet');
const layerMenu = document.getElementById('layer-menu');

const POI_TYPES = {
    'supermarket': '超市', 'hotel': '酒店', 'bank': '银行', 
    'school': '学校', 'government': '政府机关', 'mall': '商场', 
    'museum': '博物馆', 'park': '公园', 'restaurant': '餐厅', 
    'cafe': '咖啡吧', 'subway_station': '地铁站'
};

function init() {
    loadSettings();
    document.getElementById('curve-radius').value = mapConfig.curveRadius;
    document.getElementById('curve-radius').oninput = (e) => { mapConfig.curveRadius = parseInt(e.target.value); updateMap(); };

    fetch('map_data.json').then(res => res.json()).then(data => {
        mapData = data;
        if (!appState.memoryEnabled && data.settings?.origin) {
            appState.x = data.settings.origin.x; appState.z = data.settings.origin.z;
        }
        buildRoadGraph();
        updateMap();
    }).catch(e => { console.error("加载失败", e); updateMap(); });
}

// ================= 路网与寻路 =================
function buildRoadGraph() {
    roadGraph.clear();
    const addEdge = (p1, p2) => {
        const k1 = `${p1.x},${p1.z}`; const k2 = `${p2.x},${p2.z}`;
        const dist = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.z - p2.z, 2));
        if(!roadGraph.has(k1)) roadGraph.set(k1, []);
        if(!roadGraph.has(k2)) roadGraph.set(k2, []);
        roadGraph.get(k1).push({ node: k2, dist, x: p2.x, z: p2.z });
        roadGraph.get(k2).push({ node: k1, dist, x: p1.x, z: p1.z });
    };
    mapData.roads.forEach(road => {
        for (let i = 0; i < road.points.length - 1; i++) addEdge(road.points[i], road.points[i+1]);
    });
}

function getNearestRoadNode(px, pz) {
    let nearest = null; let minD = Infinity;
    roadGraph.forEach((edges, key) => {
        const [x, z] = key.split(',').map(Number);
        const d = Math.sqrt(Math.pow(x - px, 2) + Math.pow(z - pz, 2));
        if(d < minD) { minD = d; nearest = {x, z, key}; }
    });
    return nearest;
}

function calculateRoute(startX, startZ, endX, endZ) {
    const startNode = getNearestRoadNode(startX, startZ);
    const endNode = getNearestRoadNode(endX, endZ);
    if (!startNode || !endNode) return [];

    const distances = new Map(); const previous = new Map(); const unvisited = new Set();
    roadGraph.forEach((_, key) => { distances.set(key, Infinity); unvisited.add(key); });
    distances.set(startNode.key, 0);

    while (unvisited.size > 0) {
        let currKey = null; let minD = Infinity;
        unvisited.forEach(key => { if (distances.get(key) < minD) { minD = distances.get(key); currKey = key; } });
        if (!currKey || currKey === endNode.key) break;
        unvisited.delete(currKey);

        roadGraph.get(currKey).forEach(neighbor => {
            const alt = distances.get(currKey) + neighbor.dist;
            if (alt < distances.get(neighbor.node)) { distances.set(neighbor.node, alt); previous.set(neighbor.node, currKey); }
        });
    }

    const path = []; let curr = endNode.key;
    if (previous.has(curr) || curr === startNode.key) {
        while (curr) { const [x, z] = curr.split(',').map(Number); path.unshift({x, z}); curr = previous.get(curr); }
    }
    return path;
}

// ================= 核心渲染 =================
function switchLayer(mode) {
    currentLayerMode = mode;
    layerMenu.style.display = 'none';
    updateMap();
}
document.getElementById('btn-layers').onclick = () => layerMenu.style.display = layerMenu.style.display === 'flex' ? 'none' : 'flex';

function updateMap() {
    const scale = Math.pow(2, appState.zoom);
    const width = container.offsetWidth; const height = container.offsetHeight;
    const cx = appState.x * scale; const cz = appState.z * scale;
    coordsDisplay.textContent = `X: ${Math.round(appState.x)}, Z: ${Math.round(appState.z)}`;
    saveSettings();

    renderTiles(cx, cz, scale, width, height);
    lineLayer.innerHTML = ''; markerContainer.innerHTML = '';

    if (currentLayerMode !== 'raw') {
        if (currentLayerMode === 'all' || currentLayerMode === 'travel') renderLines(cx, cz, scale, width, height, false);
        if (currentLayerMode === 'all' || currentLayerMode === 'transit') renderLines(cx, cz, scale, width, height, true);
        renderMarkers(cx, cz, scale, width, height);
    }
    renderActiveRoute(cx, cz, scale, width, height);
}

function generateSmoothPathD(points, scale, cx, cz, width, height) {
    if (points.length < 2) return "";
    let d = "";
    const getScreenPt = (pt) => ({ x: (width / 2) + (pt.x * scale - cx), y: (height / 2) + (pt.z * scale - cz) });
    const radius = mapConfig.curveRadius; // 可控平滑度

    for (let i = 0; i < points.length; i++) {
        const p = getScreenPt(points[i]);
        if (i === 0) { d += `M ${p.x} ${p.y} `; } 
        else if (i === points.length - 1) { d += `L ${p.x} ${p.y}`; } 
        else {
            const pPrev = getScreenPt(points[i-1]); const pNext = getScreenPt(points[i+1]);
            const d1 = Math.sqrt(Math.pow(p.x - pPrev.x, 2) + Math.pow(p.y - pPrev.y, 2));
            const d2 = Math.sqrt(Math.pow(pNext.x - p.x, 2) + Math.pow(pNext.y - p.y, 2));
            const r = Math.min(radius * scale, d1/2, d2/2); 
            const q1x = p.x - (p.x - pPrev.x) * (r / d1); const q1y = p.y - (p.y - pPrev.y) * (r / d1);
            const q2x = p.x + (pNext.x - p.x) * (r / d2); const q2y = p.y + (pNext.y - p.y) * (r / d2);
            d += `L ${q1x} ${q1y} Q ${p.x} ${p.y} ${q2x} ${q2y} `;
        }
    }
    return d;
}

function renderLines(cx, cz, scale, width, height, isSubway) {
    const dataSource = isSubway ? mapData.subways : mapData.roads;
    
    dataSource.forEach(lineData => {
        if (appState.zoom < lineData.minZoom || appState.zoom > lineData.maxZoom) return;
        const pathD = generateSmoothPathD(lineData.points, scale, cx, cz, width, height);
        const pathId = `path-${lineData.id}`;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('id', pathId); path.setAttribute('d', pathD); path.setAttribute('fill', 'none');
        
        if (isSubway) {
            path.setAttribute('stroke', lineData.color || '#E53935'); path.setAttribute('stroke-width', 4);
        } else {
            let lw = lineData.type === 'highway' ? 8 : (lineData.type === 'expressway' ? 6 : (lineData.type === 'main' ? 4 : 2));
            let color = lineData.type === 'highway' ? 'rgba(255, 160, 0, 0.7)' : 'rgba(255, 255, 255, 0.6)';
            path.setAttribute('stroke', color); path.setAttribute('stroke-width', lw);
        }
        path.setAttribute('stroke-linecap', 'round');
        lineLayer.appendChild(path);

        // 动态多标签渲染 (根据比例尺决定显示几个名字)
        if (lineData.name) {
            const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textGroup.setAttribute('class', 'road-text');
            textGroup.setAttribute('dy', isSubway ? -6 : 4); 

            let offsets = ['50%'];
            if (scale > 0.2) offsets = ['25%', '75%'];
            if (scale > 0.5) offsets = ['20%', '50%', '80%'];

            offsets.forEach(offset => {
                const textPath = document.createElementNS('http://www.w3.org/2000/svg', 'textPath');
                textPath.setAttribute('href', `#${pathId}`);
                textPath.setAttribute('startOffset', offset);
                textPath.textContent = lineData.name;
                textGroup.appendChild(textPath);
            });
            lineLayer.appendChild(textGroup);
        }
    });
}

function renderMarkers(cx, cz, scale, width, height) {
    let allPois = [...mapData.pois];
    if (currentLayerMode !== 'travel') { // 如果不是只看公路，就把地铁站加进来
        mapData.subways.forEach(sub => {
            if(sub.stations) sub.stations.forEach(st => allPois.push({ ...st, type: 'subway_station', companyLogo: sub.logo }));
        });
    }

    allPois.forEach(poi => {
        if (appState.zoom < (poi.minZoom || -3) || appState.zoom > (poi.maxZoom || 0)) return;
        const sx = (width / 2) + (poi.x * scale - cx);
        const sy = (height / 2) + (poi.z * scale - cz);
        if (sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) return; 
        
        const el = document.createElement('div');
        el.className = 'map-marker';
        // 智能防碰撞：如果靠右边，把文字丢到左侧
        if (sx > width - 120) el.classList.add('label-left');

        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        
        let icon = 'location_on'; let bgColor = 'var(--md-sys-color-primary)';
        if(poi.type === 'supermarket') icon = 'shopping_cart';
        if(poi.type === 'hotel') { icon = 'hotel'; bgColor = '#8E24AA'; } 
        if(poi.type === 'bank') icon = 'account_balance';
        if(poi.type === 'subway_station') { icon = 'directions_subway'; bgColor = '#E53935'; }

        let iconHtml = `<div class="marker-icon" style="background:${bgColor}"><span class="material-symbols-rounded" style="font-size: 18px;">${icon}</span></div>`;
        if (poi.companyLogo) iconHtml = `<div class="marker-icon"><img src="${poi.companyLogo}" class="transit-logo"></div>`;

        el.innerHTML = `${iconHtml}<div class="marker-label">${poi.name}</div>`;
        el.onclick = (e) => { e.stopPropagation(); openBottomSheet(poi); };
        markerContainer.appendChild(el);
    });
}

// ================= 手势交互 (移动端双指缩放) =================
container.addEventListener('touchstart', startInteraction, { passive: false });
container.addEventListener('touchmove', dragOrZoom, { passive: false });
container.addEventListener('touchend', endInteraction);
container.addEventListener('mousedown', startInteraction);
window.addEventListener('mousemove', dragOrZoom);
window.addEventListener('mouseup', endInteraction);

function startInteraction(e) {
    if (e.target.closest('.bottom-sheet') || e.target.closest('.context-menu') || e.target.closest('.layer-menu')) return;
    hideMenus();
    
    if (e.type === 'touchstart' && e.touches.length === 2) {
        // 双指按下，准备缩放
        initialPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        initialPinchZoom = appState.zoom;
        isDragging = false;
        return;
    }

    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    
    isDragging = true; dragStartMouseX = clientX; dragStartMouseY = clientY;
    dragStartX = appState.x; dragStartZ = appState.z;
    
    longPressTimer = setTimeout(() => { isDragging = false; showContextMenu(clientX, clientY); }, 500);
}

function dragOrZoom(e) {
    if (e.type === 'touchmove' && e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (initialPinchDistance) {
            const zoomDelta = Math.log2(dist / initialPinchDistance);
            // 阈值触发离散缩放 (配合瓦片机制)
            if (zoomDelta > 0.5) { setZoom(appState.zoom + 1); initialPinchDistance = dist; }
            else if (zoomDelta < -0.5) { setZoom(appState.zoom - 1); initialPinchDistance = dist; }
        }
        return;
    }

    if (!isDragging) return;
    e.preventDefault();
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    
    if (Math.abs(clientX - dragStartMouseX) > 5 || Math.abs(clientY - dragStartMouseY) > 5) clearTimeout(longPressTimer);

    const scale = Math.pow(2, appState.zoom);
    appState.x = dragStartX - ((clientX - dragStartMouseX) / scale);
    appState.z = dragStartZ - ((clientY - dragStartMouseY) / scale);
    requestAnimationFrame(updateMap);
}

function endInteraction() { clearTimeout(longPressTimer); isDragging = false; initialPinchDistance = null; }

function setZoom(newZoom) {
    newZoom = Math.max(mapConfig.minZoom, Math.min(mapConfig.maxZoom, newZoom));
    if (newZoom === appState.zoom) return;
    appState.zoom = newZoom; tileContainer.innerHTML = ''; updateMap();
}
document.getElementById('btn-zoom-in').onclick = () => setZoom(appState.zoom + 1);
document.getElementById('btn-zoom-out').onclick = () => setZoom(appState.zoom - 1);
container.addEventListener('wheel', (e) => { e.preventDefault(); if (e.deltaY > 0) setZoom(appState.zoom - 1); else if (e.deltaY < 0) setZoom(appState.zoom + 1); }, { passive: false });


// ================= 路由 UI =================
function setRouteStart() { routeState.start = { ...window.lastClickedCoords, name: '地图选点' }; checkAndRoute(); hideMenus(); }
function setRouteEnd() { routeState.end = { ...window.lastClickedCoords, name: '地图选点' }; checkAndRoute(); hideMenus(); }

function checkAndRoute() {
    if (routeState.start && routeState.end) {
        routeState.path = calculateRoute(routeState.start.x, routeState.start.z, routeState.end.x, routeState.end.z);
        routeState.active = true;
        document.getElementById('btn-exit-route').style.display = 'flex';
        updateMap();
        openRouteBottomSheet(); // 打开多方案路线面板
    }
}

function openRouteBottomSheet() {
    const content = document.getElementById('sheet-content');
    // 模拟 Google Maps 路线多方案 UI
    content.innerHTML = `
        <div class="sheet-header-row"><div class="sheet-header"><h2>路线概览</h2></div></div>
        <div class="route-ui-container">
            <div class="route-modes">
                <button class="route-mode-btn active"><span class="material-symbols-rounded">directions_car</span></button>
                <button class="route-mode-btn"><span class="material-symbols-rounded">directions_walk</span></button>
                <button class="route-mode-btn"><span class="material-symbols-rounded">directions_transit</span></button>
            </div>
            <div class="route-locations">
                <div class="route-loc-row"><div class="route-dot"></div><input class="route-input" value="${routeState.start.name || '我的位置'}" readonly></div>
                <div class="route-loc-row"><div class="route-dot dest"></div><input class="route-input" value="${routeState.end.name || '目的地'}" readonly></div>
            </div>
            <div class="route-options">
                <div class="route-card suggested">
                    <div><h4>22 分钟</h4><p>建议路线 · 距离较短</p></div>
                    <span class="material-symbols-rounded" style="color:var(--md-sys-color-primary)">assistant_navigation</span>
                </div>
                <div class="route-card">
                    <div><h4 style="color:var(--md-sys-color-outline)">24 分钟</h4><p>备选路线 · 途径中央大道</p></div>
                </div>
            </div>
        </div>
    `;
    bottomSheet.classList.add('active');
}

function renderActiveRoute(cx, cz, scale, width, height) {
    if (!routeState.active) return;
    const getScreenPt = (x, z) => `${(width / 2) + (x * scale - cx)},${(height / 2) + (z * scale - cz)}`;
    if (routeState.path.length > 0) {
        const pathD = generateSmoothPathD(routeState.path, scale, cx, cz, width, height);
        const rp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rp.setAttribute('d', pathD); rp.setAttribute('fill', 'none'); rp.setAttribute('stroke', '#1976D2');
        rp.setAttribute('stroke-width', 6); rp.setAttribute('stroke-linecap', 'round');
        lineLayer.appendChild(rp);
    }
    const startPx = getScreenPt(routeState.start.x, routeState.start.z); const endPx = getScreenPt(routeState.end.x, routeState.end.z);
    if (routeState.path.length > 0) {
        const firstNode = getScreenPt(routeState.path[0].x, routeState.path[0].z);
        const lastNode = getScreenPt(routeState.path[routeState.path.length-1].x, routeState.path[routeState.path.length-1].z);
        lineLayer.innerHTML += `<path d="M ${startPx} L ${firstNode}" stroke="#1976D2" stroke-width="4" stroke-dasharray="8,8" />`;
        lineLayer.innerHTML += `<path d="M ${lastNode} L ${endPx}" stroke="#1976D2" stroke-width="4" stroke-dasharray="8,8" />`;
    } else {
        lineLayer.innerHTML += `<path d="M ${startPx} L ${endPx}" stroke="#1976D2" stroke-width="4" stroke-dasharray="8,8" />`;
    }
}

document.getElementById('btn-exit-route').onclick = () => {
    routeState = { active: false, start: null, end: null, path: [] };
    document.getElementById('btn-exit-route').style.display = 'none';
    hideMenus(); updateMap();
}

function showContextMenu(screenX, screenY) {
    const scale = Math.pow(2, appState.zoom);
    const targetX = Math.round(appState.x + (screenX - container.offsetWidth/2) / scale);
    const targetZ = Math.round(appState.z + (screenY - container.offsetHeight/2) / scale);
    const menu = document.getElementById('context-menu');
    document.getElementById('ctx-coords').textContent = `${targetX}, ${targetZ}`;
    menu.style.left = `${screenX}px`; menu.style.top = `${screenY}px`;
    menu.style.display = 'block';
    window.lastClickedCoords = {x: targetX, z: targetZ};
}

function openBottomSheet(poi) {
    const content = document.getElementById('sheet-content');
    const typeLabel = POI_TYPES[poi.type] || '地点';
    const brandHtml = poi.brandLogo ? `<img src="${poi.brandLogo}" class="brand-logo">` : '';

    content.innerHTML = `
        <div class="sheet-header-row">
            <div class="sheet-header">
                <h2>${poi.name}</h2>
                <div class="poi-type">${typeLabel} ${poi.status ? `· <span style="font-weight:normal; color:#555">${poi.status}</span>` : ''}</div>
            </div>
            ${brandHtml}
        </div>
        <div class="action-buttons">
            <button class="action-btn" onclick="window.lastClickedCoords={x:${poi.x},z:${poi.z},name:'${poi.name}'}; setRouteEnd();"><div class="icon"><span class="material-symbols-rounded">directions</span></div>路线</button>
            <button class="action-btn" onclick="window.lastClickedCoords={x:${poi.x},z:${poi.z},name:'${poi.name}'}; setRouteStart();"><div class="icon"><span class="material-symbols-rounded">near_me</span></div>出发</button>
            ${poi.website ? `<button class="action-btn" onclick="window.open('${poi.website}')"><div class="icon"><span class="material-symbols-rounded">language</span></div>网站</button>` : ''}
        </div>
        ${poi.images ? `<div class="sheet-images">${poi.images.map(img => `<img src="${img}">`).join('')}</div>` : ''}
    `;
    bottomSheet.classList.add('active');
}

function hideMenus() { bottomSheet.classList.remove('active'); document.getElementById('context-menu').style.display = 'none'; layerMenu.style.display = 'none'; }
function addLocationRedirect() { window.location.href = `add_marker.html?x=${window.lastClickedCoords.x}&z=${window.lastClickedCoords.z}`; }
function copyCoords() { const t = `${window.lastClickedCoords.x}, ${window.lastClickedCoords.z}`; navigator.clipboard.writeText(t); hideMenus(); alert("已复制: " + t); }

// ================= 底层工具 =================
function renderTiles(cx, cz, scale, width, height) { /* ...保持原样... */
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
