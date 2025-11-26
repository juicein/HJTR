// ---------- 配置 ----------
const DATA_FLIGHTS = '/data/flight_data.txt';
const DATA_AIRPORTS = '/data/airports.json';

// Leaflet 初始化（确保 container 在 DOM ready 后可用）
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);

// OSM 切片（简约底图）。若你希望“无国界轮廓”风格，可以替换为自制无标签切片或灰色瓦片。
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 8,
  attribution: ''
}).addTo(map);

// 修复桌面空白：Leaflet 有时需要手动刷新尺寸
setTimeout(()=>map.invalidateSize(), 300);

// 全局 state
let airportDB = {}; // object keyed by code
let flights = [];   // parsed flight objects
let markers = {};   // flight markers keyed by flightNo
let airportMarkers = {}; // airport markers keyed by code
let polyLines = {};
let showFlightNo = localStorage.getItem('showFlightNo') === 'true';

// DOM
const searchInput = document.getElementById('searchInput');
const toggleFlightNo = document.getElementById('toggleFlightNo');
const flightListEl = document.getElementById('flightList');
const infoCard = document.getElementById('infoCard');
const showAirportNames = document.getElementById('showAirportNames');
const showAirportCodes = document.getElementById('showAirportCodes');

// helpers
const weekdayMap = {SUN:0,MON:1,TUE:2,WED:3,THU:4,FRI:5,SAT:6};
function timeToMinutes(t){ const [h,m]=t.split(':').map(Number); return h*60 + m; }
function getQueryParam(){ return new URLSearchParams(location.search).get('flights_map'); }

// parse flight line robustly (support #+n#跨日)
function parseFlightLine(line){
  if(!line) return null;
  try{
    const raw = line.trim();
    const flightNo = (raw.match(/【([^】]+)】/)||[,''])[1] || '';
    const aircraft = (raw.match(/〔([^〕]+)〕/)||[,''])[1] || '';
    const airline = (raw.match(/『([^』]+)』/)||[,''])[1] || '';
    const daysStr = (raw.match(/«([^»]+)»/)||[,''])[1] || '';
    const days = daysStr ? daysStr.split(',').map(s=>s.trim()) : [];
    // segments pattern: 《Place出发》{hh:mm}#+n#@...
    const segRegex = /《([^》]+?)》\{([0-2]?\d:[0-5]\d)\}#\+?([0-9]+)#@[^@]*@/g;
    let segs=[], m;
    while((m=segRegex.exec(raw))!==null){
      const placeText = m[1]; const time = m[2]; const dayOffset = parseInt(m[3]||'0',10) || 0;
      const airport = placeText.replace(/出发|到达|到达站|出发站/g,'').trim();
      segs.push({airport, time, dayOffset});
    }
    const dep = segs[0] || null;
    const arr = segs[1] || null;
    const priceEco = (raw.match(/§([^§]+)§/)||[,''])[1] || '';
    const priceBiz = (raw.match(/θ([^θ]+)θ/)||[,''])[1] || '';
    const special = (raw.match(/△([^△]+)△/)||[,''])[1] || '';
    const regNo = (raw.match(/<([^>]+)>/)||[,''])[1] || '';
    return { raw, flightNo, aircraft, airline, days, dep, arr, priceEco, priceBiz, special, regNo };
  }catch(e){ console.error('parseFlightLine',e,line); return null; }
}

// load airports (expect object keyed by code)
async function loadAirports(){
  const res = await fetch(DATA_AIRPORTS, {cache:'no-cache'});
  const json = await res.json();
  // Accept either array or object: normalize to object keyed by code
  if(Array.isArray(json)){
    airportDB = {};
    json.forEach(a=>{
      if(!a.code) return;
      airportDB[a.code.toUpperCase()] = a;
      // ensure aliases exist
      a.aliases = a.aliases || [];
    });
  }else{
    // already object keyed
    airportDB = {};
    Object.keys(json).forEach(k=>{
      airportDB[k.toUpperCase()] = json[k];
      airportDB[k.toUpperCase()].aliases = airportDB[k.toUpperCase()].aliases || [];
    });
  }
}

// find airport by name/alias/code (case-insensitive)
function findAirportByName(name){
  if(!name) return null;
  const s = name.trim().toLowerCase();
  // try code exact
  if(airportDB[s.toUpperCase()]) return airportDB[s.toUpperCase()];
  for(const code in airportDB){
    const a = airportDB[code];
    if((a.name && a.name.toLowerCase().includes(s)) || (a.code && a.code.toLowerCase()===s)) return a;
    if(a.aliases && a.aliases.some(x=>x.toLowerCase().includes(s))) return a;
  }
  return null;
}

// find flights by flightNo or regNo
function findFlightsByQuery(q){
  const s = q.trim().toLowerCase();
  if(!s) return [];
  return flights.filter(f=>{
    if(f.flightNo && f.flightNo.toLowerCase().includes(s)) return true;
    if(f.regNo && f.regNo.toLowerCase().includes(s)) return true;
    // also match dep/arr airport codes/names
    if(f.dep && f.dep.airport && f.dep.airport.toLowerCase().includes(s)) return true;
    if(f.arr && f.arr.airport && f.arr.airport.toLowerCase().includes(s)) return true;
    return false;
  });
}

// draw airport markers (with CSS via divIcon)
function drawAirports(){
  // clear existing
  Object.values(airportMarkers).forEach(m => map.removeLayer(m));
  airportMarkers = {};
  Object.keys(airportDB).forEach(code=>{
    const a = airportDB[code];
    if(!a.lat || !a.lon) return;
    const el = L.divIcon({
      className: 'airport-marker',
      html: `<div class="airport-marker" title="${a.name} (${a.code})"></div>`,
      iconSize: [16,16],
      iconAnchor: [8,8]
    });
    const mk = L.marker([a.lat, a.lon], {icon:el}).addTo(map);
    mk.on('click', ()=> showAirportCard(a));
    airportMarkers[code] = mk;
    // optionally show label if checkbox on
    if(showAirportNames.checked || showAirportCodes.checked){
      const txt = (showAirportNames.checked? a.name : '') + (showAirportCodes.checked? ' ' + a.code : '');
      if(txt.trim()){
        L.tooltip({permanent:true, direction:'right', className:'flight-label'}).setContent(txt).setLatLng([a.lat, a.lon]).addTo(map);
      }
    }
  });
}

// create plane SVG icon (data URI) rotated automatically by Leaflet's rotation handling via CSS transform
function planeIconSvg(color='rgba(11,102,194,1)'){
  // simple plane SVG path - compact and rotate-able
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='-18 -18 36 36'><g transform='scale(1)'><path d='M0-10 L6 0 L0 -2 L-6 0 Z' fill='${color}' stroke='#fff' stroke-width='0.8' /></g></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

// draw flights (in-flight or focused)
function drawFlights(filterId=null){
  // clear previous markers and polylines
  Object.values(markers).forEach(m=>map.removeLayer(m));
  Object.values(polyLines).forEach(p=>map.removeLayer(p));
  markers = {}; polyLines = {};

  const now = new Date();

  // build items with status and progress for each flight
  const items = flights.map(f=>{
    // compute dep/arr Date based on today and dayOffset flags
    const base = new Date();
    let depDate = null, arrDate = null;
    if(f.dep && f.dep.time){
      depDate = makeDateTime(base, f.dep.time, f.dep.dayOffset || 0);
    }
    if(f.arr && f.arr.time){
      arrDate = makeDateTime(base, f.arr.time, f.arr.dayOffset || 0);
      // if arr earlier than dep and dayOffset not provided, treat as next day
      if(depDate && arrDate < depDate && !(f.arr.dayOffset && f.arr.dayOffset>0)) arrDate.setDate(arrDate.getDate()+1);
    }
    let status='no-service-today', progress=0;
    // if days specified, check runs today
    if(f.days && f.days.length){
      const d = base.getDay();
      const run = f.days.some(t=> weekdayMap[t.toUpperCase()] === d);
      if(run){
        if(depDate && now < depDate) status='preparing';
        else if(depDate && arrDate && now >= depDate && now <= arrDate){ status='in-flight'; progress = fracBetween(now,depDate,arrDate); }
        else status='arrived';
      }else status='no-service-today';
    }
    return { flight: f, depDate, arrDate, status, progress };
  });

  // choose visible flights
  let visible = items.filter(it => it.status === 'in-flight');
  if(filterId){
    const idu = filterId.toLowerCase();
    const focus = items.filter(it => (it.flight.flightNo && it.flight.flightNo.toLowerCase()===idu) || (it.flight.regNo && it.flight.regNo.toLowerCase()===idu) || (it.flight.id && it.flight.id.toLowerCase()===idu));
    if(focus.length) visible = focus;
  }

  visible.forEach(it=>{
    const f = it.flight;
    const depA = findAirportByName(f.dep?.airport || f.dep?.airportName || f.dep?.airportCode || '');
    const arrA = findAirportByName(f.arr?.airport || f.arr?.airportName || f.arr?.airportCode || '');
    // but our parseFlightLine stores f.dep.airport as airport name; convert using findAirportByName
    const depAirport = findAirportByName(f.dep?.airport || f.dep?.airport);
    const arrAirport = findAirportByName(f.arr?.airport || f.arr?.airport);
    if(!depAirport || !arrAirport) return;

    // add polyline
    const line = L.polyline([[depAirport.lat, depAirport.lon],[arrAirport.lat, arrAirport.lon]], {color:'#ff8c00', weight:2, dashArray:'6 6'}).addTo(map);
    polyLines[f.flightNo] = line;

    // compute position along line
    const ratio = it.progress;
    const lat = depAirport.lat + (arrAirport.lat - depAirport.lat) * ratio;
    const lon = depAirport.lon + (arrAirport.lon - depAirport.lon) * ratio;

    // compute angle for rotation (bearing)
    const angle = bearing(depAirport.lat, depAirport.lon, arrAirport.lat, arrAirport.lon);

    // plane icon
    const svgData = planeIconSvg('#1e90ff'); // you can change color
    const icon = L.icon({ iconUrl: svgData, iconSize:[32,32], iconAnchor:[16,16] });

    const mk = L.marker([lat, lon], { icon, rotationAngle: angle /* for leaflet-rotatedmarker plugin if available */ }).addTo(map);
    mk.flight = f;
    mk.on('click', ()=> showFlightCard(f, it, depAirport, arrAirport));
    markers[f.flightNo] = mk;

    // show tooltip label if user enabled
    if(toggleFlightNo.checked){
      mk.bindTooltip(f.flightNo, {permanent:true, direction:'right', className:'flight-label'}).openTooltip();
    }
  });

  // ensure airports also drawn
  drawAirports();
  renderFlightList(items);
}

// render flight list on side
function renderFlightList(items){
  flightListEl.innerHTML = '';
  items.forEach(it=>{
    const f = it.flight;
    const div = document.createElement('div');
    div.className = 'flight-card';
    const depTime = f.dep? `${f.dep.time}${f.dep.dayOffset? (' (+'+f.dep.dayOffset+')'):''}` : '--';
    const arrTime = f.arr? `${f.arr.time}${f.arr.dayOffset? (' (+'+f.arr.dayOffset+')'):''}` : '--';
    div.innerHTML = `<h4>${f.flightNo} ${f.airline || ''} <span style="float:right;color:var(--muted)">${f.regNo? f.regNo : ''}</span></h4>
      <div class="flight-meta">${f.dep? f.dep.airport : '--'} → ${f.arr? f.arr.airport : '--'} · ${depTime} → ${arrTime}</div>
      <div class="flight-meta">机型：${f.aircraft || '—'}</div>
      <div class="flight-status">${it.status}</div>`;
    div.addEventListener('click', ()=>{
      // zoom to flight polyline if exists
      const pl = polyLines[f.flightNo];
      if(pl) map.fitBounds(pl.getBounds(), {padding:[80,80]});
    });
    flightListEl.appendChild(div);
  });
}

// show flight info card (FR24-like)
function showFlightCard(f, item, depA, arrA){
  // find other flights by same regNo to show prev/next
  const reg = f.regNo;
  const siblings = reg ? flights.filter(x=>x.regNo && x.regNo === reg) : [];

  // build times (ISO-like)
  const depDate = item.depDate ? item.depDate.toLocaleString() : '--';
  const arrDate = item.arrDate ? item.arrDate.toLocaleString() : '--';
  const progressPct = Math.round(item.progress * 100);

  let html = `<div class="title">${f.flightNo} · ${f.airline || ''}</div>`;
  html += `<div class="meta">机型: ${f.aircraft || '—'} · 注册号: ${f.regNo || '—'}</div>`;
  html += `<div style="margin-top:8px;"><b>起飞：</b> ${depA.name} (${depA.code}) · ${depDate}</div>`;
  html += `<div><b>到达：</b> ${arrA.name} (${arrA.code}) · ${arrDate}</div>`;
  html += `<div style="margin-top:8px;"><b>进度：</b> ${progressPct}%</div>`;
  html += `<div class="progress-wrap" style="margin-top:6px"><div class="progress" style="width:${progressPct}%"></div></div>`;
  if(siblings.length>1){
    html += `<div style="margin-top:8px;color:var(--muted)">相同注册号航班 (${reg}) 共 ${siblings.length} 条</div>`;
  }
  html += `<div style="margin-top:8px;color:var(--muted);font-size:12px">经济：${f.priceEco||'—'} · 商务：${f.priceBiz||'—'} · 头等：${f.special||'—'}</div>`;

  infoCard.innerHTML = html;
  infoCard.classList.remove('hidden');
}

// show airport card
function showAirportCard(a){
  let html = `<div class="title">${a.name} (${a.code})</div>`;
  if(a.level) html += `<div class="meta">等级：${a.level}</div>`;
  if(a.runways) html += `<div class="meta">跑道：${a.runways}</div>`;
  infoCard.innerHTML = html;
  infoCard.classList.remove('hidden');
}

// hide info card on map click
map.on('click', ()=> infoCard.classList.add('hidden'));

// compute bearing between two lat/lon
function bearing(lat1, lon1, lat2, lon2){
  const toRad = Math.PI/180, toDeg = 180/Math.PI;
  const y = Math.sin((lon2-lon1)*toRad) * Math.cos(lat2*toRad);
  const x = Math.cos(lat1*toRad)*Math.sin(lat2*toRad) - Math.sin(lat1*toRad)*Math.cos(lat2*toRad)*Math.cos((lon2-lon1)*toRad);
  return (Math.atan2(y,x)*toDeg + 360) % 360;
}

// date helpers
function makeDateTime(baseDate, hhmm, addDays=0){
  const [hh, mm] = hhmm.split(':').map(s=>parseInt(s,10));
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hh, mm, 0, 0);
  if(addDays) d.setDate(d.getDate() + addDays);
  return d;
}
function fracBetween(now, dep, arr){ const total = arr - dep; if(total<=0) return 0; return Math.min(1,Math.max(0,(now-dep)/total)); }

// ---------- load flights ----------
async function loadFlights(){
  const res = await fetch(DATA_FLIGHTS, {cache:'no-cache'});
  const txt = await res.text();
  flights = txt.split(/\r?\n/).map(parseFlightLine).filter(Boolean);
  // normalize fields: ensure f.dep.airport / f.arr.airport are set
  flights.forEach(f=>{
    if(f.dep && f.dep.airport===undefined && f.dep.airportName) f.dep.airport = f.dep.airportName;
    // map f.dep.airport field names if various formats exist; we assume parseFlightLine sets .dep.airport
  });
}

// ---------- SEARCH ----------
function initSearch(){
  searchInput.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){
      doSearch(searchInput.value.trim());
    }
  });
}
function doSearch(q){
  if(!q) return;
  const results = findFlightsByQuery(q);
  if(results.length>0){
    // focus first result
    const f = results[0];
    // fit bounds if polyline exists else fly to airport
    const dep = findAirportByName(f.dep.airport);
    const arr = findAirportByName(f.arr.airport);
    if(dep && arr){
      map.fitBounds([[dep.lat,dep.lon],[arr.lat,arr.lon]], {padding:[80,80]});
    }else if(dep){
      map.panTo([dep.lat,dep.lon]);
    }
    // open info card for first result
    // find item with same flightNo
    const item = { flight: f, depDate: makeDateTime(new Date(), f.dep.time, f.dep.dayOffset || 0), arrDate: makeDateTime(new Date(), f.arr.time, f.arr.dayOffset || 0), status:'in-flight', progress:0.4 };
    showFlightCard(f, item, dep || {name:f.dep.airport, code:''}, arr || {name:f.arr.airport, code:''});
    // highlight marker if exists
  }else{
    // try match airport
    const ap = findAirportByName(q);
    if(ap) {
      map.panTo([ap.lat, ap.lon]);
      showAirportCard(ap);
    } else {
      alert('未找到匹配的航班或机场');
    }
  }
}

// ---------- UI bindings ----------
toggleFlightNo.checked = showFlightNo;
toggleFlightNo.addEventListener('change', ()=>{
  showFlightNo = toggleFlightNo.checked;
  localStorage.setItem('showFlightNo', showFlightNo);
  drawFlights(getQueryParam());
});

// search input init
initSearch();
document.getElementById('searchInput').value = '';

// airport labels toggles
showAirportNames.addEventListener('change', ()=> drawAirports());
showAirportCodes.addEventListener('change', ()=> drawAirports());

// main init
async function init(){
  await loadAirports();
  await loadFlights();
  // initial draw
  drawAirports();
  drawFlights(getQueryParam());
  // if url param present, focus and zoom to flight
  const q = getQueryParam();
  if(q){
    // center on matched flight
    const matches = findFlightsByQuery(q);
    if(matches.length){
      const f = matches[0];
      const dep = findAirportByName(f.dep.airport);
      const arr = findAirportByName(f.arr.airport);
      if(dep && arr) map.fitBounds([[dep.lat,dep.lon],[arr.lat,arr.lon]], {padding:[80,80]});
    }
  }
  // periodic refresh (optional)
  setInterval(()=> drawFlights(getQueryParam()), 30*1000);
}
init();
