// ============ 初始化地图 ============
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);

// 简约底图（无国界）
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 7,
}).addTo(map);

let airportDB = {};
let flights = [];
let markers = {};
let polyLines = {};
let showFlightNo = localStorage.getItem("showFlightNo") === "true";

// ============ 读取数据 ============
async function loadData() {
  airportDB = await fetch("../data/airports.json").then(r => r.json());

  const txt = await fetch("../data/flight_data.txt").then(r => r.text());
  flights = parseFlightData(txt);

  initToolbar();
  renderFlights();
}

// ============ 解析航班原始格式 ============
function parseFlightData(raw) {
  const list = [];
  const reg = /【(.*?)】[\s\S]*?《(.*?)出发》\{(.*?)\}.*?《(.*?)到达》\{(.*?)\}[\s\S]*?<([^>]+)>/g;
  let m;
  while ((m = reg.exec(raw)) !== null) {
    list.push({
      flightNo: m[1],
      dep: m[2],
      depTime: m[3],
      arr: m[4],
      arrTime: m[5],
      id: m[6]
    });
  }
  return list;
}

// ============ 工具函数 ============
function timeToMinutes(t) { const [h,m] = t.split(":").map(Number); return h*60 + m; }
function getFlightIDFromURL() { return new URLSearchParams(location.search).get("flights_map"); }
function airportByName(name) {
  for (let code in airportDB) {
    if (airportDB[code].city === name || airportDB[code].name.includes(name)) return airportDB[code];
  }
  return null;
}

// ============ 渲染航班 ============
function renderFlights() {
  const filterID = getFlightIDFromURL();

  for (let k in markers) map.removeLayer(markers[k]);
  for (let k in polyLines) map.removeLayer(polyLines[k]);
  markers = {}; polyLines = {};

  flights.forEach(f => {
    if (filterID && f.id.toUpperCase() !== filterID.toUpperCase()) return;

    const depA = airportByName(f.dep);
    const arrA = airportByName(f.arr);
    if (!depA || !arrA) return;

    const nowMin = new Date().getHours()*60 + new Date().getMinutes();
    const depMin = timeToMinutes(f.depTime);
    const arrMin = timeToMinutes(f.arrTime);

    if (nowMin < depMin || nowMin > arrMin) return; // 飞行中才显示

    const ratio = (nowMin - depMin)/(arrMin - depMin);
    const lat = depA.lat + (arrA.lat - depA.lat)*ratio;
    const lng = depA.lng + (arrA.lng - depA.lng)*ratio;

    // 航线
    const line = L.polyline([[depA.lat, depA.lng],[arrA.lat, arrA.lng]], {
      color:"orange", weight:2, dashArray:"6 6"
    }).addTo(map);
    polyLines[f.flightNo] = line;

    // 飞机图标
    const icon = L.icon({
      iconUrl: "https://i.imgur.com/4bZtV3y.png", // PNG 飞机图标
      iconSize: [32,32],
      iconAnchor: [16,16]
    });
    const mk = L.marker([lat,lng], {icon}).addTo(map);
    mk.flight = f;
    mk.on("click",()=>showInfoCard(f,depA,arrA));
    markers[f.flightNo] = mk;

    // 显示航班号
    if(showFlightNo){
      mk.bindTooltip(f.flightNo,{permanent:true,direction:"right",className:"flight-label"});
    }

    // 点击机场显示信息
    [depA, arrA].forEach(ap=>{
      const airportMk = L.marker([ap.lat,ap.lng],{
        icon: L.divIcon({className:"airport-icon",html:`<div style="font-size:14px;">${ap.code}</div>`})
      }).addTo(map);
      airportMk.on("click",()=>showAirportCard(ap));
    });
  });
}

// ============ 信息卡片 ============
function showInfoCard(f, depA, arrA){
  const card = document.getElementById("infoCard");
  card.innerHTML=`
    <h3>${f.flightNo}</h3>
    <p><b>航班ID：</b>${f.id}</p>
    <p><b>出发：</b>${depA.name} (${f.depTime})</p>
    <p><b>到达：：</b>${arrA.name} (${f.arrTime})</p>
    ${arrA.level?`<p><b>机场等级：</b>${arrA.level}</p>`:""}
    ${arrA.runways?`<p><b>跑道数量：</b>${arrA.runways}</p>`:""}
  `;
  card.classList.remove("hidden");
}

function showAirportCard(ap){
  const card = document.getElementById("infoCard");
  card.innerHTML=`
    <h3>${ap.name} (${ap.code})</h3>
    ${ap.level?`<p><b>机场等级：</b>${ap.level}</p>`:""}
    ${ap.runways?`<p><b>跑道数量：</b>${ap.runways}</p>`:""}
  `;
  card.classList.remove("hidden");
}

// ============ 顶部工具栏 ============
function initToolbar(){
  const chk = document.getElementById("toggleFlightNo");
  chk.checked = showFlightNo;
  chk.addEventListener("change",()=>{
    showFlightNo = chk.checked;
    localStorage.setItem("showFlightNo", showFlightNo);
    renderFlights();
  });
}

// ============ 启动 ============
loadData();
