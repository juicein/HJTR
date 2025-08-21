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
    const econPrice = entry.match(/§(.*?)元§/)?.[1] || "";
    const bizPrice = entry.match(/θ(.*?)元θ/)?.[1] || "";
    const firstPrice = entry.match(/△(.*?)元△/)?.[1] || "";
    return {
      flightNo, weekdays, aircraft, airline,
      depAirport, depTime, depTerminal,
      arrAirport, arrTime, arrTerminal,
      econPrice, bizPrice, firstPrice
    };
  });
}

function renderFlights(flights) {
  const container = document.getElementById("flightsContainer");
  container.innerHTML = "";
  flights.forEach(f => {
    const card = document.createElement("div");
    card.className = "flight-card";
    card.innerHTML = `
      <div class="flight-header">
        <span>${f.flightNo} | ${f.airline}</span>
        <span>${f.aircraft}</span>
      </div>
      <div class="flight-body">
        <div><strong>${f.depAirport}</strong> ${f.depTime} (${f.depTerminal})</div>
        <div>→</div>
        <div><strong>${f.arrAirport}</strong> ${f.arrTime} (${f.arrTerminal})</div>
        <div>运行日: ${f.weekdays}</div>
      </div>
      <div class="prices">
        ${f.econPrice ? `<span class="price-tag economy">经济舱 ¥${f.econPrice}</span>` : ""}
        ${f.bizPrice ? `<span class="price-tag business">商务舱 ¥${f.bizPrice}</span>` : ""}
        ${f.firstPrice ? `<span class="price-tag first">头等舱 ¥${f.firstPrice}</span>` : ""}
      </div>
    `;
    container.appendChild(card);
  });
}

// ========== 交互逻辑 ==========
const flights = parseFlights(flightsData);
renderFlights(flights);

document.querySelector(".toggle-filters").addEventListener("click", () => {
  document.querySelector(".filters").classList.toggle("open");
});

document.getElementById("searchBtn").addEventListener("click", () => {
  const dep = document.getElementById("depAirportInput").value.trim();
  const arr = document.getElementById("arrAirportInput").value.trim();
  const airline = document.getElementById("airlineInput").value.trim();
  const priceSort = document.getElementById("priceSort").value;
  const timeFilter = document.getElementById("timeFilter").value;
  const date = document.getElementById("dateInput").value;

  let results = [...flights];

  // 日期 → 星期几
  let weekday = "";
  if (date) {
    const d = new Date(date);
    const days = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
    weekday = days[d.getDay()];
    results = results.filter(f => f.weekdays.includes(weekday));
  }

  if (dep) results = results.filter(f => f.depAirport.includes(dep));
  if (arr) results = results.filter(f => f.arrAirport.includes(arr));
  if (airline) results = results.filter(f => f.airline.includes(airline));

  if (timeFilter) {
    results = results.filter(f => {
      const [h] = f.depTime.split(":").map(Number);
      if (timeFilter === "early") return h < 6;
      if (timeFilter === "morning") return h >= 6 && h < 12;
      if (timeFilter === "noon") return h >= 12 && h < 14;
      if (timeFilter === "afternoon") return h >= 14 && h < 18;
      if (timeFilter === "evening") return h >= 18;
    });
  }

  if (priceSort) {
    results.sort((a,b) => {
      const pa = parseInt(a.econPrice || a.bizPrice || a.firstPrice || 0);
      const pb = parseInt(b.econPrice || b.bizPrice || b.firstPrice || 0);
      return priceSort === "asc" ? pa - pb : pb - pa;
    });
  }

  renderFlights(results);
});
