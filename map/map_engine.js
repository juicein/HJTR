// ==========================
// ⚙️ 配置
// ==========================
const TILE_SIZE = 256;
const BASE_URL = "/map/tiles";

const map = document.getElementById("map");

// ==========================
// 🌍 状态
// ==========================
let state = {
  x: 0,
  z: 0,
  zoom: -1
};

// ==========================
// 🧠 Tile缓存（核心）
// ==========================
const tileCache = new Map(); // key: z_x_z

function getKey(z,x,y){
  return `${z}_${x}_${y}`;
}

// ==========================
// 🧠 Tile URL
// ==========================
function getTileURL(z,x,y){
  return `${BASE_URL}/zoom.${z}/${x}/${y}/tile.${x}.${y}.webp`;
}

// ==========================
// 🧠 获取或创建 tile（复用DOM）
// ==========================
function getTile(z,x,y){

  const key = getKey(z,x,y);

  if (tileCache.has(key)){
    return tileCache.get(key);
  }

  const img = document.createElement("img");
  img.className = "tile";

  img.src = getTileURL(z,x,y);

  img.onerror = ()=> img.remove();

  tileCache.set(key,img);

  return img;
}

// ==========================
// 🧠 渲染（只加载视口）
// ==========================
function render(){

  const w = map.clientWidth;
  const h = map.clientHeight;

  const startX = Math.floor(state.x / TILE_SIZE);
  const startZ = Math.floor(state.z / TILE_SIZE);

  const endX = Math.floor((state.x + w) / TILE_SIZE);
  const endZ = Math.floor((state.z + h) / TILE_SIZE);

  const visible = new Set();

  for(let x = startX-1; x <= endX+1; x++){
    for(let z = startZ-1; z <= endZ+1; z++){

      const key = getKey(state.zoom,x,z);
      visible.add(key);

      let tile = getTile(state.zoom,x,z);

      if (!tile.parentNode){
        map.appendChild(tile);
      }

      const px = x * TILE_SIZE - state.x;
      const pz = z * TILE_SIZE - state.z;

      tile.style.transform = `translate(${px}px, ${pz}px)`;
    }
  }

  // 移除不可见 tile（不删除缓存）
  tileCache.forEach((tile,key)=>{
    if (!visible.has(key)){
      if (tile.parentNode){
        tile.remove();
      }
    }
  });
}

// ==========================
// 🖱️ 拖动（平滑）
// ==========================
let dragging = false;
let lastX,lastY;

map.addEventListener("mousedown",(e)=>{
  dragging = true;
  map.style.cursor="grabbing";
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener("mouseup",()=>{
  dragging = false;
  map.style.cursor="grab";
});

window.addEventListener("mousemove",(e)=>{
  if(!dragging) return;

  state.x -= (e.clientX - lastX);
  state.z -= (e.clientY - lastY);

  lastX = e.clientX;
  lastY = e.clientY;

  requestAnimationFrame(render);
});

// ==========================
// 🔍 平滑缩放（核心）
// ==========================
map.addEventListener("wheel",(e)=>{

  const oldZoom = state.zoom;

  state.zoom += (e.deltaY < 0 ? 1 : -1);
  state.zoom = Math.max(-6, Math.min(0, state.zoom));

  if (oldZoom === state.zoom) return;

  const scale = Math.pow(2, state.zoom - oldZoom);

  state.x *= scale;
  state.z *= scale;

  requestAnimationFrame(render);
});

// ==========================
// 🚀 初始化
// ==========================
state.x = 0;
state.z = 0;

render();

window.addEventListener("resize", ()=> requestAnimationFrame(render));
