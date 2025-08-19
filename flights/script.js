// 星期映射
const weekMap = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

// 初始化日期选择（今天 - 90天）
const today = new Date();
const maxDate = new Date();
maxDate.setDate(today.getDate() + 90);
const datePicker = document.getElementById("datePicker");
datePicker.min = today.toISOString().split("T")[0];
datePicker.max = maxDate.toISOString().split("T")[0];
datePicker.value = today.toISOString().split("T")[0];

// 拆分航班字符串
const flightData = flights.split("《航班结束》")
  .map(f=>f.trim())
  .filter(f=>f)
  .map(parseFlight);

// 解析函数
function parseFlight(str){
  const id = str.match(/【(.*?)】/)[1];
  const week = str.match(/«(.*?)»/)[1].split(",");
  const plane = str.match(/〔(.*?)〕/)[1];
  const airline = str.match(/『(.*?)』/)[1];
  const from = str.match(/《(.*?)出发》/)[1];
  const to = str.match(/《(.*?)到达》/)[1];
  const dep = str.match(/出发》{(.*?)}/)[1];
  const depDay = parseInt(str.match(/出发》.*#\+(\d+)#/)[1]);
  const depTerminal = str.match(/出发》.*@(.*?)@/)[1];
  const arr = str.match(/到达》{(.*?)}/)[1];
  const arrDay = parseInt(str.match(/到达》.*#\+(\d+)#/)[1]);
  const arrTerminal = str.match(/到达》.*@(.*?)@/)[1];
  const economy = str.match(/§(.*?)元§/)[1];
  const business = str.match(/θ(.*?)元θ/)[1];

  return {id,week,plane,airline,from,to,dep,depDay,depTerminal,arr,arrDay,arrTerminal,economy:parseInt(economy),business:parseInt(business)};
}

// 初始化航空公司下拉
const airlines = [...new Set(flightData.map(f=>f.airline))];
const airlineFilter = document.getElementById("airlineFilter");
airlines.forEach(a=>{
  let opt=document.createElement("option");
  opt.value=a; opt.innerText=a;
  airlineFilter.appendChild(opt);
});

// 获取机场列表
const airports = [...new Set(flightData.flatMap(f=>[f.from,f.to]))];

// 模糊匹配
function suggestAirport(keyword){
  if(!keyword) return;
  const matches = airports.filter(a=>a.includes(keyword));
  if(matches.length){
    // 打开弹窗
    const list = document.getElementById("airportList");
    list.innerHTML="";
    matches.forEach(a=>{
      let li=document.createElement("li");
      li.innerText=a;
      li.onclick=()=>{document.activeElement.value=a; closeModal();};
      list.appendChild(li);
    });
    openModal();
  }
}

// 弹窗
function openModal(){document.getElementById("airportModal").style.display="block";}
function closeModal(){document.getElementById("airportModal").style.display="none";}

// 搜索逻辑
function searchFlights(){
  const from = document.getElementById("fromAirport").value.trim();
  const to = document.getElementById("toAirport").value.trim();
  const timeRange = document.getElementById("timeFilter").value;
  const airline = airlineFilter.value;
  const sort = document.getElementById("priceSort").value;
  const date = document.getElementById("datePicker").value;
  const week = weekMap[new Date(date).getDay()];

  let result = flightData.filter(f=>{
    if(!f.week.includes(week)) return false;
    if(from && !f.from.includes(from)) return false;
    if(to && !f.to.includes(to)) return false;
    if(airline && f.airline!==airline) return false;
    if(timeRange){
      const [s,e]=timeRange.split("-").map(Number);
      const h=parseInt(f.dep.split(":")[0]);
      if(h<s || h>=e) return false;
    }
    return true;
  });

  if(sort==="eco") result.sort((a,b)=>a.economy-b.economy);
  if(sort==="bus") result.sort((a,b)=>a.business-b.business);

  renderFlights(result);
}

// 只看某机场
function showSingleAirport(){
  const from = document.getElementById("fromAirport").value.trim();
  if(!from) return alert("请输入一个机场名称");
  let result = flightData.filter(f=>(f.from.includes(from)||f.to.includes(from)));
  renderFlights(result);
}

// 渲染卡片（新航风格）
function renderFlights(list){
  const container=document.getElementById("flightsContainer");
  container.innerHTML="";
  if(list.length===0){
    container.innerHTML="<p>没有符合条件的航班</p>";
    return;
  }
  list.forEach(f=>{
    let card=document.createElement("div");
    card.className="card";
    card.innerHTML=`
      <div class="card-header">
        <span class="flight-id">${f.id}</span>
        <span class="airline">${f.airline}</span>
      </div>
      <div class="card-body">
        <div class="route">
          <div class="from">
            <strong>${f.from}</strong><br>
            ${f.dep} ${f.depDay? "(次日)":""}<br>
            <small>${f.depTerminal}</small>
          </div>
          <div class="arrow">→</div>
          <div class="to">
            <strong>${f.to}</strong><br>
            ${f.arr} ${f.arrDay? "(次日)":""}<br>
            <small>${f.arrTerminal}</small>
          </div>
        </div>
        <div class="info">
          <span>机型：${f.plane}</span>
        </div>
        <div class="price">
          <span class="eco">经济舱 ¥${f.economy}</span>
          <span class="bus">商务舱 ¥${f.business}</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// 初始加载
searchFlights();
