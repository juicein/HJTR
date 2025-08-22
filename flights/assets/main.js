// 将星期映射到 JS
const weekMap = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function pad2(n){ return n<10 ? "0"+n : ""+n; }
function addDays(date, d){ let nd=new Date(date); nd.setDate(nd.getDate()+d); return `${nd.getFullYear()}-${pad2(nd.getMonth()+1)}-${pad2(nd.getDate())}`; }

// 正则解析原始字符串
function parseFlights(raw){
  const regex = /【(.*?)】〈〉«(.*?)»〔(.*?)〕『(.*?)』《(.*?)出发》{(.*?)}\#\+(\d+)#@([^@]+)@《(.*?)到达》{(.*?)}\#\+(\d+)#@([^@]+)@ (§.*?§)(θ.*?θ)?(△.*?△)?《航班结束》/g;
  let flights=[], m;
  while((m=regex.exec(raw))!==null){
    flights.push({
      flightNo:m[1],
      days:m[2].split(","),
      aircraft:m[3],
      airline:m[4],
      depAirport:m[5],
      depTime:m[6],
      depDay:parseInt(m[7]),
      depTerminal:m[8],
      arrAirport:m[9],
      arrTime:m[10],
      arrDay:parseInt(m[11]),
      arrTerminal:m[12],
      ecoText:m[13]||"",
      busText:m[14]||"",
      firstText:m[15]||""
    });
  }
  return flights;
}

// 计算时长
function calcDuration(depDateStr, depTime, arrDateStr, arrTime){
  const dep=new Date(`${depDateStr}T${depTime}:00`);
  const arr=new Date(`${arrDateStr}T${arrTime}:00`);
  let diff=(arr-dep)/60000;
  if(diff<0) return "";
  return `${Math.floor(diff/60)}小时${diff%60}分`;
}

const allFlights=parseFlights(flightsData);

// 渲染
function renderFlights(list, selectedDate){
  const container=document.getElementById("flightsContainer");
  const summary=document.getElementById("summaryBar");
  container.innerHTML="";

  const weekday=weekMap[selectedDate.getDay()];
  summary.textContent=`共 ${list.length} 班 · 日期：${selectedDate.getFullYear()}-${pad2(selectedDate.getMonth()+1)}-${pad2(selectedDate.getDate())}（${weekday}）`;

  if(list.length===0){
    container.innerHTML=`<div class="flight-card"><div class="airline">没有符合条件的航班</div></div>`;
    return;
  }

  list.forEach(f=>{
    const depDateStr=addDays(selectedDate,f.depDay);
    const arrDateStr=addDays(selectedDate,f.arrDay);
    const depPlus=f.depDay>0?"（次日）":"";
    const arrPlus=f.arrDay>0?"（次日）":"";
    const duration=calcDuration(depDateStr,f.depTime,arrDateStr,f.arrTime);

    const card=document.createElement("div");
    card.className="flight-card";
    card.innerHTML=`
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
          <div class="terminal">航站楼：${f.depTerminal}</div>
          <div class="date">起飞日期：${depDateStr}</div>
        </div>
        <div class="arrow">→</div>
        <div class="port">
          <div class="city">${f.arrAirport}</div>
          <div class="time">${f.arrTime}${arrPlus}</div>
          <div class="terminal">航站楼：${f.arrTerminal}</div>
          <div class="date">到达日期：${arrDateStr}</div>
        </div>
      </div>
      <div class="card-foot">
        <div class="aircraft">机型：${f.aircraft} ｜ 飞行时长：${duration||"—"}</div>
        <div class="price-group">
          <div class="price-chip">经济舱：${f.ecoText||"—"}</div>
          ${f.busText?`<div class="price-chip bus">商务舱：${f.busText}</div>`:""}
          ${f.firstText?`<div class="price-chip first">头等舱：${f.firstText}</div>`:""}
        </div>
      </div>`;
    container.appendChild(card);
  });
}

// 初始化
window.onload=function(){
  const dateInput=document.getElementById("dateInput");
  const today=new Date();
  dateInput.value=`${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;
  renderFlights(allFlights,today);
};
