let mapConfig = { minZoom: -6, maxZoom: 0, defaultZoom: -1, imageFormat: "webp" };
let appState = { x: 0, z: 0, zoom: -1, showCrosshair: true, showCoords: true };
let mapData = { regions: [], pois: [], roads: [], subways: [] };

// 路由状态 (增加模式: road / transit)
let routeState = { active: false, mode: 'road', start: null, end: null, path: [], picking: null };
let roadGraph = new Map();
let transitGraph = new Map();

// 手势与拖拽状态
let isDragging = false;
let dragStartX, dragStartZ, dragStartMouseX, dragStartMouseY;
let longPressTimer;
let initialPinchDist = null, initialPinchZoom = null;

const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const regionContainer = document.getElementById('region-container');
const lineLayer = document.getElementById('line-layer');
const coordsDisplay = document.getElementById('coords-display');
const bottomSheet = document.getElementById('bottom-sheet');
const routePlanner = document.getElementById('route-planner');

const POI_TYPES = {
    'supermarket': '超市', 'hotel': '酒店', 'bank': '银行', 
    'school': '学校', 'government': '政府机关', 'mall': '商场', 
    'museum': '博物馆', 'park': '公园', 'restaurant': '餐厅', 
    'cafe': '咖啡吧', 'subway_station': '地铁站'
};

function init() {
    fetch('map_data.json').then(res => res.json()).then(data => {
        mapData = data;
        if (data.settings?.origin) {
            appState.x = data.settings.origin.x; appState.z = data.settings.origin.z;
        }
        buildGraphs();
        updateMap();
    }).catch(e => { console.error("加载地图数据失败", e); updateMap(); });
}

// ================= 路网与寻路 (支持道路与轨道双网) =================
function buildGraphs() {
    roadGraph.clear(); transitGraph.clear();
    const addEdge = (graph, p1, p2) => {
        const k1 = `${p1.x},${p1.z}`; const k2 = `${p2.x},${p2.z}`;
        const dist = Math.hypot(p1.x - p2.x, p1.z - p2.z);
        if(!graph.has(k1)) graph.set(k1, []);
        if(!graph.has(k2)) graph.set(k2, []);
        graph.get(k1).push({ node: k2, dist, x: p2.x, z: p2.z });
        graph.get(k2).push({ node: k1, dist, x: p1.x, z: p1.z });
    };

    mapData.roads?.forEach(r => {
        for (let i = 0; i < r.points.length - 1; i++) addEdge(roadGraph, r.points[i], r.points[i+1]);
    });
    mapData.subways?.forEach(s => {
        for (let i = 0; i < s.points.length - 1; i++) addEdge(transitGraph, s.points[i], s.points[i+1]);
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

function calculateRoute(startX, startZ, endX, endZ, mode) {
    const graph = mode === 'transit' ? transitGraph : roadGraph;
    if (graph.size === 0) return [];

    const startNode = getNearestNode(graph, startX, startZ);
    const endNode = getNearestNode(graph, endX, endZ);
    if (!startNode || !endNode) return [];

    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set(graph.keys());

    graph.forEach((_, key) => distances.set(key, Infinity));
    distances.set(startNode.key, 0);

    while (unvisited.size > 0) {
        let curr = null, minD = Infinity;
        unvisited.forEach(k => { if (distances.get(k) < minD) { minD = distances.get(k); curr = k; } });
        if (!curr || curr === endNode.key) break;
        unvisited.delete(curr);

        graph.get(curr).forEach(neighbor => {
            const alt = distances.get(curr) + neighbor.dist;
            if (alt < distances.get(neighbor.node)) {
                distances.set(neighbor.node, alt);
                previous.set(neighbor.node, curr);
            }
        });
    }

    const path = []; let curr = endNode.key;
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

    renderTiles(cx, cz, scale, width, height);
    renderLines(cx, cz, scale, width, height);
    renderRegions(cx, cz, scale, width, height);
    renderMarkers(cx, cz, scale, width, height);
    renderActiveRoute(cx, cz, scale, width, height);
}

// 动态贝塞尔曲线 (曲率 radius 可在代码中控制调整，当前设为 40 * scale)
function generateSmoothPathD(points, scale, cx, cz, width, height, isSubway) {
    if (points.length < 2) return { d: "", len: 0 };
    let d = ""; let totalLen = 0;
    const radius = isSubway ? 60 : 40; // 地铁线弯道更大更平滑

    const getScreenPt = (pt) => ({
        x: (width / 2) + (pt.x * scale - cx),
        y: (height / 2) + (pt.z * scale - cz)
    });

    for (let i = 0; i < points.length; i++) {
        const p = getScreenPt(points[i]);
        if (i === 0) { d += `M ${p.x} ${p.y} `; } 
        else if (i === points.length - 1) { 
            d += `L ${p.x} ${p.y}`; 
            totalLen += Math.hypot(p.x - getScreenPt(points[i-1]).x, p.y - getScreenPt(points[i-1]).y);
        } else {
            const pPrev = getScreenPt(points[i-1]);
            const pNext = getScreenPt(points[i+1]);
            const d1 = Math.hypot(p.x - pPrev.x, p.y - pPrev.y);
            const d2 = Math.hypot(pNext.x - p.x, pNext.y - p.y);
            totalLen += d1;

            const r = Math.min(radius * scale, d1/2, d2/2); 
            const q1x = p.x - (p.x - pPrev.x) * (r / d1);
            const q1y = p.y - (p.y - pPrev.y) * (r / d1);
            const q2x = p.x + (pNext.x - p.x) * (r / d2);
            const q2y = p.y + (pNext.y - p.y) * (r / d2);
            
            d += `L ${q1x} ${q1y} Q ${p.x} ${p.y} ${q2x} ${q2y} `;
        }
    }
    return { d, len: totalLen };
}

function renderLines(cx, cz, scale, width, height) {
    lineLayer.innerHTML = '';
    
    // 随比例缩放的路宽
    const getLineWidth = (base) => Math.max(2, base * Math.pow(1.2, appState.zoom + 2));

    const drawLine = (lineData, isSubway) => {
        const { d: pathD, len: pixelLength } = generateSmoothPathD(lineData.points, scale, cx, cz, width, height, isSubway);
        const pathId = `path-${isSubway?'sub':'road'}-${lineData.name}`;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('id', pathId);
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        
        if (isSubway) {
            path.setAttribute('stroke', lineData.color || '#E53935');
            path.setAttribute('stroke-width', getLineWidth(5));
        } else {
            let baseW = lineData.type === 'highway' ? 8 : (lineData.type === 'expressway' ? 6 : 4);
            path.setAttribute('stroke', lineData.type === 'highway' ? 'rgba(255, 160, 0, 0.7)' : 'rgba(255, 255, 255, 0.6)');
            path.setAttribute('stroke-width', getLineWidth(baseW));
        }
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        lineLayer.appendChild(path);

        // 动态多标签渲染逻辑 (根据线路像素长度，决定渲染多少个标签)
        if (lineData.name && pixelLength > 150) {
            const textNodesCount = Math.floor(pixelLength / 400) + 1; // 每 400 像素一个名字
            const textClass = isSubway ? 'subway-text' : 'road-text';

            for(let i=1; i<=textNodesCount; i++) {
                const offset = (i / (textNodesCount + 1)) * 100; // 均匀分布 25%, 50%, 75%...
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('class', textClass);
                text.setAttribute('dy', 5);
                text.innerHTML = `<textPath href="#${pathId}" startOffset="${offset}%">${lineData.name}</textPath>`;
                lineLayer.appendChild(text);
            }
        }
    };

    mapData.roads?.forEach(r => drawLine(r, false));
    mapData.subways?.forEach(s => drawLine(s, true));
}

function renderRegions(cx, cz, scale, width, height) {
    regionContainer.innerHTML = '';
    mapData.regions?.forEach(reg => {
        // 根据地区类型控制层级显示大小
        let minZ = -6, maxZ = -2, fontSize = 32;
        if(reg.type === 'city') { minZ = -6; maxZ = -3; fontSize = 48; }
        else if(reg.type === 'district') { minZ = -4; maxZ = -1; fontSize = 28; }
        else if(reg.type === 'community') { minZ = -2; maxZ = 0; fontSize = 18; }
        
        if(appState.zoom < minZ || appState.zoom > maxZ) return;

        const sx = (width / 2) + (reg.x * scale - cx);
        const sy = (height / 2) + (reg.z * scale - cz);
        
        const el = document.createElement('div');
        el.className = 'region-label';
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        el.style.fontSize = `${fontSize}px`;
        el.innerText = reg.name;
        regionContainer.appendChild(el);
    });
}

function renderMarkers(cx, cz, scale, width, height) {
    markerContainer.innerHTML = '';
    let allPois = [...(mapData.pois || [])];
    
    // 把地铁站当作 POI 聚合渲染
    mapData.subways?.forEach(sub => {
        sub.stations?.forEach(st => {
            allPois.push({ ...st, type: 'subway_station', brandLogo: sub.logo, remarks: `属于 ${sub.name}` });
        });
    });

    allPois.forEach(poi => {
        const sx = (width / 2) + (poi.x * scale - cx);
        const sy = (height / 2) + (poi.z * scale - cz);
        if (sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50) return; 
        
        const el = document.createElement('div');
        el.className = 'map-marker';
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        
        let icon = 'location_on'; let bgColor = 'var(--md-sys-color-primary)';
        if(poi.type === 'supermarket') icon = 'shopping_cart';
        if(poi.type === 'hotel') { icon = 'hotel'; bgColor = '#8E24AA'; }
        if(poi.type === 'subway_station') { icon = 'directions_subway'; bgColor = '#E53935'; }
        
        let iconHtml = `<div class="marker-icon" style="background:${bgColor}"><span class="material-symbols-rounded" style="font-size: 16px;">${icon}</span></div>`;
        if (poi.brandLogo && poi.type !== 'subway_station') { // 如果有品牌且不是地铁站(地铁站用特定风格)
            iconHtml = `<div class="marker-icon"><img src="${poi.brandLogo}" class="transit-logo"></div>`;
        }

        el.innerHTML = `${iconHtml}<div class="marker-label">${poi.name}</div>`;
        el.onclick = (e) => { 
            e.stopPropagation(); 
            if(routeState.picking) { handleRoutePick(poi.name, poi.x, poi.z); }
            else { openBottomSheet(poi); }
        };
        markerContainer.appendChild(el);
    });
}

function renderActiveRoute(cx, cz, scale, width, height) {
    if (!routeState.active || !routeState.start || !routeState.end) return;
    const getScreenPt = (x, z) => `${(width / 2) + (x * scale - cx)},${(height / 2) + (z * scale - cz)}`;
    
    const color = routeState.mode === 'transit' ? '#E53935' : '#1976D2';

    if (routeState.path.length > 0) {
        const { d } = generateSmoothPathD(routeState.path, scale, cx, cz, width, height, routeState.mode === 'transit');
        const rp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rp.setAttribute('d', d);
        rp.setAttribute('fill', 'none');
        rp.setAttribute('stroke', color);
        rp.setAttribute('stroke-width', 8);
        rp.setAttribute('stroke-linecap', 'round');
        lineLayer.appendChild(rp);
    }

    const startPx = getScreenPt(routeState.start.x, routeState.start.z);
    const endPx = getScreenPt(routeState.end.x, routeState.end.z);
    
    // 没路网的地方连虚线
    if (routeState.path.length > 0) {
        const firstNode = getScreenPt(routeState.path[0].x, routeState.path[0].z);
        const lastNode = getScreenPt(routeState.path[routeState.path.length-1].x, routeState.path[routeState.path.length-1].z);
        lineLayer.innerHTML += `<path d="M ${startPx} L ${firstNode}" stroke="${color}" stroke-width="4" stroke-dasharray="8,8" />`;
        lineLayer.innerHTML += `<path d="M ${lastNode} L ${endPx}" stroke="${color}" stroke-width="4" stroke-dasharray="8,8" />`;
    } else {
        lineLayer.innerHTML += `<path d="M ${startPx} L ${endPx}" stroke="${color}" stroke-width="4" stroke-dasharray="8,8" />`;
    }
}

// ================= 交互事件与手势 (支持移动端防复制和双指缩放) =================
container.addEventListener('touchstart', (e) => { 
    if(e.touches.length > 1) { e.preventDefault(); handlePinchStart(e); } 
    else { startInteraction(e); }
}, {passive: false});
container.addEventListener('touchmove', (e) => { 
    if(e.touches.length > 1) { e.preventDefault(); handlePinchMove(e); } 
    else { e.preventDefault(); drag(e); }
}, {passive: false});
container.addEventListener('touchend', endInteraction);
container.addEventListener('mousedown', startInteraction);
window.addEventListener('mousemove', drag);
window.addEventListener('mouseup', endInteraction);

function handlePinchStart(e) {
    initialPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    initialPinchZoom = appState.zoom;
}
function handlePinchMove(e) {
    if(!initialPinchDist) return;
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const zoomDelta = Math.log2(dist / initialPinchDist);
    let newZoom = Math.round(initialPinchZoom + zoomDelta);
    setZoom(newZoom);
}

function startInteraction(e) {
    if (e.target.closest('.bottom-sheet') || e.target.closest('.context-menu') || e.target.closest('.route-planner-card')) return;
    hideMenus();
    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    
    isDragging = true;
    dragStartMouseX = clientX; dragStartMouseY = clientY;
    dragStartX = appState.x; dragStartZ = appState.z;
    
    longPressTimer = setTimeout(() => {
        isDragging = false; 
        if(!routeState.picking) showContextMenu(clientX, clientY);
    }, 500); // 长按触发自定义菜单，防止系统弹出
}

function drag(e) {
    if (!isDragging) return;
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    if (Math.abs(clientX - dragStartMouseX) > 5 || Math.abs(clientY - dragStartMouseY) > 5) { clearTimeout(longPressTimer); }
    const scale = Math.pow(2, appState.zoom);
    appState.x = dragStartX - ((clientX - dragStartMouseX) / scale);
    appState.z = dragStartZ - ((clientY - dragStartMouseY) / scale);
    requestAnimationFrame(updateMap);
}
function endInteraction() { clearTimeout(longPressTimer); isDragging = false; initialPinchDist = null; }

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


// ================= UI 菜单与路线规划功能 =================
function showContextMenu(screenX, screenY) {
    const scale = Math.pow(2, appState.zoom);
    const targetX = Math.round(appState.x + (screenX - container.offsetWidth/2) / scale);
    const targetZ = Math.round(appState.z + (screenY - container.offsetHeight/2) / scale);
    const menu = document.getElementById('context-menu');
    document.getElementById('ctx-coords').textContent = `${targetX}, ${targetZ}`;
    menu.style.left = `${screenX}px`; menu.style.top = `${screenY}px`;
    menu.style.display = 'block';
    window.lastClickedCoords = {x: targetX, z: targetZ, name: `${targetX}, ${targetZ}`};
}

// 路线规划集成
function openRoutePlanner() {
    hideMenus(); document.querySelector('.search-box').style.display = 'none';
    routePlanner.style.display = 'flex'; routeState.active = true;
    document.getElementById('btn-exit-route').style.display = 'flex';
}
function closeRoutePlanner() {
    routePlanner.style.display = 'none'; document.querySelector('.search-box').style.display = 'flex';
    routeState = { active: false, mode: 'road', start: null, end: null, path: [], picking: null };
    document.getElementById('btn-exit-route').style.display = 'none';
    document.getElementById('route-start-input').value = ''; document.getElementById('route-end-input').value = '';
    updateMap();
}
document.getElementById('btn-exit-route').onclick = closeRoutePlanner;

function setRoutePoint(type) {
    openRoutePlanner();
    if(type === 'start') {
        routeState.start = { x: window.lastClickedCoords.x, z: window.lastClickedCoords.z };
        document.getElementById('route-start-input').value = window.lastClickedCoords.name;
    } else {
        routeState.end = { x: window.lastClickedCoords.x, z: window.lastClickedCoords.z };
        document.getElementById('route-end-input').value = window.lastClickedCoords.name;
    }
    checkAndRoute();
}

function setRouteMode(mode) {
    routeState.mode = mode;
    document.getElementById('mode-road').classList.toggle('active', mode === 'road');
    document.getElementById('mode-transit').classList.toggle('active', mode === 'transit');
    checkAndRoute();
}

function checkAndRoute() {
    if (routeState.start && routeState.end) {
        routeState.path = calculateRoute(routeState.start.x, routeState.start.z, routeState.end.x, routeState.end.z, routeState.mode);
        updateMap();
    }
}

document.getElementById('route-start-input').onclick = () => { routeState.picking = 'start'; alert("请在地图上点击选择起点"); }
document.getElementById('route-end-input').onclick = () => { routeState.picking = 'end'; alert("请在地图上点击选择终点"); }

function handleRoutePick(name, x, z) {
    if(routeState.picking === 'start') {
        routeState.start = {x, z}; document.getElementById('route-start-input').value = name;
    } else if(routeState.picking === 'end') {
        routeState.end = {x, z}; document.getElementById('route-end-input').value = name;
    }
    routeState.picking = null; checkAndRoute();
}

function openBottomSheet(poi) {
    const content = document.getElementById('sheet-content');
    const typeLabel = POI_TYPES[poi.type] || '地点';
    const brandHtml = poi.brandLogo ? `<img src="${poi.brandLogo}" class="brand-logo">` : '';
    let imagesHtml = (poi.images && poi.images.length > 0) ? `<div class="sheet-images">${poi.images.map(img => `<img src="${img}">`).join('')}</div>` : '';

    content.innerHTML = `
        <div class="sheet-header-row">
            <div class="sheet-header">
                <h2>${poi.name}</h2>
                <div class="poi-type">${typeLabel} ${poi.status ? `· <span style="font-weight:normal; color:#555">${poi.status}</span>` : ''}</div>
            </div>
            ${brandHtml}
        </div>
        <div class="action-buttons">
            <button class="action-btn" onclick="window.lastClickedCoords={x:${poi.x},z:${poi.z},name:'${poi.name}'}; setRoutePoint('end'); bottomSheet.classList.remove('active');"><div class="icon"><span class="material-symbols-rounded">directions</span></div>路线</button>
            ${poi.website ? `<button class="action-btn" onclick="window.open('${poi.website}')"><div class="icon"><span class="material-symbols-rounded">language</span></div>网站</button>` : ''}
        </div>
        ${imagesHtml}
        ${poi.remarks ? `<div style="padding-top:16px; border-top:1px solid var(--md-sys-color-surface-container);"><p style="color: var(--md-sys-color-outline); line-height: 1.5;">${poi.remarks}</p></div>` : ''}
    `;
    bottomSheet.classList.add('active');
}

function hideMenus() { bottomSheet.classList.remove('active'); document.getElementById('context-menu').style.display = 'none'; }
function copyCoords() { const t = `${window.lastClickedCoords.x}, ${window.lastClickedCoords.z}`; navigator.clipboard.writeText(t); hideMenus(); alert("坐标已复制: " + t); }

// ================= 设置与底图渲染 =================
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

document.getElementById('btn-my-location').onclick = () => { 
    // 定位到 settings origin, 无则回原点
    appState.x = mapData.settings?.origin?.x || 0; 
    appState.z = mapData.settings?.origin?.z || 0; 
    setZoom(-2); // 定位时稍微放大
    updateMap(); 
};

init();
