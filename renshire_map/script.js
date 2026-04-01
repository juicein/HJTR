// ================= 全局状态与设置 =================
let mapConfig = { minZoom: -6, maxZoom: 0, defaultZoom: -1, imageFormat: "webp" };
let appState = {
    x: -15193, z: -6713, zoom: -1,
    showCrosshair: true, showCoords: true, memoryEnabled: true
};
let mapData = { regions: [], pois: [], roads: [], subways: [] };

// 交互状态
let isDragging = false, isZooming = false;
let dragStartX, dragStartZ, dragStartMouseX, dragStartMouseY;
let initialPinchDistance = 0, initialZoomLevel = 0;
let longPressTimer;

// DOM 元素
const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const lineLayer = document.getElementById('line-layer');
const coordsDisplay = document.getElementById('coords-display');
const bottomSheet = document.getElementById('bottom-sheet');

// ================= 初始化与本地存储 =================
function init() {
    loadSettings();
    applySettingsToUI();
    
    // 加载地图属性和图层数据
    fetch('map_properties.js').then(res => res.text()).then(text => {
        // 简单提取配置，避免 new Function
        if(text.includes('minZoom')) mapConfig.minZoom = -6; 
    }).catch(e => console.warn("未找到属性文件，使用默认"));

    fetch('map_data.json').then(res => res.json()).then(data => {
        mapData = data;
        if (!appState.memoryEnabled && data.settings?.origin) {
            appState.x = data.settings.origin.x;
            appState.z = data.settings.origin.z;
        }
        updateMap();
    }).catch(e => {
        console.error("无法加载地图数据", e);
        updateMap();
    });
}

function loadSettings() {
    const saved = localStorage.getItem('mapAppState');
    if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.memoryEnabled) {
            appState.x = parsed.x ?? appState.x;
            appState.z = parsed.z ?? appState.z;
            appState.zoom = parsed.zoom ?? appState.zoom;
        }
        appState.showCrosshair = parsed.showCrosshair ?? true;
        appState.showCoords = parsed.showCoords ?? true;
        appState.memoryEnabled = parsed.memoryEnabled ?? true;
    }
}

function saveSettings() {
    localStorage.setItem('mapAppState', JSON.stringify(appState));
}

// ================= 核心渲染引擎 =================
function updateMap() {
    const scale = Math.pow(2, appState.zoom);
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    
    const centerWorldPx = appState.x * scale;
    const centerWorldPz = appState.z * scale;
    
    // 更新坐标显示
    coordsDisplay.textContent = `X: ${Math.round(appState.x)}, Z: ${Math.round(appState.z)}`;
    saveSettings();

    // 1. 渲染瓦片
    renderTiles(centerWorldPx, centerWorldPz, scale, width, height);
    
    // 2. 渲染 SVG 道路和地铁
    renderLines(centerWorldPx, centerWorldPz, scale, width, height);

    // 3. 渲染标记点和地名
    renderMarkers(centerWorldPx, centerWorldPz, scale, width, height);
}

function renderTiles(centerWorldPx, centerWorldPz, scale, width, height) {
    const centerTileX = Math.floor(centerWorldPx / 256);
    const centerTileZ = Math.floor(centerWorldPz / 256);
    const rangeX = Math.ceil(width / 2 / 256) + 1;
    const rangeZ = Math.ceil(height / 2 / 256) + 1;
    
    const neededTiles = new Set();
    
    for (let tx = centerTileX - rangeX; tx <= centerTileX + rangeX; tx++) {
        for (let tz = centerTileZ - rangeZ; tz <= centerTileZ + rangeZ; tz++) {
            const key = `${appState.zoom}_${tx}_${tz}`;
            neededTiles.add(key);
            
            const screenX = (width / 2) + (tx * 256 - centerWorldPx);
            const screenY = (height / 2) + (tz * 256 - centerWorldPz);
            
            let img = tileContainer.querySelector(`img[data-key="${key}"]`);
            if (!img) {
                img = document.createElement('img');
                img.dataset.key = key;
                img.src = `./tiles/zoom.${appState.zoom}/${Math.floor(tx/10)}/${Math.floor(tz/10)}/tile.${tx}.${tz}.${mapConfig.imageFormat}`;
                img.onerror = () => img.style.display = 'none';
                tileContainer.appendChild(img);
            }
            img.style.left = `${Math.round(screenX)}px`;
            img.style.top = `${Math.round(screenY)}px`;
        }
    }
    Array.from(tileContainer.children).forEach(img => {
        if (!neededTiles.has(img.dataset.key)) img.remove();
    });
}

function renderLines(cx, cz, scale, width, height) {
    lineLayer.innerHTML = ''; // 清空 SVG
    
    const drawPath = (lineData, styleClass, strokeColor, strokeWidth) => {
        if (appState.zoom < lineData.minZoom || appState.zoom > lineData.maxZoom) return;
        
        let pathD = "";
        lineData.points.forEach((pt, i) => {
            const sx = (width / 2) + (pt.x * scale - cx);
            const sy = (height / 2) + (pt.z * scale - cz);
            pathD += (i === 0 ? `M ${sx} ${sy} ` : `L ${sx} ${sy} `);
        });
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', strokeColor);
        path.setAttribute('stroke-width', strokeWidth);
        path.setAttribute('stroke-linejoin', 'round'); // 核心：让道路交汇处产生平滑圆角！
        path.setAttribute('stroke-linecap', 'round');
        lineLayer.appendChild(path);
    };

    // 渲染道路
    mapData.roads.forEach(road => {
        let width = road.type === 'highway' ? 8 : (road.type === 'main' ? 5 : 3);
        let color = road.type === 'highway' ? 'rgba(255, 160, 0, 0.7)' : 'rgba(255, 255, 255, 0.6)';
        drawPath(road, '', color, width);
    });

    // 渲染地铁
    mapData.subways.forEach(sub => {
        drawPath(sub, '', sub.color || '#E53935', 4);
    });
}

function renderMarkers(cx, cz, scale, width, height) {
    markerContainer.innerHTML = '';
    
    // 渲染地名 (Regions)
    mapData.regions.forEach(reg => {
        if (appState.zoom < reg.minZoom || appState.zoom > reg.maxZoom) return;
        const sx = (width / 2) + (reg.x * scale - cx);
        const sy = (height / 2) + (reg.z * scale - cz);
        
        const el = document.createElement('div');
        el.className = 'marker-region';
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        el.textContent = reg.name;
        markerContainer.appendChild(el);
    });

    // 渲染 POI 地点
    mapData.pois.forEach(poi => {
        if (appState.zoom < poi.minZoom || appState.zoom > poi.maxZoom) return;
        const sx = (width / 2) + (poi.x * scale - cx);
        const sy = (height / 2) + (poi.z * scale - cz);
        
        if (sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50) return; // 屏幕外剔除
        
        const el = document.createElement('div');
        el.className = 'map-marker';
        el.style.left = `${sx}px`; el.style.top = `${sy}px`;
        
        // 自动匹配图标
        let icon = 'location_on';
        if(poi.type === 'supermarket') icon = 'shopping_cart';
        if(poi.type === 'hotel') icon = 'hotel';
        if(poi.type === 'bank') icon = 'account_balance';
        if(poi.type === 'school') icon = 'school';

        el.innerHTML = `
            <div class="marker-icon"><span class="material-symbols-rounded" style="font-size: 20px;">${icon}</span></div>
            <div class="marker-label">${poi.name}</div>
        `;
        el.onclick = (e) => { e.stopPropagation(); openBottomSheet(poi); };
        markerContainer.appendChild(el);
    });
}

// ================= 交互逻辑 =================
function setZoom(newZoom) {
    newZoom = Math.max(mapConfig.minZoom, Math.min(mapConfig.maxZoom, newZoom));
    if (newZoom === appState.zoom) return;
    appState.zoom = newZoom;
    tileContainer.innerHTML = '';
    updateMap();
}

document.getElementById('btn-zoom-in').onclick = () => setZoom(appState.zoom + 1);
document.getElementById('btn-zoom-out').onclick = () => setZoom(appState.zoom - 1);
document.getElementById('btn-my-location').onclick = () => { appState.x = 0; appState.z = 0; updateMap(); };

container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0) setZoom(appState.zoom - 1);
    else if (e.deltaY < 0) setZoom(appState.zoom + 1);
}, { passive: false });

// 拖拽与长按
container.addEventListener('mousedown', startInteraction);
container.addEventListener('touchstart', startInteraction, { passive: false });
window.addEventListener('mousemove', drag);
window.addEventListener('touchmove', drag, { passive: false });
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
    
    // 长按触发
    longPressTimer = setTimeout(() => {
        isDragging = false;
        showContextMenu(clientX, clientY);
    }, 600);
}

function drag(e) {
    if (!isDragging) return;
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    
    // 如果移动超过一定距离，取消长按
    if (Math.abs(clientX - dragStartMouseX) > 10 || Math.abs(clientY - dragStartMouseY) > 10) {
        clearTimeout(longPressTimer);
    }

    const deltaX = clientX - dragStartMouseX;
    const deltaY = clientY - dragStartMouseY;
    const scale = Math.pow(2, appState.zoom);
    
    appState.x = dragStartX - (deltaX / scale);
    appState.z = dragStartZ - (deltaY / scale);
    requestAnimationFrame(updateMap);
}

function endInteraction() {
    clearTimeout(longPressTimer);
    isDragging = false;
}

// ================= UI 组件 =================
function openBottomSheet(poi) {
    const content = document.getElementById('sheet-content');
    let imagesHtml = '';
    if (poi.images && poi.images.length > 0) {
        imagesHtml = `<div class="sheet-images">${poi.images.map(img => `<img src="${img}">`).join('')}</div>`;
    }
    
    content.innerHTML = `
        <div class="sheet-header">
            <h2>${poi.name}</h2>
            <div class="sheet-rating">${poi.rating || '暂无评分'} <span class="material-symbols-rounded">star</span> (${poi.reviews || 0})<br>${poi.status || ''}</div>
        </div>
        <div class="action-buttons">
            <button class="action-btn"><div class="icon"><span class="material-symbols-rounded">directions</span></div>路线</button>
            ${poi.website ? `<button class="action-btn" onclick="window.open('${poi.website}')"><div class="icon"><span class="material-symbols-rounded">language</span></div>网站</button>` : ''}
            <button class="action-btn"><div class="icon"><span class="material-symbols-rounded">share</span></div>分享</button>
        </div>
        ${imagesHtml}
        <div style="padding-top:16px; border-top:1px solid var(--md-sys-color-surface-container);">
            <p style="color: var(--md-sys-color-outline); line-height: 1.5;">${poi.remarks || '没有更多介绍信息。'}</p>
        </div>
    `;
    bottomSheet.classList.add('active');
}

function hideMenus() {
    bottomSheet.classList.remove('active');
    document.getElementById('context-menu').style.display = 'none';
}

function showContextMenu(screenX, screenY) {
    // 将屏幕坐标反算为地图世界坐标
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    const scale = Math.pow(2, appState.zoom);
    const targetX = Math.round(appState.x + (screenX - width/2) / scale);
    const targetZ = Math.round(appState.z + (screenY - height/2) / scale);
    
    const menu = document.getElementById('context-menu');
    document.getElementById('ctx-coords').textContent = `${targetX}, ${targetZ}`;
    menu.style.left = `${screenX}px`;
    menu.style.top = `${screenY}px`;
    menu.style.display = 'block';
    
    window.lastClickedCoords = {x: targetX, z: targetZ};
}

function copyCoords() {
    const text = `${window.lastClickedCoords.x}, ${window.lastClickedCoords.z}`;
    navigator.clipboard.writeText(text);
    hideMenus();
    alert("坐标已复制: " + text);
}

// ================= 设置面板 =================
document.getElementById('btn-settings').onclick = () => {
    document.getElementById('settings-modal').style.display = 'block';
};
document.getElementById('btn-close-settings').onclick = () => {
    document.getElementById('settings-modal').style.display = 'none';
};

function applySettingsToUI() {
    document.getElementById('toggle-crosshair').checked = appState.showCrosshair;
    document.getElementById('toggle-coords').checked = appState.showCoords;
    document.getElementById('toggle-memory').checked = appState.memoryEnabled;
    
    document.getElementById('crosshair').style.display = appState.showCrosshair ? 'block' : 'none';
    coordsDisplay.style.display = appState.showCoords ? 'inline-block' : 'none';
}

['toggle-crosshair', 'toggle-coords', 'toggle-memory'].forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
        if (id === 'toggle-crosshair') appState.showCrosshair = e.target.checked;
        if (id === 'toggle-coords') appState.showCoords = e.target.checked;
        if (id === 'toggle-memory') appState.memoryEnabled = e.target.checked;
        applySettingsToUI();
        saveSettings();
    });
});

// 启动
init();
