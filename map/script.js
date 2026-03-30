// ================= 状态与配置 =================
let mapConfig = { minZoom: -6, maxZoom: 0, defaultZoom: -1, imageFormat: "webp" };
let appState = {
    x: 0, z: 0, zoom: -1,
    data: { areas: [], pois: [], roads: [], subways: [] },
    settings: { crosshair: true, coords: true, remember: true }
};

// ================= DOM 元素 =================
const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.getElementById('marker-container');
const canvas = document.getElementById('overlay-canvas');
const ctx = canvas.getContext('2d');
const displayX = document.getElementById('display-x');
const displayZ = document.getElementById('display-z');
const detailPanel = document.getElementById('detail-panel');
const contextMenu = document.getElementById('context-menu');
const settingsDialog = document.getElementById('settings-dialog');

// ================= 1. 初始化 =================
async function initMap() {
    // 读取本地设置
    loadSettings();
    
    // 尝试加载第三方瓦片配置 (Unmined)
    try {
        const script = document.createElement('script');
        script.src = 'map_properties.js';
        script.onload = () => {
            if (typeof UnminedMapProperties !== 'undefined') {
                mapConfig = { ...mapConfig, ...UnminedMapProperties };
                appState.zoom = mapConfig.defaultZoom;
            }
        };
        document.head.appendChild(script);
    } catch (e) { console.warn("No map_properties.js found."); }

    // 加载数据结构 json
    try {
        const response = await fetch('data.json');
        const data = await response.json();
        appState.data = data;
        
        // 应用默认原点或读取上次位置
        if (!appState.settings.remember || !localStorage.getItem('lastX')) {
            appState.x = data.settings?.defaultOrigin?.x || 0;
            appState.z = data.settings?.defaultOrigin?.z || 0;
        }
    } catch (e) { console.error("Failed to load data.json", e); }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    updateMap();
}

function loadSettings() {
    const saved = JSON.parse(localStorage.getItem('mapSettings') || '{}');
    appState.settings = { ...appState.settings, ...saved };
    
    document.getElementById('setting-crosshair').checked = appState.settings.crosshair;
    document.getElementById('setting-coords').checked = appState.settings.coords;
    document.getElementById('setting-remember').checked = appState.settings.remember;
    
    applySettings();

    if (appState.settings.remember) {
        appState.x = parseFloat(localStorage.getItem('lastX')) || 0;
        appState.z = parseFloat(localStorage.getItem('lastZ')) || 0;
        appState.zoom = parseFloat(localStorage.getItem('lastZoom')) || appState.zoom;
    }
}

function applySettings() {
    document.getElementById('crosshair').style.display = appState.settings.crosshair ? 'block' : 'none';
    document.getElementById('coord-display').style.display = appState.settings.coords ? 'block' : 'none';
    localStorage.setItem('mapSettings', JSON.stringify(appState.settings));
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    renderOverlay();
}

// ================= 2. 核心渲染 (瓦片, Canvas, DOM 标点) =================
function updateMap() {
    if (appState.settings.remember) {
        localStorage.setItem('lastX', appState.x);
        localStorage.setItem('lastZ', appState.z);
        localStorage.setItem('lastZoom', appState.zoom);
    }

    displayX.innerText = Math.round(appState.x);
    displayZ.innerText = Math.round(appState.z);

    renderTiles();
    renderOverlay();
    renderMarkers();
}

function worldToScreen(wx, wz) {
    const scale = Math.pow(2, appState.zoom);
    const sx = (canvas.width / 2) + (wx - appState.x) * scale;
    const sy = (canvas.height / 2) + (wz - appState.z) * scale;
    return { x: sx, y: sy };
}

function screenToWorld(sx, sy) {
    const scale = Math.pow(2, appState.zoom);
    const wx = appState.x + (sx - canvas.width / 2) / scale;
    const wz = appState.z + (sy - canvas.height / 2) / scale;
    return { x: wx, z: wz };
}

function renderTiles() {
    const scale = Math.pow(2, appState.zoom);
    const centerWorldPx = appState.x * scale;
    const centerWorldPz = appState.z * scale;
    const centerTileX = Math.floor(centerWorldPx / 256);
    const centerTileZ = Math.floor(centerWorldPz / 256);
    
    const rangeX = Math.ceil(canvas.width / 2 / 256) + 1;
    const rangeZ = Math.ceil(canvas.height / 2 / 256) + 1;
    
    const neededTiles = new Set();
    for (let tx = centerTileX - rangeX; tx <= centerTileX + rangeX; tx++) {
        for (let tz = centerTileZ - rangeZ; tz <= centerTileZ + rangeZ; tz++) {
            const key = `${appState.zoom}_${tx}_${tz}`;
            neededTiles.add(key);
            let img = tileContainer.querySelector(`img[data-key="${key}"]`);
            
            const screenX = (canvas.width / 2) + (tx * 256 - centerWorldPx);
            const screenY = (canvas.height / 2) + (tz * 256 - centerWorldPz);

            if (!img) {
                img = document.createElement('img');
                img.dataset.key = key;
                img.src = `./tiles/zoom.${appState.zoom}/${Math.floor(tx/10)}/${Math.floor(tz/10)}/tile.${tx}.${tz}.${mapConfig.imageFormat}`;
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

// 绘制 Canvas 层：道路 (透明度、圆角贝塞尔曲线) 和 地铁
function renderOverlay() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 如果缩小得太厉害，不显示道路
    if (appState.zoom < -3) return;

    // 绘制道路
    appState.data.roads.forEach(road => {
        if (!road.points || road.points.length < 2) return;
        ctx.beginPath();
        
        // 样式设置
        ctx.strokeStyle = road.type === 'expressway' ? 'rgba(255, 152, 0, 0.6)' : 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = road.type === 'expressway' ? 8 : 4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // 贝塞尔曲线平滑处理 (Quadratic Curve to midpoints)
        let pts = road.points.map(p => worldToScreen(p[0], p[1]));
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
            let xc = (pts[i].x + pts[i + 1].x) / 2;
            let yc = (pts[i].y + pts[i + 1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
    });

    // 绘制地铁
    appState.data.subways.forEach(sub => {
        if (!sub.points) return;
        ctx.beginPath();
        ctx.strokeStyle = sub.color || '#ff0000';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        
        sub.points.forEach((p, index) => {
            const pos = worldToScreen(p[0], p[1]);
            if (index === 0) ctx.moveTo(pos.x, pos.y);
            else ctx.lineTo(pos.x, pos.y);
        });
        ctx.stroke();
    });
}

// 渲染 DOM 标点 (地区、POI层级显示)
function renderMarkers() {
    markerContainer.innerHTML = ''; // 清空重建，优化点可改为更新已有节点
    
    // 渲染地区名 (在较小的 Zoom 显示)
    appState.data.areas.forEach(area => {
        if (appState.zoom >= area.minZoom && appState.zoom <= (area.maxZoom || 0)) {
            const pos = worldToScreen(area.x, area.z);
            const el = document.createElement('div');
            el.className = 'area-label';
            el.innerText = area.name;
            el.style.left = `${pos.x}px`;
            el.style.top = `${pos.y}px`;
            markerContainer.appendChild(el);
        }
    });

    // 渲染 POI (在较大的 Zoom 显示)
    appState.data.pois.forEach(poi => {
        if (appState.zoom >= (poi.minZoom || -3)) {
            const pos = worldToScreen(poi.x, poi.z);
            const el = document.createElement('div');
            el.className = 'poi-marker';
            el.style.left = `${pos.x}px`;
            el.style.top = `${pos.y}px`;
            
            // 匹配 Material Icon
            let iconName = 'location_on';
            if(poi.type === 'supermarket') iconName = 'shopping_cart';
            else if(poi.type === 'restaurant') iconName = 'restaurant';
            else if(poi.type === 'bank') iconName = 'account_balance';
            
            el.innerHTML = `
                <div class="poi-pin" style="background: ${getMarkerColor(poi.type)}">
                    <span class="material-symbols-rounded">${iconName}</span>
                </div>
                <div class="poi-label">${poi.name}</div>
            `;
            
            // 点击打开详情面板
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                openDetailPanel(poi);
            });
            
            markerContainer.appendChild(el);
        }
    });
}

function getMarkerColor(type) {
    const colors = { supermarket: '#4CAF50', restaurant: '#FF9800', bank: '#2196F3' };
    return colors[type] || '#EA4335';
}

// ================= 3. 详情面板逻辑 (仿图1) =================
function openDetailPanel(poi) {
    let imagesHtml = '';
    if (poi.images && poi.images.length > 0) {
        imagesHtml = `<div class="poi-images">` + poi.images.map(url => `<img src="${url}" alt="Img">`).join('') + `</div>`;
    }

    const content = `
        ${imagesHtml}
        <div class="poi-header">
            <div class="poi-title">${poi.name}</div>
            <div class="poi-rating">${poi.rating} 
                <span class="material-symbols-rounded" style="font-size: 16px;">star</span> 
                <span style="color:var(--md-sys-color-on-surface-variant)">(${poi.reviews})</span>
            </div>
            <p style="color: ${poi.status?.includes('结束')?'#d93025':'#188038'}; margin-top: 4px; font-size: 14px;">
                ${poi.status || ''}
            </p>
        </div>
        <div class="poi-actions">
            <button class="action-btn" onclick="startNavigation(${poi.x}, ${poi.z})">
                <span class="material-symbols-rounded">directions</span>路线
            </button>
            <button class="action-btn">
                <span class="material-symbols-rounded">call</span>致电
            </button>
            <button class="action-btn">
                <span class="material-symbols-rounded">bookmark</span>保存
            </button>
            <button class="action-btn" onclick="window.open('${poi.website}', '_blank')">
                <span class="material-symbols-rounded">language</span>网站
            </button>
        </div>
        <div style="padding: 16px;">
            <p>${poi.desc || '暂无详细描述'}</p>
        </div>
    `;
    
    detailPanel.querySelector('.panel-content').innerHTML = content;
    detailPanel.classList.add('active');
}

function closePanels() {
    detailPanel.classList.remove('active');
    contextMenu.style.display = 'none';
}
container.addEventListener('click', closePanels); // 点击空白处关闭面板

// 假导航函数提示
function startNavigation(x, z) {
    alert(`准备规划路线至 X:${x}, Z:${z}。此功能需后端寻路算法支持。`);
}

// ================= 4. 长按菜单与交互逻辑 =================
let longPressTimer;
let isDragging = false;
let startX, startY;
let mapStartX, mapStartZ;

// 长按处理
container.addEventListener('touchstart', handleStart);
container.addEventListener('mousedown', handleStart);
window.addEventListener('touchmove', handleMove, { passive: false });
window.addEventListener('mousemove', handleMove);
window.addEventListener('touchend', handleEnd);
window.addEventListener('mouseup', handleEnd);
container.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY); }); // 电脑右键

function handleStart(e) {
    if (e.target.closest('.marker-container')) return; // 点在标点上忽略
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    isDragging = true;
    startX = clientX; startY = clientY;
    mapStartX = appState.x; mapStartZ = appState.z;
    
    // 触发长按
    longPressTimer = setTimeout(() => {
        isDragging = false;
        showContextMenu(clientX, clientY);
    }, 600); // 600ms 长按
}

function handleMove(e) {
    if (!isDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    // 如果移动超过容差，取消长按
    if (Math.abs(clientX - startX) > 10 || Math.abs(clientY - startY) > 10) {
        clearTimeout(longPressTimer);
        
        // 执行平移地图
        e.preventDefault();
        const scale = Math.pow(2, appState.zoom);
        appState.x = mapStartX - (clientX - startX) / scale;
        appState.z = mapStartZ - (clientY - startY) / scale;
        requestAnimationFrame(updateMap);
    }
}

function handleEnd() {
    clearTimeout(longPressTimer);
    isDragging = false;
}

// 显示长按菜单
let contextCoords = {x:0, z:0};
function showContextMenu(clientX, clientY) {
    const worldPos = screenToWorld(clientX, clientY);
    contextCoords.x = Math.round(worldPos.x);
    contextCoords.z = Math.round(worldPos.z);
    
    document.getElementById('ctx-x').innerText = contextCoords.x;
    document.getElementById('ctx-z').innerText = contextCoords.z;
    
    contextMenu.style.left = `${clientX}px`;
    contextMenu.style.top = `${clientY}px`;
    contextMenu.style.display = 'flex';
}

// 菜单按钮绑定
document.getElementById('ctx-copy').onclick = () => {
    navigator.clipboard.writeText(`${contextCoords.x}, ${contextCoords.z}`);
    closePanels();
};
document.getElementById('ctx-route-to').onclick = () => { startNavigation(contextCoords.x, contextCoords.z); closePanels(); };
document.getElementById('ctx-add-poi').onclick = () => {
    window.open(`add_poi.html?x=${contextCoords.x}&z=${contextCoords.z}`, '_blank');
    closePanels();
};

// ================= 5. 缩放逻辑与设置 =================
function setZoom(newZoom) {
    newZoom = Math.max(mapConfig.minZoom, Math.min(mapConfig.maxZoom, newZoom));
    if (newZoom === appState.zoom) return;
    appState.zoom = newZoom;
    updateMap();
}

document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(appState.zoom + 1));
document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(appState.zoom - 1));
container.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(appState.zoom + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });

// 设置面板逻辑
document.getElementById('btn-settings').onclick = () => settingsDialog.classList.add('active');
document.getElementById('btn-close-settings').onclick = () => settingsDialog.classList.remove('active');
['setting-crosshair', 'setting-coords', 'setting-remember'].forEach(id => {
    document.getElementById(id).onchange = (e) => {
        appState.settings[id.replace('setting-', '')] = e.target.checked;
        applySettings();
    };
});

// 启动
initMap();
