// ================= 全局状态与配置 =================
let mapData = { regions: [], pois: [], roads: [], subways: [] };
let zoomLevel = -1;
let currentX = 0, currentZ = 0; // 地图中心点
let mapOrigin = { x: 0, z: 0 };
let isDragging = false;
let dragStartX, dragStartZ, mouseStartX, mouseStartY;

// 用户设置项 (本地记忆)
let userSettings = {
    showCrosshair: false,
    showCoords: false,
    rememberPos: true
};

// ================= DOM 获取 =================
const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const pathCanvas = document.getElementById('path-canvas');
const ctx = pathCanvas.getContext('2d');
const coordDisplay = document.getElementById('coord-display');
const contextMenu = document.getElementById('context-menu');

// ================= 1. 初始化与设置系统 =================
async function init() {
    loadSettings();
    applySettingsToUI();
    
    // 异步拉取 JSON 数据
    try {
        const response = await fetch('map_data.json');
        const data = await response.json();
        mapData = data;
        mapOrigin = data.mapConfig.origin || { x: 0, z: 0 };
        
        // 恢复位置或回到原点
        if (userSettings.rememberPos && localStorage.getItem('lastPosX')) {
            currentX = parseFloat(localStorage.getItem('lastPosX'));
            currentZ = parseFloat(localStorage.getItem('lastPosZ'));
            zoomLevel = parseInt(localStorage.getItem('lastZoom')) || data.mapConfig.defaultZoom;
        } else {
            currentX = mapOrigin.x;
            currentZ = mapOrigin.z;
            zoomLevel = data.mapConfig.defaultZoom;
        }
    } catch (e) {
        console.error("无法加载 map_data.json", e);
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    updateMap();
}

function loadSettings() {
    const saved = localStorage.getItem('mcMapSettings');
    if (saved) userSettings = { ...userSettings, ...JSON.parse(saved) };
}

function saveSettings() {
    localStorage.setItem('mcMapSettings', JSON.stringify(userSettings));
    applySettingsToUI();
}

function applySettingsToUI() {
    document.getElementById('set-crosshair').checked = userSettings.showCrosshair;
    document.getElementById('set-coords').checked = userSettings.showCoords;
    document.getElementById('set-memory').checked = userSettings.rememberPos;
    
    document.getElementById('crosshair').style.display = userSettings.showCrosshair ? 'block' : 'none';
    coordDisplay.style.display = userSettings.showCoords ? 'block' : 'none';
}

function toggleSettings() {
    document.getElementById('settings-panel').classList.toggle('open');
}

// 监听设置修改
['crosshair', 'coords', 'memory'].forEach(key => {
    document.getElementById(`set-${key}`).addEventListener('change', (e) => {
        userSettings[`show${key.charAt(0).toUpperCase() + key.slice(1)}`] = e.target.checked;
        if(key === 'memory') userSettings.rememberPos = e.target.checked;
        saveSettings();
    });
});

// ================= 2. 核心渲染 (瓦片 + Canvas道路 + 标记) =================
function resizeCanvas() {
    pathCanvas.width = container.offsetWidth;
    pathCanvas.height = container.offsetHeight;
    updateMap();
}

function updateMap() {
    if (userSettings.rememberPos) {
        localStorage.setItem('lastPosX', currentX);
        localStorage.setItem('lastPosZ', currentZ);
        localStorage.setItem('lastZoom', zoomLevel);
    }

    if (userSettings.showCoords) {
        coordDisplay.innerText = `X: ${Math.round(currentX)}, Z: ${Math.round(currentZ)}`;
    }

    const width = container.offsetWidth;
    const height = container.offsetHeight;
    const scale = Math.pow(2, zoomLevel);
    
    const centerWorldPx = currentX * scale;
    const centerWorldPz = currentZ * scale;

    // --- 1. 渲染瓦片 (复用你成熟的逻辑) ---
    renderTiles(width, height, centerWorldPx, centerWorldPz);

    // --- 2. 渲染矢量道路 (Canvas 圆角优化) ---
    renderPaths(width, height, scale, centerWorldPx, centerWorldPz);

    // --- 3. 渲染 LOD 层级标记点 ---
    renderMarkers(width, height, scale, centerWorldPx, centerWorldPz);
}

function renderTiles(width, height, centerWorldPx, centerWorldPz) {
    const centerTileX = Math.floor(centerWorldPx / 256);
    const centerTileZ = Math.floor(centerWorldPz / 256);
    const rangeX = Math.ceil(width / 2 / 256) + 1;
    const rangeZ = Math.ceil(height / 2 / 256) + 1;
    
    const neededTiles = new Set();
    
    for (let tx = centerTileX - rangeX; tx <= centerTileX + rangeX; tx++) {
        for (let tz = centerTileZ - rangeZ; tz <= centerTileZ + rangeZ; tz++) {
            const tileKey = `${zoomLevel}_${tx}_${tz}`;
            neededTiles.add(tileKey);
            
            const screenX = (width / 2) + (tx * 256 - centerWorldPx);
            const screenY = (height / 2) + (tz * 256 - centerWorldPz);
            
            let img = tileContainer.querySelector(`img[data-key="${tileKey}"]`);
            if (!img) {
                img = document.createElement('img');
                img.dataset.key = tileKey;
                img.style.position = 'absolute';
                img.style.width = '256px'; img.style.height = '256px';
                
                // 根据你的目录结构
                const dirX = Math.floor(tx / 10);
                const dirZ = Math.floor(tz / 10);
                img.src = `./tiles/zoom.${zoomLevel}/${dirX}/${dirZ}/tile.${tx}.${tz}.webp`;
                img.onerror = () => { img.style.display = 'none'; };
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

// 核心：Canvas 渲染多段线道路
function renderPaths(width, height, scale, centerWorldPx, centerWorldPz) {
    ctx.clearRect(0, 0, width, height);
    
    // LOD 规则：缩放到 -4 以下时不显示普通道路，只显示高速
    const hideNormalRoads = zoomLevel < -3;

    // 配置圆角线条
    ctx.lineJoin = 'round'; // 关键：处理拐点的平滑圆角
    ctx.lineCap = 'round';

    // 绘制道路
    mapData.roads.forEach(road => {
        if (hideNormalRoads && road.type !== 'highway') return;

        ctx.beginPath();
        // 设置样式
        ctx.lineWidth = road.type === 'highway' ? 8 : (road.type === 'arterial' ? 6 : 4);
        ctx.strokeStyle = road.type === 'highway' ? '#fbbc04' : '#ffffff';
        
        road.path.forEach((pt, idx) => {
            const px = (width / 2) + (pt[0] * scale - centerWorldPx);
            const py = (height / 2) + (pt[1] * scale - centerWorldPz);
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.stroke();
    });

    // 绘制地铁
    mapData.subways.forEach(sub => {
        ctx.beginPath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ea4335'; // 地铁红
        ctx.setLineDash([10, 10]); // 虚线表示地铁

        sub.path.forEach((pt, idx) => {
            const px = (width / 2) + (pt[0] * scale - centerWorldPx);
            const py = (height / 2) + (pt[1] * scale - centerWorldPz);
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.setLineDash([]); // 恢复实线
    });
}

function renderMarkers(width, height, scale, centerWorldPx, centerWorldPz) {
    markerContainer.innerHTML = '';
    
    // 1. LOD 控制：根据层级筛选地名
    mapData.regions.forEach(reg => {
        if (zoomLevel < -5 && reg.level !== 'global') return;
        if (zoomLevel >= -2 && reg.level === 'global') return; // 放大后隐藏全局字
        createMarkerDom(reg, reg.name, '📍', width, height, scale, centerWorldPx, centerWorldPz);
    });

    // 2. 细节层级渲染 POI 和 地铁站
    if (zoomLevel >= -3) {
        mapData.pois.forEach(poi => {
            let icon = '🏢';
            if(poi.type === 'hotel') icon = '🏨';
            if(poi.type === 'bank') icon = '🏦';
            createMarkerDom(poi, poi.name, icon, width, height, scale, centerWorldPx, centerWorldPz);
        });
        
        mapData.subways.forEach(sub => {
            if(!sub.stations) return;
            sub.stations.forEach(st => {
                createMarkerDom(st, st.name, '🚇', width, height, scale, centerWorldPx, centerWorldPz);
            });
        });
    }
}

function createMarkerDom(data, text, iconStr, width, height, scale, centerPx, centerPz) {
    const px = (width / 2) + (data.x * scale - centerPx);
    const py = (height / 2) + (data.z * scale - centerPz);
    
    // 视口剔除优化
    if (px < -100 || px > width + 100 || py < -100 || py > height + 100) return;

    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.left = `${px}px`;
    el.style.top = `${py}px`;
    el.style.transform = 'translate(-50%, -50%)';
    el.style.textAlign = 'center';
    el.style.pointerEvents = 'auto'; // 允许点击地标
    
    el.innerHTML = `
        <div style="font-size:24px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${iconStr}</div>
        <div style="background:rgba(255,255,255,0.9); padding:2px 6px; border-radius:12px; font-size:12px; font-weight:bold; color:#333; margin-top:4px; box-shadow:0 1px 3px rgba(0,0,0,0.2);">${text}</div>
    `;
    
    el.onclick = () => {
        alert(`${text}\n${data.desc || '没有详细描述'}\n坐标: ${data.x}, ${data.z}`);
    };
    markerContainer.appendChild(el);
}

// ================= 3. 拖拽、缩放与长按交互 =================
let pressTimer;

container.addEventListener('mousedown', startInteraction);
container.addEventListener('touchstart', startInteraction, { passive: false });
window.addEventListener('mousemove', drag);
window.addEventListener('touchmove', drag, { passive: false });
window.addEventListener('mouseup', endInteraction);
window.addEventListener('touchend', endInteraction);
container.addEventListener('contextmenu', e => e.preventDefault()); // 禁用自带右键

function startInteraction(e) {
    if (e.target.closest('.m3-context-menu') || e.target.closest('.m3-fab') || e.target.closest('.m3-search-bar')) return;
    
    isDragging = true;
    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    
    mouseStartX = clientX;
    mouseStartY = clientY;
    dragStartX = currentX;
    dragStartZ = currentZ;

    contextMenu.style.display = 'none'; // 隐藏菜单

    // 长按检测 (500ms)
    pressTimer = setTimeout(() => {
        isDragging = false; // 触发长按后停止拖拽
        showContextMenu(clientX, clientY);
    }, 500);
}

function drag(e) {
    if (!isDragging) return;
    e.preventDefault();
    
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    
    // 如果移动了，取消长按判定
    if (Math.abs(clientX - mouseStartX) > 5 || Math.abs(clientY - mouseStartY) > 5) {
        clearTimeout(pressTimer);
    }
    
    const scale = Math.pow(2, zoomLevel);
    currentX = dragStartX - ((clientX - mouseStartX) / scale);
    currentZ = dragStartZ - ((clientY - mouseStartY) / scale);
    
    requestAnimationFrame(updateMap);
}

function endInteraction() {
    isDragging = false;
    clearTimeout(pressTimer);
}

// 长按菜单逻辑
let targetMcCoords = { x: 0, z: 0 };
function showContextMenu(screenX, screenY) {
    // 逆向运算：将屏幕坐标转换回 Minecraft 世界坐标
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    const scale = Math.pow(2, zoomLevel);
    
    targetMcCoords.x = Math.round(currentX + (screenX - width / 2) / scale);
    targetMcCoords.z = Math.round(currentZ + (screenY - height / 2) / scale);

    document.getElementById('ctx-coord').innerText = `坐标: X: ${targetMcCoords.x}, Z: ${targetMcCoords.z}`;
    
    contextMenu.style.left = `${screenX}px`;
    contextMenu.style.top = `${screenY}px`;
    contextMenu.style.display = 'block';
}

// 菜单按钮事件绑定
document.getElementById('ctx-copy').onclick = () => {
    navigator.clipboard.writeText(`${targetMcCoords.x}, ${targetMcCoords.z}`);
    contextMenu.style.display = 'none';
    alert("坐标已复制到剪贴板！");
};

document.getElementById('ctx-route-from').onclick = () => { alert("已设为起点"); contextMenu.style.display = 'none'; };
document.getElementById('ctx-route-to').onclick = () => { alert("已设为终点"); contextMenu.style.display = 'none'; };

document.getElementById('ctx-add-marker').onclick = () => {
    // 携带坐标参数跳转新页面
    window.location.href = `add_marker.html?x=${targetMcCoords.x}&z=${targetMcCoords.z}`;
};

// UI 按钮绑定
document.getElementById('btn-zoom-in').onclick = () => { zoomLevel++; updateMap(); };
document.getElementById('btn-zoom-out').onclick = () => { zoomLevel--; updateMap(); };
document.getElementById('btn-origin').onclick = () => { currentX = mapOrigin.x; currentZ = mapOrigin.z; updateMap(); };

// 隐藏菜单
document.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu') && !isDragging) {
        contextMenu.style.display = 'none';
    }
});

init();
