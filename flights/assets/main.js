// ===== 数据解析 =====
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

// ===== 星期转换 =====
function getWeekday(dateStr) {
  const d = new Date(dateStr);
  const days = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  return days[d.getDay()];
}

// ===== 渲染卡片 =====
function renderFlights(list) {
  const container = document.getElementById("flightsContainer");
  container.innerHTML = "";

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
          <strong>${f.depTime}</strong>
          <div>${f.depAirport} (${f.depTerminal})</div>
        </div>
        <div class="arrow">→</div>
        <div class="time-block">
          <strong>${f.arrTime}</strong>
          <div>${f.arrAirport} (${f.arrTerminal})</div>
        </div>
      </div>
      <div class="prices">
        ${f.econPrice ? `<span class="price econ">经济舱 ¥${f.econPrice}</span>` : ""}
        ${f.bizPrice ? `<span class="price biz">商务舱 ¥${f.bizPrice}</span>` : ""}
        ${f.firstPrice ? `<span class="price first">头等舱 ¥${f.firstPrice}</span>` : ""}
      </div>
    `;
    container.appendChild(card);
  });
}

// ===== 筛选逻辑 =====
function applyFilters() {
  let list = [...flights];
  const dep = document.getElementById("depInput").value.trim();
  const arr = document.getElementById("arrInput").value.trim();
  const onlyDep = document.getElementById("onlyDep").checked;
  const airline = document.getElementById("airlineInput").value.trim();
  const timeFilter = document.getElementById("timeFilter").value;
  const sort = document.getElementById("priceSort").value;

  // 日期转星期
  const date = document.getElementById("dateInput").value;
  if (date) {
    const week = getWeekday(date);
    list = list.filter(f => f.weekdays.includes(week));
  }

  if (dep) list = list.filter(f => f.depAirport.includes(dep));
  if (arr && !onlyDep) list = list.filter(f => f.arrAirport.includes(arr));
  if (airline) list = list.filter(f => f.airline.includes(airline));

  if (timeFilter) {
    list = list.filter(f => {
      const [h,m] = f.depTime.split(":").map(Number);
      const minutes = h*60+m;
      if (timeFilter==="late-night") return minutes>=0 && minutes<360;
      if (timeFilter==="morning") return minutes>=360 && minutes<720;
      if (timeFilter==="noon") return minutes>=720 && minutes<780;
      if (timeFilter==="afternoon") return minutes>=780 && minutes<1080;
      if (timeFilter==="evening") return minutes>=1080 && minutes<1440;
    });
  }

  if (sort==="asc") list.sort((a,b)=> (a.econPrice||99999) - (b.econPrice||99999));
  if (sort==="desc") list.sort((a,b)=> (b.econPrice||0) - (a.econPrice||0));

  renderFlights(list);
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("dateInput").value = today;
  renderFlights(flights);

  document.querySelectorAll(".filters input, .filters select")
    .forEach(el => el.addEventListener("input", applyFilters));
});
