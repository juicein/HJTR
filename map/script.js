
// ================= 全局配置与状态 =================
let mapConfig = {
    minZoom: -6,
    maxZoom: 0,
    defaultZoom: -1,
    imageFormat: "webp" // 默认值，如果找不到 js 文件就用这个
};

let zoomLevel = mapConfig.defaultZoom;
let isDragging = false;
let isZooming = false; // 用于移动端双指缩放
let dragStartMouseX, dragStartMouseY;
let dragStartX, dragStartZ;
let initialPinchDistance = 0;
let initialZoomLevel = 0;

// ================= DOM 元素 =================
const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const xInput = document.getElementById('coordinates-x');
const zInput = document.getElementById('coordinates-z');

// ================= 1. 读取 map_properties.js =================
function initMapProperties() {
    const script = document.createElement('script');
    script.src = 'map_properties.js';
    
    // 如果文件加载成功
    script.onload = () => {
        if (typeof UnminedMapProperties !== 'undefined') {
            mapConfig.minZoom = UnminedMapProperties.minZoom;
            mapConfig.maxZoom = UnminedMapProperties.maxZoom;
            mapConfig.defaultZoom = UnminedMapProperties.defaultZoom;
            mapConfig.imageFormat = UnminedMapProperties.imageFormat || "webp";
            zoomLevel = mapConfig.defaultZoom; // 更新当前缩放层级
            console.log("成功加载地图配置:", mapConfig);
        }
        updateMap();
    };
    
    // 如果文件丢失或加载失败（Fallback 容错）
    script.onerror = () => {
        console.warn("未找到 map_properties.js，将使用默认配置运行地图。");
        updateMap();
    };
    
    document.head.appendChild(script);
}

// ================= 2. 核心地图渲染 =================
function updateMap() {
    const cx = parseFloat(xInput.value) || 0; 
    const cz = parseFloat(zInput.value) || 0; 
    
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    
    const scale = Math.pow(2, zoomLevel);
    const centerWorldPx = cx * scale;
    const centerWorldPz = cz * scale;
    
    const centerTileX = Math.floor(centerWorldPx / 256);
    const centerTileZ = Math.floor(centerWorldPz / 256);
    
    const rangeX = Math.ceil(width / 2 / 256) + 1;
    const rangeZ = Math.ceil(height / 2 / 256) + 1;
    
    const neededTiles = new Set();
    
    for (let tx = centerTileX - rangeX; tx <= centerTileX + rangeX; tx++) {
        for (let tz = centerTileZ - rangeZ; tz <= centerTileZ + rangeZ; tz++) {
            const tileKey = `${zoomLevel}_${tx}_${tz}`;
            neededTiles.add(tileKey);
            
            const tileWorldPx = tx * 256;
            const tileWorldPz = tz * 256;
            
            const screenX = (width / 2) + (tileWorldPx - centerWorldPx);
            const screenY = (height / 2) + (tileWorldPz - centerWorldPz);
            
            renderTile(tileKey, tx, tz, screenX, screenY);
        }
    }
    
    Array.from(tileContainer.children).forEach(img => {
        if (!neededTiles.has(img.dataset.key)) {
            img.remove();
        }
    });
}

function renderTile(key, tx, tz, screenX, screenY) {
    let img = tileContainer.querySelector(`img[data-key="${key}"]`);
    
    if (!img) {
        img = document.createElement('img');
        img.dataset.key = key;
        const dirX = Math.floor(tx / 10);
        const dirZ = Math.floor(tz / 10);
        
        // 动态使用配置中的扩展名 (webp 或 jpeg)
        img.src = `./tiles/zoom.${zoomLevel}/${dirX}/${dirZ}/tile.${tx}.${tz}.${mapConfig.imageFormat}`;
        img.onerror = () => { img.style.display = 'none'; };
        tileContainer.appendChild(img);
    }
    
    img.style.left = `${Math.round(screenX)}px`;
    img.style.top = `${Math.round(screenY)}px`;
}

// ================= 3. 缩放控制逻辑 (UI/滚轮/双指) =================
function setZoom(newZoom) {
    // 限制缩放范围在 mapConfig 内
    newZoom = Math.max(mapConfig.minZoom, Math.min(mapConfig.maxZoom, newZoom));
    if (newZoom === zoomLevel) return; // 没有变化则跳过
    
    zoomLevel = newZoom;
    tileContainer.innerHTML = ''; // 切换缩放级别时清空旧瓦片，防止残影
    updateMap();
}

// UI 按钮缩放
document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(zoomLevel + 1));
document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(zoomLevel - 1));

// 鼠标滚轮缩放
container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0) setZoom(zoomLevel - 1); // 向下滚缩小
    else if (e.deltaY < 0) setZoom(zoomLevel + 1); // 向上滚放大
}, { passive: false });

// 移动端双指测距函数
function getDistance(touch1, touch2) {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

// ================= 4. 拖拽与触控逻辑 =================
container.addEventListener('mousedown', startInteraction);
container.addEventListener('touchstart', startInteraction, { passive: false });
window.addEventListener('mousemove', drag);
window.addEventListener('touchmove', handleTouchMove, { passive: false });
window.addEventListener('mouseup', endInteraction);
window.addEventListener('touchend', endInteraction);
window.addEventListener('touchcancel', endInteraction);

function startInteraction(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;
    
    // 双指缩放初始化
    if (e.type === 'touchstart' && e.touches.length === 2) {
        isZooming = true;
        isDragging = false;
        initialPinchDistance = getDistance(e.touches[0], e.touches[1]);
        initialZoomLevel = zoomLevel;
        return;
    }
    
    // 单指/鼠标拖拽初始化
    if (e.type === 'mousedown' || (e.type === 'touchstart' && e.touches.length === 1)) {
        isDragging = true;
        isZooming = false;
        const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
        
        dragStartMouseX = clientX;
        dragStartMouseY = clientY;
        dragStartX = parseFloat(xInput.value) || 0;
        dragStartZ = parseFloat(zInput.value) || 0;
    }
}

function handleTouchMove(e) {
    e.preventDefault(); // 阻止手机浏览器原生滚动或缩放
    if (isZooming && e.touches.length === 2) {
        const currentDistance = getDistance(e.touches[0], e.touches[1]);
        const scaleRatio = currentDistance / initialPinchDistance;
        
        // 当双指拉伸/捏合到一定比例时，触发层级跳跃 (类似你原本的逻辑)
        if (scaleRatio > 1.5) {
            setZoom(initialZoomLevel + 1);
            initialPinchDistance = currentDistance; // 重置基准距离
            initialZoomLevel = zoomLevel;
        } else if (scaleRatio < 0.6) {
            setZoom(initialZoomLevel - 1);
            initialPinchDistance = currentDistance;
            initialZoomLevel = zoomLevel;
        }
    } else if (isDragging) {
        drag(e); // 复用拖拽逻辑
    }
}

function drag(e) {
    if (!isDragging || isZooming) return;
    if (e.type === 'mousemove') e.preventDefault();
    
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    
    const deltaX = clientX - dragStartMouseX;
    const deltaY = clientY - dragStartMouseY;
    
    const scale = Math.pow(2, zoomLevel);
    xInput.value = Math.round(dragStartX - (deltaX / scale));
    zInput.value = Math.round(dragStartZ - (deltaY / scale));
    
    requestAnimationFrame(updateMap);
}

function endInteraction() { 
    isDragging = false; 
    isZooming = false; 
}

// 监听输入框手动修改坐标
xInput.addEventListener('change', updateMap);
zInput.addEventListener('change', updateMap);

// ================= 初始化 =================
// 启动程序：优先加载配置文件，然后再渲染地图
initMapProperties();
