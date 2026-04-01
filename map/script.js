let mapConfig = { minZoom: -6, maxZoom: 0, defaultZoom: -1, imageFormat: "webp" };
let appState = { x: 0, z: 0, zoom: -1, showCrosshair: true, showCoords: true, memoryEnabled: true };
let mapData = { regions: [], pois: [], roads: [], subways: [] };

// 路由状态
let routeState = { active: false, start: null, end: null, path: [] };
let roadGraph = new Map(); // 图数据结构用于寻路

let isDragging = false, isZooming = false;
let dragStartX, dragStartZ, dragStartMouseX, dragStartMouseY;
let longPressTimer;

const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const lineLayer = document.getElementById('line-layer');
const coordsDisplay = document.getElementById('coords-display');
const bottomSheet = document.getElementById('bottom-sheet');

const POI_TYPES = {
    'supermarket': '超市', 'hotel': '酒店', 'bank': '银行', 
    'school': '学校', 'government': '政府机关', 'mall': '商场', 
    'museum': '博物馆', 'park': '公园', 'restaurant': '餐厅', 
    'cafe': '咖啡吧', 'subway_station': '地铁站'
};

function init() {
    loadSettings();
    applySettingsToUI();
    
    fetch('map_properties.js').then(res => res.text()).then(text => {
        if(text.includes('minZoom')) mapConfig.minZoom = -6; 
    }).catch(e => console.warn("未找到属性文件，使用默认"));

    fetch('map_data.json').then(res => res.json()).then(data => {
        mapData = data;
        if (!appState.memoryEnabled && data.settings?.origin) {
            appState.x = data.settings.origin.x; appState.z = data.settings.origin.z;
        }
        buildRoadGraph(); // 构建导航路网图
        updateMap();
    }).catch(e => { console.error("加载地图数据失败", e); updateMap(); });
}

// ================= 路网与寻路 (Dijkstra) =================
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
        for (let i = 0; i < road.points.length - 1; i++) {
            addEdge(road.points[i], road.points[i+1]);
        }
    });
}

// 寻找离目标最近的路网节点
function getNearestRoadNode(px, pz) {
    let nearest = null; let minD = Infinity;
    roadGraph.forEach((edges, key) => {
        const [x, z] = key.split(',').map(Number);
        const d = Math.sqrt(Math.pow(x - px, 2) + Math.pow(z - pz, 2));
        if(d < minD) { minD = d; nearest = {x, z, key}; }
    });
    return nearest;
}

// 简单的 Dijkstra 寻路
function calculateRoute(startX, startZ, endX, endZ) {
    const startNode = getNearestRoadNode(startX, startZ);
    const endNode = getNearestRoadNode(endX, endZ);
    
    if (!startNode || !endNode) return []; // 没路网

    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set();

    roadGraph.forEach((_, key) => {
        distances.set(key, Infinity);
        unvisited.add(key);
    });
    distances.set(startNode.key, 0);

    while (unvisited.size > 0) {
        let currKey = null;
        let minD = Infinity;
        unvisited.forEach(key => {
            if (distances.get(key) < minD) { minD = distances.get(key); currKey = key; }
        });

        if (!currKey || currKey === endNode.key) break;
        unvisited.delete(currKey);

        roadGraph.get(currKey).forEach(neighbor => {
            const alt = distances.get(currKey) + neighbor.dist;
            if (alt < distances.get(neighbor.node)) {
                distances.set(neighbor.node, alt);
                previous.set(neighbor.node, currKey);
            }
        });
    }

    const path = [];
    let curr = endNode.key;
    if (previous.has(curr) || curr === startNode.key) {
        while (curr) {
            const [x, z] = curr.split(',').map(Number);
            path.unshift({x, z});
            curr = previous.get(curr);
        }
    }
    return path;
}

// ================= 核心渲染 =================
function updateMap() {
    const scale = Math.pow(2, appState.zoom);
    const width = container.offsetWidth; const height = container.offsetHeight;
    const cx = appState.x * scale; const cz = appState.z * scale;
    
    coordsDisplay.textContent = `X: ${Math.round(appState.x)}, Z: ${Math.round(appState.z)}`;
    saveSettings();

    renderTiles(cx, cz, scale, width, height);
    renderLines(cx, cz, scale, width, height);
    renderMarkers(cx, cz, scale, width, height);
    renderActiveRoute(cx, cz, scale, width, height);
}

// 生成平滑的 SVG 路径 (计算二次贝塞尔曲线)
function generateSmoothPathD(points, scale, cx, cz, width, height, radius = 20) {
    if (points.length < 2) return "";
    let d = "";
    
    const getScreenPt = (pt) => ({
        x: (width / 2) + (pt.x * scale - cx),
        y: (height / 2) + (pt.z * scale - cz)
    });

    for (let i = 0; i < points.length; i++) {
        const p = getScreenPt(points[i]);
        if (i === 0) {
            d += `M ${p.x} ${p.y} `;
        } else if (i === points.length - 1) {
            d += `L ${p.x} ${p.y}`;
        } else {
            const pPrev = getScreenPt(points[i-1]);
            const pNext = getScreenPt(points[i+1]);
            // 简单平滑算法：在拐点前后一定比例处切断，用 Q 曲线连接
            const d1 = Math.sqrt(Math.pow(p.x - pPrev.x, 2) + Math.pow(p.y - pPrev.y, 2));
            const d2 = Math.sqrt(Math.pow(pNext.x - p.x, 2) + Math.pow(pNext.y - p.y, 2));
            const r = Math.min(radius * scale, d1/2, d2/2); // 圆角半径动态适配
            
            const q1x = p.x - (p.x - pPrev.x) * (r / d1);
            const q1y = p.y - (p.y - pPrev.y) * (r / d1);
            const q2x = p.x + (pNext.x - p.x) * (r / d2);
            const q2y = p.y + (pNext.y - p.y) * (r / d2);
            
            d += `L ${q1x} ${q1y} Q ${p.x} ${p.y} ${q2x} ${q2y} `;
        }
    }
    return d;
}

function renderLines(cx, cz, scale, width, height) {
    lineLayer.innerHTML = '';
    
    const drawLine = (lineData, isSubway) => {
        if (appState.zoom < lineData.minZoom || appState.zoom > lineData.maxZoom) return;
        
        const pathD = generateSmoothPathD(lineData.points, scale, cx, cz, width, height);
        const pathId = `path-${lineData.id}`;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('id', pathId);
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        
        if (isSubway) {
            path.setAttribute('stroke', lineData.color || '#E53935');
            path.setAttribute('stroke-width', 4);
        } else {
            let lw = lineData.type === 'highway' ? 8 : (lineData.type === 'expressway' ? 6 : (lineData.type === 'main' ? 4 : 2));
            let color = lineData.type === 'highway' ? 'rgba(255, 160, 0, 0.7)' : 'rgba(255, 255, 255, 0.6)';
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', lw);
        }
        path.setAttribute('stroke-linecap', 'round');
        lineLayer.appendChild(path);

        // 道路名称渲染
        if (lineData.name && !isSubway && scale >= 0.25) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('class', 'road-text');
            text.setAttribute('dy', 4); // 垂直居中偏移
            text.innerHTML = `<textPath href="#${pathId}" startOffset="50%">${lineData.name}</textPath>`;
            lineLayer.appendChild(text);
        }
    };

    mapData.roads.forEach(r => drawLine(r, false));
    mapData.subways.forEach(s => drawLine(s, true));
}

function renderActiveRoute(cx, cz, scale, width, height) {
    if (!routeState.active) return;
    
    const getScreenPt = (x, z) => `${(width / 2) + (x * scale - cx)},${(height / 2) + (z * scale - cz)}`;

    // 绘制寻路实际路线 (深蓝色)
    if (routeState.path.length > 0) {
        const pathD = generateSmoothPathD(routeState.path, scale, cx, cz, width, height);
        const rp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rp.setAttribute('d', pathD);
        rp.setAttribute('fill', 'none');
        rp.setAttribute('stroke', '#1976D2'); // Google Map 蓝
        rp.setAttribute('stroke-width', 6);
        rp.setAttribute('stroke-linecap', 'round');
        lineLayer.appendChild(rp);
    }

    // 两端如果没有路网，用虚线连接
    const startPx = getScreenPt(routeState.start.x, routeState.start.z);
    const endPx = getScreenPt(routeState.end.x, routeState.end.z);
    
    if (routeState.path.length > 0) {
        const firstNode = getScreenPt(routeState.path[0].x, routeState.path[0].z);
        const lastNode = getScreenPt(routeState.path[routeState.path.length-1].x, routeState.path[routeState.path.length-1].z);
        
        lineLayer.innerHTML += `<path d="M ${startPx} L ${firstNode}" stroke="#1976D2" stroke-width="4" stroke-dasharray="8,8" />`;
        lineLayer.innerHTML += `<path d="M ${lastNode} L ${endPx}" stroke="#1976D2" stroke-width="4" stroke-dasharray="8,8" />`;
    } else {
        // 如果完全没路，直接连虚线
        lineLayer.innerHTML += `<path d="M ${startPx} L ${endPx}" stroke="#1976D2" stroke-width="4" stroke-dasharray="8,8" />`;
    }
}

function renderMarkers(cx, cz, scale, width, height) {
    markerContainer.innerHTML = '';
    
    // 聚合 POI 和 地铁站
    let allPois = [...mapData.pois];
    mapData.subways.forEach(sub => {
        if(sub.stations) {
            sub.stations.forEach(st => {
                allPois.push({ ...st, type: 'subway_station', companyLogo: sub.logo });
            });
        }
    });

    allPois.forEach(poi => {
        if (appState.zoom < (poi.minZoom || -3) || appState.zoom > (poi.maxZoom || 0)) return;
        const sx = (width / 2) + (poi.x * scale - cx);
        const sy = (height / 2) + (poi.z * scale - cz);
        
        if (sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) return; 
        
        const el = document.createElement('div');
        el.className = 'map-marker';
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        
        let icon = 'location_on'; let bgColor = 'var(--md-sys-color-primary)';
        if(poi.type === 'supermarket') icon = 'shopping_cart';
        if(poi.type === 'hotel') { icon = 'hotel'; bgColor = '#8E24AA'; } // 酒店紫色
        if(poi.type === 'bank') icon = 'account_balance';
        if(poi.type === 'subway_station') { icon = 'directions_subway'; bgColor = '#E53935'; } // 地铁红

        // 支持渲染品牌Logo代替Material Icon
        let iconHtml = `<div class="marker-icon" style="background:${bgColor}"><span class="material-symbols-rounded" style="font-size: 18px;">${icon}</span></div>`;
        if (poi.companyLogo) {
            iconHtml = `<div class="marker-icon"><img src="${poi.companyLogo}" class="transit-logo"></div>`;
        }

        // 文字在右侧
        el.innerHTML = `${iconHtml}<div class="marker-label">${poi.name}</div>`;
        el.onclick = (e) => { e.stopPropagation(); openBottomSheet(poi); };
        markerContainer.appendChild(el);
    });
}

// ================= 交互事件 =================
container.addEventListener('touchstart', (e) => { if(e.touches.length > 1) e.preventDefault(); }, {passive: false});
container.addEventListener('touchmove', (e) => { e.preventDefault(); drag(e); }, {passive: false});
container.addEventListener('mousedown', startInteraction);
container.addEventListener('touchstart', startInteraction, { passive: false });
window.addEventListener('mousemove', drag);
window.addEventListener('mouseup', endInteraction);
window.addEventListener('touchend', endInteraction);

function startInteraction(e) {
    if (e.target.closest('.bottom-sheet') || e.target.closest('.context-menu')) return;
    hideMenus();

    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    
    isDragging = true;
    dragStartMouseX = clientX; dragStartMouseY = clientY;
    dragStartX = appState.x; dragStartZ = appState.z;
    
    longPressTimer = setTimeout(() => {
        isDragging = false; showContextMenu(clientX, clientY);
    }, 500);
}

function drag(e) {
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

function endInteraction() { clearTimeout(longPressTimer); isDragging = false; }

function setZoom(newZoom) {
    newZoom = Math.max(mapConfig.minZoom, Math.min(mapConfig.maxZoom, newZoom));
    if (newZoom === appState.zoom) return;
    appState.zoom = newZoom; tileContainer.innerHTML = ''; updateMap();
}
document.getElementById('btn-zoom-in').onclick = () => setZoom(appState.zoom + 1);
document.getElementById('btn-zoom-out').onclick = () => setZoom(appState.zoom - 1);
container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0) setZoom(appState.zoom - 1); else if (e.deltaY < 0) setZoom(appState.zoom + 1);
}, { passive: false });


// ================= 路由与菜单功能 =================
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

// 1. 跳转添加页面
function addLocationRedirect() {
    const url = `add_marker.html?x=${window.lastClickedCoords.x}&z=${window.lastClickedCoords.z}`;
    window.location.href = url; // 真实可用的跳转
}

// 2. 路线规划交互
function setRouteStart() {
    routeState.start = { ...window.lastClickedCoords };
    checkAndRoute();
    hideMenus();
}
function setRouteEnd() {
    routeState.end = { ...window.lastClickedCoords };
    checkAndRoute();
    hideMenus();
}
function checkAndRoute() {
    if (routeState.start && routeState.end) {
        routeState.path = calculateRoute(routeState.start.x, routeState.start.z, routeState.end.x, routeState.end.z);
        routeState.active = true;
        document.getElementById('btn-exit-route').style.display = 'flex';
        updateMap();
    }
}
document.getElementById('btn-exit-route').onclick = () => {
    routeState = { active: false, start: null, end: null, path: [] };
    document.getElementById('btn-exit-route').style.display = 'none';
    updateMap();
}

function openBottomSheet(poi) {
    const content = document.getElementById('sheet-content');
    let imagesHtml = '';
    if (poi.images && poi.images.length > 0) {
        imagesHtml = `<div class="sheet-images">${poi.images.map(img => `<img src="${img}">`).join('')}</div>`;
    }
    
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
            <button class="action-btn" onclick="window.lastClickedCoords={x:${poi.x},z:${poi.z}}; setRouteEnd(); bottomSheet.classList.remove('active');"><div class="icon"><span class="material-symbols-rounded">directions</span></div>路线</button>
            ${poi.website ? `<button class="action-btn" onclick="window.open('${poi.website}')"><div class="icon"><span class="material-symbols-rounded">language</span></div>网站</button>` : ''}
            <button class="action-btn"><div class="icon"><span class="material-symbols-rounded">share</span></div>分享</button>
        </div>
        ${imagesHtml}
        ${poi.remarks ? `<div style="padding-top:16px; border-top:1px solid var(--md-sys-color-surface-container);"><p style="color: var(--md-sys-color-outline); line-height: 1.5;">${poi.remarks}</p></div>` : ''}
    `;
    bottomSheet.classList.add('active');
}

function hideMenus() { bottomSheet.classList.remove('active'); document.getElementById('context-menu').style.display = 'none'; }
function copyCoords() {
    const text = `${window.lastClickedCoords.x}, ${window.lastClickedCoords.z}`;
    navigator.clipboard.writeText(text); hideMenus(); alert("坐标已复制: " + text);
}

// ================= 设置与工具 =================
function renderTiles(cx, cz, scale, width, height) { /* ...与之前代码保持一致... */ 
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

function loadSettings() {
    const saved = localStorage.getItem('mapAppState');
    if (saved) Object.assign(appState, JSON.parse(saved));
}
function saveSettings() { localStorage.setItem('mapAppState', JSON.stringify(appState)); }
function applySettingsToUI() { /* ...与之前代码一致... */ }
document.getElementById('btn-my-location').onclick = () => { appState.x = 0; appState.z = 0; updateMap(); };
init();
