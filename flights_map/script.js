/* flights_map/script.js
   说明：
   - 从 /data/flight_data.txt 读取航班数据（每行一条）
   - 从 /data/airports.json 读取机场库（包含 x,y 坐标与 code/name）
   - 在 canvas 上绘制虚线航线、飞机点、并美化机场点 (glow + label)
   - 提供侧栏开关：显示机场名称 / 三字码
*/

const DATA_FLIGHTS = '/data/flight_data.txt';
const DATA_AIRPORTS = '/data/airports.json';

const canvas = document.getElementById('mapCanvas');
const flightListEl = document.getElementById('flightList');
const mapTitle = document.getElementById('mapTitle');
const mapStatus = document.getElementById('mapStatus');

let DPR = window.devicePixelRatio || 1;
let airportMap = {}; // name -> {name,code,x,y}
let flights = [];

// helper
const weekdayMap = {SUN:0, MON:1, TUE:2, WED:3, THU:4, FRI:5, SAT:6};
function $(s){return document.querySelector(s)}
function log(...a){console.log('[flights_map]',...a)}

// parse a single line (robust)
function parseFlightLine(line){
  const raw = line.trim();
  if(!raw) return null;
  try{
    const flightNo = (raw.match(/【([^】]+)】/) || [,''])[1] || '';
    const aircraft = (raw.match(/〔([^〕]+)〕/) || [,''])[1] || '';
    const airline = (raw.match(/『([^』]+)』/) || [,''])[1] || '';
    const daysStr = (raw.match(/«([^»]+)»/) || [,''])[1] || '';
    const days = daysStr ? daysStr.split(',').map(s=>s.trim()) : [];
    // segments
    const segRegex = /《([^》]+?)》\{([0-2]?\d:[0-5]\d)\}#\+?([0-9]+)#@([^@]*)@/g;
    let segs = [], m;
    while((m = segRegex.exec(raw)) !== null){
      const placeText = m[1];
      const time = m[2];
      const offset = parseInt(m[3]||'0',10) || 0;
      // remove trailing keywords
      const airport = placeText.replace(/出发|到达|到达站|出发站/g,'').trim();
      segs.push({airport, time, dayOffset: offset});
    }
    const dep = segs[0] || null;
    const arr = segs[1] || null;
    const priceEco = (raw.match(/§([^§]+)§/) || [,''])[1] || '';
    const priceBiz = (raw.match(/θ([^θ]+)θ/) || [,''])[1] || '';
    const special = (raw.match(/△([^△]+)△/) || [,''])[1] || '';
    const id = (raw.match(/<([^>]+)>/) || [,''])[1] || '';
    return {raw, flightNo, aircraft, airline, days, dep, arr, priceEco, priceBiz, special, id};
  }catch(e){
    console.error('parseFlightLine error', e);
    return null;
  }
}

// date helpers
function makeDateTime(baseDate, hhmm, addDays=0){
  const [hh, mm] = hhmm.split(':').map(s=>parseInt(s,10));
  const dt = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hh, mm, 0, 0);
  if(addDays) dt.setDate(dt.getDate() + addDays);
  return dt;
}
function nextOccurrenceForDays(daysTokens, fromDate = new Date()){
  const runMap = daysTokens.map(t => weekdayMap[t.toUpperCase()]);
  for(let i=0;i<7;i++){
    const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    d.setDate(d.getDate()+i);
    if(runMap.includes(d.getDay())) return d;
  }
  return null;
}
function runsOnDate(flight, date){
  const tokens = flight.days || [];
  if(tokens.length === 0) return false;
  const wk = date.getDay();
  return tokens.some(t => weekdayMap[t.toUpperCase()] === wk);
}
function fracBetween(now, dep, arr){
  const total = arr - dep;
  if(total <= 0) return 0;
  return Math.min(1, Math.max(0, (now - dep) / total));
}
function formatTimeHHMM(d){ if(!d) return '--:--'; return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0'); }

// canvas sizing / coords
function resizeCanvas(){
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * DPR);
  canvas.height = Math.round(rect.height * DPR);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
}

function toCanvasXY(pt){
  // pt expected in 0..1200, 0..600
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / 1200;
  const scaleY = rect.height / 600;
  return [pt.x * scaleX * DPR, pt.y * scaleY * DPR];
}

// draw airport markers
function drawAirports(ctx, showNames, showCodes){
  Object.values(airportMap).forEach(ap => {
    if(typeof ap.x !== 'number' || typeof ap.y !== 'number') return;
    const [cx, cy] = toCanvasXY({x: ap.x, y: ap.y});
    // glow (shadow)
    ctx.save();
    ctx.beginPath();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18 * DPR);
    grad.addColorStop(0, 'rgba(11,102,194,0.18)');
    grad.addColorStop(1, 'rgba(11,102,194,0)');
    ctx.fillStyle = grad;
    ctx.arc(cx, cy, 18 * DPR, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
    // main dot
    ctx.save();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#111';
    ctx.beginPath();
    ctx.arc(cx, cy, 4 * DPR, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // outline
    ctx.save();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#0b66c2';
    ctx.lineWidth = 1.5 * DPR;
    ctx.beginPath();
    ctx.arc(cx, cy, 6 * DPR, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();

    // label
    ctx.save();
    ctx.font = `${12*DPR}px sans-serif`;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#111';
    const labelParts = [];
    if(showNames && ap.name) labelParts.push(ap.name);
    if(showCodes && ap.code) labelParts.push(ap.code);
    const label = labelParts.join(' ');
    if(label){
      ctx.fillText(label, cx + 10 * DPR, cy + 4 * DPR);
    }
    ctx.restore();
  });
}

// draw flights (routes + plane if in-flight or focused)
function drawFlights(ctx, flightItems, focusId=null){
  flightItems.forEach(item => {
    const f = item.flight;
    if(!f.dep || !f.arr) return;
    const depCoord = airportMap[f.dep.airport] || {x: Math.random()*1200, y: Math.random()*600};
    const arrCoord = airportMap[f.arr.airport] || {x: Math.random()*1200, y: Math.random()*600};
    const [dx,dy] = toCanvasXY(depCoord);
    const [ax,ay] = toCanvasXY(arrCoord);

    // dashed curved line
    ctx.save();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || '#666';
    ctx.lineWidth = 2 * DPR;
    ctx.setLineDash([8 * DPR, 6 * DPR]);
    ctx.beginPath();
    ctx.moveTo(dx,dy);
    const mx = (dx + ax)/2, my = (dy + ay)/2 - 48*DPR;
    ctx.quadraticCurveTo(mx, my, ax, ay);
    ctx.stroke();
    ctx.restore();

    // label route mid
    ctx.save();
    ctx.font = `${11*DPR}px sans-serif`;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || '#666';
    ctx.fillText(f.flightNo, mx + 6*DPR, my - 6*DPR);
    ctx.restore();

    // show plane when in-flight or if focused
    const shouldShowPlane = (item.status === 'in-flight') || (focusId && f.id && f.id.toUpperCase() === focusId.toUpperCase());
    if(shouldShowPlane){
      const t = typeof item.progress === 'number' ? item.progress : 0;
      const t1 = 1 - t;
      const p1x = dx, p1y = dy;
      const p2x = mx, p2y = my;
      const p3x = ax, p3y = ay;
      const px = t1*t1*p1x + 2*t1*t*p2x + t*t*p3x;
      const py = t1*t1*p1y + 2*t1*t*p2y + t*t*p3y;

      // plane dot
      ctx.save();
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#0b66c2';
      ctx.beginPath();
      ctx.arc(px, py, 6 * DPR, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();

      // flight label
      ctx.save();
      ctx.font = `${12*DPR}px sans-serif`;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#111';
      ctx.fillText(`${f.flightNo} ${f.airline}`, px + 10*DPR, py - 10*DPR);
      ctx.restore();
    }
  });
}

// main rendering
function renderScene(flightItems, focusId=null){
  resizeCanvas();
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width, canvas.height);

  // draw airports under routes
  const showNames = document.getElementById('showAirportNames').checked;
  const showCodes = document.getElementById('showAirportCodes').checked;
  drawAirports(ctx, showNames, showCodes);

  // draw flights
  drawFlights(ctx, flightItems, focusId);
}

// load airports JSON
async function loadAirports(){
  try{
    const r = await fetch(DATA_AIRPORTS, {cache:'no-cache'});
    if(!r.ok) throw new Error('无法加载 airports.json: ' + r.status);
    const arr = await r.json();
    airportMap = {};
    arr.forEach(a=>{
      // ensure name key matches flight data airport string
      airportMap[a.name] = {name: a.name, code: a.code || '', x: a.x, y: a.y};
      if(a.aliases && Array.isArray(a.aliases)){
        a.aliases.forEach(alias => { airportMap[alias] = {name: a.name, code: a.code || '', x: a.x, y: a.y}; });
      }
    });
    log('已加载机场库', Object.keys(airportMap).length);
  }catch(err){
    console.error(err);
    mapStatus.textContent = '加载机场数据失败：' + err.message;
    airportMap = {};
  }
}

// load flights file
async function loadFlights(){
  try{
    const r = await fetch(DATA_FLIGHTS, {cache:'no-cache'});
    if(!r.ok) throw new Error('无法加载 flight_data.txt: ' + r.status);
    const txt = await r.text();
    const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    flights = lines.map(parseFlightLine).filter(Boolean);
    log('加载航班', flights.length);
  }catch(err){
    console.error(err);
    mapStatus.textContent = '加载航班数据失败：' + err.message;
    flights = [];
  }
}

// build items with status and progress
function buildFlightItems(now = new Date(), urlId = null){
  const items = [];
  for(const f of flights){
    if(!f.dep || !f.arr) continue;
    const nextDate = nextOccurrenceForDays(f.days, now);
    const runsToday = runsOnDate(f, now);

    let baseDate = now;
    if(urlId && f.id && f.id.toUpperCase() === urlId.toUpperCase()){
      baseDate = nextDate || now;
    }

    const depDT = makeDateTime(baseDate, f.dep.time, f.dep.dayOffset || 0);
    let arrDT = makeDateTime(baseDate, f.arr.time, f.arr.dayOffset || 0);
    if(arrDT < depDT && !(f.arr.dayOffset && f.arr.dayOffset>0)) arrDT.setDate(arrDT.getDate()+1);

    let status = 'no-service-today';
    if(urlId && f.id && f.id.toUpperCase() === urlId.toUpperCase()){
      if(now < depDT) status = 'preparing';
      else if(now >= depDT && now <= arrDT) status = 'in-flight';
      else status = 'arrived';
    } else {
      if(runsToday){
        const depToday = makeDateTime(now, f.dep.time, f.dep.dayOffset || 0);
        let arrToday = makeDateTime(now, f.arr.time, f.arr.dayOffset || 0);
        if(arrToday < depToday && !(f.arr.dayOffset && f.arr.dayOffset>0)) arrToday.setDate(arrToday.getDate()+1);
        if(now < depToday) status = 'preparing';
        else if(now >= depToday && now <= arrToday) status = 'in-flight';
        else status = 'arrived';
        f._depToday = depToday;
        f._arrToday = arrToday;
      } else {
        status = 'no-service-today';
      }
    }

    let progress = 0;
    if(status === 'in-flight'){
      const actualDep = f._depToday || depDT;
      const actualArr = f._arrToday || arrDT;
      progress = fracBetween(now, actualDep, actualArr);
    } else {
      if(urlId && f.id && f.id.toUpperCase() === urlId.toUpperCase()){
        progress = now < depDT ? 0 : 1;
      } else progress = 0;
    }

    items.push({flight: f, depDT, arrDT, status, progress});
  }
  return items;
}

// render flight list sidebar
function renderFlightList(items){
  flightListEl.innerHTML = '';
  items.forEach(it => {
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

function displayStatusText(it){
  const now = new Date();
  const f = it.flight;
  const dep = f._depToday || it.depDT;
  const arr = f._arrToday || it.arrDT;
  if(it.status === 'in-flight'){
    const pct = Math.round(it.progress * 100);
    return `飞行中 · ${formatTimeHHMM(dep)} → ${formatTimeHHMM(arr)} · 进度 ${pct}%`;
  } else if(it.status === 'preparing'){
    const mins = Math.max(0, Math.round((dep - now)/60000));
    return `准备中 · ${formatTimeHHMM(dep)} 起飞（${mins} 分钟）`;
  } else if(it.status === 'arrived'){
    return `已到达 · ${formatTimeHHMM(arr)}`;
  } else {
    return `今日未执飞`;
  }
}

// initial load + draw
async function loadAndRender(){
  mapStatus.textContent = '加载机场与航班数据…';
  await loadAirports();
  await loadFlights();

  const urlId = (new URL(location.href)).searchParams.get('id') || null;
  const now = new Date();

  const items = buildFlightItems(now, urlId);
  // default: show only in-flight; if urlId present, focus that flight
  let mapItems = items.filter(it => it.status === 'in-flight');
  if(urlId){
    const focus = items.find(it => it.flight.id && it.flight.id.toUpperCase() === urlId.toUpperCase());
    if(focus) {
      mapItems = [focus];
      mapTitle.textContent = `航路地图 · 航班 ${focus.flight.flightNo} (${focus.flight.id})`;
    } else {
      mapStatus.textContent = '未找到指定航班：' + urlId;
      mapTitle.textContent = '航路地图';
    }
  } else {
    mapTitle.textContent = '航路地图 · 仅显示当前“飞行中”的航班';
  }

  renderFlightList(items);
  renderScene(mapItems, urlId);

  mapStatus.textContent = `当前时间：${now.toLocaleString()} · 航班记录：${items.length} · 地图航线：${mapItems.length}`;
}

// UI bindings
document.getElementById('btnApply').addEventListener('click', ()=>{
  const v = document.getElementById('searchId').value.trim();
  if(!v) return alert('请输入航班 ID (例如 DF1728) 或 航班号 (HA1610)');
  const u = new URL(location.href);
  u.searchParams.set('id', v);
  location.href = u.toString();
});

document.getElementById('showAirportNames').addEventListener('change', ()=>{ loadAndRender(); });
document.getElementById('showAirportCodes').addEventListener('change', ()=>{ loadAndRender(); });

// dark toggle (simple)
document.getElementById('darkToggle').addEventListener('change', (e)=>{
  if(e.target.checked) document.documentElement.style.setProperty('color-scheme','dark');
  else document.documentElement.style.setProperty('color-scheme','light');
});

// resize and redraw on window resize
window.addEventListener('resize', ()=>{
  DPR = window.devicePixelRatio || 1;
  loadAndRender();
});

// initial call
window.addEventListener('load', ()=>{
  DPR = window.devicePixelRatio || 1;
  loadAndRender();
});
