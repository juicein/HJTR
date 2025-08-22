/* ========= 工具与常量 ========= */
const weekMap = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const pad2 = n => (n<10? "0"+n : ""+n);

function parsePriceNum(txt){
  const m = (txt||"").toString().match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}
function toMinutes(t){ // "HH:MM" -> minutes
  const [h,m] = (t||"0:0").split(":").map(x=>parseInt(x,10));
  return h*60 + (m||0);
}
function fmtDuration(mins){
  const h = Math.floor(mins/60), m = mins%60;
  return `${h}小时${m}分`;
}

/* ========= 把原始字符串解析为对象 ========= */
function parseFlights(raw){
  const entries = raw.split("《航班结束》").map(s=>s.trim()).filter(Boolean);
  return entries.map(str=>{
    const flightNo    = str.match(/【(.*?)】/)?.[1] || "";
    const weekdaysStr = str.match(/«(.*?)»/)?.[1] || "";
    const weekdays    = weekdaysStr.split(",").map(s=>s.trim()).filter(Boolean);
    const aircraft    = str.match(/〔(.*?)〕/)?.[1] || "";
    const airline     = str.match(/『(.*?)』/)?.[1] || "";

    const depAirport  = str.match(/《(.*?)出发》/)?.[1] || "";
    const arrAirport  = str.match(/《(.*?)到达》/)?.[1] || "";

    const depTime     = str.match(/出发》{(.*?)}/)?.[1] || "";
    const arrTime     = str.match(/到达》{(.*?)}/)?.[1] || "";

    const depDay      = parseInt(str.match(/出发》.*#\+(\d+)#/)?.[1] || "0", 10);
    const arrDay      = parseInt(str.match(/到达》.*#\+(\d+)#/)?.[1] || "0", 10);

    const depTerminal = str.match(/出发》.*@([^@]+)@/)?.[1] || "";
    const arrTerminal = str.match(/到达》.*@([^@]+)@/)?.[1] || "";

    const ecoText     = str.match(/§(.*?)§/)?.[1] || "";
    const busText     = str.match(/θ(.*?)θ/)?.[1] || "";
    const firstText   = str.match(/△(.*?)△/)?.[1] || ""; // ✨ 新增：头等舱

    const economyNum  = parsePriceNum(ecoText);
    const businessNum = parsePriceNum(busText);
    const firstNum    = parsePriceNum(firstText);

    // ✨ 新增：飞行时长（分钟）
    const depAbs = depDay*24*60 + toMinutes(depTime);
    const arrAbs = arrDay*24*60 + toMinutes(arrTime);
    const durationMins = Math.max(0, arrAbs - depAbs); // 简化：数据保证到达不早于出发

    return {
      raw: str,
      flightNo, weekdays, aircraft, airline,
      depAirport, depTime, depDay, depTerminal,
      arrAirport, arrTime, arrDay, arrTerminal,
      ecoText, busText, firstText,
      economyNum, businessNum, firstNum,
      durationMins
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

// ✨ 统一“有效价格”：优先经济，其次商务，再次头等
function effectivePriceNum(f){
  if(!Number.isNaN(f.economyNum)) return f.economyNum;
  if(!Number.isNaN(f.businessNum)) return f.businessNum;
  if(!Number.isNaN(f.firstNum)) return f.firstNum;
  return Number.POSITIVE_INFINITY;
}

function applyFilters(){
  const from = document.getElementById("fromAirport").value.trim();
  const to   = document.getElementById("toAirport").value.trim();
  const timeRange = document.getElementById("timeFilter").value;
  const airline   = document.getElementById("airlineFilter").value;
  const sort   = document.getElementById("sortSelect").value;

  const selDate = new Date(datePicker.value);
  const weekday = weekMap[selDate.getDay()];

  let list = flights.filter(f=>{
    if(f.weekdays.length && !f.weekdays.includes(weekday)) return false;
    if(from && !f.depAirport.includes(from)) return false;
    if(to && !f.arrAirport.includes(to)) return false;
    if(airline && f.airline !== airline) return false;
    if(!withinTimeRange(f.depTime, timeRange)) return false;
    return true;
  });

  // ✨ 排序：默认出发时间；价格升/降
  if(sort === "priceAsc"){
    list.sort((a,b)=> effectivePriceNum(a) - effectivePriceNum(b));
  }else if(sort === "priceDesc"){
    list.sort((a,b)=> effectivePriceNum(b) - effectivePriceNum(a));
  }else{
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

  list.sort((a,b)=>a.depTime.localeCompare(b.depTime));
  renderFlights(list, selDate);
}

function resetFilters(){
  document.getElementById("fromAirport").value = "";
  document.getElementById("toAirport").value = "";
  document.getElementById("timeFilter").value = "";
  document.getElementById("airlineFilter").value = "";
  document.getElementById("sortSelect").value = "";
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

  list.forEach((f, idx)=>{
    const depDateStr = addDays(selectedDate, f.depDay);
    const arrDate    = new Date(selectedDate); arrDate.setDate(arrDate.getDate()+f.arrDay);
    const arrDateStr = `${arrDate.getFullYear()}-${pad2(arrDate.getMonth()+1)}-${pad2(arrDate.getDate())}`;

    const depPlus = f.depDay>0 ? "（次日）" : "";
    const arrPlus = f.arrDay>0 ? "（次日）" : "";

    const card = document.createElement("div");
    card.className = "flight-card";
    card.dataset.index = idx; // 用于弹窗找到对应数据
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
        <div class="aircraft">
          机型：${f.aircraft}
          <span class="duration"> · 飞行时长：${fmtDuration(f.durationMins)}</span>
        </div>
        <div class="price-group">
          ${f.ecoText ? `<div class="price-chip">经济舱：${f.ecoText}</div>` : ""}
          ${f.busText ? `<div class="price-chip bus">商务舱：${f.busText}</div>` : ""}
          ${f.firstText ? `<div class="price-chip first">头等舱：${f.firstText}</div>` : ""}
        </div>
      </div>
    `;

    // ✨ 点击卡片 -> 弹窗
    card.addEventListener("click", ()=>openModal(f));
    container.appendChild(card);
  });
}

/* ========= 弹窗逻辑 ========= */
const overlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalBody  = document.getElementById("modalBody");
const modalCloseBtn = document.getElementById("modalCloseBtn");
const copyRawBtn = document.getElementById("copyRawBtn");
const buyBtn     = document.getElementById("buyBtn");
const toast      = document.getElementById("toast");

let currentFlight = null;

function openModal(f){
  currentFlight = f;
  modalTitle.textContent = `${f.flightNo} · ${f.airline}`;

  const weekdays = (f.weekdays||[]).join(" / ") || "未标注";
  const priceLines = [
    f.ecoText   ? `经济舱：${f.ecoText}`   : null,
    f.busText   ? `商务舱：${f.busText}`   : null,
    f.firstText ? `头等舱：${f.firstText}` : null
  ].filter(Boolean).join("  |  ");

  modalBody.innerHTML = `
    <div class="grid">
      <div>
        <div><strong>出发</strong>：${f.depAirport}（${f.depTerminal || "-"}）</div>
        <div><strong>时间</strong>：${f.depTime}  ${f.depDay>0?"（次日）":""}</div>
      </div>
      <div>
        <div><strong>到达</strong>：${f.arrAirport}（${f.arrTerminal || "-"}）</div>
        <div><strong>时间</strong>：${f.arrTime}  ${f.arrDay>0?"（次日）":""}</div>
      </div>
    </div>
    <div><strong>机型</strong>：${f.aircraft}</div>
    <div><strong>运行日</strong>：${weekdays}</div>
    <div><strong>飞行时长</strong>：${fmtDuration(f.durationMins)}</div>
    <div><strong>票价</strong>：${priceLines || "—"}</div>
    <div>
      <strong>该航班源数据</strong>：
      <pre>${f.raw}</pre>
    </div>
  `;

  overlay.hidden = false;
}

function closeModal(){
  overlay.hidden = true;
  currentFlight = null;
}

modalCloseBtn.addEventListener("click", closeModal);
overlay.addEventListener("click", (e)=>{
  if(e.target === overlay) closeModal();
});
document.addEventListener("keydown", (e)=>{
  if(e.key === "Escape" && !overlay.hidden) closeModal();
});

// 复制原始数据
copyRawBtn.addEventListener("click", async ()=>{
  if(!currentFlight) return;
  try{
    await navigator.clipboard.writeText(currentFlight.raw);
    showToast("源数据已复制");
  }catch(e){
    showToast("复制失败，请手动选择复制");
  }
});

// 购买按钮 -> 成功提示
buyBtn.addEventListener("click", ()=>{
  showToast("购买成功 ✔");
});

let toastTimer = null;
function showToast(text){
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ toast.hidden = true; }, 1600);
}

/* ========= 事件绑定 ========= */
document.getElementById("searchBtn").addEventListener("click", applyFilters);
document.getElementById("onlyThisAirportBtn").addEventListener("click", onlyThisAirport);
document.getElementById("resetBtn").addEventListener("click", resetFilters);
document.getElementById("datePicker").addEventListener("change", applyFilters);

// 首次渲染
applyFilters();
