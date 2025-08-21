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

    const econPrice = entry.match(/§(.*?)元§/)?.[1] || null;
    const bizPrice = entry.match(/θ(.*?)元θ/)?.[1] || null;
    const firstPrice = entry.match(/△(.*?)元△/)?.[1] || null;

    return {
      flightNo, weekdays, aircraft, airline,
      depAirport, depTime, depTerminal,
      arrAirport, arrTime, arrTerminal,
      econPrice, bizPrice, firstPrice
    };
  });
}

const flights = parseFlights(flightsData);

// 星期映射
const weekMap = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

// 渲染函数
function renderFlights(list) {
  const container = document.getElementById("flightsContainer");
  container.innerHTML = "";
  list.forEach(f => {
    const card = document.createElement("div");
    card.className = "flight-card";
    card.innerHTML = `
      <div class="flight-header">${f.flightNo} - ${f.airline}</div>
      <div class="flight-info">机型: ${f.aircraft}</div>
      <div class="flight-info">出发: ${f.depAirport} ${f.depTime} (${f.depTerminal})</div>
      <div class="flight-info">到达: ${f.arrAirport} ${f.arrTime} (${f.arrTerminal})</div>
      <div class="flight-info">
        ${f.econPrice ? `<span class="price-box price-econ">经济舱 ¥${f.econPrice}</span>` : ""}
        ${f.bizPrice ? `<span class="price-box price-biz">商务舱 ¥${f.bizPrice}</span>` : ""}
        ${f.firstPrice ? `<span class="price-box price-first">头等舱 ¥${f.firstPrice}</span>` : ""}
      </div>
    `;
    container.appendChild(card);
  });
}

// 默认显示今天
document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  document.getElementById("dateInput").value = today.toISOString().split("T")[0];
  renderFlights(flights);
});

// 搜索筛选
document.getElementById("searchBtn").addEventListener("click", () => {
  const dep = document.getElementById("depInput").value.trim();
  const arr = document.getElementById("arrInput").value.trim();
  const airline = document.getElementById("airlineInput").value.trim();
  const timeFilter = document.getElementById("timeFilter").value;
  const priceSort = document.getElementById("priceSort").value;
  const dateVal = document.getElementById("dateInput").value;

  let week = "";
  if (dateVal) {
    const d = new Date(dateVal);
    week = weekMap[d.getDay()];
  }

  let result = flights.filter(f => {
    if (dep && !f.depAirport.includes(dep)) return false;
    if (arr && !f.arrAirport.includes(arr)) return false;
    if (airline && !f.airline.includes(airline)) return false;
    if (week && !f.weekdays.includes(week)) return false;
    if (timeFilter) {
      const hour = parseInt(f.depTime.split(":")[0]);
      if (timeFilter==="early" && !(hour>=0 && hour<6)) return false;
      if (timeFilter==="morning" && !(hour>=6 && hour<12)) return false;
      if (timeFilter==="noon" && !(hour>=12 && hour<14)) return false;
      if (timeFilter==="afternoon" && !(hour>=14 && hour<18)) return false;
      if (timeFilter==="evening" && !(hour>=18 && hour<24)) return false;
    }
    return true;
  });

  if (priceSort) {
    result.sort((a,b) => {
      const pa = a.econPrice ? parseInt(a.econPrice) : (a.bizPrice ? parseInt(a.bizPrice) : 0);
      const pb = b.econPrice ? parseInt(b.econPrice) : (b.bizPrice ? parseInt(b.bizPrice) : 0);
      return priceSort==="asc" ? pa-pb : pb-pa;
    });
  }

  renderFlights(result);
});

document.getElementById("onlyDepBtn").addEventListener("click", () => {
  const dep = document.getElementById("depInput").value.trim();
  if (!dep) return alert("请输入出发机场！");
  const result = flights.filter(f => f.depAirport.includes(dep));
  renderFlights(result);
});
