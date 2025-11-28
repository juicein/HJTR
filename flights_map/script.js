// =================== 配置（可修改） ===================
const DEFAULT_REFRESH_INTERVAL = 3 * 60 * 1000; // 默认 3 分钟
const ANIMATION_STEP_MS = 1000 / 20; // 平滑动画帧：20 FPS
const EAST8_OFFSET = 8 * 60; // minutes offset for UTC+8

// =================== 全局状态 ===================
let map = null;
let useAbstractMap = false; // 可由侧栏开关设置（localStorage 保存）
let airportDB = [];
let flights = []; // 解析后
let markers = {}; // flightKey -> marker
let polylines = {}; // flightKey -> polyline
let airportMarkers = []; // airport marker array for cleanup
let showFlightNo = localStorage.getItem("showFlightNo") === "true";
let showAirportLabels = localStorage.getItem("showAirportLabels") === "true";
let showOnlyFiltered = localStorage.getItem("showOnlyFiltered") === "true";
let refreshInterval = Number(localStorage.getItem("refreshInterval")) || DEFAULT_REFRESH_INTERVAL;
let animRequest = null;
let lastRenderTime = 0;
let targetPositions = {}; // flightKey -> {lat,lng}

// =================== init map (Leaflet) ===================
function initMap(){
  map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([30, 90], 3);

  // tile layer (default)
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 });
  osm.addTo(map);

  // prepare abstract overlay as imageOverlay (SVG data URL) covering world bounds [-90..90 lat?]. We'll use bounds [[90,-180],[ -90,180]]
  const svg = buildAbstractWorldSVG();
  const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  window._abstractOverlay = L.imageOverlay(svgUrl, [[90,-180],[-90,180]], {interactive:false});

  // UI: switch radio status from saved
  const mode = localStorage.getItem("mapMode") || "tiles";
  setMapMode(mode);

  // map events
  map.on('click', ()=> {
    // click to hide info card
    document.getElementById("infoCard").classList.add("hidden");
  });
}

// build a simple abstract world SVG (very simplified continent shapes; purely decorative, covers full lon/lat bounds)
function buildAbstractWorldSVG(){
  // Note: shapes are simplified stylized blobs — sufficient for abstract look.
  // Fill is transparent gold-ish stroke in new-airline style.
  // Because we place this image overlay in bounds [[90,-180],[-90,180]], Leaflet will stretch it as equirectangular.
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000" viewBox="0 0 2000 1000">
    <rect width="100%" height="100%" fill="#f4f8ff"/>
    <g fill="#cfe9ff" stroke="#b7dbff" stroke-width="2" transform="scale(1)">
      <!-- Very rough continent blobs (abstract) -->
      <path d="M200 220 C 260 160, 360 140, 460 180 C 560 220, 640 320, 720 360 C 820 400, 900 420, 980 380 C 1080 340, 1160 300, 1250 320 C 1340 340, 1400 420, 1480 500 C 1520 540, 1580 600, 1660 620 C 1720 640, 1780 700, 1860 740 L1860 840 L140 840 L140 740 C160 700,180 620,200 520 C210 460,220 360,200 320 Z"/>
      <path d="M80 520 C120 460,160 400,220 380 C260 360,320 360,360 400 C400 440,420 520,420 580 C420 640,380 700,320 720 C260 740,160 740,120 680 C100 640,80 580,80 520 Z"/>
      <path d="M1200 120 C1240 140,1280 160,1320 180 C1360 200,1400 240,1460 260 C1500 280,1560 300,1600 320 C1640 340,1680 380,1720 420 C1760 460,1800 520,1820 560 L1820 680 L1200 680 C1180 600,1180 520,1200 460 C1220 420,1240 300,1200 240 Z"/>
    </g>
    <!-- stylized grid lines -->
    <g stroke="#e8f1ff" stroke-width="1" opacity="0.6">
      <path d="M0 200 L2000 200"/>
      <path d="M0 400 L2000 400"/>
      <path d="M0 600 L2000 600"/>
    </g>
  </svg>
  `;
  return svg;
}

// set map mode: "tiles" or "abstract"
function setMapMode(mode){
  useAbstractMap = (mode === "abstract");
  localStorage.setItem("mapMode", mode);
  // remove existing layers except base container
  map.eachLayer(layer=>{
    // keep only tile if tiles mode, or add overlay if abstract
  });
  // Clear all base layers and re-add according to mode:
  map.eachLayer(layer=>{
    map.removeLayer(layer);
  });
  if(useAbstractMap){
    // add a neutral plain background (no tiles) and the abstract overlay
    const empty = L.tileLayer('', {noWrap:true});
    empty.addTo(map);
    window._abstractOverlay.addTo(map);
  }else{
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 7 }).addTo(map);
  }
  // redraw airports/markers (they rely on map object)
  renderAirports();
  renderFlights(getFlightIDFromURL());
}

// =================== utility: east-8 "now" ===================
function nowInE8(){
  // return Date object adjusted to UTC+8 representing current instant in that timezone
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset()*60000;
  const e8 = new Date(utcMs + EAST8_OFFSET*60000);
  return e8;
}
// create Date in East8 timezone for current day with given hh:mm and dayOffset (n days from today)
function east8DateForTime(hhmm, plusDays){
  const [hh,mm] = hhmm.split(":").map(s=>Number(s));
  const base = nowInE8();
  const year = base.getFullYear(), month = base.getMonth(), day = base.getDate();
  // construct an East8-local time as UTC ms by computing UTC ms for the given local time
  // Create a Date object in UTC representing the same instant: Date.UTC(year,month,day+plusDays,hh,mm) - shift by 8h
  const utcMs = Date.UTC(year, month, day + (plusDays||0), hh, mm, 0) - (EAST8_OFFSET*60000);
  return new Date(utcMs);
}

// parse raw flights from text; supports multi-segment (multiple '出发'/'到达' pairs)
function parseFlightData(raw){
  const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for(const line of lines){
    const f = { raw: line, segments: [] };
    // flightNo
    const mNo = line.match(/【([^】]+)】/);
    if(mNo) f.flightNo = mNo[1].trim();

    // aircraft
    const mAc = line.match(/〔([^〕]+)〕/);
    if(mAc) f.aircraft = mAc[1].trim();

    // airline
    const mAir = line.match(/『([^』]+)』/);
    if(mAir) f.airline = mAir[1].trim();

    // registration id inside <>
    const mReg = line.match(/<([^>]+)>/);
    if(mReg) f.registration = mReg[1].trim();

    // days in « »
    const mDays = line.match(/«([^»]+)»/);
    if(mDays) f.days = mDays[1].split(",").map(s=>s.trim());

    // fares optional
    const mEco = line.match(/§([^§]+)§/);
    if(mEco) f.economy = mEco[1].trim();
    const mBiz = line.match(/θ([^θ]+)θ/);
    if(mBiz) f.business = mBiz[1].trim();

    // extract all departure/arrival pairs
    // use global regex to find 《...出发》{time}#+n#@...@ and 《...到达》{time}#+n#@...@
    const segRegex = /《([^》]+?)出发》\{([^}]+)\}#\+?(\d+)#@([^@]+)@|《([^》]+?)到达》\{([^}]+)\}#\+?(\d+)#@([^@]+)@/g;
    // We'll manually parse by searching for '出发' then nearest following '到达'
    try{
      // Find indices of "《...出发》{time}#+n#@...@" occurrences
      const depRegex = /《([^》]+?)出发》\{([^}]+)\}#\+?(\d+)#@([^@]+)@/g;
      const arrRegex = /《([^》]+?)到达》\{([^}]+)\}#\+?(\d+)#@([^@]+)@/g;
      const depMatches = [...line.matchAll(depRegex)];
      const arrMatches = [...line.matchAll(arrRegex)];
      // pair them in order: assume same count or arr may follow
      const count = Math.max(depMatches.length, arrMatches.length);
      for(let i=0;i<count;i++){
        const d = depMatches[i];
        const a = arrMatches[i];
        if(d && a){
          const seg = {
            dep: d[1].trim(),
            depTime: d[2].trim(),
            depPlus: Number(d[3]||0),
            depTerminal: d[4].trim(),
            arr: a[1].trim(),
            arrTime: a[2].trim(),
            arrPlus: Number(a[3]||0),
            arrTerminal: a[4].trim()
          };
          f.segments.push(seg);
        } else if(d && !a){
          // incomplete pair: only departure found
          const seg = {
            dep: d[1].trim(),
            depTime: d[2].trim(),
            depPlus: Number(d[3]||0),
            depTerminal: d[4].trim(),
            arr: null, arrTime: null, arrPlus:0, arrTerminal:null
          };
          f.segments.push(seg);
        } else if(!d && a){
          // only arrival (rare)
          const seg = {
            dep: null, depTime: null, depPlus:0, depTerminal:null,
            arr: a[1].trim(),
            arrTime: a[2].trim(),
            arrPlus: Number(a[3]||0),
            arrTerminal: a[4].trim()
          };
          f.segments.push(seg);
        }
      }
      // If no structured matches (older format), attempt simple fallback
      if(f.segments.length === 0){
        const simple = line.match(/《([^》]+?)出发》\{([^}]+)\}[\s\S]*?《([^》]+?)到达》\{([^}]+)\}/);
        if(simple){
          f.segments.push({
            dep: simple[1].trim(), depTime: simple[2].trim(), depPlus:0,
            arr: simple[3].trim(), arrTime: simple[4].trim(), arrPlus:0
          });
        }
      }
    }catch(e){
      console.warn("segment parse error", e, line);
    }

    out.push(f);
  }
  return out;
}

// =================== airport lookup (by name or code or alias) ===================
function airportByName(name){
  if(!name) return null;
  const n = name.toLowerCase().trim();
  for(const ap of airportDB){
    if((ap.code && ap.code.toLowerCase() === n) || (ap.name && ap.name.toLowerCase() === n)) return ap;
  }
  for(const ap of airportDB){
    if(ap.name && ap.name.toLowerCase().includes(n)) return ap;
    if(ap.aliases && ap.aliases.some(a=>a.toLowerCase().includes(n))) return ap;
    if(ap.code && ap.code.toLowerCase().includes(n)) return ap;
  }
  return null;
}

// =================== parsing + rendering ===================
function loadData(){
  // airports
  fetch("data/airports.json").then(r=>r.json()).then(data=>{
    airportDB = data;
    renderAirports();
  }).catch(e=>{
    console.error("加载 airports.json 失败", e);
    airportDB = [];
  });

  // flights
  fetch("data/flight_data.txt").then(r=>r.text()).then(txt=>{
    flights = parseFlightData(txt);
    // render
    renderFlights(getFlightIDFromURL());
  }).catch(e=>{
    console.error("加载 flight_data.txt 失败", e);
    flights = [];
  });

  // start auto refresh
  startAutoRefresh();
  startAnimationLoop();
}

// compute bearing (degrees) from lat1/lng1 to lat2/lng2
function bearing(lat1,lng1,lat2,lng2){
  const toRad = Math.PI/180, toDeg = 180/Math.PI;
  const φ1 = lat1*toRad, φ2 = lat2*toRad;
  const Δλ = (lng2-lng1)*toRad;
  const y = Math.sin(Δλ)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y,x)*toDeg + 360) % 360;
}

// returns current status of a flight: {status: 'notoday'|'preparing'|'inflight'|'arrived', segmentIndex, depDate, arrDate, ratio}
function flightStatusAndPosition(f){
  // find segment that matches today/day offsets and schedule
  // For each segment compute depDate and arrDate in East8 timezone based on plus offsets (use east8DateForTime)
  const eNow = nowInE8();
  const weekday = eNow.toLocaleString('en-US', {weekday:'short'}).toUpperCase(); // e.g., "MON"
  // check schedule days: if f.days exists, confirm today
  if(f.days && f.days.length>0 && f.days.indexOf(weekday) === -1){
    // not running today
    return {status:'notoday', segmentIndex:null};
  }

  for(let i=0;i<f.segments.length;i++){
    const seg = f.segments[i];
    if(!seg.depTime || !seg.arrTime) continue; // incomplete, skip
    const depDate = east8DateForTime(seg.depTime, seg.depPlus || 0);
    let arrDate = east8DateForTime(seg.arrTime, seg.arrPlus || 0);
    // sometimes arr <= dep -> increment arr day
    if(arrDate.getTime() <= depDate.getTime()) arrDate = new Date(arrDate.getTime() + 24*3600*1000);

    if(eNow.getTime() < depDate.getTime()){
      // preparing (before takeoff)
      return {status:'preparing', segmentIndex:i, depDate, arrDate, ratio:0};
    } else if(eNow.getTime() >= depDate.getTime() && eNow.getTime() <= arrDate.getTime()){
      const ratio = (eNow.getTime() - depDate.getTime())/(arrDate.getTime() - depDate.getTime());
      return {status:'inflight', segmentIndex:i, depDate, arrDate, ratio};
    } else {
      // after this segment; continue to next segment (could be multi-segment)
      continue;
    }
  }
  // if we reach here, all segments are passed -> arrived
  const last = f.segments[f.segments.length-1];
  if(last && last.arrTime){
    const arrDate = east8DateForTime(last.arrTime, last.arrPlus || 0);
    // ensure arrDate > dep maybe adjust
    return {status:'arrived', segmentIndex: f.segments.length -1, depDate: null, arrDate, ratio:1};
  }
  return {status:'unknown', segmentIndex:null};
}

// render airports
function renderAirports(){
  // clear existing
  airportMarkers.forEach(m=>map.removeLayer(m));
  airportMarkers = [];

  for(const ap of airportDB){
    // create divIcon with concentric circle & label
    const html = `<div class="airport-wrapper">
      <div class="airport-icon" title="${ap.name}">
        <div class="outer"></div>
        <div style="width:8px;height:8px;border-radius:50%;background:${getComputedStyle(document.documentElement).getPropertyValue('--primary')||'#1D4886'}"></div>
      </div>
      <div class="airport-label">${ap.code}</div>
    </div>`;
    const icon = L.divIcon({ className: 'airport-divicon', html, iconSize: [100,24], iconAnchor:[8,8]});
    const mk = L.marker([ap.lat, ap.lng], { icon }).addTo(map);
    mk.on('click', ()=> showAirportCard(ap));
    airportMarkers.push(mk);

    // show/hide label
    const el = mk.getElement();
    if(el){
      const lbl = el.querySelector('.airport-label');
      if(lbl) lbl.style.display = showAirportLabels ? 'inline' : 'none';
    }
  }
}

// render flights
function renderFlights(filterID=null){
  // clear old markers/polylines
  Object.values(markers).forEach(m=>map.removeLayer(m));
  Object.values(polylines).forEach(p=>map.removeLayer(p));
  markers = {}; polylines = {}; targetPositions = {};

  const filter = filterID ? filterID.toUpperCase() : null;
  const eNow = nowInE8();

  flights.forEach(f=>{
    // if filter and showOnlyFiltered: hide others
    if(filter && showOnlyFiltered){
      // match by flightNo or registration or id (id might be same as registration or flightNo)
      const matches = (f.flightNo && f.flightNo.toUpperCase() === filter) ||
                      (f.registration && f.registration.toUpperCase() === filter) ||
                      (f.raw && f.raw.toUpperCase().includes(filter));
      if(!matches) return;
    } else if(filter){
      // not hiding others, but we will still highlight matched later
    }

    // Determine status
    const st = flightStatusAndPosition(f);
    if(st.status === 'notoday' || st.status === 'unknown') {
      // not show if not operating today (user requested that)
      return;
    }

    if(st.status === 'preparing'){
      // you asked: if preparing or arrived, do not show on map — user requested: only flying shown
      // But you said you may want preparating/arrived to display if single-flight mode; so only show 'preparing' when filterID equals this flight
      const fid = filter;
      const matches = fid && ((f.flightNo && f.flightNo.toUpperCase() === fid) || (f.registration && f.registration.toUpperCase() === fid) || (f.raw && f.raw.toUpperCase().includes(fid)));
      if(!matches){
        return;
      }
      // else show as special (on-ground)
    }

    // For inflight or when matched by filter, compute position
    const segIdx = st.segmentIndex;
    if(segIdx == null) return;
    const seg = f.segments[segIdx];
    const depAirport = airportByName(seg.dep);
    const arrAirport = airportByName(seg.arr);
    if(!depAirport || !arrAirport){
      // if airport unknown, skip rendering.
      return;
    }

    // compute position along great circle? We'll linearly interpolate lat/lng (sufficient for visualization)
    const ratio = st.ratio || 0;
    const lat = depAirport.lat + (arrAirport.lat - depAirport.lat) * ratio;
    const lng = depAirport.lng + (arrAirport.lng - depAirport.lng) * ratio;

    // draw polyline for the whole route (all segments of flight)
    // For multi-segment, draw lines between segment endpoints
    const coords = [];
    for(const s of f.segments){
      const da = airportByName(s.dep);
      const aa = airportByName(s.arr);
      if(da) coords.push([da.lat, da.lng]);
      if(aa) coords.push([aa.lat, aa.lng]);
    }
    // remove duplicates
    const uniqCoords = coords.filter((c,i,arr)=> i===0 || (c[0] !== arr[i-1][0] || c[1] !== arr[i-1][1]));
    const line = L.polyline(uniqCoords, { color: '#FAA43A', weight: 2, dashArray:'6 6', opacity: 0.9 }).addTo(map);
    polylines[f.flightNo + (f.registration || '')] = line;

    // plane icon (divIcon) rotated: default PNG points up (north). rotate by bearing.
    const ang = bearing(depAirport.lat, depAirport.lng, arrAirport.lat, arrAirport.lng);
    const imgSrc = "https://i.imgur.com/4bZtV3y.png"; // replaceable
    const planeHtml = `<div style="transform:rotate(${ang}deg);"><img src="${imgSrc}" style="width:34px;height:34px;display:block;"/></div>`;
    const divIcon = L.divIcon({ className: 'plane-div-icon', html: planeHtml, iconSize:[34,34], iconAnchor:[17,17]});
    const mk = L.marker([lat, lng], { icon: divIcon, zIndexOffset:500 }).addTo(map);
    mk.flight = f;
    mk.segmentIndex = segIdx;
    mk.depAirport = depAirport;
    mk.arrAirport = arrAirport;
    mk.ratio = ratio;
    mk.angle = ang;

    // tooltip flight no
    if(showFlightNo && f.flightNo){
      mk.bindTooltip(f.flightNo, {permanent:true, direction:'right', className:'flight-label'});
    }

    mk.on('click', ()=> showInfoCard(f, segIdx));

    markers[f.flightNo + (f.registration || '')] = mk;
    targetPositions[f.flightNo + (f.registration || '')] = { lat, lng, ang };
  });

  // update sidebar lists
  refreshFlightLists();
}

// show flight info card
function showInfoCard(f, segIdx){
  const card = document.getElementById('infoCard');
  const seg = f.segments[segIdx];
  const st = flightStatusAndPosition(f);
  const depAirport = airportByName(seg.dep);
  const arrAirport = airportByName(seg.arr);
  const depDate = st.depDate || east8DateForTime(seg.depTime, seg.depPlus || 0);
  const arrDate = st.arrDate || east8DateForTime(seg.arrTime, seg.arrPlus || 0);
  const reg = f.registration || '—';
  const percent = Math.max(0, Math.min(100, Math.round((st.ratio||0)*100)));

  card.innerHTML = `
    <h3>${f.flightNo || '—'} · ${f.airline || ''}</h3>
    <div class="info-row">
      <div>
        <div class="info-sub"><b>起飞</b></div>
        <div>${depAirport ? depAirport.name + ' ('+depAirport.code+')' : seg.dep || '—'} ${formatE8(depDate)}</div>
      </div>
      <div>
        <div class="info-sub"><b>到达</b></div>
        <div>${arrAirport ? arrAirport.name + ' ('+arrAirport.code+')' : seg.arr || '—'} ${formatE8(arrDate)}</div>
      </div>
    </div>
    <div style="margin-top:8px">
      <div class="info-sub">机型：${f.aircraft || '—'} · 注册号：${reg}</div>
      <div class="info-sub">航班进度：${percent}%</div>
      <div class="prog" style="height:8px;margin-top:6px;background:#e6eefb;border-radius:6px;overflow:hidden">
        <i style="display:block;height:100%;width:${percent}%;background:var(--accent)"></i>
      </div>
    </div>
    <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn ghost" id="btn-related">查找前后序航程</button>
      <button class="btn primary" id="btn-zoom">聚焦航班</button>
    </div>
  `;
  card.classList.remove('hidden');

  document.getElementById('btn-zoom').onclick = ()=>{
    // zoom to flight marker if present
    const key = f.flightNo + (f.registration || '');
    const mk = markers[key];
    if(mk) map.setView(mk.getLatLng(), 6);
  };
  document.getElementById('btn-related').onclick = ()=>{
    if(!f.registration) return showToast('无注册号，无法查找前后序航程');
    const regs = flights.filter(x=>x.registration && x.registration === f.registration);
    if(regs.length <= 1) return showToast('未找到前后序航程');
    // show in sidebar
    const flightList = document.getElementById('flightList');
    flightList.innerHTML = regs.map(r=>`<div class="flight-card"><b>${r.flightNo}</b><div class="meta">${r.airline||''} ${r.aircraft||''}</div></div>`).join('');
    document.getElementById('sidebar').classList.remove('hidden');
  };
}

// format date in East8 timezone as string
function formatE8(d){
  if(!d) return '';
  const opts = { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' };
  // We must display d in East8. d is a Date object representing UTC ms; to properly format in E8, compute offset.
  const utcMs = d.getTime();
  const e8 = new Date(utcMs + EAST8_OFFSET*60000);
  // get components
  const Y = e8.getFullYear(), M = String(e8.getMonth()+1).padStart(2,'0'), D = String(e8.getDate()).padStart(2,'0');
  const hh = String(e8.getHours()).padStart(2,'0'), mm = String(e8.getMinutes()).padStart(2,'0');
  return `${Y}-${M}-${D} ${hh}:${mm} (UTC+8)`;
}

// refresh flight lists in sidebar and mobile
function refreshFlightLists(){
  const flightList = document.getElementById('flightList');
  const mobileList = document.getElementById('mobileList');
  const entries = Object.values(markers).map(mk=>{
    const f = mk.flight;
    const percent = Math.round((mk.ratio||0)*100);
    return { flightNo: f.flightNo, airline: f.airline, dep: mk.depAirport ? mk.depAirport.code : (f.segments[0] ? f.segments[0].dep : ''), arr: mk.arrAirport? mk.arrAirport.code : (f.segments[0]? f.segments[0].arr : ''), percent };
  }).sort((a,b)=>a.percent - b.percent);

  if(entries.length === 0){
    flightList.innerHTML = `<div style="color:var(--muted);padding:12px">当前无显示航班（或不在飞行时间范围内）。</div>`;
    mobileList.innerHTML = flightList.innerHTML;
    return;
  }

  flightList.innerHTML = entries.map(e=>`
    <div class="flight-card" data-flight="${e.flightNo}">
      <div><b>${e.flightNo}</b> · <span class="meta">${e.airline || ''}</span></div>
      <div class="meta">${e.dep} → ${e.arr}</div>
      <div class="prog"><i style="width:${e.percent}%;"></i></div>
    </div>
  `).join('');
  mobileList.innerHTML = flightList.innerHTML;

  // attach click handlers
  [...flightList.querySelectorAll('.flight-card')].forEach(el=>{
    el.addEventListener('click', ()=>{
      const fn = el.getAttribute('data-flight');
      // find marker
      const key = Object.keys(markers).find(k=>k.includes(fn));
      if(key && markers[key]){
        const mk = markers[key];
        map.setView(mk.getLatLng(), Math.max(map.getZoom(),6));
        showInfoCard(mk.flight, mk.segmentIndex);
      }
    });
  });
}

// search
function doSearch(txt){
  txt = (txt||'').trim();
  if(!txt) return showToast('请输入搜索内容');
  const q = txt.toLowerCase();

  // search flights
  const hits = flights.filter(f=>{
    if(f.flightNo && f.flightNo.toLowerCase().includes(q)) return true;
    if(f.registration && f.registration.toLowerCase().includes(q)) return true;
    // search dep/arr airport names or codes
    for(const s of f.segments){
      if(s.dep && s.dep.toLowerCase().includes(q)) return true;
      if(s.arr && s.arr.toLowerCase().includes(q)) return true;
    }
    return false;
  });

  if(hits.length>0){
    const first = hits[0];
    // try to focus marker
    const key = Object.keys(markers).find(k => (markers[k].flight && markers[k].flight.flightNo === first.flightNo) || (markers[k].flight && markers[k].flight.registration === first.registration));
    if(key && markers[key]){
      map.setView(markers[key].getLatLng(), 6);
      showInfoCard(markers[key].flight, markers[key].segmentIndex);
      return;
    } else {
      // maybe airports search
      const ap = airportDB.find(a => a.code && a.code.toLowerCase() === q) || airportByName(txt);
      if(ap){
        map.setView([ap.lat, ap.lng], 6);
        showAirportCard(ap);
        return;
      }
      showToast('搜索到数据但当前不在显示航班或非飞行时刻');
      return;
    }
  } else {
    // maybe airport
    const ap = airportDB.find(a => a.code && a.code.toLowerCase() === q) || airportByName(txt);
    if(ap){
      map.setView([ap.lat, ap.lng], 6);
      showAirportCard(ap);
      return;
    }
    showToast('未找到匹配项');
  }
}

// start auto-refresh
let refreshTimer = null;
function startAutoRefresh(){
  if(refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(()=> {
    doRefresh();
  }, refreshInterval);
}

// refresh (reload flights file and rerender)
function doRefresh(){
  fetch('data/flight_data.txt', {cache:'no-store'}).then(r=>r.text()).then(txt=>{
    flights = parseFlightData(txt);
    renderFlights(getFlightIDFromURL());
    renderAirports();
  }).catch(e=>{
    console.error('refresh failed', e);
  });
}

// animation loop (smoothly move existing markers toward targetPositions)
function animate(){
  const now = Date.now();
  const dt = now - lastRenderTime;
  lastRenderTime = now;
  const keys = Object.keys(targetPositions);
  for(const k of keys){
    const tgt = targetPositions[k];
    const mk = markers[k];
    if(!mk) continue;
    // current
    const cur = mk.getLatLng();
    // linear interpolate with factor
    const factor = 0.12; // smoothing factor (tweakable)
    const newLat = cur.lat + (tgt.lat - cur.lat) * factor;
    const newLng = cur.lng + (tgt.lng - cur.lng) * factor;
    const newAng = tgt.ang; // immediate rotate to target angle
    mk.setLatLng([newLat, newLng]);
    // rotate DOM img if exists
    const el = mk.getElement();
    if(el){
      const img = el.querySelector('img');
      if(img){
        img.style.transform = `rotate(${newAng}deg)`;
      }
    }
  }
  animRequest = requestAnimationFrame(animate);
}

function startAnimationLoop(){
  if(!animRequest) animRequest = requestAnimationFrame(animate);
}

// show airport card
function showAirportCard(ap){
  const card = document.getElementById('infoCard');
  card.innerHTML = `
    <h3>${ap.name} (${ap.code})</h3>
    ${ap.level?`<div class="info-sub">机场等级：${ap.level}</div>`:""}
    ${ap.runways?`<div class="info-sub">跑道数量：${ap.runways}</div>`:""}
  `;
  card.classList.remove('hidden');
}

// toast
function showToast(txt,ms=2000){
  const t = document.getElementById('toast');
  t.textContent = txt;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(()=> t.classList.add('hidden'), ms);
}

// parse URL param
function getFlightIDFromURL(){
  const id = new URLSearchParams(location.search).get('flights_map') || new URLSearchParams(location.search).get('id');
  return id;
}

// ========== UI init ============
function initToolbar(){
  // load saved toggles
  document.getElementById('toggleFlightNo').checked = showFlightNo;
  document.getElementById('toggleAirportLabels').checked = showAirportLabels;
  document.getElementById('mapModeTiles').checked = (localStorage.getItem('mapMode') || 'tiles') === 'tiles';
  document.getElementById('mapModeAbstract').checked = (localStorage.getItem('mapMode') || 'tiles') === 'abstract';
  document.getElementById('chkOnlyFiltered').checked = showOnlyFiltered;
  document.getElementById('refreshInterval').value = Math.round(refreshInterval/1000);

  document.getElementById('toggleFlightNo').addEventListener('change', (e)=>{
    showFlightNo = e.target.checked;
    localStorage.setItem('showFlightNo', showFlightNo);
    renderFlights(getFlightIDFromURL());
  });
  document.getElementById('toggleAirportLabels').addEventListener('change', (e)=>{
    showAirportLabels = e.target.checked;
    localStorage.setItem('showAirportLabels', showAirportLabels);
    renderAirports();
  });

  // search
  document.getElementById('searchBtn').addEventListener('click', ()=> doSearch(document.getElementById('searchInput').value));
  document.getElementById('searchInput').addEventListener('keydown', (e)=> { if(e.key === 'Enter') doSearch(e.target.value); });
  document.getElementById('clearSearchBtn').addEventListener('click', ()=> {
    document.getElementById('searchInput').value = '';
    renderFlights(getFlightIDFromURL());
  });

  // sidebar toggle
  document.getElementById('btn-sidebar-toggle').addEventListener('click', ()=>{
    document.getElementById('sidebar').classList.toggle('hidden');
  });

  // map mode radio
  document.getElementById('mapModeTiles').addEventListener('change', ()=> {
    if(document.getElementById('mapModeTiles').checked) setMapMode('tiles');
  });
  document.getElementById('mapModeAbstract').addEventListener('change', ()=> {
    if(document.getElementById('mapModeAbstract').checked) setMapMode('abstract');
  });

  // settings save
  document.getElementById('btn-save-settings').addEventListener('click', ()=>{
    showOnlyFiltered = document.getElementById('chkOnlyFiltered').checked;
    localStorage.setItem('showOnlyFiltered', showOnlyFiltered);
    const sec = Number(document.getElementById('refreshInterval').value) || 180;
    refreshInterval = sec * 1000;
    localStorage.setItem('refreshInterval', refreshInterval);
    startAutoRefresh();
    showToast('设置已保存');
    renderFlights(getFlightIDFromURL());
  });

  document.getElementById('btn-refresh').addEventListener('click', ()=> doRefresh());
}

// ========== startup ============
window.addEventListener('load', ()=>{
  initMap();
  initToolbar();
  loadData();
});
