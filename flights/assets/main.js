// 解析航班数据
function parseFlights(rawData) {
  const entries = rawData.trim().split(/《航班结束》/).filter(e => e.trim());
  return entries.map(entry => {
    const flightNo = entry.match(/【(.*?)】/)?.[1] || "";
    const weekdays = entry.match(/«(.*?)»/)?.[1] || "";
    const aircraft = entry.match(/〔(.*?)〕/)?.[1] || "";
    const airline = entry.match(/『(.*?)』/)?.[1] || "";
    const depAirport = entry.match(/《(.*?)出发》/)?.[1] || "";
    const depTime = entry.match(/出发》{(.*?)}#\+\d+#/)?.[1] || "";
    const depTerminal = entry.match(/出发》{.*?}#\+\d+#@(.*?)@/)?.[1] || "";
    const arrAirport = entry.match(/《(.*?)到达》/)?.[1] || "";
    const arrTime = entry.match(/到达》{(.*?)}#\+\d+#/)?.[1] || "";
    const arrTerminal = entry.match(/到达》{.*?}#\+\d+#@(.*?)@/)?.[1] || "";
    const econPrice = entry.match(/§(.*?)§/)?.[1] || "";
    const bizPrice = entry.match(/θ(.*?)θ/)?.[1] || "";

    return {
      flightNo, weekdays, aircraft, airline,
      depAirport, depTime, depTerminal,
      arrAirport, arrTime, arrTerminal,
      econPrice, bizPrice
    };
  });
}

const flights = parseFlights(flightsData);

// 渲染航班卡片
function renderFlights(flightsArr) {
  const container = document.getElementById("flightsContainer");
  container.innerHTML = "";

  flightsArr.forEach(f => {
    const card = document.createElement("div");
    card.className = "flight-card";

    card.innerHTML = `
      <div class="flight-header">
        <span>${f.flightNo} · ${f.airline}</span>
        <span>${f.aircraft}</span>
      </div>
      <div class="flight-sub">运行日: ${f.weekdays}</div>
      <div class="flight-times">
        <div>
          <strong>${f.depTime}</strong><br>
          ${f.depAirport} · ${f.depTerminal}
        </div>
        <div>
          <strong>${f.arrTime}</strong><br>
          ${f.arrAirport} · ${f.arrTerminal}
        </div>
      </div>
      <div class="flight-prices">
        <div class="price">经济舱: ${f.econPrice}</div>
        <div class="price">商务舱: ${f.bizPrice}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

// 初始渲染
renderFlights(flights);

// 机场联想
function updateAirportList() {
  const airports = new Set();
  flights.forEach(f => {
    airports.add(f.depAirport);
    airports.add(f.arrAirport);
  });
  const list = document.getElementById("airportList");
  list.innerHTML = "";
  airports.forEach(a => {
    const option = document.createElement("option");
    option.value = a;
    list.appendChild(option);
  });
}
updateAirportList();

// 查询按钮
document.getElementById("searchBtn").addEventListener("click", () => {
  const keyword = document.getElementById("airportInput").value.trim();
  let result = flights;

  if (keyword) {
    result = result.filter(f => f.depAirport.includes(keyword) || f.arrAirport.includes(keyword));
  }

  const sortBy = document.getElementById("sortSelect").value;
  if (sortBy === "price") {
    result = result.slice().sort((a, b) => {
      const pa = parseInt(a.econPrice) || 999999;
      const pb = parseInt(b.econPrice) || 999999;
      return pa - pb;
    });
  } else {
    result = result.slice().sort((a, b) => {
      return (a.depTime > b.depTime) ? 1 : -1;
    });
  }

  renderFlights(result);
});
