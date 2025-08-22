// ===== 解析函数 =====
function parseFlights(data) {
  const regex = /【(.*?)】〈〉«(.*?)»〔(.*?)〕『(.*?)』《(.*?)出发》{(.*?)}\#\+\d\#@.*?@《(.*?)到达》{(.*?)}\#\+\d\#@.*?@ (.*?)《航班结束》/g;
  let match, results = [];
  while ((match = regex.exec(data)) !== null) {
    const [_, flightNo, days, aircraft, airline, from, depTime, to, arrTime, priceStr] = match;
    const prices = parsePrice(priceStr);
    results.push({
      flightNo, days, aircraft, airline,
      from, depTime, to, arrTime,
      ...prices
    });
  }
  return results;
}

function parsePrice(str){
  const eco  = (str.match(/§(.*?)元§/) || [])[1];
  const bus  = (str.match(/θ(.*?)元θ/) || [])[1];
  const first= (str.match(/△(.*?)元△/) || [])[1];
  return {
    ecoText: eco ? eco+"元" : "",
    busText: bus ? bus+"元" : "",
    firstText: first ? first+"元" : ""
  };
}

// ===== 渲染 =====
function renderFlights(list) {
  const container = document.getElementById("results");
  container.innerHTML = "";
  list.forEach(f=>{
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-head">
        <span>${f.flightNo}</span>
        <span>${f.airline}</span>
      </div>
      <div class="card-body">
        <div class="airport">
          <h3>${f.from}</h3>
          <div class="time">${f.depTime}</div>
        </div>
        <div class="airport">
          ➡
        </div>
        <div class="airport">
          <h3>${f.to}</h3>
          <div class="time">${f.arrTime}</div>
        </div>
      </div>
      <div class="card-foot">
        <div class="aircraft">机型：${f.aircraft}</div>
        <div class="price-group">
          ${f.ecoText ? `<div class="price-chip">经济舱 ${f.ecoText}</div>` : ""}
          ${f.busText ? `<div class="price-chip bus">商务舱 ${f.busText}</div>` : ""}
          ${f.firstText ? `<div class="price-chip first">头等舱 ${f.firstText}</div>` : ""}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// ===== 筛选逻辑 =====
function applyFilters(){
  const fromVal = document.getElementById("fromAirport").value.trim();
  const toVal = document.getElementById("toAirport").value.trim();
  const classVal = document.getElementById("classFilter").value;
  const sortVal = document.getElementById("priceSort").value;

  let filtered = flights.slice();

  if (fromVal) filtered = filtered.filter(f=>f.from.includes(fromVal));
  if (toVal) filtered = filtered.filter(f=>f.to.includes(toVal));

  if (classVal) {
    filtered = filtered.filter(f=>{
      if(classVal==="eco") return f.ecoText;
      if(classVal==="bus") return f.busText;
      if(classVal==="first") return f.firstText;
      return true;
    });
  }

  if (sortVal) {
    filtered.sort((a,b)=>{
      const aPrice = parseInt((a.ecoText||a.busText||a.firstText));
      const bPrice = parseInt((b.ecoText||b.busText||b.firstText));
      return sortVal==="asc" ? aPrice-bPrice : bPrice-aPrice;
    });
  }

  renderFlights(filtered);
}

// ===== 初始化 =====
const flights = parseFlights(flightsData);
renderFlights(flights);

document.getElementById("searchBtn").addEventListener("click", applyFilters);
document.getElementById("departOnlyBtn").addEventListener("click", ()=>{
  const fromVal = document.getElementById("fromAirport").value.trim();
  let filtered = flights;
  if(fromVal) filtered = flights.filter(f=>f.from.includes(fromVal) || f.to.includes(fromVal));
  renderFlights(filtered);
});
