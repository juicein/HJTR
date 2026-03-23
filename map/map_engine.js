// =======================
// MC MAP ENGINE v2（重构版）
// =======================

// ===== 配置 =====
const TILE_SIZE = 256;
let zoomLevel = -1;

let camera = {
  x: 0,
  z: 0
};

const tileCache = new Map();
let isDragging = false;
let lastX, lastY;
let isZooming = false;

// ===== DOM =====
const previewContainer = document.querySelector('.preview-container');

let tileContainer = document.createElement('div');
tileContainer.className = 'tile-container';
previewContainer.appendChild(tileContainer);


// =======================
// 坐标系统（核心修复🔥）
// =======================

// MC → 屏幕
function worldToScreen(wx, wz) {
  const scale = Math.pow(2, zoomLevel);

  return {
    x: (wx - camera.x) * scale + previewContainer.clientWidth / 2,
    y: (-wz + camera.z) * scale + previewContainer.clientHeight / 2 // Z轴翻转
  };
}

// 屏幕 → MC
function screenToWorld(sx, sy) {
  const scale = Math.pow(2, zoomLevel);

  return {
    x: (sx - previewContainer.clientWidth / 2) / scale + camera.x,
    z: -(sy - previewContainer.clientHeight / 2) / scale + camera.z
  };
}


// =======================
// Tile路径（适配你现有结构）
// =======================
function getTileUrl(tx, tz) {
  const xDir = Math.floor(tx / 10);
  const zDir = Math.floor(tz / 10);

  return `https://map.shangxiaoguan.top/tiles/zoom.${zoomLevel}/${xDir}/${zDir}/tile.${tx}.${tz}.jpeg`;
}


// =======================
// Tile加载（带缓存）
// =======================
function loadTile(tx, tz) {
  const key = `${zoomLevel}_${tx}_${tz}`;

  if (tileCache.has(key)) {
    return tileCache.get(key);
  }

  const img = new Image();
  img.src = getTileUrl(tx, tz);

  img.dataset.key = key;
  img.style.position = 'absolute';

  tileCache.set(key, img);
  return img;
}


// =======================
// 主渲染（核心🔥）
// =======================
function render() {
  const scale = Math.pow(2, zoomLevel);

  const width = previewContainer.clientWidth;
  const height = previewContainer.clientHeight;

  // 当前视野范围
  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(width, height);

  const startX = Math.floor(topLeft.x / TILE_SIZE);
  const endX = Math.floor(bottomRight.x / TILE_SIZE);

  const startZ = Math.floor(topLeft.z / TILE_SIZE);
  const endZ = Math.floor(bottomRight.z / TILE_SIZE);

  const neededTiles = new Set();

  for (let tx = startX - 1; tx <= endX + 1; tx++) {
    for (let tz = startZ - 1; tz <= endZ + 1; tz++) {

      const key = `${zoomLevel}_${tx}_${tz}`;
      neededTiles.add(key);

      let img = tileCache.get(key);

      if (!img) {
        img = loadTile(tx, tz);
        tileContainer.appendChild(img);
      }

      // 计算位置
      const worldX = tx * TILE_SIZE;
      const worldZ = tz * TILE_SIZE;

      const pos = worldToScreen(worldX, worldZ);

      const size = TILE_SIZE * scale;

      img.style.left = pos.x + 'px';
      img.style.top = pos.y + 'px';
      img.style.width = size + 'px';
      img.style.height = size + 'px';
      img.style.opacity = 1;
    }
  }

  // 移除多余tile（关键优化🔥）
  tileCache.forEach((img, key) => {
    if (!neededTiles.has(key)) {
      img.remove();
      tileCache.delete(key);
    }
  });
}


// =======================
// 拖拽（优化版）
// =======================
previewContainer.addEventListener('mousedown', (e) => {
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener('mouseup', () => isDragging = false);

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;

  const scale = Math.pow(2, zoomLevel);

  camera.x -= dx / scale;
  camera.z += dy / scale;

  lastX = e.clientX;
  lastY = e.clientY;

  requestRender();
});


// =======================
// 缩放（重写🔥）
// =======================
previewContainer.addEventListener('wheel', (e) => {
  e.preventDefault();

  const mouse = screenToWorld(e.clientX, e.clientY);

  if (e.deltaY < 0) zoomLevel++;
  else zoomLevel--;

  zoomLevel = Math.max(-6, Math.min(3, zoomLevel));

  camera.x = mouse.x;
  camera.z = mouse.z;

  requestRender();
});


// =======================
// 触摸缩放（简化稳定版）
// =======================
let pinchStartDist = 0;

previewContainer.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    isZooming = true;
    pinchStartDist = getDistance(e.touches[0], e.touches[1]);
  }
});

previewContainer.addEventListener('touchmove', (e) => {
  if (!isZooming || e.touches.length < 2) return;

  const dist = getDistance(e.touches[0], e.touches[1]);

  if (Math.abs(dist - pinchStartDist) > 30) {
    if (dist > pinchStartDist) zoomLevel++;
    else zoomLevel--;

    zoomLevel = Math.max(-6, Math.min(3, zoomLevel));

    pinchStartDist = dist;
    requestRender();
  }

  e.preventDefault();
});

previewContainer.addEventListener('touchend', () => {
  isZooming = false;
});

function getDistance(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}


// =======================
// 渲染调度（防卡🔥）
// =======================
let renderPending = false;

function requestRender() {
  if (renderPending) return;

  renderPending = true;

  requestAnimationFrame(() => {
    render();
    renderPending = false;
  });
}


// =======================
// 初始化
// =======================
function initMap(x = 0, z = 0) {
  camera.x = x;
  camera.z = z;

  requestRender();
}

window.initMap = initMap;


// 默认启动
initMap(0, 0);
