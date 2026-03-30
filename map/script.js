// ================= 全局状态与配置 =================
let mapConfig = { minZoom: -6, maxZoom: 1, defaultZoom: -1, imageFormat: "webp" };
let zoomLevel = mapConfig.defaultZoom;
let currentX = 0, currentZ = 0; // 当前地图中心点坐标
let mapData = { places: [], networks: [] };

// DOM 元素
const container = document.getElementById('map-container');
const vectorLayer = document.getElementById('vector-layer');
const markerContainer = document.querySelector('.marker-container');
const bottomSheet = document.getElementById('bottom-sheet');
const contextMenu = document.getElementById('context-menu');

// 设置与持久化
const appSettings = JSON.parse(localStorage.getItem('haojinMapSettings')) || {
    crosshair: false, coords: false, memory: true, lastX: 0, lastZ: 0, lastZoom: -1
};

// ================= 1. 初始化与数据加载 =================
async function initApp() {
    // 恢复记忆位置
    if (appSettings.memory) {
        currentX = appSettings.lastX;
        currentZ = appSettings.lastZ;
        zoomLevel = appSettings.lastZoom;
    }

    applySettingsUI();

    try {
        const res = await fetch('map_data.json');
        mapData = await res.json();
        // 如果没有记忆，使用 JSON 中配置的原点
        if (!appSettings.memory && mapData.settings) {
            currentX = mapData.settings.originX;
            currentZ = mapData.settings.originZ;
        }
    } catch (e) {
        console.warn("未找到 map_data.json，等待后续添加。");
    }

    updateMap(); // 你的瓦片渲染逻辑（此处保留你之前的计算，见下方）
    renderOverlays(); // 渲染标记和道路
}

// ================= 2. 坐标系转换引擎 =================
// 将 Minecraft 游戏坐标转换为当前屏幕的绝对像素坐标
function worldToScreen(worldX, worldZ) {
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    const scale = Math.pow(2, zoomLevel);
    
    // 相对中心的像素偏移
    const dxPx = (worldX - currentX) * scale;
    const dzPx = (worldZ - currentZ) * scale;
    
    return {
        x: (width / 2) + dxPx,
        y: (height / 2) + dzPx
    };
}

// ================= 3. 矢量与标记渲染 =================
function renderOverlays() {
    // 1. 根据层级判断显示逻辑 (Global, Region, District, Community)
    const viewLevel = getLevelByZoom(zoomLevel);
    
    // 2. 渲染 SVG 道路网络
    vectorLayer.innerHTML = '';
    mapData.networks.forEach(net => {
        if (!isVisibleAtLevel(net.level, viewLevel)) return;
        
        const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        // 将坐标数组转换为 SVG 屏幕点阵
        const points = net.path.map(coord => {
            const pt = worldToScreen(coord[0], coord[1]);
            return `${pt.x},${pt.y}`;
        }).join(" ");
        
        path.setAttribute("points", points);
        path.setAttribute("class", "route-path");
        
        // 样式区分：地铁还是道路
        if (net.type === 'transit') {
            path.setAttribute("stroke", net.color || "#006495");
            path.setAttribute("stroke-width", Math.max(2, 6 + zoomLevel));
            path.setAttribute("stroke-dasharray", "8, 4"); // 轨道虚线效果
        } else {
            const widthMap = { highway: 10, express: 8, main: 5, normal: 3 };
            path.setAttribute("stroke", "#FFC107"); // 道路默认颜色
            path.setAttribute("stroke-width", Math.max(1, (widthMap[net.roadType] || 3) + zoomLevel * 2));
        }
        vectorLayer.appendChild(path);
    });

    // 3. 渲染 POI 标记
    markerContainer.innerHTML = '';
    mapData.places.forEach(place => {
        if (!isVisibleAtLevel(place.level, viewLevel)) return;

        const pos = worldToScreen(place.x, place.z);
        
        const marker = document.createElement('div');
        marker.className = 'map-marker';
        marker.style.left = `${pos.x}px`;
        marker.style.top = `${pos.y}px`;

        // 决定使用什么图标 (Material Icon 映射)
        const iconMap = {
            supermarket: 'shopping_cart', bank: 'account_balance',
            hotel: 'hotel', restaurant: 'restaurant', school: 'school'
        };
        const iconName = iconMap[place.category] || 'location_on';

        marker.innerHTML = `
            <div class="marker-pin"><span class="material-symbols-rounded">${iconName}</span></div>
            <div class="marker-label">${place.name}</div>
        `;

        // 点击事件：呼出底部菜单
        marker.addEventListener('click', (e) => {
            e.stopPropagation();
            showBottomSheet(place);
        });

        markerContainer.appendChild(marker);
    });
}

// 简单的层级判定逻辑
function getLevelByZoom(z) {
    if (z <= -4) return ['global'];
    if (z <= -2) return ['global', 'region'];
    if (z <= 0) return ['global', 'region', 'district'];
    return ['global', 'region', 'district', 'community'];
}
function isVisibleAtLevel(targetLevel, currentLevels) {
    return currentLevels.includes(targetLevel);
}

// ================= 4. 底部面板与长按菜单 =================
function showBottomSheet(place) {
    document.getElementById('sheet-title').innerText = place.name;
    document.getElementById('sheet-category').innerText = place.category || '默认标点';
    document.getElementById('sheet-remark').innerText = place.remark || '';
    
    const scroller = document.getElementById('sheet-images');
    scroller.innerHTML = '';
    if (place.images && place.images.length > 0) {
        place.images.forEach(imgUrl => {
            const img = document.createElement('img');
            img.src = imgUrl;
            scroller.appendChild(img);
        });
    }

    bottomSheet.classList.add('active');
}

// 点击地图空白处隐藏面板
container.addEventListener('click', () => {
    bottomSheet.classList.remove('active');
    contextMenu.classList.remove('active');
});

// 长按逻辑 (Touch & Right Click)
let pressTimer;
let contextX, contextZ;

container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        const touch = e.touches[0];
        startLongPress(touch.clientX, touch.clientY);
    }
});
container.addEventListener('touchend', () => clearTimeout(pressTimer));
container.addEventListener('touchmove', () => clearTimeout(pressTimer));

container.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // 阻止默认右键菜单
    triggerContextMenu(e.clientX, e.clientY);
});

function startLongPress(clientX, clientY) {
    pressTimer = setTimeout(() => triggerContextMenu(clientX, clientY), 600); // 600ms 长按
}

function triggerContextMenu(clientX, clientY) {
    // 将屏幕坐标反算回世界坐标
    const rect = container.getBoundingClientRect();
    const mapPx = clientX - rect.left - (rect.width / 2);
    const mapPy = clientY - rect.top - (rect.height / 2);
    
    const scale = Math.pow(2, zoomLevel);
    contextX = Math.round(currentX + (mapPx / scale));
    contextZ = Math.round(currentZ + (mapPy / scale));

    document.getElementById('menu-coord-text').innerText = `${contextX}, ${contextZ}`;
    
    contextMenu.style.left = `${clientX}px`;
    contextMenu.style.top = `${clientY}px`;
    contextMenu.classList.add('active');
}

// ================= 5. 设置与系统操作 =================
document.getElementById('menu-copy-coord').addEventListener('click', () => {
    navigator.clipboard.writeText(`${contextX}, ${contextZ}`);
    contextMenu.classList.remove('active');
    // 可以添加一个 Toast 提示
});

document.getElementById('menu-add-marker').addEventListener('click', () => {
    // 携带坐标跳转到你配置的后端系统或表单页面
    window.open(`add_marker.html?x=${contextX}&z=${contextZ}`, '_blank');
});

function saveSettings() {
    localStorage.setItem('haojinMapSettings', JSON.stringify({
        ...appSettings,
        lastX: currentX, lastZ: currentZ, lastZoom: zoomLevel
    }));
}

// 你现有的 drag 逻辑中，更新 currentX 和 currentZ 后：
// requestAnimationFrame(() => { updateMap(); renderOverlays(); saveSettings(); });

initApp();
