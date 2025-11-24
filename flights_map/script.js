/*
  flight/script.js
  说明：
    - 此文件负责：
      1) 拉取 /data/flight_data.txt（你的原始数据库文本）
      2) 解析每一行成对象（解析你提供的那种模版）
      3) 在地图上绘制“正在飞行”的航班（虚线航线 + 飞机位置）
      4) 提供侧栏列表显示每个航班状态与链接到新闻详情（/news-detail.html?id=DF1728）
    - 注意：如果你的 Pages 路径与我假设不同，请调整 DATA_PATH 变量。
*/

const DATA_PATH = '/data/flight_data.txt'; // 相对仓库的 data 文件夹
const canvas = document.getElementById('mapCanvas');
const svg = document.getElementById('worldSvg');
const flightListEl = document.getElementById('flightList');
const mapTitle = document.getElementById('mapTitle');
const mapStatus = document.getElementById('mapStatus');

let DPR = window.devicePixelRatio || 1;

// --- 机场坐标映射表（示例: 以 SVG viewBox 1200x600 为坐标系）
// 请把你的机场名称替换到这里，并设置合理的 x,y 值（0..1200, 0..600）
const airportCoords = {
  // 示例：你给的两个机场
  "拜科努尔": {x: 200, y: 180},
  "千里马":   {x: 420, y: 220},
  // 常见示例，可按需添加
  "北京": {x: 780, y: 150},
  "上海": {x: 840, y: 210},
  "首尔": {x: 930, y: 120}
};

// ---------- 辅助函数 ----------
function $(sel){return document.querySelector(sel)}
function parseFlightLine(line){
  // 目标返回对象：
  // {raw, flightNo, aircraft, airline, days: ['MON',...], dep:{airport, time, dayOffset}, arr:{airport,time,dayOffset}, priceEco, priceBiz, id}
  const raw = line.trim();
  if(!raw) return null;
  try{
    const flightNo = (raw.match(/【([^】]+)】/) || [,''])[1] || '';
    const aircraft = (raw.match(/〔([^〕]+)〕/) || [,''])[1] || '';
    const airline = (raw.match(/『([^』]+)』/) || [,''])[1] || '';
    const days = (raw.match(/«([^»]+)»/) || [,''])[1] ? (raw.match(/«([^»]+)»/)[1].split(',').map(s=>s.trim())) : [];
    // departure and arrival parts: pattern 《...》{hh:mm}#+n#@T...
    const segRegex = /《([^》]+?)》\{([0-2]?\d:[0-5]\d)\}#\+?([0-9]+)#@([^@]*)@/g;
    let segs = [], m;
    while((m = segRegex.exec(raw)) !== null){
      // m[1]: like "拜科努尔出发" or "千里马到达"
      const placeText = m[1];
      const time = m[2];
      const offset = parseInt(m[3] || '0',10) || 0;
      // try to split airport name from trailing "出发" or "到达"
      const airport = placeText.replace(/出发|到达|到达站|出发站/g, '').trim();
      segs.push({airport, time, dayOffset: offset});
    }
    // we expect segs[0] is dep, segs[1] arr
    const dep = segs[0] || null;
    const arr = segs[1] || null;

    const priceEco = (raw.match(/§([^§]+)§/) || [,''])[1] || '';
    const priceBiz = (raw.match(/θ([^θ]+)θ/) || [,''])[1] || '';
    const special = (raw.match(/△([^△]+)△/) || [,''])[1] || '';
    const id = (raw.match(/<([^>]+)>/) || [,''])[1] || '';

    return {raw, flightNo, aircraft, airline, days, dep, arr, priceEco, priceBiz, special, id};
  }catch(e){
    console.error('parse error', e, line);
    return null;
  }
}

// map weekday tokens MON->1 ... SUN->0 (js getDay())
const weekdayMap = {SUN:0, MON:1, TUE:2, WED:3, THU:4, FRI:5, SAT:6};

function todayWeekdayNum(d = new Date()){
  return d.getDay();
}

// 将 hh:mm 变成 Date（以 baseDate 的年月日）
function makeDateTime(baseDate, hhmm, addDays=0){
  const [hh, mm] = hhmm.split(':').map(s=>parseInt(s,10));
  const dt = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hh, mm, 0, 0);
  if(addDays) dt.setDate(dt.getDate() + addDays);
  return dt;
}

// 获取 next occurrence date for a flight's days (within next 7 days)
// 返回一个 Date（从 today 开始，包括今天）或 null
function nextOccurrenceForDays(daysTokens, fromDate = new Date()){
  // normalize tokens to weekday numbers
  const runMap = daysTokens.map(t => weekdayMap[t.toUpperCase()]);
  for(let i=0;i<7;i++){
    const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    d.setDate(d.getDate()+i);
    if(runMap.includes(d.getDay())) return d;
  }
  return null;
}

// 检查航班在某个日期是否开行（基于 days 字段）
function runsOnDate(flight, date){
  const tokens = flight.days || [];
  if(tokens.length === 0) return false;
  const wk = date.getDay();
  return tokens.some(t => weekdayMap[t.toUpperCase()] === wk);
}

function formatTimeHHMM(date){
  if(!date) return '--:--';
  return date.getHours().toString().padStart(2,'0') + ':' + date.getMinutes().toString().padStart(2,'0');
}

// percentage between two dates
function fracBetween(now, dep, arr){
  const total = arr - dep;
  if(total <= 0) return 0;
  return Math.min(1, Math.max(0, (now - dep) / total));
}

// get URL param
function getUrlParam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

// -------- 绘图相关 ----------
function resizeCanvasToDisplaySize(){
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * DPR);
  canvas.height = Math.round(r.height * DPR);
  canvas.style.width = r.width + 'px';
  canvas.style.height = r.height + 'px';
}

// convert airport coords (0..1200,0..600) to canvas pixel coords
function toCanvasXY(pt){
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / 1200;
  const scaleY = rect.height / 600;
  return [pt.x * scaleX * DPR, pt.y * scaleY * DPR];
}

function drawScene(flightsToShow, focusFlightId=null){
  resizeCanvasToDisplaySize();
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width, canvas.height);

  // draw each flight route (dashed) and plane icon at position if in-flight
  flightsToShow.forEach(item => {
    const {flight, depDT, arrDT, status, progress} = item;

    // resolve coords
    const depCoord = airportCoords[flight.dep.airport] || {x: Math.random()*1200, y: Math.random()*600};
    const arrCoord = airportCoords[flight.arr.airport] || {x: Math.random()*1200, y: Math.random()*600};
    const [dx,dy] = toCanvasXY(depCoord);
    const [ax,ay] = toCanvasXY(arrCoord);

    // draw dashed line
    ctx.save();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || '#666';
    ctx.lineWidth = 2 * DPR;
    ctx.setLineDash([8 * DPR, 6 * DPR]);
    ctx.beginPath();
    ctx.moveTo(dx,dy);
    // draw slight arc (bezier) for aesthetics
    const mx = (dx + ax)/2, my = (dy + ay)/2 - 40*DPR;
    ctx.quadraticCurveTo(mx, my, ax, ay);
    ctx.stroke();
    ctx.restore();

    // show plane only if status === 'in-flight' OR focusFlightId provided (for focused flight we might show even if preparing/arrived)
    const shouldShowPlane = (status === 'in-flight') || (focusFlightId && focusFlightId === flight.id);
    if(shouldShowPlane){
      // compute position along bezier: we'll use simple linear interpolation on t = progress (OK visually)
      const t = typeof progress === 'number' ? progress : 0;
      // sample point on quadratic curve: B(t) = (1-t)^2*P0 + 2(1-t)t*P1 + t^2*P2 where P1 is mx,my
      const t1 = 1 - t;
      const p1x = dx, p1y = dy;
      const p2x = mx, p2y = my;
      const p3x = ax, p3y = ay;
      const px = t1*t1*p1x + 2*t1*t*p2x + t*t*p3x;
      const py = t1*t1*p1y + 2*t1*t*p2y + t*t*p3y;

      // draw plane as small circle + triangle (simple)
      ctx.save();
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#0b66c2';
      ctx.beginPath();
      ctx.arc(px, py, 6*DPR, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();

      // draw label
      ctx.save();
      ctx.font = `${12*DPR}px sans-serif`;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#111';
      ctx.fillText(flight.flightNo + ' ' + flight.airline, px + 10*DPR, py - 10*DPR);
      ctx.restore();
    }
  });
}

// -------- 主逻辑 ----------
async function loadAndRender(){
  mapStatus.textContent = '正在加载航班数据...';
  try{
    const res = await fetch(DATA_PATH, {cache: 'no-cache'});
    if(!res.ok) throw new Error('无法加载 data 文件: ' + res.status);
    const txt = await res.text();
    const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const flights = lines.map(parseFlightLine).filter(Boolean);

    mapStatus.textContent = '解析完成，共 ' + flights.length + ' 条记录';

    // check URL param for id filter
    const queryId = getUrlParam('id') || null;
    const searchInput = document.getElementById('searchId');
    if(queryId) {
      searchInput.value = queryId;
    }

    // build sidebar list and determine flights to show on map
    const now = new Date();
    const flightsForMap = []; // only in-flight by default
    const flightItems = [];

    for(const flight of flights){
      // compute next occurrence (for focused view) & today's schedule
      const nextDate = nextOccurrenceForDays(flight.days, now);
      const runsToday = runsOnDate(flight, now);

      // choose base date for dep/arr calculation:
      // - if queryId present and matches this flight, use nextDate (soonest run) so we can show status even if not today
      // - otherwise for map "in-flight" check, only consider today's run
      let baseDate;
      if(queryId && flight.id && flight.id.toUpperCase() === queryId.toUpperCase()){
        baseDate = nextDate || now;
      } else {
        baseDate = now;
      }

      if(!flight.dep || !flight.arr){
        // skip malformed
        continue;
      }

      const depDT = makeDateTime(baseDate, flight.dep.time, flight.dep.dayOffset || 0);
      let arrDT = makeDateTime(baseDate, flight.arr.time, flight.arr.dayOffset || 0);
      // if arr is earlier than dep, assume arrives next day unless offset given
      if(arrDT < depDT && !(flight.arr.dayOffset && flight.arr.dayOffset>0)){
        arrDT.setDate(arrDT.getDate()+1);
      }

      // Determine status relative to "now"
      let status = 'no-service-today';
      if(queryId && flight.id && flight.id.toUpperCase() === queryId.toUpperCase()){
        // for focused flight we used nextDate; status based on now vs depDT/arrDT
        if(now < depDT) status = 'preparing';
        else if(now >= depDT && now <= arrDT) status = 'in-flight';
        else status = 'arrived';
      } else {
        // regular: only mark in-flight for flights that run today
        if(runsToday){
          // recalc dep/arr for today specifically:
          const depToday = makeDateTime(now, flight.dep.time, flight.dep.dayOffset || 0);
          let arrToday = makeDateTime(now, flight.arr.time, flight.arr.dayOffset || 0);
          if(arrToday < depToday && !(flight.arr.dayOffset && flight.arr.dayOffset>0)) arrToday.setDate(arrToday.getDate()+1);

          if(now < depToday) status = 'preparing';
          else if(now >= depToday && now <= arrToday) status = 'in-flight';
          else status = 'arrived';
          // override depDT/arrDT for accurate map show
          // but keep base depDT/arrDT for other uses:
          // We'll use depToday/arrToday for progress if runsToday
          // store those
          flight._depToday = depToday;
          flight._arrToday = arrToday;
        } else {
          status = 'no-service-today';
        }
      }

      // compute progress fraction if in-flight
      let progress = 0;
      if(status === 'in-flight'){
        const actualDep = flight._depToday || depDT;
        const actualArr = flight._arrToday || arrDT;
        progress = fracBetween(now, actualDep, actualArr);
      } else {
        // if focused flight and not in-flight, compute 0 or 1
        if(queryId && flight.id && flight.id.toUpperCase() === queryId.toUpperCase()){
          progress = now < depDT ? 0 : 1;
        } else {
          progress = 0;
        }
      }

      const item = {flight, depDT, arrDT, status, progress};
      flightItems.push(item);

      // For default map view: show only flights that are in-flight
      if(status === 'in-flight') flightsForMap.push(item);
      // If URL id filter present, show only that flight on map
    }

    // if user provided id, show only that flight (and include it on map even if not in-flight)
    const urlId = getUrlParam('id');
    let mapFlightsToDraw = flightsForMap;
    if(urlId){
      const focus = flightItems.find(it => it.flight.id && it.flight.id.toUpperCase() === urlId.toUpperCase());
      if(focus){
        mapFlightsToDraw = [focus];
        mapTitle.textContent = `航路地图 · 航班 ${focus.flight.flightNo} (${focus.flight.id})`;
      } else {
        mapStatus.textContent = '未找到指定航班：' + urlId;
      }
    } else {
      mapTitle.textContent = '航路地图 · 仅显示当前“飞行中”的航班';
    }

    // render list
    renderFlightList(flightItems);

    // draw on canvas
    drawScene(mapFlightsToDraw, urlId ? urlId.toUpperCase() : null);

    // update map status summary
    mapStatus.textContent = `当前时间：${now.toLocaleString()} · 地图航线数：${mapFlightsToDraw.length}`;
  }catch(err){
    console.error(err);
    mapStatus.textContent = '加载失败：' + err.message;
  }
}

function renderFlightList(items){
  flightListEl.innerHTML = '';
  items.forEach(it=>{
    const f = it.flight;
    const div = document.createElement('div');
    div.className = 'flight-card';
    const idPart = f.id ? ` · <a href="/news-detail.html?id=${encodeURIComponent(f.id)}">${f.id}</a>` : '';
    const daysText = (f.days && f.days.length) ? f.days.join(',') : '—';
    div.innerHTML = `<h4>${f.flightNo} ${f.airline}${idPart}</h4>
      <div class="flight-meta">${f.dep.airport} → ${f.arr.airport} · ${f.dep.time} → ${f.arr.time}</div>
      <div class="flight-meta">机型：${f.aircraft} · 班期：${daysText}</div>
      <div class="flight-status">${displayStatusText(it)}</div>
      <div style="margin-top:6px;font-size:12px;color:var(--muted)">经济：${f.priceEco || '—'} · 商务：${f.priceBiz || '—'}</div>
    `;
    flightListEl.appendChild(div);
  });
}

function displayStatusText(item){
  const now = new Date();
  const flight = item.flight;
  // if item was built with _depToday/_arrToday use them
  const dep = flight._depToday || item.depDT;
  const arr = flight._arrToday || item.arrDT;
  const st = item.status;
  if(st === 'in-flight'){
    const progressPct = Math.round(item.progress * 100);
    return `飞行中 · ${formatTimeHHMM(dep)} → ${formatTimeHHMM(arr)} · 进度 ${progressPct}%`;
  } else if(st === 'preparing'){
    // minutes to dep
    const min = Math.max(0, Math.round((dep - now)/60000));
    return `准备中 · 将于 ${formatTimeHHMM(dep)} 起飞（还有 ${min} 分钟）`;
  } else if(st === 'arrived'){
    return `已到达 · ${formatTimeHHMM(arr)}`;
  } else {
    return `今日未执飞`;
  }
}

// --------- UI 事件绑定 ----------
document.getElementById('btnApply').addEventListener('click', ()=>{
  const v = document.getElementById('searchId').value.trim();
  if(!v) return alert('请输入航班 ID (例如 DF1728) 或 航班号 (HA1610)');
  // go to same page with id param
  const u = new URL(location.href);
  u.searchParams.set('id', v);
  location.href = u.toString();
});

window.addEventListener('resize', ()=>{
  DPR = window.devicePixelRatio || 1;
  // redraw
  loadAndRender();
});

// dark mode toggle
const darkToggle = document.getElementById('darkToggle');
darkToggle.addEventListener('change', (e)=>{
  if(e.target.checked) document.documentElement.style.setProperty('color-scheme','dark');
  else document.documentElement.style.setProperty('color-scheme','light');
});

// initial
loadAndRender();
