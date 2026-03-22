const TILE_SIZE = 256;
const container = document.getElementById("map");

let state = {
  x: 0,
  z: 0,
  zoom: -1
};

// ========================
// 🧠 region索引（你提供的）
// ========================
const regionMap = {};
UnminedRegions.forEach(r => {
  regionMap[`${r.x},${r.z}`] = r.m;
});

function tileExists(x, z) {
  const rx = Math.floor(x / 32);
  const rz = Math.floor(z / 32);

  const region = regionMap[`${rx},${rz}`];
  if (!region) return false;

  const lx = ((x % 32)+32)%32;
  const lz = ((z % 32)+32)%32;

  const i = lz * 32 + lx;
  const row = Math.floor(i / 32);
  const col = i % 32;

  return (region[row] & (1 << col)) !== 0;
}

// ========================
// 🎨 渲染
// ========================
function render() {

  container.innerHTML = "";

  const w = window.innerWidth;
  const h = window.innerHeight;

  const tiles = 20;

  for (let dx=-tiles; dx<tiles; dx++) {
    for (let dz=-tiles; dz<tiles; dz++) {

      const tx = Math.floor(state.x/256)+dx;
      const tz = Math.floor(state.z/256)+dz;

      if (!tileExists(tx, tz)) continue;

      const img = document.createElement("img");
      img.className = "tile";

      img.src = `./tiles/zoom.${state.zoom}/${tx}/${tz}/tile.${tx}.${tz}.webp`;

      img.style.left = (tx*256 - state.x + w/2)+"px";
      img.style.top  = (tz*256 - state.z + h/2)+"px";

      container.appendChild(img);
    }
  }

  renderPOI();
  renderRoads();
}

// ========================
// 📍 POI
// ========================
function renderPOI() {

  POI.forEach(p => {

    const el = document.createElement("div");
    el.className = "marker";

    el.style.left = (p.x - state.x + window.innerWidth/2)+"px";
    el.style.top  = (p.z - state.z + window.innerHeight/2)+"px";

    el.onclick = () => {
      document.getElementById("info").style.display = "block";
      document.getElementById("info").innerHTML = `<b>${p.name}</b>`;
    };

    container.appendChild(el);
  });
}

// ========================
// 🚇 路网
// ========================
function renderRoads() {

  ROADS.forEach(line => {

    for (let i=0;i<line.length-1;i++) {

      const [x1,z1] = line[i];
      const [x2,z2] = line[i+1];

      const dx = x2-x1;
      const dz = z2-z1;

      const len = Math.sqrt(dx*dx + dz*dz);
      const angle = Math.atan2(dz,dx)*180/Math.PI;

      const el = document.createElement("div");
      el.className = "road";

      el.style.width = len+"px";
      el.style.left = (x1 - state.x + window.innerWidth/2)+"px";
      el.style.top  = (z1 - state.z + window.innerHeight/2)+"px";
      el.style.transform = `rotate(${angle}deg)`;

      container.appendChild(el);
    }
  });
}

// ========================
// 🖱️ 拖动
// ========================
let dragging=false, sx, sz, cx, cz;

container.onmousedown = e=>{
  dragging=true;
  cx=e.clientX; cz=e.clientY;
  sx=state.x; sz=state.z;
};

window.onmouseup=()=>dragging=false;

window.onmousemove=e=>{
  if(!dragging)return;

  state.x = sx - (e.clientX-cx);
  state.z = sz - (e.clientY-cz);

  render();
};

// ========================
// 🔍 缩放
// ========================
container.onwheel = e=>{
  let old=state.zoom;

  state.zoom += (e.deltaY<0?1:-1);
  state.zoom=Math.max(-6,Math.min(0,state.zoom));

  let scale=Math.pow(2,state.zoom-old);

  state.x*=scale;
  state.z*=scale;

  render();
};

// ========================
// 🔍 搜索
// ========================
document.getElementById("searchInput").onchange = e=>{

  let val = e.target.value;

  if (val.includes(",")) {
    let [x,z]=val.split(",").map(Number);
    state.x=x;
    state.z=z;
  } else {
    let poi = POI.find(p=>p.name.includes(val));
    if (poi) {
      state.x=poi.x;
      state.z=poi.z;
    }
  }

  render();
};

// 启动
render();
