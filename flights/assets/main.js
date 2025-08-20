/* ========= 工具与常量 ========= */
const weekMap = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const pad2 = n => (n<10? "0"+n : ""+n);

function parsePriceNum(txt){
  // 传入形如 "1280元" 或 "1280元§" 的片段，取数字
  const m = (txt||"").toString().match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

/* ========= 把原始字符串解析为对象 ========= */
function parseFlights(raw){
  // 以 “《航班结束》” 作为条目分割
  const entries = raw.split("《航班结束》").map(s=>s.trim()).filter(Boolean);
  return entries.map(str=>{
    const flightNo    = str.match(/【(.*?)】/)?.[1] || "";
    const weekdaysStr = str.match(/«(.*?)»/)?.[1] || ""; // "MON,TUE,..." 
    const weekdays    = weekdaysStr.split(",").map(s=>s.trim()).filter(Boolean);
    const aircraft    = str.match(/〔(.*?)〕/)?.[1] || "";
    const airline     = str.match(/『(.*?)』/)?.[1] || "";

    const depAirport  = str.match(/《(.*?)出发》/)?.[1] || "";
    const arrAirport  = str.match(/《(.*?)到达》/)?.[1] || "";

    const depTime     = str.match(/出发》{(.*?)}/)?.[1] || "";    // 14:00
    const arrTime     = str.match(/到达》{(.*?)}/)?.[1] || "";    // 19:02

    const depDay      = parseInt(str.match(/出发》.*#\+(\d+)#/)?.[1] || "0", 10);
    const arrDay      = parseInt(str.match(/到达》.*#\+(\d+)#/)?.[1] || "0", 10);

    // 兼容 @T1@ / @T1航站楼@ 两种
    const depTerminal = str.match(/出发》.*@([^@]+)@/)?.[1] || "";
    const arrTerminal = str.match(/到达》.*@([^@]+)@/)?.[1] || "";

    const ecoText     = str.match(/§(.*?)§/)?.[1] || "";      // "1650元"
    const busText     = str.match(/θ(.*?)θ/)?.[1] || "";      // "4200元" or ""

    const economyNum  = parsePriceNum(ecoText);
    const businessNum = parsePriceNum(busText);

    return {
      raw: str,
      flightNo, weekdays, aircraft, airline,
      depAirport, depTime, depDay, depTerminal,
      arrAirport, arrTime, arrDay, arrTerminal,
      ecoText, busText, economyNum, businessNum
    };
  });
}

const flights = parseFlights(flightsData);

/* ========= 日期：默认今天，限制+90天 ========= */
const today = new Date();
const maxDate = new Date(); maxDate.setDate(today.getDate()+90);

const datePicker = document.getElementById("datePicker");
datePicker.min = today.toISOString().split("T")[0];
datePicker.max = maxDate.toISOString().split("T")[0];
datePicker.value = today.toISOString().split("T")[0];

document.getElementById("todayText").textContent =
  `今天：${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;

/* ========= 机场与航司下拉 ========= */
function initAirportsAndAirlines(){
  const setAirports = new Set();
  const setAirlines = new Set();
  flights.forEach(f=>{
    setAirports.add(f.depAirport);
    setAirports.add(f.arrAirport);
    if(f.airline) setAirlines.add(f.airline);
  });

  const airportList = document.getElementById("airportList");
  airportList.innerHTML = "";
  [...setAirports].sort().forEach(name=>{
    const opt = document.createElement("option");
    opt.value = name;
    airportList.appendChild(opt);
  });

  const airlineFilter = document.getElementById("airlineFilter");
  airlineFilter.innerHTML = `<option value="">不限</option>`;
  [...setAirlines].sort().forEach(name=>{
    const opt = document.createElement("option");
    opt.value = name; opt.textContent = name;
    airlineFilter.appendChild(opt);
  });
}
initAirportsAndAirlines();

/* ========= 过滤与排序 ========= */
function withinTimeRange(depTime, range){
  if(!range) return true;
  const [s,e] = range.split("-").map(Number);
  const h = parseInt(depTime.split(":")[0], 10);
  return (h>=s && h<e);
}

function applyFilters(){
  const from = document.getElementById("fromAirport").value.trim();
  const to   = document.getElementById("toAirport").value.trim();
  const timeRange = document.getElementById("timeFilter").value;
  const airline   = document.getElementById("airlineFilter").value;
  const ecoMin = parseInt(document.getElementById("ecoMin").value || "", 10);
  const ecoMax = parseInt(document.getElementById("ecoMax").value || "", 10);
  const busMin = parseInt(document.getElementById("busMin").value || "", 10);
  const busMax = parseInt(document.getElementById("busMax").value || "", 10);
  const sort   = document.getElementById("sortSelect").value;

  // 日期→星期几（英文）→ 与 weekdays 匹配
  const selDate = new Date(datePicker.value);
  const weekday = weekMap[selDate.getDay()]; // SUN..SAT

  let list = flights.filter(f=>{
    if(f.weekdays.length && !f.weekdays.includes(weekday)) return false;

    if(from && !f.depAirport.includes(from)) return false;
    if(to && !f.arrAirport.includes(to)) return false;

    if(airline && f.airline !== airline) return false;
    if(!withinTimeRange(f.depTime, timeRange)) return false;

    // 价格区间（可选）
    if(!Number.isNaN(ecoMin) && !(f.economyNum >= ecoMin)) return false;
    if(!Number.isNaN(ecoMax) && !(f.economyNum <= ecoMax)) return false;
    if(!Number.isNaN(busMin) && !(f.businessNum >= busMin)) return false;
    if(!Number.isNaN(busMax) && !(f.businessNum <= busMax)) return false;

    return true;
  });

  // 排序
  if(sort === "ecoAsc"){
    list.sort((a,b)=>(a.economyNum||1e12)-(b.economyNum||1e12));
  }else if(sort === "busAsc"){
    list.sort((a,b)=>(a.businessNum||1e12)-(b.businessNum||1e12));
  }else{
    // 默认按出发时间
    list.sort((a,b)=>{
      const ta = a.depTime.padStart(5,"0");
      const tb = b.depTime.padStart(5,"0");
      return ta.localeCompare(tb);
    });
  }

  renderFlights(list, selDate);
}

function onlyThisAirport(){
  const key = document.getElementById("fromAirport").value.trim();
  if(!key){ alert("请先在“出发机场”输入一个机场名称"); return; }

  const selDate = new Date(datePicker.value);
  const weekday = weekMap[selDate.getDay()];

  const timeRange = document.getElementById("timeFilter").value;
  const airline   = document.getElementById("airlineFilter").value;

  let list = flights.filter(f=>{
    if(f.weekdays.length && !f.weekdays.includes(weekday)) return false;
    if(!(f.depAirport.includes(key) || f.arrAirport.includes(key))) return false;
    if(airline && f.airline !== airline) return false;
    if(!withinTimeRange(f.depTime, timeRange)) return false;
    return true;
  });

  // 默认时间排序
  list.sort((a,b)=>a.depTime.localeCompare(b.depTime));
  renderFlights(list, selDate);
}

function resetFilters(){
  document.getElementById("fromAirport").value = "";
  document.getElementById("toAirport").value = "";
  document.getElementById("timeFilter").value = "";
  document.getElementById("airlineFilter").value = "";
  document.getElementById("ecoMin").value = "";
  document.getElementById("ecoMax").value = "";
  document.getElementById("busMin").value = "";
  document.getElementById("busMax").value = "";
  document.getElementById("sortSelect").value = "";
  // 日期保持不变（默认今天）
  applyFilters();
}

/* ========= 卡片渲染 ========= */
function addDays(baseDate, offset){
  const d = new Date(baseDate);
  d.setDate(d.getDate() + (offset||0));
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function renderFlights(list, selectedDate){
  const container = document.getElementById("flightsContainer");
  const summary   = document.getElementById("summaryBar");
  container.innerHTML = "";

  const weekday = weekMap[selectedDate.getDay()];
  summary.textContent = `共 ${list.length} 班 · 日期：${selectedDate.getFullYear()}-${pad2(selectedDate.getMonth()+1)}-${pad2(selectedDate.getDate())}（${weekday}）`;

  if(list.length === 0){
    container.innerHTML = `<div class="flight-card"><div class="airline">没有符合条件的航班</div></div>`;
    return;
  }

  list.forEach(f=>{
    const depDateStr = addDays(selectedDate, f.depDay);
    const arrDate    = new Date(selectedDate); arrDate.setDate(arrDate.getDate()+f.arrDay);
    const arrDateStr = `${arrDate.getFullYear()}-${pad2(arrDate.getMonth()+1)}-${pad2(arrDate.getDate())}`;

    const depPlus = f.depDay>0 ? "（次日）" : "";
    const arrPlus = f.arrDay>0 ? "（次日）" : "";

    const card = document.createElement("div");
    card.className = "flight-card";
    card.innerHTML = `
      <div class="card-head">
        <div class="flight-no">${f.flightNo}</div>
        <div class="badges">
          <span class="badge">${f.airline}</span>
          <span class="badge">${f.aircraft}</span>
        </div>
      </div>

      <div class="card-body">
        <div class="port">
          <div class="city">${f.depAirport}</div>
          <div class="time">${f.depTime}${depPlus}</div>
          <div class="terminal">航站楼：${f.depTerminal || "-"}</div>
          <div class="date">起飞日期：${depDateStr}</div>
        </div>

        <div class="arrow">→</div>

        <div class="port">
          <div class="city">${f.arrAirport}</div>
          <div class="time">${f.arrTime}${arrPlus}</div>
          <div class="terminal">航站楼：${f.arrTerminal || "-"}</div>
          <div class="date">到达日期：${arrDateStr}</div>
        </div>
      </div>

      <div class="card-foot">
        <div class="aircraft">机型：${f.aircraft}</div>
        <div class="price-group">
          <div class="price-chip">经济舱：${f.ecoText || "—"}</div>
          <div class="price-chip bus">商务舱：${f.busText || "—"}</div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

/* ========= 事件绑定 ========= */
document.getElementById("searchBtn").addEventListener("click", applyFilters);
document.getElementById("onlyThisAirportBtn").addEventListener("click", onlyThisAirport);
document.getElementById("resetBtn").addEventListener("click", resetFilters);
document.getElementById("datePicker").addEventListener("change", applyFilters);

// 首次渲染（默认今天 → 星期过滤；无其他筛选即展示“当日全部航班”）
applyFilters();
