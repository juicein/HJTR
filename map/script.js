
// ================= 全局状态 =================
let zoomLevel = -1; // 当前缩放 (0为原比例，-1为1/2，-2为1/4)
let isDragging = false;
let dragStartMouseX, dragStartMouseY;
let dragStartX, dragStartZ;
let cachedMarkers = [];

// ================= DOM 元素 =================
const container = document.getElementById('map-container');
const tileContainer = document.querySelector('.tile-container');
const markerContainer = document.querySelector('.marker-container');
const xInput = document.getElementById('coordinates-x');
const zInput = document.getElementById('coordinates-z');

// ================= 核心：地图渲染引擎 =================
// 改进的计算方法：直接映射世界像素到屏幕像素
function updateMap() {
    const cx = parseFloat(xInput.value) || 0; // 当前中心X (方块坐标)
    const cz = parseFloat(zInput.value) || 0; // 当前中心Z (方块坐标)
    
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    
    // 1. 计算缩放比例 (例如: zoom -1 = 0.5，代表 1个方块占 0.5 像素)
    const scale = Math.pow(2, zoomLevel);
    
    // 2. 屏幕中心在世界中的像素坐标
    const centerWorldPx = cx * scale;
    const centerWorldPz = cz * scale;
    
    // 3. 当前屏幕中心所在的瓦片索引 (每张瓦片固定 256x256 像素)
    const centerTileX = Math.floor(centerWorldPx / 256);
    const centerTileZ = Math.floor(centerWorldPz / 256);
    
    // 4. 计算需要渲染的瓦片网格范围 (根据屏幕大小动态计算，避免大屏留白)
    const rangeX = Math.ceil(width / 2 / 256) + 1;
    const rangeZ = Math.ceil(height / 2 / 256) + 1;
    
    const neededTiles = new Set();
    
    // 5. 遍历视野内的所有瓦片
    for (let tx = centerTileX - rangeX; tx <= centerTileX + rangeX; tx++) {
        for (let tz = centerTileZ - rangeZ; tz <= centerTileZ + rangeZ; tz++) {
            const tileKey = `${zoomLevel}_${tx}_${tz}`;
            neededTiles.add(tileKey);
            
            // 计算瓦片在屏幕上的绝对物理坐标
            const tileWorldPx = tx * 256;
            const tileWorldPz = tz * 256;
            
            // 屏幕左上角起点 = 屏幕中心 + (瓦片世界像素 - 中心世界像素)
            const screenX = (width / 2) + (tileWorldPx - centerWorldPx);
            const screenY = (height / 2) + (tileWorldPz - centerWorldPz);
            
            renderTile(tileKey, tx, tz, screenX, screenY);
        }
    }
    
    // 6. 清理视野外的瓦片
    Array.from(tileContainer.children).forEach(img => {
        if (!neededTiles.has(img.dataset.key)) {
            img.remove();
        }
    });

    // 7. 同步更新标记点位置
    renderMarkers(cx, cz, scale, width, height, centerWorldPx, centerWorldPz);
}

// 渲染单张瓦片
function renderTile(key, tx, tz, screenX, screenY) {
    let img = tileContainer.querySelector(`img[data-key="${key}"]`);
    
    if (!img) {
        img = document.createElement('img');
        img.dataset.key = key;
        
        // 匹配你的本地文件结构: zoom.-1 / -1 / -1 / tile.-1.-1.webp
        const dirX = Math.floor(tx / 10);
        const dirZ = Math.floor(tz / 10);
        // 注意：相对路径，确保你的 html 刚好在 tiles 文件夹的上一层
        img.src = `./tiles/zoom.${zoomLevel}/${dirX}/${dirZ}/tile.${tx}.${tz}.webp`;
        
        // 如果瓦片不存在，隐藏防报错
        img.onerror = () => { img.style.display = 'none'; };
        tileContainer.appendChild(img);
    }
    
    // 统一设置位置 (四舍五入避免模糊)
    img.style.left = `${Math.round(screenX)}px`;
    img.style.top = `${Math.round(screenY)}px`;
}

// ================= 交互：拖拽逻辑 =================
container.addEventListener('mousedown', startDrag);
container.addEventListener('touchstart', startDrag, { passive: false });
window.addEventListener('mousemove', drag);
window.addEventListener('touchmove', drag, { passive: false });
window.addEventListener('mouseup', endDrag);
window.addEventListener('touchend', endDrag);

function startDrag(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;
    isDragging = true;
    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    
    dragStartMouseX = clientX;
    dragStartMouseY = clientY;
    dragStartX = parseFloat(xInput.value) || 0;
    dragStartZ = parseFloat(zInput.value) || 0;
}

function drag(e) {
    if (!isDragging) return;
    e.preventDefault(); // 阻止手机滚动
    
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    
    const deltaX = clientX - dragStartMouseX;
    const deltaY = clientY - dragStartMouseY;
    
    // 将鼠标的像素位移，反向换算为方块坐标的位移
    const scale = Math.pow(2, zoomLevel);
    xInput.value = Math.round(dragStartX - (deltaX / scale));
    zInput.value = Math.round(dragStartZ - (deltaY / scale));
    
    // 使用 requestAnimationFrame 保证拖拽极其丝滑，替代你之前的 setTimeout 防抖
    requestAnimationFrame(updateMap);
}

function endDrag() { isDragging = false; }

// ================= 交互：滚轮缩放 =================
container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0 && zoomLevel > -6) {
        zoomLevel--; // 缩小
    } else if (e.deltaY < 0 && zoomLevel < 0) {
        zoomLevel++; // 放大
    }
    // 缩放后强制刷新所有瓦片
    tileContainer.innerHTML = '';
    updateMap();
}, { passive: false });

// 监听输入框手动修改坐标
xInput.addEventListener('change', updateMap);
zInput.addEventListener('change', updateMap);

// ================= 标记点 (Markers) =================
// 模拟获取数据
async function loadMarkers() {
    // 这里保留你原来 fetchMarkersData 的逻辑，这里我提供一个测试数据供你立刻能跑起来
    cachedMarkers = [
        { x: 0, z: 0, text: "世界中心", image: "https://cdn-icons-png.flaticon.com/512/2933/2933921.png" },
        { x: 500, z: 500, text: "遥远的村庄", image: "https://cdn-icons-png.flaticon.com/512/3448/3448338.png" }
    ];
    updateMap();
}

// 在屏幕上渲染标记点
function renderMarkers(cx, cz, scale, width, height, centerWorldPx, centerWorldPz) {
    markerContainer.innerHTML = ''; // 简单起见，每次重绘（如果标记点成千上万，需要复用DOM）
    
    cachedMarkers.forEach(marker => {
        // 标记点在世界中的像素位置
        const markerWorldPx = marker.x * scale;
        const markerWorldPz = marker.z * scale;
        
        // 计算标记点在屏幕上的相对位置
        const screenX = (width / 2) + (markerWorldPx - centerWorldPx);
        const screenY = (height / 2) + (markerWorldPz - centerWorldPz);
        
        // 简单的剔除逻辑：只渲染屏幕内的标记
        if (screenX > -50 && screenX < width + 50 && screenY > -50 && screenY < height + 50) {
            const el = document.createElement('div');
            el.className = 'map-marker';
            el.style.left = `${screenX}px`;
            el.style.top = `${screenY}px`;
            
            el.innerHTML = `
                <img src="${marker.image}" alt="icon">
                <div class="marker-text">${marker.text}</div>
            `;
            markerContainer.appendChild(el);
        }
    });
}

// ================= 初始化 =================
loadMarkers();
updateMap();
