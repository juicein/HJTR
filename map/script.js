// ================= 全局状态与设置 =================
let mapData = null;
let currentX = 0, currentZ = 0;
let zoomLevel = -1;
let isDragging = false;
let dragStartMouseX, dragStartMouseY, dragStartX, dragStartZ;

// 设置记忆系统
const defaultSettings = { showCrosshair: true, rememberPosition: true, lastX: 0, lastZ: 0, lastZoom: -1 };
let settings = JSON.parse(localStorage.getItem('mapSettings')) || defaultSettings;

// ================= DOM 元素 =================
const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const vectorLayer = document.getElementById('vector-layer'); // SVG层
const bottomSheet = document.getElementById('bottom-sheet');
const contextMenu = document.getElementById('context-menu');

// ================= 1. 初始化与数据加载 =================
async function init() {
    applySettingsToUI();
    
    try {
        const response = await fetch('data.json');
        mapData = await response.json();
        
        // 读取记忆位置或默认原点
        if (settings.rememberPosition && settings.lastX !== undefined) {
            currentX = settings.lastX; currentZ = settings.lastZ; zoomLevel = settings.lastZoom;
        } else {
            currentX = mapData.mapConfig.originX; currentZ = mapData.mapConfig.originZ; zoomLevel = mapData.mapConfig.defaultZoom;
        }
        
        updateMap();
    } catch (e) {
        console.error("加载 mapData.json 失败", e);
    }
}

function saveSettings() {
    if (settings.rememberPosition) {
        settings.lastX = currentX; settings.lastZ = currentZ; settings.lastZoom = zoomLevel;
    }
    localStorage.setItem('mapSettings', JSON.stringify(settings));
}

// ================= 2. 核心：混合渲染引擎 (瓦片 + 矢量道路 + 标记) =================
function updateMap() {
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    const scale = Math.pow(2, zoomLevel);
    
    const centerWorldPx = currentX * scale;
    const centerWorldPz = currentZ * scale;
    
    // 渲染地图瓦片 (与上一版逻辑相同)
    renderTiles(width, height, centerWorldPx, centerWorldPz, scale);
    
    if (!mapData) return;

    // 渲染 SVG 矢量道路 (核心改进：道路在底图上，但在地标下)
    renderVectors(width, height, centerWorldPx, centerWorldPz, scale);

    // 渲染各级地标、POI
    renderMarkers(width, height, centerWorldPx, centerWorldPz, scale);
    
    saveSettings();
}

function renderTiles(width, height, centerWorldPx, centerWorldPz, scale) {
    const centerTileX = Math.floor(centerWorldPx / 256);
    const centerTileZ = Math.floor(centerWorldPz / 256);
    const rangeX = Math.ceil(width / 2 / 256) + 1;
    const rangeZ = Math.ceil(height / 2 / 256) + 1;
    
    const neededTiles = new Set();
    for (let tx = centerTileX - rangeX; tx <= centerTileX + rangeX; tx++) {
        for (let tz = centerTileZ - rangeZ; tz <= centerTileZ + rangeZ; tz++) {
            const key = `${zoomLevel}_${tx}_${tz}`;
            neededTiles.add(key);
            const screenX = (width / 2) + (tx * 256 - centerWorldPx);
            const screenY = (height / 2) + (tz * 256 - centerWorldPz);
            
            let img = tileContainer.querySelector(`img[data-key="${key}"]`);
            if (!img) {
                img = document.createElement('img');
                img.dataset.key = key;
                img.src = `./tiles/zoom.${zoomLevel}/${Math.floor(tx/10)}/${Math.floor(tz/10)}/tile.${tx}.${tz}.webp`;
                img.onerror = () => { img.style.display = 'none'; };
                tileContainer.appendChild(img);
            }
            img.style.left = `${Math.round(screenX)}px`;
            img.style.top = `${Math.round(screenY)}px`;
        }
    }
    Array.from(tileContainer.children).forEach(img => { if (!neededTiles.has(img.dataset.key)) img.remove(); });
}

// === 新增：SVG 道路与轨交渲染 ===
function renderVectors(width, height, centerWorldPx, centerWorldPz, scale) {
    vectorLayer.innerHTML = ''; // 清空上一帧 SVG
    
    // 只有放大到一定程度才显示详细道路
    if (zoomLevel < -3) return;

    // 绘制道路
    mapData.roads.forEach(road => {
        const pathData = road.points.map((p, index) => {
            const screenX = (width / 2) + (p[0] * scale - centerWorldPx);
            const screenY = (height / 2) + (p[1] * scale - centerWorldPz);
            return `${index === 0 ? 'M' : 'L'} ${screenX} ${screenY}`;
        }).join(' ');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', road.color);
        path.setAttribute('stroke-width', road.width * scale * 2); // 道路宽度随缩放变化
        path.setAttribute('stroke-opacity', road.opacity);
        path.setAttribute('stroke-linejoin', 'round'); // 节点圆角平滑处理
        path.setAttribute('stroke-linecap', 'round');
        vectorLayer.appendChild(path);
    });
}

// === 分级标记点渲染 ===
function renderMarkers(width, height, centerWorldPx, centerWorldPz, scale) {
    markerContainer.innerHTML = ''; 
    
    // 渲染大区/社区名称 (缩小时显示)
    mapData.regions.forEach(region => {
        if (zoomLevel >= region.minZoom && zoomLevel <= region.maxZoom) {
            const screenX = (width / 2) + (region.x * scale - centerWorldPx);
            const screenY = (height / 2) + (region.z * scale - centerWorldPz);
            const el = document.createElement('div');
            el.className = 'region-label';
            el.style.left = `${screenX}px`; el.style.top = `${screenY}px`;
            el.innerText = region.name;
            markerContainer.appendChild(el);
        }
    });

    // 渲染具体 POI (放大时显示)
    let renderedScreenBox = []; // 用于简单的碰撞检测预留

    mapData.pois.forEach(poi => {
        if (zoomLevel >= poi.minZoom && zoomLevel <= poi.maxZoom) {
            const screenX = (width / 2) + (poi.x * scale - centerWorldPx);
            const screenY = (height / 2) + (poi.z * scale - centerWorldPz);
            
            // 剔除屏幕外的点
            if (screenX < -50 || screenX > width + 50 || screenY < -50 || screenY > height + 50) return;

            const el = document.createElement('div');
            el.className = 'map-marker';
            el.style.left = `${screenX}px`; el.style.top = `${screenY}px`;
            
            // 匹配 Material Icon
            let iconName = 'location_on';
            if (poi.type === 'supermarket') iconName = 'shopping_cart';
            else if (poi.type === 'hotel') iconName = 'bed';
            
            el.innerHTML = `
                <div class="marker-icon ${poi.type}"><span class="material-symbols-rounded" style="font-size: 18px;">${iconName}</span></div>
                <div class="marker-label">${poi.name}</div>
            `;
            
            // 点击弹出 Bottom Sheet
            el.onclick = (e) => { e.stopPropagation(); openBottomSheet(poi); };
            markerContainer.appendChild(el);
        }
    });
}

// ================= 3. 交互系统 (拖拽、长按、菜单) =================
let touchTimer;
container.addEventListener('mousedown', startInteraction);
container.addEventListener('touchstart', (e) => {
    startInteraction(e);
    // 触发长按检测 (500ms)
    const touch = e.touches[0];
    touchTimer = setTimeout(() => showContextMenu(touch.clientX, touch.clientY), 500);
}, { passive: false });

window.addEventListener('mousemove', drag);
window.addEventListener('touchmove', (e) => {
    clearTimeout(touchTimer); // 移动则取消长按
    drag(e);
}, { passive: false });

window.addEventListener('mouseup', endInteraction);
window.addEventListener('touchend', () => { clearTimeout(touchTimer); endInteraction(); });

function startInteraction(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;
    isDragging = true;
    closeBottomSheet(); // 点击地图收起抽屉
    hideContextMenu();
    dragStartMouseX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    dragStartMouseY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    dragStartX = currentX; dragStartZ = currentZ;
}

function drag(e) {
    if (!isDragging) return;
    if (e.type === 'mousemove') e.preventDefault();
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    const deltaX = clientX - dragStartMouseX;
    const deltaY = clientY - dragStartMouseY;
    
    const scale = Math.pow(2, zoomLevel);
    currentX = dragStartX - (deltaX / scale);
    currentZ = dragStartZ - (deltaY / scale);
    requestAnimationFrame(updateMap);
}

function endInteraction() { isDragging = false; }

// ================= 4. UI 组件逻辑 =================
// 底部抽屉 (Bottom Sheet)
function openBottomSheet(poi) {
    const sheetContent = document.getElementById('sheet-content');
    
    // 生成图片画廊
    const galleryHtml = poi.images ? poi.images.map(img => `<img src="${img}" alt="poi">`).join('') : '';

    sheetContent.innerHTML = `
        <h2 class="sheet-title">${poi.name}</h2>
        <div class="sheet-subtitle">${poi.rating || ''} ⭐️ (${poi.reviews || 0}) · ${poi.type} <br> ${poi.status || ''}</div>
        <div class="action-buttons">
            <button class="m3-action-btn primary"><span class="material-symbols-rounded">directions</span> 路线</button>
            <button class="m3-action-btn"><span class="material-symbols-rounded">call</span> 致电</button>
            ${poi.url ? `<button class="m3-action-btn" onclick="window.open('${poi.url}')"><span class="material-symbols-rounded">language</span> 网站</button>` : ''}
            <button class="m3-action-btn"><span class="material-symbols-rounded">bookmark</span> 保存</button>
        </div>
        <p style="color: #3c4043; line-height: 1.5;">${poi.desc || ''}</p>
        <div class="poi-gallery">${galleryHtml}</div>
    `;
    bottomSheet.classList.add('active');
}
function closeBottomSheet() { bottomSheet.classList.remove('active'); }

// 长按上下文菜单
let contextWorldX, contextWorldZ;
function showContextMenu(screenX, screenY) {
    isDragging = false; // 中断拖拽
    // 反向计算点击的地图坐标
    const width = container.offsetWidth; const height = container.offsetHeight;
    const scale = Math.pow(2, zoomLevel);
    contextWorldX = Math.round(currentX + (screenX - width/2) / scale);
    contextWorldZ = Math.round(currentZ + (screenY - height/2) / scale);

    document.getElementById('ctx-coords-text').innerText = `${contextWorldX}, ${contextWorldZ}`;
    contextMenu.style.left = `${screenX}px`; contextMenu.style.top = `${screenY}px`;
    contextMenu.style.display = 'block';
    
    // 手机端震动反馈
    if (navigator.vibrate) navigator.vibrate(50);
}
function hideContextMenu() { contextMenu.style.display = 'none'; }

// 复制坐标
document.getElementById('ctx-copy-coords').onclick = () => {
    navigator.clipboard.writeText(`${contextWorldX}, ${contextWorldZ}`);
    alert("坐标已复制!"); hideContextMenu();
};

// 设置菜单
document.getElementById('btn-settings').onclick = () => document.getElementById('settings-dialog').classList.remove('hidden');
document.getElementById('btn-close-settings').onclick = () => {
    settings.showCrosshair = document.getElementById('setting-crosshair').checked;
    settings.rememberPosition = document.getElementById('setting-remember').checked;
    applySettingsToUI(); saveSettings();
    document.getElementById('settings-dialog').classList.add('hidden');
};

function applySettingsToUI() {
    document.getElementById('setting-crosshair').checked = settings.showCrosshair;
    document.getElementById('setting-remember').checked = settings.rememberPosition;
    document.getElementById('crosshair').classList.toggle('hidden', !settings.showCrosshair);
}

// 缩放按钮
document.getElementById('btn-zoom-in').onclick = () => { zoomLevel = Math.min(0, zoomLevel + 1); updateMap(); };
document.getElementById('btn-zoom-out').onclick = () => { zoomLevel = Math.max(-6, zoomLevel - 1); updateMap(); };

// 滚轮缩放
container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0) zoomLevel = Math.max(-6, zoomLevel - 1);
    else if (e.deltaY < 0) zoomLevel = Math.min(0, zoomLevel + 1);
    updateMap();
}, { passive: false });

// 启动
init();
