const map = document.getElementById("map");

// ===== 配置 =====
const TILE_SIZE_BASE = 256;
const TILE_ROOT = "./tiles";

// ===== 相机 =====
let camera = {
  x: 0,
  z: 0,
  zoom: -1
};

// ===== 缓存 =====
const tiles = new Map();

// ===== 工具函数 =====
function getTileSize() {
  return TILE_SIZE_BASE * Math.pow(2, -camera.zoom);
}

function getTileKey(x, z, zoom) {
  return `${zoom}_${x}_${z}`;
}

function getTileUrl(x, z, zoom) {
  const xDir = Math.floor(x / 10);
  const zDir = Math.floor(z / 10);
  return `${TILE_ROOT}/zoom.${zoom}/${xDir}/${zDir}/tile.${x}.${z}.webp`;
}

// ===== 世界 → 屏幕 =====
function worldToScreen(x, z) {
  const rect = map.getBoundingClientRect();
  return {
    x: (x - camera.x) + rect.width / 2,
    y: (z - camera.z) + rect.height / 2
  };
}

// ===== 渲染 =====
function render() {
  const rect = map.getBoundingClientRect();
  const tileSize = getTileSize();

  const startX = Math.floor((camera.x - rect.width/2) / tileSize);
  const endX   = Math.floor((camera.x + rect.width/2) / tileSize);

  const startZ = Math.floor((camera.z - rect.height/2) / tileSize);
  const endZ   = Math.floor((camera.z + rect.height/2) / tileSize);

  const needed = new Set();

  for (let tx = startX-1; tx <= endX+1; tx++) {
    for (let tz = startZ-1; tz <= endZ+1; tz++) {

      const key = getTileKey(tx, tz, camera.zoom);
      needed.add(key);

      if (!tiles.has(key)) {
        const img = document.createElement("img");
        img.className = "tile";
        img.src = getTileUrl(tx, tz, camera.zoom);
        img.dataset.key = key;

        map.appendChild(img);
        tiles.set(key, img);
      }

      const img = tiles.get(key);

      const worldX = tx * tileSize;
      const worldZ = tz * tileSize;

      const screen = worldToScreen(worldX, worldZ);

      img.style.width = tileSize + "px";
      img.style.height = tileSize + "px";

      img.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
    }
  }

  // 清理多余tile
  tiles.forEach((img, key) => {
    if (!needed.has(key)) {
      img.remove();
      tiles.delete(key);
    }
  });
}

// ===== 拖拽 =====
let dragging = false;
let lastX, lastY;

map.onmousedown = (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
};

window.onmouseup = () => dragging = false;

window.onmousemove = (e) => {
  if (!dragging) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;

  camera.x -= dx;
  camera.z -= dy;

  lastX = e.clientX;
  lastY = e.clientY;

  render();
};

// ===== 缩放 =====
map.onwheel = (e) => {
  e.preventDefault();

  if (e.deltaY < 0) camera.zoom++;
  else camera.zoom--;

  camera.zoom = Math.max(-6, Math.min(0, camera.zoom));

  render();
};

// ===== 触摸 =====
map.ontouchstart = (e) => {
  if (e.touches.length === 1) {
    dragging = true;
    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;
  }
};

map.ontouchmove = (e) => {
  if (e.touches.length === 1 && dragging) {
    const dx = e.touches[0].clientX - lastX;
    const dy = e.touches[0].clientY - lastY;

    camera.x -= dx;
    camera.z -= dy;

    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;

    render();
  }
};

map.ontouchend = () => dragging = false;

// ===== 启动 =====
render();
