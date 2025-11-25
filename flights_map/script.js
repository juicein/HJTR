// ============ 地图初始化 ============
const map = L.map('map', {
  worldCopyJump: true,
  minZoom: 2
}).setView([30, 90], 3);

// 世界地图底图
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

// ============ 工具函数：解析时间 ============
function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ============ 判断是否单航班模式 ============
function getFlightIDFromURL() {
  const q = new URLSearchParams(location.search);
  return q.get("id"); // ?id=DF1721
}

// 映射机场名 → 三字码
function airportCodeByName(name) {
  for (let code in airportDB) {
    if (airportDB[code].city === name || airportDB[code].name.includes(name)) {
      return code;
    }
  }
  return null;
}

// ============ 渲染航班 ============
function renderFlights() {
  const filterID = getFlightIDFromURL();

  // 清除旧标记
  for (let k in markers) map.removeLayer(markers[k]);
  for (let k in polyLines) map.removeLayer(polyLines[k]);
  markers = {};
  polyLines = {};

  flights.forEach(f => {
    if (filterID && f.id !== filterID) return; // 单航班模式

    const depCode = airportCodeByName(f.dep);
    const arrCode = airportCodeByName(f.arr);
    if (!depCode || !arrCode) return;

    const depA = airportDB[depCode];
    const arrA = airportDB[arrCode];

    // 计算飞行状态
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const depMin = timeToMinutes(f.depTime);
    const arrMin = timeToMinutes(f.arrTime);

    let status = "preparing"; // 准备、飞行中、已到达、今天不飞

    if (nowMin < depMin) status = "preparing";
    else if (nowMin > arrMin) status = "arrived";
    else if (nowMin >= depMin && nowMin <= arrMin) status = "flying";

    if (status === "arrived" || status === "preparing") return;

    // ============= 飞行中才绘制路线与飞机位置 =============
    const total = arrMin - depMin;
    const passed = nowMin - depMin;
    const ratio = passed / total;

    const lat = depA.lat + (arrA.lat - depA.lat) * ratio;
    const lng = depA.lng + (arrA.lng - depA.lng) * ratio;

    // 航线
    const line = L.polyline(
      [[depA.lat, depA.lng], [arrA.lat, arrA.lng]],
      { color: "orange", weight: 2, dashArray: "6 6" }
    ).addTo(map);
    polyLines[f.flightNo] = line;

    // 朝向计算
    const angleRad = Math.atan2(arrA.lng - depA.lng, arrA.lat - depA.lat);
    const angleDeg = (angleRad * 180) / Math.PI - 90;

    // 飞机图标
    const icon = L.divIcon({
      className: "plane-icon",
      html: `<div style="transform: rotate(${angleDeg}deg); font-size:22px;">✈️</div>`
    });

    const mk = L.marker([lat, lng], { icon }).addTo(map);

    mk.flight = f;
    mk.on("click", () => showInfoCard(f, depA, arrA));

    markers[f.flightNo] = mk;

    // 航班号标签（可关闭）
    if (showFlightNo) {
      mk.bindTooltip(f.flightNo, {
        permanent: true,
        direction: "right",
        className: "flight-label"
      });
    }
  });
}

// ============ 信息卡片 ============
function showInfoCard(f, depA, arrA) {
  const card = document.getElementById("infoCard");
  card.innerHTML = `
    <h3>${f.flightNo}</h3>
    <p><b>航班ID：</b>${f.id}</p>
    <p><b>出发：</b>${depA.name} (${f.depTime})</p>
    <p><b>到达：</b>${arrA.name} (${f.arrTime})</p>
    <p><b>机场等级：</b>${arrA.level}</p>
    <p><b>跑道数量：</b>${arrA.runways}</p>
  `;
  card.classList.remove("hidden");
}

// ============ 顶部工具栏（航班号开关，可记忆） ============
function initToolbar() {
  const chk = document.getElementById("toggleFlightNo");
  chk.checked = showFlightNo;

  chk.addEventListener("change", () => {
    showFlightNo = chk.checked;
    localStorage.setItem("showFlightNo", showFlightNo);
    renderFlights(); // 重新渲染
  });
}

// ============ 启动 ============
loadData();
