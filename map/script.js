let mapConfig = { minZoom: -6, maxZoom: 0, defaultZoom: -1, imageFormat: "webp" };
let appState = { x: 0, z: 0, zoom: -1, mapMode: 'all' }; // modes: all, traffic, transit, raw
let mapData = { regions: [], pois: [], roads: [], subways: [] };

// 曲度半径控制 (数值越大弯角越平滑，可在此修改)
const CURVE_RADIUS = 60; 

let routeState = { active: false, start: null, end: null, paths: [], selectedIndex: 0 };
let roadGraph = new Map();

let isDragging = false;
let dragStartX, dragStartZ, dragStartMouseX, dragStartMouseY;
let longPressTimer;
let initialPinchDistance = null;
let lastPinchZoom = 0;

const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const regionContainer = document.getElementById('region-container');
const lineLayer = document.getElementById('line-layer');
const coordsDisplay = document.getElementById('coords-display');
const bottomSheet = document.getElementById('bottom-sheet');
const routeSheet = document.getElementById('route-sheet');
const contextMenu = document.getElementById('context-menu');
const layerMenu = document.getElementById('layer-menu');

const POI_TYPES = {
    'supermarket': '超市', 'hotel': '酒店', 'bank': '银行', 'school': '学校', 
    'hospital': '医院', 'mall': '商场', 'park': '公园', 'restaurant': '餐厅', 
    'subway_station': '地铁站'
};

function init() {
    fetch('map_data.json').then(res => res.json()).then(data => {
        mapData = data;
        if (data.settings?.origin) { appState.x = data.settings.origin.x; appState.z = data.settings.origin.z; }
        buildRoadGraph();
        updateMap();
    }).catch(e => { console.error("加载数据失败", e); updateMap(); });
}

// ================= 路网寻路 (支持多方案生成) =================
function buildRoadGraph() { /* ...同之前逻辑... */ 
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
    roadGraph.forEach((_, key) => {
        const [x, z] = key.split(',').map(Number);
        const d = Math.hypot(x - px, z - pz);
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
        unvisited.forEach(k => { if (distances.get(k) < minD) { minD = distances.get(k); currKey = k; } });
        if (!currKey || currKey === endNode.key) break;
        unvisited.delete(currKey);
        roadGraph.get(currKey).forEach(neighbor => {
            const alt = distances.get(currKey) + neighbor.dist;
            if (alt < distances.get(neighbor.node)) { distances.set(neighbor.node, alt); previous.set(neighbor.node, currKey); }
        });
    }

    const path = []; let curr = endNode.key;
    if (previous.has(curr) || curr === startNode.key) {
        while (curr) {
            const [x, z] = curr.split(',').map(Number);
            path.unshift({x, z}); curr = previous.get(curr);
        }
    }
    return path;
}

// ================= 核心渲染 =================
function updateMap() {
    const scale = Math.pow(2, appState.zoom);
    const w = container.offsetWidth; const h = container.offsetHeight;
    const cx = appState.x * scale; const cz = appState.z * scale;
    
    coordsDisplay.textContent = `X: ${Math.round(appState.x)}, Z: ${Math.round(appState.z)}`;

    renderTiles(cx, cz, scale, w, h);
    renderRegions(cx, cz, scale, w, h);
    renderLines(cx, cz, scale, w, h);
    renderMarkers(cx, cz, scale, w, h);
    renderActiveRoute(cx, cz, scale, w, h);
}

// 贝塞尔曲线生成
function generateSmoothPathD(points, scale, cx, cz, width, height, dynamicRadius) {
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
            // 曲率受设定半径和线段长度限制
            const r = Math.min(dynamicRadius * scale, d1/2.2, d2/2.2); 
            
            const q1x = p.x - (p.x - pPrev.x) * (r / d1); const q1y = p.y - (p.y - pPrev.y) * (r / d1);
            const q2x = p.x + (pNext.x - p.x) * (r / d2); const q2y = p.y + (pNext.y - p.y) * (r / d2);
            d += `L ${q1x} ${q1y} Q ${p.x} ${p.y} ${q2x} ${q2y} `;
        }
    }
    return d;
}

function renderRegions(cx, cz, scale, width, height) {
    regionContainer.innerHTML = '';
    mapData.regions.forEach(reg => {
        if (appState.zoom < reg.minZoom || appState.zoom > reg.maxZoom) return;
        const sx = (width / 2) + (reg.x * scale - cx);
        const sy = (height / 2) + (reg.z * scale - cz);
        
        const el = document.createElement('div');
        el.className = 'region-label';
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        // 地区字体也随缩放微调
        el.style.fontSize = `${Math.max(16, 24 * (scale + 0.5))}px`;
        el.textContent = reg.name;
        regionContainer.appendChild(el);
    });
}

function renderLines(cx, cz, scale, width, height) {
    lineLayer.innerHTML = '';
    
    const drawLine = (lineData, isSubway) => {
        if (appState.zoom < lineData.minZoom || appState.zoom > lineData.maxZoom) return;
        
        // 图层过滤
        if (appState.mapMode === 'raw') return;
        if (appState.mapMode === 'traffic' && isSubway) return;
        if (appState.mapMode === 'transit' && !isSubway) return;

        const pathD = generateSmoothPathD(lineData.points, scale, cx, cz, width, height, CURVE_RADIUS);
        const pathId = `path-${lineData.id}`;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('id', pathId);
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        
        // 动态粗细计算：基础宽度 * (scale的某种比例) 防止缩小时糊成一团，放大时又太小
        let baseW = isSubway ? 6 : (lineData.type === 'highway' ? 8 : (lineData.type === 'expressway' ? 6 : (lineData.type === 'main' ? 4 : 2)));
        let dynamicW = Math.max(1.5, baseW * Math.min(2, Math.max(0.5, scale * 2)));

        if (isSubway) {
            path.setAttribute('stroke', lineData.color || '#E53935');
        } else {
            let color = lineData.type === 'highway' ? '#fbbc04' : (lineData.type === 'expressway' ? '#fde293' : '#ffffff');
            path.setAttribute('stroke', color);
            // 道路描边让其立体
            const border = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            border.setAttribute('d', pathD); border.setAttribute('fill', 'none');
            border.setAttribute('stroke', '#d4d8db'); border.setAttribute('stroke-width', dynamicW + 2); border.setAttribute('stroke-linecap', 'round');
            lineLayer.appendChild(border);
        }
        path.setAttribute('stroke-width', dynamicW);
        path.setAttribute('stroke-linecap', 'round');
        lineLayer.appendChild(path);

        // 动态名称渲染 (根据线段数量和比例显示多个)
        if (lineData.name && scale >= 0.25) {
            const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            // 如果线段很长，显示 2-3 个标签。我们简单用 25% 和 75% 代替 50%
            const offsets = lineData.points.length > 4 ? ['25%', '75%'] : ['50%'];
            offsets.forEach(offset => {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('class', 'road-text'); text.setAttribute('dy', isSubway ? -6 : 4);
                text.innerHTML = `<textPath href="#${pathId}" startOffset="${offset}" text-anchor="middle">${lineData.name}</textPath>`;
                textGroup.appendChild(text);
            });
            lineLayer.appendChild(textGroup);
        }
    };

    mapData.roads.forEach(r => drawLine(r, false));
    mapData.subways.forEach(s => drawLine(s, true));
}

function renderMarkers(cx, cz, scale, width, height) {
    markerContainer.innerHTML = '';
    let allPois = [...mapData.pois];
    mapData.subways.forEach(sub => {
        if(sub.stations) sub.stations.forEach(st => allPois.push({ ...st, type: 'subway_station', companyLogo: sub.logo }));
    });

    let renderedBoxes = []; // 用于简单碰撞检测

    allPois.forEach(poi => {
        if (appState.zoom < (poi.minZoom || -3) || appState.zoom > (poi.maxZoom || 0)) return;
        const sx = (width / 2) + (poi.x * scale - cx);
        const sy = (height / 2) + (poi.z * scale - cz);
        if (sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) return; 
        
        // 简单碰撞检测：检查是否与已渲染的标点靠得太近 (Y轴相近，X轴在右侧重叠)
        let isCollision = renderedBoxes.some(box => Math.abs(box.y - sy) < 20 && box.x > sx && box.x - sx < 80);
        renderedBoxes.push({x: sx, y: sy});

        const el = document.createElement('div');
        el.className = `map-marker ${isCollision ? 'align-left' : ''}`;
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        
        let icon = 'location_on'; let bgColor = 'var(--md-sys-color-primary)';
        if(poi.type === 'supermarket') icon = 'shopping_cart';
        if(poi.type === 'hotel') { icon = 'hotel'; bgColor = '#8E24AA'; } 
        if(poi.type === 'hospital') { icon = 'local_hospital'; bgColor = '#E53935'; }
        if(poi.type === 'subway_station') { icon = 'directions_subway'; bgColor = '#E53935'; }

        let iconHtml = `<div class="marker-icon" style="background:${bgColor}"><span class="material-symbols-rounded" style="font-size: 18px;">${icon}</span></div>`;
        if (poi.companyLogo) iconHtml = `<div class="marker-icon"><img src="${poi.companyLogo}" class="transit-logo"></div>`;

        el.innerHTML = `${iconHtml}<div class="marker-label">${poi.name}</div>`;
        el.onmousedown = el.ontouchstart = (e) => e.stopPropagation(); // 阻止拖动地图
        el.onclick = (e) => { e.stopPropagation(); openBottomSheet(poi); };
        markerContainer.appendChild(el);
    });
}

function renderActiveRoute(cx, cz, scale, width, height) {
    if (!routeState.active || !routeState.paths.length) return;
    
    const getScreenPt = (x, z) => `${(width / 2) + (x * scale - cx)},${(height / 2) + (z * scale - cz)}`;
    const currentPath = routeState.paths[routeState.selectedIndex]; // 获取选中的路线

    if (currentPath.length > 0) {
        const pathD = generateSmoothPathD(currentPath, scale, cx, cz, width, height, CURVE_RADIUS);
        
        // 发光底边
        const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shadow.setAttribute('d', pathD); shadow.setAttribute('fill', 'none');
        shadow.setAttribute('stroke', '#1a73e8'); shadow.setAttribute('stroke-width', 10);
        shadow.setAttribute('stroke-linecap', 'round'); shadow.setAttribute('opacity', '0.3');
        lineLayer.appendChild(shadow);

        const rp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rp.setAttribute('d', pathD); rp.setAttribute('fill', 'none');
        rp.setAttribute('stroke', '#1a73e8'); rp.setAttribute('stroke-width', 6);
        rp.setAttribute('stroke-linecap', 'round');
        lineLayer.appendChild(rp);
    }

    const startPx = getScreenPt(routeState.start.x, routeState.start.z);
    const endPx = getScreenPt(routeState.end.x, routeState.end.z);
    
    if (currentPath.length > 0) {
        const firstNode = getScreenPt(currentPath[0].x, currentPath[0].z);
        const lastNode = getScreenPt(currentPath[currentPath.length-1].x, currentPath[currentPath.length-1].z);
        lineLayer.innerHTML += `<path d="M ${startPx} L ${firstNode}" stroke="#1a73e8" stroke-width="4" stroke-dasharray="6,6" />`;
        lineLayer.innerHTML += `<path d="M ${lastNode} L ${endPx}" stroke="#1a73e8" stroke-width="4" stroke-dasharray="6,6" />`;
    } else {
        lineLayer.innerHTML += `<path d="M ${startPx} L ${endPx}" stroke="#1a73e8" stroke-width="4" stroke-dasharray="6,6" />`;
    }
}

// ================= 交互与手势 =================
container.addEventListener('mousedown', startInteraction);
container.addEventListener('touchstart', startInteraction, { passive: false });
window.addEventListener('mousemove', drag);
window.addEventListener('touchmove', drag, { passive: false });
window.addEventListener('mouseup', endInteraction);
window.addEventListener('touchend', endInteraction);
container.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, true); });

function startInteraction(e) {
    if (e.target.closest('.bottom-sheet') || e.target.closest('.route-sheet') || e.target.closest('.m3-surface')) return;
    hideMenus();

    if (e.type === 'touchstart' && e.touches.length === 2) {
        // 双指捏合缩放初始化
        initialPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        lastPinchZoom = appState.zoom;
        isDragging = false;
        return;
    }

    // 鼠标中键直接呼出菜单
    if (e.button === 1) { e.preventDefault(); showContextMenu(e.clientX, e.clientY); return; }

    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    
    isDragging = true;
    dragStartMouseX = clientX; dragStartMouseY = clientY;
    dragStartX = appState.x; dragStartZ = appState.z;
    
    // 严格的长按判断
    longPressTimer = setTimeout(() => {
        if(isDragging) { isDragging = false; showContextMenu(clientX, clientY); }
    }, 600);
}

function drag(e) {
    if (e.type === 'touchmove' && e.touches.length === 2 && initialPinchDistance) {
        e.preventDefault();
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        // 动态计算缩放步长
        const zoomDelta = Math.log2(dist / initialPinchDistance);
        const targetZoom = Math.round(lastPinchZoom + zoomDelta);
        if (targetZoom !== appState.zoom) setZoom(targetZoom);
        return;
    }

    if (!isDragging) return;
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    
    // 移动超过5像素取消长按
    if (Math.hypot(clientX - dragStartMouseX, clientY - dragStartMouseY) > 5) clearTimeout(longPressTimer);

    const scale = Math.pow(2, appState.zoom);
    appState.x = dragStartX - ((clientX - dragStartMouseX) / scale);
    appState.z = dragStartZ - ((clientY - dragStartMouseY) / scale);
    requestAnimationFrame(updateMap);
}

function endInteraction() { clearTimeout(longPressTimer); isDragging = false; initialPinchDistance = null; }

function setZoom(newZoom) {
    newZoom = Math.max(mapConfig.minZoom, Math.min(mapConfig.maxZoom, newZoom));
    if (newZoom === appState.zoom) return;
    appState.zoom = newZoom; updateMap();
}
document.getElementById('btn-zoom-in').onclick = () => setZoom(appState.zoom + 1);
document.getElementById('btn-zoom-out').onclick = () => setZoom(appState.zoom - 1);
container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0) setZoom(appState.zoom - 1); else if (e.deltaY < 0) setZoom(appState.zoom + 1);
}, { passive: false });


// ================= UI 与 菜单控制 =================
function showContextMenu(screenX, screenY, fromRightClick = false) {
    const scale = Math.pow(2, appState.zoom);
    const targetX = Math.round(appState.x + (screenX - container.offsetWidth/2) / scale);
    const targetZ = Math.round(appState.z + (screenY - container.offsetHeight/2) / scale);
    
    document.getElementById('ctx-coords').textContent = `${targetX}, ${targetZ}`;
    window.lastClickedCoords = {x: targetX, z: targetZ};

    // 边界碰撞处理防出屏幕外
    let finalX = screenX; let finalY = screenY;
    if (finalX + 200 > window.innerWidth) finalX = window.innerWidth - 220;
    if (finalY + 250 > window.innerHeight) finalY = window.innerHeight - 270;
    
    contextMenu.style.left = `${finalX}px`; contextMenu.style.top = `${finalY}px`;
    contextMenu.style.display = 'block';
}

function setMapMode(mode) {
    appState.mapMode = mode;
    layerMenu.style.display = 'none';
    updateMap();
}
document.getElementById('btn-layers').onclick = (e) => {
    e.stopPropagation(); hideMenus();
    layerMenu.style.left = `16px`; layerMenu.style.bottom = `100px`;
    layerMenu.style.display = 'block';
}

function openBottomSheet(poi) {
    hideMenus();
    const typeLabel = POI_TYPES[poi.type] || '地点';
    const brandHtml = poi.brandLogo ? `<img src="${poi.brandLogo}" class="brand-logo">` : `<div class="brand-logo" style="display:flex;align-items:center;justify-content:center;background:var(--md-sys-color-primary-container)"><span class="material-symbols-rounded">location_city</span></div>`;

    document.getElementById('sheet-content').innerHTML = `
        <div class="sheet-header-row">
            <div class="sheet-header">
                <h2>${poi.name}</h2>
                <div class="poi-type">${typeLabel} ${poi.status ? `· <span style="font-weight:normal; color:var(--md-sys-color-outline)">${poi.status}</span>` : ''}</div>
            </div>
            ${brandHtml}
        </div>
        <div class="action-buttons">
            <button class="action-btn" onclick="startRouteToPoi(${poi.x}, ${poi.z}, '${poi.name}')"><span class="material-symbols-rounded">directions</span> 路线</button>
            ${poi.website ? `<button class="action-btn secondary" onclick="window.open('${poi.website}')"><span class="material-symbols-rounded">language</span> 网站</button>` : ''}
        </div>
        ${poi.images ? `<img src="${poi.images[0]}" style="width:100%; border-radius: 12px; height: 140px; object-fit: cover;">` : ''}
    `;
    bottomSheet.classList.add('active');
}

function hideMenus() { 
    bottomSheet.classList.remove('active'); 
    contextMenu.style.display = 'none'; 
    layerMenu.style.display = 'none'; 
}

// ================= 谷歌风格路线规划面板 =================
function startRouteToPoi(tx, tz, name) {
    bottomSheet.classList.remove('active');
    routeState.end = {x: tx, z: tz, name: name};
    document.getElementById('route-end-input').textContent = name;
    
    if(!routeState.start) {
        routeState.start = {x: appState.x, z: appState.z, name: "我的位置"};
        document.getElementById('route-start-input').textContent = "我的位置";
    }
    openRouteSheet();
}

function setRouteStart() {
    routeState.start = { ...window.lastClickedCoords, name: `${window.lastClickedCoords.x}, ${window.lastClickedCoords.z}` };
    document.getElementById('route-start-input').textContent = routeState.start.name;
    openRouteSheet(); hideMenus();
}

function setRouteEnd() {
    routeState.end = { ...window.lastClickedCoords, name: `${window.lastClickedCoords.x}, ${window.lastClickedCoords.z}` };
    document.getElementById('route-end-input').textContent = routeState.end.name;
    openRouteSheet(); hideMenus();
}

function openRouteSheet() {
    routeSheet.classList.add('active');
    if (routeState.start && routeState.end) computeRoute();
}
function closeRouteSheet() {
    routeSheet.classList.remove('active');
    routeState.active = false;
    document.getElementById('btn-exit-route').style.display = 'none';
    updateMap();
}

function computeRoute() {
    // 模拟生成两个不同的方案 (实际项目中可以使用 A* 加权或限制路网生成)
    const baseRoute = calculateRoute(routeState.start.x, routeState.start.z, routeState.end.x, routeState.end.z);
    
    // 构造模拟的多方案数据
    routeState.paths = [baseRoute]; 
    if(baseRoute.length > 2) {
        // 假装截断一条路生成"备选方案"
        routeState.paths.push(baseRoute.slice(0, Math.ceil(baseRoute.length/2)).concat([{x: routeState.end.x, z: routeState.end.z}]));
    }
    
    routeState.selectedIndex = 0;
    routeState.active = true;
    document.getElementById('btn-exit-route').style.display = 'flex';
    
    // 渲染结果卡片
    const resultsDiv = document.getElementById('route-results');
    resultsDiv.innerHTML = routeState.paths.map((p, i) => `
        <div class="route-card ${i===0?'selected':''}" onclick="selectRouteOption(${i})">
            <div class="route-info">
                <h4>${i===0 ? '22 分钟' : '26 分钟'} <span class="material-symbols-rounded" style="font-size:18px">directions_car</span></h4>
                <p>${i===0 ? '最快路线' : '备选路线'} · ${p.length * 1.5} 公里</p>
            </div>
            <button class="action-btn" style="padding: 8px 16px; border-radius: 8px;">开始</button>
        </div>
    `).join('');
    
    updateMap();
}

window.selectRouteOption = function(index) {
    routeState.selectedIndex = index;
    const cards = document.querySelectorAll('.route-card');
    cards.forEach((c, i) => c.classList.toggle('selected', i === index));
    updateMap();
}

document.getElementById('btn-exit-route').onclick = closeRouteSheet;
function addLocationRedirect() { window.location.href = `add_marker.html?x=${window.lastClickedCoords.x}&z=${window.lastClickedCoords.z}`; }
function copyCoords() { navigator.clipboard.writeText(`${window.lastClickedCoords.x}, ${window.lastClickedCoords.z}`); hideMenus(); alert("已复制"); }
document.getElementById('btn-my-location').onclick = () => { appState.x = 0; appState.z = 0; updateMap(); };

// 基础瓦片加载
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

init();
