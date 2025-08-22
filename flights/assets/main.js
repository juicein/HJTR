const weekMap = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const pad2 = n => n<10 ? "0"+n : ""+n;

function parsePrice(txt){
  const m = txt?.match(/\d+/);
  return m ? parseInt(m[0],10) : null;
}

function parseFlights(raw){
  const entries = raw.split("《航班结束》").map(s=>s.trim()).filter(Boolean);
  return entries.map(str=>{
    return {
      flightNo: str.match(/【(.*?)】/)?.[1] || "",
      weekdays: (str.match(/«(.*?)»/)?.[1] || "").split(",").filter(Boolean),
      aircraft: str.match(/〔(.*?)〕/)?.[1] || "",
      airline: str.match(/『(.*?)』/)?.[1] || "",
      depAirport: str.match(/《(.*?)出发》/)?.[1] || "",
      arrAirport: str.match(/@《(.*?)到达》/)?.[1] || "",
      depTime: str.match(/出发》{(.*?)}/)?.[1] || "",
      arrTime: str.match(/到达》{(.*?)}/)?.[1] || "",
      depDay: parseInt(str.match(/出发》.*#\+(\d+)#/)?.[1] || "0",10),
      arrDay: parseInt(str.match(/到达》.*#\+(\d+)#/)?.[1] || "0",10),
      depTerminal: str.match(/出发》.*@([^@]+)@/)?.[1] || "",
      arrTerminal: str.match(/到达》.*@([^@]+)@/)?.[1] || "",
      eco: str.match(/§(.*?)§/)?.[1] || "",
      biz: str.match(/θ(.*?)θ/)?.[1] || "",
      first: str.match(/△(.*?)△/)?.[1] || "",
      ecoNum: parsePrice(str.match(/§(.*?)§/)?.[1]),
      bizNum: parsePrice(str.match(/θ(.*?)θ/)?.[1]),
      firstNum: parsePrice(str.match(/△(.*?)△/)?.[1])
    };
  });
}
const flights = parseFlights(flightsData);

const datePicker = document.getElementById("datePicker");
const today = new Date();
datePicker.value = today.toISOString().split("T")[0];
document.getElementById("todayText").textContent =
  `今天：${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;

function filterFlights(){
  const from = document.getElementById("fromAirport").value.trim();
  const to = document.getElementById("toAirport").value.trim();
  const timeRange = document.getElementById("timeFilter").value;
  const airline = document.getElementById("airlineFilter").value;
  const sort = document.getElementById("sortSelect").value;

  const selDate = new Date(datePicker.value);
  const weekday = weekMap[selDate.getDay()];

  let list = flights.filter(f=>{
    if(f.weekdays.length && !f.weekdays.includes(weekday)) return false;
    if(from && !f.depAirport.includes(from)) return false;
    if(to && !f.arrAirport.includes(to)) return false;
    if(airline && f.airline!==airline) return false;
    if(timeRange){
      const [s,e] = timeRange.split("-").map(Number);
      const h = parseInt(f.depTime.split(":")[0],10);
      if(h<s || h>=e) return false;
    }
    return true;
  });

  if(sort==="ecoAsc") list.sort((a,b)=>(a.ecoNum||1e12)-(b.ecoNum||1e12));
  if(sort==="ecoDesc") list.sort((a,b)=>(b.ecoNum||0)-(a.ecoNum||0));
  else if(!sort) list.sort((a,b)=>a.depTime.localeCompare(b.depTime));

  renderFlights(list, selDate);
}

function renderFlights(list, selDate){
  const c = document.getElementById("flightsContainer");
  const summary = document.getElementById("summaryBar");
  c.innerHTML = "";
  summary.textContent = `共 ${list.length} 班`;

  list.forEach(f=>{
    const depPlus = f.depDay>0?"（次日）":"";
    const arrPlus = f.arrDay>0?"（次日）":"";

    const card = document.createElement("div");
    card.className="flight-card";
    card.innerHTML=`
      <div class="card-head">
        <div class="flight-no">${f.flightNo}</div>
        <div class="badges"><span class="badge">${f.airline}</span><span class="badge">${f.aircraft}</span></div>
      </div>
      <div class="card-body">
        <div class="port">
          <div class="city">${f.depAirport}</div>
          <div class="time">${f.depTime}${depPlus}</div>
          <div class="terminal">${f.depTerminal}</div>
        </div>
        <div class="arrow">→</div>
        <div class="port">
          <div class="city">${f.arrAirport}</div>
          <div class="time">${f.arrTime}${arrPlus}</div>
          <div class="terminal">${f.arrTerminal}</div>
        </div>
      </div>
      <div class="card-foot">
        <div class="aircraft">机型：${f.aircraft}</div>
        <div class="price-group">
          ${f.eco?`<div class="price-chip econ">经济舱 ¥${f.eco}</div>`:""}
          ${f.biz?`<div class="price-chip biz">商务舱 ¥${f.biz}</div>`:""}
          ${f.first?`<div class="price-chip first">头等舱 ¥${f.first}</div>`:""}
        </div>
      </div>
    `;
    c.appendChild(card);
  });
}

document.getElementById("searchBtn").onclick = filterFlights;
document.getElementById("resetBtn").onclick = ()=>{document.querySelectorAll(".filters input,.filters select").forEach(el=>{if(el.type!=="date")el.value="";});filterFlights()};
document.getElementById("onlyThisAirportBtn").onclick = ()=>{
  const key=document.getElementById("fromAirport").value.trim();
  if(!key) return;
  const selDate=new Date(datePicker.value);const weekday=weekMap[selDate.getDay()];
  const list=flights.filter(f=>(f.depAirport.includes(key)||f.arrAirport.includes(key)) && f.weekdays.includes(weekday));
  renderFlights(list,selDate);
};
datePicker.onchange=filterFlights;

filterFlights();
