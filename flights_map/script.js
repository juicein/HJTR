// --- 配置和初始化 ---

const FLIGHT_DATA_URL = '../data/flight_data.txt';
const AIRPORT_DATA_URL = '../data/airports.json';
const MAP_ID = 'map';
const MAP_OPTIONS = {
    center: [47.9, 66.7], // 居中在拜科努尔和千里马之间
    zoom: 7,
    minZoom: 2,
    worldCopyJump: true // 允许跨越世界边缘
};

// 全局存储
let airportsData = {}; // 以CODE为键的机场数据
let allFlightsData = []; // 解析后的原始航班数据
let flightMarkers = {}; // 存储地图上的飞机Marker

// 初始化 Leaflet 地图
const map = L.map(MAP_ID, MAP_OPTIONS);

// 根据系统深色模式设置地图瓦片层
const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
const TILE_URL = isDarkMode
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' // 暗色瓦片
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'; // 亮色瓦片（可替换为更抽象的）

L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors | Powered by JinHao Aviation'
}).addTo(map);

// --- 数据解析和计算函数 ---

/**
 * 解析原始航班数据格式
 * @param {string} rawData - 整个文件的文本内容
 * @returns {Array<Object>} 结构化的航班列表
 */
function parseFlightData(rawData) {
    const flights = [];
    const lines = rawData.trim().split('\n');
    
    // 正则表达式用于精确提取字段
    const regex = /【(.*?)】〈.*?〉«(.*?)»〔(.*?)〕『(.*?)』《(.*?)出发》\{(.*?)\}#.*?#@(.*?)@《(.*?)到达》\{(.*?)\}#.*?#@(.*?)@ (.*?)<(\w+)>《航班结束》/;

    for (const line of lines) {
        const match = line.match(regex);
        if (match) {
            const [, flightNumber, daysOfWeekStr, aircraft, airline, depName, depTime, depTerminal, arrName, arrTime, arrTerminal, , flightCode] = match;
            
            flights.push({
                flightNumber: flightNumber.trim(),
                daysOfWeek: daysOfWeekStr.split(',').map(d => d.trim()),
                aircraft: aircraft.trim(),
                airline: airline.trim(),
                departureName: depName.trim(),
                departureTime: depTime.trim(),
                arrivalName: arrName.trim(),
                arrivalTime: arrTime.trim(),
                flightCode: flightCode.trim(), // 唯一识别码
            });
        }
    }
    return flights;
}

/**
 * 从机场别名获取规范的机场数据
 * @param {string} alias - 机场的别名或名称
 * @returns {Object|null} 机场数据对象
 */
function getAirport(alias) {
    for (const code in airportsData) {
        const airport = airportsData[code];
        if (airport.name === alias || airport.aliases.includes(alias)) {
            return airport;
        }
    }
    return null;
}

/**
 * 获取当前航班状态
 * @param {Object} flight - 航班数据对象
 * @returns {Object} 包含状态、进度和描述
 */
function getFlightStatus(flight) {
    const now = new Date();
    const today = now.getDay(); // 0 (Sun) to 6 (Sat)
    const dayMap = { 'SUN': 0, 'MON': 1, 'TUE': 2, 'WED': 3, 'THU': 4, 'FRI': 5, 'SAT': 6 };
    const todayStr = Object.keys(dayMap).find(key => dayMap[key] === today);
    
    // 检查今天是否开行
    if (!flight.daysOfWeek.includes(todayStr)) {
        return { status: 'NO_FLIGHT', progress: 0, description: '今天不开行' };
    }

    // 格式化时间为Date对象（今天的日期）
    const [depHour, depMin] = flight.departureTime.split(':').map(Number);
    const depTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), depHour, depMin, 0);

    const [arrHour, arrMin] = flight.arrivalTime.split(':').map(Number);
    let arrTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), arrHour, arrMin, 0);

    // 处理跨夜航班（如果到达时间早于起飞时间，则到达时间是第二天）
    if (arrTime.getTime() < depTime.getTime()) {
        arrTime = new Date(arrTime.getTime() + 24 * 60 * 60 * 1000);
    }
    
    const totalDuration = arrTime.getTime() - depTime.getTime();
    const elapsedTime = now.getTime() - depTime.getTime();
    
    if (now.getTime() < depTime.getTime()) {
        // 准备中
        const timeUntilDep = Math.ceil((depTime.getTime() - now.getTime()) / (60 * 1000));
        return { status: 'PREPARING', progress: 0, description: `准备中，${timeUntilDep}分钟后起飞`, depTime, arrTime };
    } else if (now.getTime() >= depTime.getTime() && now.getTime() <= arrTime.getTime()) {
        // 飞行中
        const progress = elapsedTime / totalDuration;
        return { status: 'IN_FLIGHT', progress: Math.min(progress, 1), description: `飞行中，已完成${Math.round(progress * 100)}%`, depTime, arrTime };
    } else {
        // 已到达
        const landedTime = Math.ceil((now.getTime() - arrTime.getTime()) / (60 * 1000));
        return { status: 'ARRIVED', progress: 1, description: `已于${landedTime}分钟前到达`, depTime, arrTime };
    }
}

/**
 * 计算飞机当前位置的坐标和朝向 (方位角/Heading)
 * @param {Object} flight - 航班数据对象
 * @param {number} progress - 飞行进度 (0到1)
 * @returns {{lat: number, lon: number, heading: number}} 坐标和朝向
 */
function calculatePlanePosition(flight, progress) {
    const depAirport = getAirport(flight.departureName);
    const arrAirport = getAirport(flight.arrivalName);

    if (!depAirport || !arrAirport) {
        console.error("找不到机场数据", flight.departureName, flight.arrivalName);
        return null;
    }

    const startLat = depAirport.lat;
    const startLon = depAirport.lon;
    const endLat = arrAirport.lat;
    const endLon = arrAirport.lon;

    // 线性插值计算当前位置
    const lat = startLat + (endLat - startLat) * progress;
    const lon = startLon + (endLon - startLon) * progress;

    // 计算朝向 (方位角)
    // 这是一个简化版的计算（用于短途航线），长途航线需要使用大圆航线公式
    const deltaLon = endLon - startLon;
    const deltaLat = endLat - startLat;
    const headingRad = Math.atan2(deltaLon, deltaLat);
    const heading = headingRad * (180 / Math.PI);

    return { lat, lon, heading };
}

// --- 地图渲染函数 ---

/**
 * 创建自定义飞机Marker图标
 * @param {string} flightNumber - 航班号
 * @param {number} heading - 飞机朝向（度数）
 * @param {boolean} showLabel - 是否显示航班号标签
 * @returns {L.DivIcon} Leaflet DivIcon
 */
function createPlaneIcon(flightNumber, heading, showLabel) {
    const labelHtml = showLabel ? `<div class="flight-label">${flightNumber}</div>` : '';
    
    // SVG 飞机图标
    const svgIcon = `<svg class="plane-icon-svg" style="transform: rotate(${heading}deg);" viewBox="0 0 24 24">
        <path d="M11.5 2C10.7 2 10 2.7 10 3.5V11H3.5C2.7 11 2 11.7 2 12.5C2 13.3 2.7 14 3.5 14H10V20.5C10 21.3 10.7 22 11.5 22C12.3 22 13 21.3 13 20.5V14H19.5C20.3 14 21 13.3 21 12.5C21 11.7 20.3 11 19.5 11H13V3.5C13 2.7 12.3 2 11.5 2Z"/>
    </svg>`;
    
    return L.divIcon({
        className: 'plane-icon',
        html: svgIcon + labelHtml,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

/**
 * 绘制地图上的所有航班和机场
 * @param {Array<Object>} flightsToDisplay - 需要显示的航班列表 (过滤后的)
 * @param {string|null} singleFlightCode - 如果只显示单个航班，则为它的 flightCode
 */
function renderMap(flightsToDisplay, singleFlightCode = null) {
    // 清除所有图层（确保刷新时不留旧Marker）
    map.eachLayer(layer => {
        if (layer instanceof L.Marker || layer instanceof L.Polyline) {
            map.removeLayer(layer);
        }
        // Leaflet 瓦片层不要移除
    });
    
    flightMarkers = {}; // 重置飞机Marker存储

    const allAirportsInUse = new Set();
    const showLabel = document.getElementById('toggle-flight-number').checked;

    flightsToDisplay.forEach(flight => {
        const statusData = getFlightStatus(flight);
        const depAirport = getAirport(flight.departureName);
        const arrAirport = getAirport(flight.arrivalName);

        if (!depAirport || !arrAirport) return; // 缺少机场数据则跳过

        // 记录使用的机场
        allAirportsInUse.add(depAirport.code);
        allAirportsInUse.add(arrAirport.code);

        const depLatLng = [depAirport.lat, depAirport.lon];
        const arrLatLng = [arrAirport.lat, arrAirport.lon];
        
        // 1. 绘制虚线航线（所有航班都绘制，但只有飞行中的显示飞机）
        const polyline = L.polyline([depLatLng, arrLatLng], {
            color: '#007bff', 
            weight: 2, 
            dashArray: '5, 10', 
            opacity: 0.5
        }).addTo(map);

        // 2. 只有飞行中才绘制飞机图标
        if (statusData.status === 'IN_FLIGHT') {
            const pos = calculatePlanePosition(flight, statusData.progress);
            if (!pos) return;

            const icon = createPlaneIcon(flight.flightNumber, pos.heading, showLabel);
            const marker = L.marker([pos.lat, pos.lon], { icon: icon, zIndexOffset: 100 }).addTo(map);
            
            // 点击飞机显示信息卡片
            marker.on('click', () => showDetailCard('flight', flight, statusData));
            
            flightMarkers[flight.flightNumber] = { marker, flight, statusData, pos };
        }
        
        // 如果是单个航班模式，更新信息板
        if (singleFlightCode && flight.flightCode === singleFlightCode) {
             document.getElementById('flight-status').innerHTML = `
                <strong>${flight.flightNumber} (${flight.flightCode})</strong><br>
                状态: ${statusData.description}<br>
                航线: ${flight.departureName} → ${flight.arrivalName}<br>
                起降: ${flight.departureTime} / ${flight.arrivalTime}
            `;
        }
    });
    
    // 3. 绘制机场Marker (只绘制在当前航线中使用的机场)
    allAirportsInUse.forEach(code => {
        const airport = airportsData[code];
        const icon = L.divIcon({
            className: 'airport-icon',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        const marker = L.marker([airport.lat, airport.lon], { icon: icon }).addTo(map);
        
        // 点击机场显示信息卡片
        marker.on('click', () => showDetailCard('airport', airport));
    });
}

/**
 * 刷新地图上的飞机位置和状态
 */
function updatePlanePositions() {
    const showLabel = document.getElementById('toggle-flight-number').checked;

    for (const flightNumber in flightMarkers) {
        const { marker, flight } = flightMarkers[flightNumber];
        const statusData = getFlightStatus(flight);
        
        if (statusData.status === 'IN_FLIGHT') {
            const pos = calculatePlanePosition(flight, statusData.progress);
            if (pos) {
                // 更新位置
                marker.setLatLng([pos.lat, pos.lon]);
                
                // 更新图标（旋转和标签）
                const newIcon = createPlaneIcon(flightNumber, pos.heading, showLabel);
                marker.setIcon(newIcon);
                
                // 更新存储的状态
                flightMarkers[flightNumber].statusData = statusData;
                flightMarkers[flightNumber].pos = pos;
            }
        } else {
            // 如果航班已结束或未开始，移除飞机
            map.removeLayer(marker);
            delete flightMarkers[flightNumber];
        }
    }
    
    // 如果单个航班的卡片已打开，更新卡片内容
    const detailCard = document.getElementById('flight-detail-card');
    if (!detailCard.classList.contains('hidden') && detailCard.dataset.type === 'flight') {
        const currentFlightNumber = detailCard.dataset.id;
        if (flightMarkers[currentFlightNumber]) {
            showDetailCard('flight', flightMarkers[currentFlightNumber].flight, flightMarkers[currentFlightNumber].statusData);
        } else {
             // 航班已到达或取消，关闭卡片
             detailCard.classList.add('hidden');
        }
    }

    // 更新信息板（针对单航班模式）
    const params = new URLSearchParams(window.location.search);
    const flightCodeParam = params.get('flights_map');
    if (flightCodeParam) {
        const singleFlight = allFlightsData.find(f => f.flightCode.toLowerCase() === flightCodeParam.toLowerCase());
        if (singleFlight) {
            const statusData = getFlightStatus(singleFlight);
            document.getElementById('flight-status').innerHTML = `
                <strong>${singleFlight.flightNumber} (${singleFlight.flightCode})</strong><br>
                状态: ${statusData.description}<br>
                航线: ${singleFlight.departureName} → ${singleFlight.arrivalName}<br>
                起降: ${singleFlight.departureTime} / ${singleFlight.arrivalTime}
            `;
        }
    }
}


/**
 * 显示详情卡片（飞机或机场）
 * @param {string} type - 'flight' 或 'airport'
 * @param {Object} data - 数据对象
 * @param {Object} [statusData] - 航班状态数据
 */
function showDetailCard(type, data, statusData = null) {
    const card = document.getElementById('flight-detail-card');
    let htmlContent = '';
    
    card.dataset.type = type;

    if (type === 'flight') {
        card.dataset.id = data.flightNumber;
        const depAirport = getAirport(data.departureName);
        const arrAirport = getAirport(data.arrivalName);

        htmlContent = `
            <h3>${data.flightNumber} - ${data.flightCode}</h3>
            <p><strong>状态:</strong> ${statusData.description}</p>
            <p><strong>航线:</strong> ${data.departureName} (${depAirport ? depAirport.code : '?'}) → ${data.arrivalName} (${arrAirport ? arrAirport.code : '?'})</p>
            <p><strong>机型:</strong> ${data.aircraft}</p>
            <p><strong>起飞/降落:</strong> ${data.departureTime} / ${data.arrivalTime}</p>
            <p><strong>开行日期:</strong> ${data.daysOfWeek.join(', ')}</p>
        `;
    } else if (type === 'airport') {
        card.dataset.id = data.code;
        htmlContent = `
            <h3>${data.name} (${data.code})</h3>
            <p><strong>跑道数量:</strong> ${data.runways || 'N/A'}</p>
            <p><strong>跑道等级:</strong> ${data.runway_grades || 'N/A'}</p>
            <p><strong>坐标:</strong> ${data.lat.toFixed(2)}, ${data.lon.toFixed(2)}</p>
        `;
    }

    card.innerHTML = htmlContent;
    card.classList.remove('hidden');
}

// --- 主要流程和事件处理 ---

/**
 * 初始化所有数据和渲染
 */
async function initialize() {
    try {
        // 1. 获取机场数据
        const airportResponse = await fetch(AIRPORT_DATA_URL);
        const rawAirports = await airportResponse.json();
        rawAirports.forEach(a => airportsData[a.code] = a);

        // 2. 获取航班数据
        const flightResponse = await fetch(FLIGHT_DATA_URL);
        const rawFlightData = await flightResponse.text();
        allFlightsData = parseFlightData(rawFlightData);
        
        // 3. 处理URL参数
        const params = new URLSearchParams(window.location.search);
        const flightCodeParam = params.get('flights_map');

        let flightsToRender = allFlightsData;
        
        // 如果有特定的航班号，则只显示该航班及其前后续（这里只处理单航班）
        if (flightCodeParam) {
            const singleFlight = allFlightsData.find(f => f.flightCode.toLowerCase() === flightCodeParam.toLowerCase());
            if (singleFlight) {
                flightsToRender = [singleFlight];
                document.getElementById('info-board').style.display = 'block';
                document.getElementById('flight-status').textContent = '正在计算航班状态...';
            } else {
                // 未找到特定航班，显示所有，并提示
                document.getElementById('flight-status').textContent = `未找到航班 ${flightCodeParam}，显示所有航班。`;
                // 确保在显示所有航班模式下不显示单航班信息板
                document.getElementById('info-board').style.display = 'none';
            }
        } else {
            // 没有参数，显示所有航班，隐藏单航班信息板
            document.getElementById('info-board').style.display = 'none';
        }

        // 4. 初次渲染地图
        renderMap(flightsToRender, flightCodeParam);

        // 5. 启动实时位置更新
        setInterval(updatePlanePositions, 10000); // 每10秒刷新一次位置
        
        // 确保单航班模式下地图居中到航线
        if (flightsToRender.length === 1 && flightsToRender[0]) {
            const flight = flightsToRender[0];
            const depAirport = getAirport(flight.departureName);
            const arrAirport = getAirport(flight.arrivalName);
            if (depAirport && arrAirport) {
                const bounds = L.latLngBounds([depAirport.lat, depAirport.lon], [arrAirport.lat, arrAirport.lon]);
                map.fitBounds(bounds.pad(0.5)); // 放大一点，pad(0.5) 增加50%的边缘
            }
        }
        
    } catch (error) {
        console.error("加载或解析数据失败:", error);
        document.getElementById('flight-status').textContent = "数据加载失败，请检查文件路径和格式。";
    }
}

// --- UI 事件和本地存储 ---

const toggleSwitch = document.getElementById('toggle-flight-number');
const STORAGE_KEY = 'showFlightNumber';

// 加载状态
const storedState = localStorage.getItem(STORAGE_KEY);
if (storedState !== null) {
    toggleSwitch.checked = storedState === 'true';
}

// 监听开关变化
toggleSwitch.addEventListener('change', (e) => {
    const newState = e.target.checked;
    localStorage.setItem(STORAGE_KEY, newState); // 记忆状态
    
    // 重新渲染地图以应用新的标签显示状态
    const params = new URLSearchParams(window.location.search);
    const flightCodeParam = params.get('flights_map');

    let flightsToRender = allFlightsData;
    if (flightCodeParam) {
        const singleFlight = allFlightsData.find(f => f.flightCode.toLowerCase() === flightCodeParam.toLowerCase());
        if (singleFlight) {
            flightsToRender = [singleFlight];
        }
    }
    // 重新渲染，这次只刷新飞机位置和图标，以避免重绘整个地图
    // 更高效的做法是只更新飞机Marker的Icon，但为了代码简洁，这里采用完整刷新逻辑
    renderMap(flightsToRender, flightCodeParam);
});

// 点击地图关闭详情卡片
map.on('click', () => {
    document.getElementById('flight-detail-card').classList.add('hidden');
});

// 启动应用
document.addEventListener('DOMContentLoaded', initialize);
