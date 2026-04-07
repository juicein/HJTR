let mapConfig = { minZoom: -6, maxZoom: 0, defaultZoom: -1, imageFormat: "webp" };
let appState = { x: 0, z: 0, zoom: -1, showCrosshair: true, showCoords: true, memoryEnabled: true, mapLayer: 'all' }; // mapLayer: all, transit, drive, raw
let mapData = { regions: [], pois: [], roads: [], subways: [] };

// 路由状态
let routeState = { active: false, start: null, end: null, mode: 'drive', path: [], options: [] };
let graphDrive = new Map();
let graphTransit = new Map();

// 手势与拖拽控制
let isDragging = false;
let dragStartX, dragStartZ, dragStartMouseX, dragStartMouseY;
let longPressTimer;
let initialPinchDist = null;
let initialZoom = null;

const BEZIER_RADIUS = 60; // 控制弯道平滑的圆角曲度放大

const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const regionContainer = document.getElementById('region-container');
const lineLayer = document.getElementById('line-layer');
const bottomSheet = document.getElementById('bottom-sheet');
const routePanel = document.getElementById('route-panel');
const contextMenu = document.getElementById('context-menu');

const POI_TYPES = {
    'supermarket': '超市', 'hotel': '酒店', 'bank': '银行', 
    'school': '学校', 'government': '政府机关', 'mall': '商场', 
    'museum': '博物馆', 'park': '公园', 'restaurant': '餐厅', 
    'cafe': '咖啡吧', 'subway_station': '轨道交通'
};

function init() {
    loadSettings();
    document.getElementById('toggle-crosshair').checked = appState.showCrosshair;
    document.getElementById('toggle-coords').checked = appState.showCoords;
    document.getElementById('toggle-memory').checked = appState.memoryEnabled;
    document.getElementById('crosshair').style.display = appState.showCrosshair ? 'block' : 'none';
    document.getElementById('coords-display').style.display = appState.showCoords ? 'inline-block' : 'none';

    fetch('map_data.json').then(res => res.json()).then(data => {
        mapData = data;
        if (!appState.memoryEnabled && data.settings?.origin) {
            appState.x = data.settings.origin.x; appState.z = data.settings.origin.z;
        }
        buildGraphs();
        updateMap();
    }).catch(e => { console.error("加载地图数据失败", e); });
}

// ================= 路网与寻路 (Dijkstra) =================
function buildGraphs() {
    graphDrive.clear(); graphTransit.clear();
    const addEdge = (graph, p1, p2) => {
        const k1 = `${p1.x},${p1.z}`; const k2 = `${p2.x},${p2.z}`;
        const dist = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.z - p2.z, 2));
        if(!graph.has(k1)) graph.set(k1, []);
        if(!graph.has(k2)) graph.set(k2, []);
        graph.get(k1).push({ node: k2, dist, x: p2.x, z: p2.z });
        graph.get(k2).push({ node: k1, dist, x: p1.x, z: p1.z });
    };

    mapData.roads.forEach(road => {
        for (let i = 0; i < road.points.length - 1; i++) addEdge(graphDrive, road.points[i], road.points[i+1]);
    });
    mapData.subways.forEach(sub => {
        for (let i = 0; i < sub.points.length - 1; i++) addEdge(graphTransit, sub.points[i], sub.points[i+1]);
    });
}

function getNearestNode(graph, px, pz) {
    let nearest = null; let minD = Infinity;
    graph.forEach((edges, key) => {
        const [x, z] = key.split(',').map(Number);
        const d = Math.sqrt(Math.pow(x - px, 2) + Math.pow(z - pz, 2));
        if(d < minD) { minD = d; nearest = {x, z, key}; }
    });
    return nearest;
}

function calculateRoute(graph, startX, startZ, endX, endZ) {
    const startNode = getNearestNode(graph, startX, startZ);
    const endNode = getNearestNode(graph, endX, endZ);
    if (!startNode || !endNode) return null;

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
            if (alt < distances.get(neighbor.node)) { distances.set(neighbor.node, alt); previous.set(neighbor.node, currKey); }
        });
    }

    const path = []; let curr = endNode.key; let totalDist = distances.get(endNode.key);
    if (previous.has(curr) || curr === startNode.key) {
        while (curr) { const [x, z] = curr.split(',').map(Number); path.unshift({x, z}); curr = previous.get(curr); }
    }
    return { path, totalDist };
}

// ================= 核心渲染 =================
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

// 贝塞尔平滑弯道
function generateSmoothPathD(points, scale, cx, cz, width, height) {
    if (points.length < 2) return { d: "", len: 0 };
    let d = ""; let totalLen = 0;
    
    const getScreenPt = (pt) => ({ x: (width / 2) + (pt.x * scale - cx), y: (height / 2) + (pt.z * scale - cz) });

    for (let i = 0; i < points.length; i++) {
        const p = getScreenPt(points[i]);
        if (i === 0) {
            d += `M ${p.x} ${p.y} `;
        } else if (i === points.length - 1) {
            d += `L ${p.x} ${p.y}`;
            const pPrev = getScreenPt(points[i-1]);
            totalLen += Math.sqrt(Math.pow(p.x - pPrev.x, 2) + Math.pow(p.y - pPrev.y, 2));
        } else {
            const pPrev = getScreenPt(points[i-1]);
            const pNext = getScreenPt(points[i+1]);
            const d1 = Math.sqrt(Math.pow(p.x - pPrev.x, 2) + Math.pow(p.y - pPrev.y, 2));
            const d2 = Math.sqrt(Math.pow(pNext.x - p.x, 2) + Math.pow(pNext.y - p.y, 2));
            totalLen += d1;
            
            const r = Math.min(BEZIER_RADIUS * scale, d1/2, d2/2); 
            const q1x = p.x - (p.x - pPrev.x) * (r / d1); const q1y = p.y - (p.y - pPrev.y) * (r / d1);
            const q2x = p.x + (pNext.x - p.x) * (r / d2); const q2y = p.y + (pNext.y - p.y) * (r / d2);
            
            d += `L ${q1x} ${q1y} Q ${p.x} ${p.y} ${q2x} ${q2y} `;
        }
    }
    return { d, len: totalLen };
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
        // 缩放地区文字大小
        el.style.fontSize = `${Math.max(20, 60 + appState.zoom * 10)}px`;
        el.textContent = reg.name;
        regionContainer.appendChild(el);
    });
}

function renderLines(cx, cz, scale, width, height) {
    lineLayer.innerHTML = '';
    
    const drawLine = (lineData, isSubway) => {
        if (appState.mapLayer === 'raw') return;
        if (appState.mapLayer === 'transit' && !isSubway) return;
        if (appState.mapLayer === 'drive' && isSubway) return;
        if (appState.zoom < lineData.minZoom || appState.zoom > lineData.maxZoom) return;
        
        const pathData = generateSmoothPathD(lineData.points, scale, cx, cz, width, height);
        if(!pathData.d) return;

        const pathId = `path-${lineData.id}`;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('id', pathId);
        path.setAttribute('d', pathData.d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        
        // 根据比例尺动态调整线宽
        let baseWidth = isSubway ? 6 : (lineData.type === 'highway' ? 10 : (lineData.type === 'expressway' ? 8 : (lineData.type === 'main' ? 6 : 4)));
        let strokeW = Math.max(2, baseWidth + appState.zoom * 1.5); // 防止缩小糊一起
        
        if (isSubway) {
            path.setAttribute('stroke', lineData.color || '#E53935');
            path.setAttribute('stroke-width', strokeW);
        } else {
            let color = lineData.type === 'highway' ? '#fbbc04' : (lineData.type === 'expressway' ? '#fce8b2' : '#ffffff');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', strokeW);
            
            // 添加道路边框效果
            const borderPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            borderPath.setAttribute('d', pathData.d); borderPath.setAttribute('fill', 'none');
            borderPath.setAttribute('stroke', '#dadce0'); borderPath.setAttribute('stroke-width', strokeW + 2);
            lineLayer.appendChild(borderPath);
        }
        lineLayer.appendChild(path);

        // 动态数量的文字标注
        if (lineData.name && scale >= 0.1) {
            const textClass = isSubway ? 'subway-text' : 'road-text';
            const numLabels = Math.max(1, Math.floor(pathData.len / 400)); // 每 400px 屏幕距离放一个名字
            const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textEl.setAttribute('class', textClass);
            textEl.setAttribute('dy', isSubway ? -strokeW : 5); // 轨道文字在上方，道路文字居中
            
            let tspanHtml = '';
            for(let i=1; i<=numLabels; i++) {
                const offset = `${(i / (numLabels + 1)) * 100}%`;
                tspanHtml += `<textPath href="#${pathId}" startOffset="${offset}">${lineData.name}</textPath>`;
            }
            textEl.innerHTML = tspanHtml;
            lineLayer.appendChild(textEl);
        }
    };

    mapData.roads.forEach(r => drawLine(r, false));
    mapData.subways.forEach(s => drawLine(s, true));
}

function renderActiveRoute(cx, cz, scale, width, height) {
    if (!routeState.active || !routeState.start || !routeState.end) return;
    const getScreenPt = (x, z) => `${(width / 2) + (x * scale - cx)},${(height / 2) + (z * scale - cz)}`;

    const drawRoutePath = (pathObj, color) => {
        if(!pathObj || pathObj.path.length === 0) return;
        const pData = generateSmoothPathD(pathObj.path, scale, cx, cz, width, height);
        const rp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rp.setAttribute('d', pData.d); rp.setAttribute('fill', 'none');
        rp.setAttribute('stroke', color); rp.setAttribute('stroke-width', Math.max(4, 8 + appState.zoom)); 
        rp.setAttribute('stroke-linecap', 'round'); rp.setAttribute('stroke-linejoin', 'round');
        lineLayer.appendChild(rp);
    };

    const startPx = getScreenPt(routeState.start.x, routeState.start.z);
    const endPx = getScreenPt(routeState.end.x, routeState.end.z);
    
    let currentOption = routeState.options.find(o => o.selected);
    if (currentOption && currentOption.path.length > 0) {
        drawRoutePath(currentOption, '#1a73e8'); // 谷歌蓝
        const firstNode = getScreenPt(currentOption.path[0].x, currentOption.path[0].z);
        const lastNode = getScreenPt(currentOption.path[currentOption.path.length-1].x, currentOption.path[currentOption.path.length-1].z);
        
        lineLayer.innerHTML += `<path d="M ${startPx} L ${firstNode}" stroke="#1a73e8" stroke-width="4" stroke-dasharray="8,8" />`;
        lineLayer.innerHTML += `<path d="M ${lastNode} L ${endPx}" stroke="#1a73e8" stroke-width="4" stroke-dasharray="8,8" />`;
    } else {
        lineLayer.innerHTML += `<path d="M ${startPx} L ${endPx}" stroke="#1a73e8" stroke-width="4" stroke-dasharray="8,8" />`;
    }

    // 画起终点 Marker
    const createRouteMarker = (px, pz, isStart) => {
        const el = document.createElement('div');
        el.className = 'map-marker';
        el.style.left = `${px}px`; el.style.top = `${pz}px`;
        const icon = isStart ? 'my_location' : 'location_on';
        const color = isStart ? '#1a73e8' : '#d93025';
        el.innerHTML = `<div class="marker-icon" style="background:${color}"><span class="material-symbols-rounded" style="font-size:18px;">${icon}</span></div>`;
        markerContainer.appendChild(el);
    };
    createRouteMarker((width/2)+(routeState.start.x*scale-cx), (height/2)+(routeState.start.z*scale-cz), true);
    createRouteMarker((width/2)+(routeState.end.x*scale-cx), (height/2)+(routeState.end.z*scale-cz), false);
}

function renderMarkers(cx, cz, scale, width, height) {
    if(routeState.active) return; // 规划路线时隐藏普通标注，防干扰
    markerContainer.innerHTML = '';
    
    let allPois = [...mapData.pois];
    mapData.subways.forEach(sub => {
        if(sub.stations) sub.stations.forEach(st => allPois.push({ ...st, type: 'subway_station', companyLogo: sub.logo }));
    });

    allPois.forEach(poi => {
        if (appState.zoom < (poi.minZoom || -3) || appState.zoom > (poi.maxZoom || 0)) return;
        const sx = (width / 2) + (poi.x * scale - cx);
        const sy = (height / 2) + (poi.z * scale - cz);
        
        if (sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) return; 
        
        const el = document.createElement('div');
        el.className = 'map-marker';
        // 防碰撞：如果太靠右，文字居左
        if (sx > width - 120) el.classList.add('left-align');

        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        
        let icon = 'location_on'; let bgColor = 'var(--md-sys-color-primary)';
        if(poi.type === 'supermarket') icon = 'shopping_cart';
        if(poi.type === 'hotel') { icon = 'hotel'; bgColor = '#8E24AA'; }
        if(poi.type === 'bank') icon = 'account_balance';
        if(poi.type === 'subway_station') { icon = 'directions_subway'; bgColor = '#E53935'; } 

        let iconHtml = `<div class="marker-icon" style="background:${bgColor}"><span class="material-symbols-rounded" style="font-size: 18px;">${icon}</span>`;
        if (poi.companyLogo) iconHtml += `<img src="${poi.companyLogo}" class="company-logo">`;
        iconHtml += `</div>`;

        el.innerHTML = `${iconHtml}<div class="marker-label">${poi.name}</div>`;
        el.onclick = (e) => { e.stopPropagation(); openBottomSheet(poi); };
        markerContainer.appendChild(el);
    });
}

// ================= 交互与手势事件 =================
container.addEventListener('touchstart', (e) => { 
    if(e.touches.length === 2) { e.preventDefault(); handlePinchStart(e); } 
    else startInteraction(e); 
}, {passive: false});
container.addEventListener('touchmove', (e) => { 
    if(e.touches.length === 2) { e.preventDefault(); handlePinchMove(e); } 
    else { e.preventDefault(); drag(e); }
}, {passive: false});
container.addEventListener('touchend', (e) => { initialPinchDist = null; endInteraction(); });

container.addEventListener('mousedown', startInteraction);
window.addEventListener('mousemove', drag);
window.addEventListener('mouseup', endInteraction);

function handlePinchStart(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    initialPinchDist = Math.sqrt(dx*dx + dy*dy);
    initialZoom = appState.zoom;
    clearTimeout(longPressTimer);
}

function handlePinchMove(e) {
    if (!initialPinchDist) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const zoomDelta = Math.log2(dist / initialPinchDist);
    
    // 每次增量>0.5才实际缩放
    if (Math.abs(zoomDelta) > 0.6) {
        setZoom(Math.round(initialZoom + zoomDelta));
        initialPinchDist = dist; initialZoom = appState.zoom;
    }
}

function startInteraction(e) {
    if (e.target.closest('.bottom-sheet') || e.target.closest('.context-menu') || e.target.closest('.route-panel')) return;
    hideMenus();

    // 允许电脑鼠标中键 (button 1) 呼出菜单
    if (e.type === 'mousedown' && e.button === 1) {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY);
        return;
    }

    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    
    isDragging = true;
    dragStartMouseX = clientX; dragStartMouseY = clientY;
    dragStartX = appState.x; dragStartZ = appState.z;
    
    longPressTimer = setTimeout(() => {
        isDragging = false; showContextMenu(clientX, clientY);
    }, 600); // 严格长按时间
}

function drag(e) {
    if (!isDragging) return;
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    
    if (Math.abs(clientX - dragStartMouseX) > 5 || Math.abs(clientY - dragStartMouseY) > 5) {
        clearTimeout(longPressTimer); // 拖动大于5px则取消长按菜单
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

// ================= 路由与菜单UI功能 =================
function showContextMenu(screenX, screenY) {
    const scale = Math.pow(2, appState.zoom);
    const targetX = Math.round(appState.x + (screenX - container.offsetWidth/2) / scale);
    const targetZ = Math.round(appState.z + (screenY - container.offsetHeight/2) / scale);
    
    document.getElementById('ctx-coords').textContent = `${targetX}, ${targetZ}`;
    window.lastClickedCoords = {x: targetX, z: targetZ, name: `${targetX}, ${targetZ}`};
    
    // 边界检测，防止飞出屏幕
    contextMenu.style.display = 'block';
    const rect = contextMenu.getBoundingClientRect();
    if (screenX + rect.width > window.innerWidth) screenX = window.innerWidth - rect.width - 10;
    if (screenY + rect.height > window.innerHeight) screenY = window.innerHeight - rect.height - 10;
    
    // 添加过渡动画
    contextMenu.style.left = `${screenX}px`; contextMenu.style.top = `${screenY+10}px`;
    contextMenu.animate([{opacity:0, transform:'translateY(10px)'}, {opacity:1, transform:'translateY(0)'}], {duration: 200, fill: 'forwards'});
}

function addLocationRedirect() { window.location.href = `add_marker.html?x=${window.lastClickedCoords.x}&z=${window.lastClickedCoords.z}`; }

// 路线规划系统
function setRouteStart() { routeState.start = { ...window.lastClickedCoords }; openRoutePanel(); hideMenus(); }
function setRouteEnd() { routeState.end = { ...window.lastClickedCoords }; openRoutePanel(); hideMenus(); }
function swapRoute() { const temp = routeState.start; routeState.start = routeState.end; routeState.end = temp; generateRoutes(); }

function openRoutePanel() {
    routePanel.classList.add('active'); bottomSheet.classList.remove('active');
    document.getElementById('btn-exit-route').style.display = 'flex';
    generateRoutes();
}
function closeRoutePanel() {
    routePanel.classList.remove('active');
    routeState = { active: false, start: null, end: null, mode: 'drive', path: [], options: [] };
    document.getElementById('btn-exit-route').style.display = 'none';
    updateMap();
}
document.getElementById('btn-exit-route').onclick = closeRoutePanel;

document.querySelectorAll('.route-tab').forEach(tab => {
    tab.onclick = (e) => {
        document.querySelectorAll('.route-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        routeState.mode = e.currentTarget.dataset.mode;
        generateRoutes();
    };
});

function generateRoutes() {
    document.getElementById('route-start-input').value = routeState.start ? routeState.start.name : '';
    document.getElementById('route-end-input').value = routeState.end ? routeState.end.name : '';
    
    const listEl = document.getElementById('route-options-list');
    if (!routeState.start || !routeState.end) {
        listEl.innerHTML = '<div style="text-align:center; color:#888; padding:20px;">请完善起终点信息</div>';
        return;
    }

    routeState.active = true;
    routeState.options = [];
    
    if (routeState.mode === 'drive') {
        const res = calculateRoute(graphDrive, routeState.start.x, routeState.start.z, routeState.end.x, routeState.end.z);
        if(res && res.path.length>0) routeState.options.push({ path: res.path, time: `${Math.ceil(res.totalDist/10)} 分钟`, desc: '最快路线 · 驾车', selected: true });
        routeState.options.push({ path: [], time: '直线导航', desc: '无可用路网', selected: !res || res.path.length===0 });
    } else if (routeState.mode === 'transit') {
        const res = calculateRoute(graphTransit, routeState.start.x, routeState.start.z, routeState.end.x, routeState.end.z);
        if(res && res.path.length>0) routeState.options.push({ path: res.path, time: `${Math.ceil(res.totalDist/15)} 分钟`, desc: '推荐轨道交通', selected: true });
        else routeState.options.push({ path: [], time: '无换乘方案', desc: '附近无地铁站', selected: true });
    } else {
        routeState.options.push({ path: [], time: '直线步行', desc: '自由寻路', selected: true });
    }

    renderRouteOptions(listEl);
    updateMap();
}

function renderRouteOptions(container) {
    container.innerHTML = '';
    routeState.options.forEach((opt, idx) => {
        const div = document.createElement('div');
        div.className = `route-card ${opt.selected ? 'selected' : ''}`;
        div.innerHTML = `<div><div class="time">${opt.time}</div><div class="desc">${opt.desc}</div></div><span class="material-symbols-rounded" style="color:var(--md-sys-color-primary)">${opt.selected ? 'check_circle' : 'chevron_right'}</span>`;
        div.onclick = () => { routeState.options.forEach(o => o.selected = false); opt.selected = true; renderRouteOptions(container); updateMap(); };
        container.appendChild(div);
    });
}

function openBottomSheet(poi) {
    const content = document.getElementById('sheet-content');
    const typeLabel = POI_TYPES[poi.type] || '地点';
    const brandHtml = poi.brandLogo ? `<img src="${poi.brandLogo}" class="brand-logo">` : '';
    const imgsHtml = poi.images ? `<div class="sheet-images">${poi.images.map(i=>`<img src="${i}">`).join('')}</div>` : '';

    content.innerHTML = `
        <div class="sheet-header-row">
            <div class="sheet-header">
                <h2>${poi.name}</h2>
                <div class="poi-type">${typeLabel} ${poi.status ? `· <span style="font-weight:normal; color:var(--md-sys-color-outline)">${poi.status}</span>` : ''}</div>
            </div>
            ${brandHtml}
        </div>
        <div class="action-buttons">
            <button class="action-btn" onclick="window.lastClickedCoords={x:${poi.x},z:${poi.z},name:'${poi.name}'}; setRouteEnd();"><div class="icon"><span class="material-symbols-rounded">directions</span></div>路线</button>
            ${poi.website ? `<button class="action-btn" onclick="window.open('${poi.website}')"><div class="icon"><span class="material-symbols-rounded">language</span></div>网站</button>` : ''}
            <button class="action-btn"><div class="icon"><span class="material-symbols-rounded">share</span></div>分享</button>
        </div>
        ${imgsHtml}
        ${poi.remarks ? `<div style="padding-top:16px; border-top:1px solid var(--md-sys-color-surface-container); color:var(--md-sys-color-outline)">${poi.remarks}</div>` : ''}
    `;
    bottomSheet.classList.add('active'); routePanel.classList.remove('active');
}

function hideMenus() { contextMenu.style.display = 'none'; bottomSheet.classList.remove('active'); }
function copyCoords() {
    const t = `${window.lastClickedCoords.x}, ${window.lastClickedCoords.z}`;
    navigator.clipboard.writeText(t); hideMenus(); alert("已复制坐标: " + t);
}

// ================= 设置与图层 =================
document.getElementById('btn-layers').onclick = () => document.getElementById('layers-modal').style.display = 'block';
document.getElementById('btn-settings').onclick = () => document.getElementById('settings-modal').style.display = 'block';
document.getElementById('btn-close-settings').onclick = () => document.getElementById('settings-modal').style.display = 'none';

document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.onclick = (e) => {
        document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        appState.mapLayer = e.currentTarget.dataset.layer;
        document.getElementById('layers-modal').style.display = 'none';
        updateMap();
    };
});

document.getElementById('toggle-crosshair').onchange = (e) => { appState.showCrosshair = e.target.checked; document.getElementById('crosshair').style.display = e.target.checked?'block':'none'; saveSettings();};
document.getElementById('toggle-coords').onchange = (e) => { appState.showCoords = e.target.checked; document.getElementById('coords-display').style.display = e.target.checked?'inline-block':'none'; saveSettings();};
document.getElementById('toggle-memory').onchange = (e) => { appState.memoryEnabled = e.target.checked; saveSettings();};

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

function loadSettings() { const s = localStorage.getItem('mapAppStateM3'); if(s) Object.assign(appState, JSON.parse(s)); }
function saveSettings() { localStorage.setItem('mapAppStateM3', JSON.stringify(appState)); }
document.getElementById('btn-my-location').onclick = () => { appState.x = 0; appState.z = 0; updateMap(); };

init();
