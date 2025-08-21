// 将日期转星期几（英文缩写）
function getWeekday(dateStr) {
  const days = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  const d = new Date(dateStr);
  return days[d.getDay()];
}

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
    const firstPrice = entry.match(/△(.*?)△/)?.[1] || "";
    const addDay = arrTime.includes("+1") ? 1 : 0;

    return {
      flightNo, weekdays, aircraft, airline,
      depAirport, depTime, depTerminal,
      arrAirport, arrTime: arrTime.replace(/\+.*#/, ""), arrTerminal,
      econPrice, bizPrice, firstPrice, addDay
    };
  });
}

function renderFlights(list) {
  const results = document.getElementById("results");
  results.innerHTML = "";
  list.forEach(f => {
    const card = document.createElement("div");
    card.className = "flight-card";
    card.innerHTML = `
      <div class="flight-header">
        <span class="flight-no">${f.flightNo}</span>
        <span class="airline">${f.airline}</span>
        <span class="aircraft">${f.aircraft}</span>
      </div>
      <div class="flight-body">
        <div class="time-block">
          <div><strong>${f.depTime}</strong></div>
          <div>${f.depAirport} (${f.depTerminal})</div>
        </div>
        <div class="arrow">→</div>
        <div class="time-block">
          <div><strong>${f.arrTime}${f.addDay ? " +1天" : ""}</strong></div>
          <div>${f.arrAirport} (${f.arrTerminal})</div>
        </div>
      </div>
      <div class="price-block">
        ${f.econPrice ? `<span class="price econ">经济舱 ${f.econPrice}</span>` : ""}
        ${f.bizPrice ? `<span class="price biz">商务舱 ${f.bizPrice}</span>` : ""}
        ${f.firstPrice ? `<span class="price first">头等舱 ${f.firstPrice}</span>` : ""}
      </div>
    `;
    results.appendChild(card);
  });
}

function filterFlights() {
  const from = document.getElementById("fromAirport").value.trim();
  const to = document.getElementById("toAirport").value.trim();
  const airline = document.getElementById("airlineFilter").value.trim();
  const timeFilter = document.getElementById("timeFilter").value;
  const date = document.getElementById("flightDate").value;
  const weekday = date ? getWeekday(date) : "";
  const sort = document.getElementById("priceSort").value;

  let list = flights.filter(f => {
    if (from && !f.depAirport.includes(from)) return false;
    if (to && !f.arrAirport.includes(to)) return false;
    if (airline && !f.airline.includes(airline)) return false;
    if (weekday && !f.weekdays.includes(weekday)) return false;
    if (timeFilter) {
      const hour = parseInt(f.depTime.split(":")[0],10);
      if (timeFilter==="early" && (hour<0||hour>=6)) return false;
      if (timeFilter==="morning" && (hour<6||hour>=12)) return false;
      if (timeFilter==="noon" && (hour<12||hour>=14)) return false;
      if (timeFilter==="afternoon" && (hour<14||hour>=18)) return false;
      if (timeFilter==="evening" && (hour<18||hour>=24)) return false;
    }
    return true;
  });

  // 价格排序
  if (sort) {
    list.sort((a,b)=>{
      const pa = parseInt(a.econPrice||a.bizPrice||a.firstPrice||"0");
      const pb = parseInt(b.econPrice||b.bizPrice||b.firstPrice||"0");
      return sort==="asc"? pa-pb : pb-pa;
    });
  }

  renderFlights(list);
}

const flights = parseFlights(flightsData);
renderFlights(flights);

// 事件绑定
document.getElementById("searchBtn").addEventListener("click", filterFlights);
document.getElementById("onlyDepartureBtn").addEventListener("click", ()=>{
  document.getElementById("toAirport").value="";
  filterFlights();
});
