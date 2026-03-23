const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

let width, height;

function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}
window.onresize = resize;
resize();


// ===== 核心配置 =====
const TILE_SIZE = 256;

// ⚠️ 修改成你的路径
const TILE_PATH = "./tiles/{z}/{x}_{y}.png";

// 地图中心（MC坐标）
let camera = {
  x: 0,
  z: 0,
  zoom: 2
};

// 缓存
const tileCache = {};


// ===== 坐标转换（已处理MC Z轴翻转）=====
function worldToScreen(x, z) {
  const scale = Math.pow(2, camera.zoom);

  return {
    x: (x - camera.x) * scale + width / 2,
    y: (-z + camera.z) * scale + height / 2 // ✅ Z轴翻转关键
  };
}

function screenToWorld(x, y) {
  const scale = Math.pow(2, camera.zoom);

  return {
    x: (x - width/2) / scale + camera.x,
    z: -(y - height/2) / scale + camera.z
  };
}


// ===== 加载tile =====
function loadTile(z, x, y) {
  const key = `${z}_${x}_${y}`;

  if (tileCache[key]) return tileCache[key];

  const img = new Image();
  img.src = TILE_PATH
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y);

  tileCache[key] = img;
  return img;
}


// ===== 渲染 =====
function render() {
  ctx.clearRect(0, 0, width, height);

  const scale = Math.pow(2, camera.zoom);

  // 当前视野范围（世界坐标）
  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(width, height);

  // 转tile坐标
  const startX = Math.floor(topLeft.x / TILE_SIZE);
  const endX = Math.floor(bottomRight.x / TILE_SIZE);

  const startY = Math.floor(topLeft.z / TILE_SIZE);
  const endY = Math.floor(bottomRight.z / TILE_SIZE);

  for (let tx = startX - 1; tx <= endX + 1; tx++) {
    for (let ty = startY - 1; ty <= endY + 1; ty++) {

      const img = loadTile(camera.zoom, tx, ty);

      const worldX = tx * TILE_SIZE;
      const worldZ = ty * TILE_SIZE;

      const pos = worldToScreen(worldX, worldZ);

      const size = TILE_SIZE * scale;

      if (img.complete) {
        ctx.drawImage(img, pos.x, pos.y, size, size);
      }
    }
  }

  drawCenter();
  requestAnimationFrame(render);
}


// ===== 中心点标记（防黑屏调试用）=====
function drawCenter() {
  const p = worldToScreen(camera.x, camera.z);

  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5, 0, Math.PI*2);
  ctx.fill();
}


// ===== 拖动 =====
let dragging = false;
let lastX, lastY;

canvas.onmousedown = (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
};

window.onmouseup = () => dragging = false;

window.onmousemove = (e) => {
  if (!dragging) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;

  const scale = Math.pow(2, camera.zoom);

  camera.x -= dx / scale;
  camera.z += dy / scale; // ⚠️ 注意方向

  lastX = e.clientX;
  lastY = e.clientY;
};


// ===== 缩放 =====
canvas.onwheel = (e) => {
  e.preventDefault();

  const oldZoom = camera.zoom;

  if (e.deltaY < 0) camera.zoom++;
  else camera.zoom--;

  camera.zoom = Math.max(0, Math.min(6, camera.zoom));

  // 缩放中心锁定
  const mouse = screenToWorld(e.clientX, e.clientY);

  camera.x = mouse.x;
  camera.z = mouse.z;
};


// ===== 启动 =====
render();
