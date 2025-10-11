const map = document.getElementById('metro-map');
const background = document.getElementById('background')
const tooltip = document.getElementById('tooltip');
const routeResult = document.getElementById('route-result');
const routeList = document.getElementById('route-list');
const lineSummary = document.getElementById('line-summary');
const fareZoneSummary = document.getElementById('fare-zone-summary'); // 新增付费区总结元素
let zoomLevel = 1;
let startPoint = null;
let endPoint = null;
let currentStation = null;
let stationsData = {};
let linesData = {};
let offsetX = 0;
let offsetY = 0;
let startX, startY;
let maxX = 0;
let maxY = 0;
let minX = 0;
let minY = 0;
let isDragging = false;
let dragStartX, dragStartY;


// 添加线路颜色映射函数
function getLineColorByName(lineName) {
    const line = lines.find(l => l.name === lineName);
    return line ? line.color : null;
}

// 添加获取线路颜色的函数
function getLineColor(color) {
    for (const line of lines) {
        if (line.color === color) {
            return line.name;
        }
    }
    return "未知线路";
}

function drawLine(x1, y1, x2, y2, color, lineId) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", color);
    line.setAttribute("id", lineId);
    line.classList.add("line");
    map.appendChild(line);
    if (!linesData[color]) linesData[color] = [];
    linesData[color].push({ x1, y1, x2, y2, id: lineId });
}

function drawStation(x, y, name, isTransfer, lineColor, labelOffset) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.setAttribute("r", 6);
    circle.classList.add("station");
    circle.style.stroke = lineColor;
    circle.addEventListener("click", (event) => showStationInfo(circle, name, event));

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x + labelOffset.x);
    text.setAttribute("y", y + labelOffset.y);
    text.textContent = name;
    text.addEventListener("click", (event) => showStationInfo(circle, name, event));
    text.style.cursor = "pointer";

    if (isTransfer) {
        circle.setAttribute("r", 7);
        circle.style.stroke = "#888";
        circle.style.strokeWidth = 3.5;
        text.style.fontWeight = "bold";
    }

    map.appendChild(circle);
    map.appendChild(text);

    stationsData[name] = { x, y, element: circle, fareZone: lines.find(line => line.stations.some(station => station.name === name)).stations.find(station => station.name === name).fareZone };

    // Update max dimensions for auto-resizing canvas
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
}

function showStationInfo(stationOrElement, name, event) {
    // 如果传入的是DOM元素，从元素获取站名
    if (stationOrElement instanceof SVGElement) {
        const stationData = Object.entries(stationsData).find(([_, data]) => data.element === stationOrElement);
        if (stationData) {
            name = stationData[0];
        }
    }
    
    // 确保我们有站名
    if (!name || !stationsData[name]) return;
    
    currentStation = name;
    const station = stationsData[name];
    
    // 更新站点信息
    const stationNameElement = document.getElementById("station-name");
    stationNameElement.textContent = `${name}站`;
    stationNameElement.className = 'h3';

    const fareZoneInfoElement = document.getElementById("fare-zone-info");
    fareZoneInfoElement.textContent = `${station.fareZone}计费区`;

    const linesInfoElement = document.getElementById("lines-info");
    linesInfoElement.textContent = `${Array.from(new Set(getLinesForStation(name))).join('/')}`;
    
    // 显示tooltip
    const tooltip = document.getElementById('tooltip');
    tooltip.style.display = "block";
    
    // 获取tooltip的实际尺寸
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    
    // 获取鼠标点击位置
    let mouseX, mouseY;
    if (event) {
        // 如果有事件对象，使用事件的坐标
        mouseX = event.clientX;
        mouseY = event.clientY;
    } else {
        // 如果没有事件对象，使用站点在视口中的位置
        const svgRect = map.getBoundingClientRect();
        mouseX = station.x * zoomLevel + offsetX + svgRect.left;
        mouseY = station.y * zoomLevel + offsetY + svgRect.top;
    }
    
    // 计算位置，默认在鼠标左上方
    let left = mouseX - tooltipWidth - 20;
    let top = mouseY - tooltipHeight - 20;
    
    // 确保不会超出视口
    if (left < 10) {
        // 如果左侧空间不足，显示在右侧
        left = mouseX + 20;
    }
    if (top < 10) {
        // 如果上方空间不足，显示在下方
        top = mouseY + 20;
    }
    
    // 确保不会超出右侧和底部
    if (left + tooltipWidth > window.innerWidth - 10) {
        left = window.innerWidth - tooltipWidth - 10;
    }
    if (top + tooltipHeight > window.innerHeight - 10) {
        top = window.innerHeight - tooltipHeight - 10;
    }
    
    // 应用位置
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    
    // 显示背景遮罩
    background.style.display = "block";
}

function getLinesForStation(name) {
    const lines = [];
    Object.keys(linesData).forEach(color => {
        linesData[color].forEach(line => {
            const startStation = findStationByCoordinates(line.x1, line.y1);
            const endStation = findStationByCoordinates(line.x2, line.y2);
            if ((startStation && startStation.name === name) || (endStation && endStation.name === name)) {
                lines.push(getLineColor(color));
            }
        });
    });
    return lines;
}

function openWikiPage(stationName) {
    window.open(`https://wiki.shangxiaoguan.top/${encodeURIComponent(stationName)}站`, '_blank');
    setToastText("正在跳转…");
    showToast();
    setTimeout(() => hideToast(), 5000)
}

function setStartPoint(name) {
    clearRoute();
    startPoint = name;
    document.getElementById("start-search").value = name;
    hideTooltip();
    updateMarkers();
}

function setEndPoint(name) {
    endPoint = name;
    document.getElementById("end-search").value = name;
    hideTooltip();
    highlightRoute();
    updateMarkers();
}

function hideTooltip() {
    tooltip.style.display = "none";
    background.style.display = "none";
}

function clearRoute() {
    startPoint = null;
    endPoint = null;
    document.getElementById("start-search").value = "";
    document.getElementById("end-search").value = "";
    resetMap();
    routeResult.style.display = "none";
    removeMarkers();
    // 清除查询信息
    localStorage.removeItem('metroTransferQuery');
}

function resetMap() {
    // 移除调暗效果
    document.querySelectorAll('.line, .station, text').forEach(element => {
        element.classList.remove('map-dimmed');
    });
    
    // 移除高亮组
    const highlightedGroup = document.querySelector('.highlighted-group');
    if (highlightedGroup) {
        highlightedGroup.remove();
    }

    // 重置站点标记
    const stations = document.querySelectorAll(".station");
    stations.forEach(station => {
        station.classList.remove("start-point");
        station.classList.remove("end-point");
    });
}

function setGrayTextColors() {
    const grayTextItems = document.querySelectorAll('.line-stations');
    grayTextItems.forEach(item => {
        const lineColor = item.dataset.lineColor;
        if (lineColor) {
            item.style.setProperty('--line-color', lineColor);
        }
    });
}

// Dijkstra's Algorithm to find the shortest path with weights
function dijkstraFindShortestPath(graph, start, end, optimizeFor = 'time') {
    const distances = {};
    const previousNodes = {};
    const previousEdges = {};
    const unvisitedNodes = new Set(Object.keys(graph));
    const TRANSFER_TIME = 3; // 换乘等候时间（分钟）

    // 初始化距离和前置节点
    for (const node in graph) {
        distances[node] = {
            time: Infinity,
            transfers: Infinity,
            currentLine: null
        };
        previousNodes[node] = null;
        previousEdges[node] = null;
    }
    distances[start] = {
        time: 0,
        transfers: 0,
        currentLine: null
    };

    while (unvisitedNodes.size > 0) {
        // 找到当前最近的节点
        let closestNode = null;
        for (const node of unvisitedNodes) {
            if (closestNode === null || 
                (optimizeFor === 'time' && distances[node].time < distances[closestNode].time) ||
                (optimizeFor === 'transfers' && 
                    (distances[node].transfers < distances[closestNode].transfers || 
                    (distances[node].transfers === distances[closestNode].transfers && 
                     distances[node].time < distances[closestNode].time)))) {
                closestNode = node;
            }
        }

        if (distances[closestNode].time === Infinity) break;
        if (closestNode === end) break;

        unvisitedNodes.delete(closestNode);

        // 更新邻居节点的距离
        for (const neighbor in graph[closestNode]) {
            const edge = graph[closestNode][neighbor];
            const currentLine = edge.line;
            
            // 计算新的时间，包括运行时间和换乘等候时间
            let newTime = distances[closestNode].time + edge.time;
            let newTransfers = distances[closestNode].transfers;
            
            // 如果是换乘，增加换乘等候时间和换乘次数
            if (distances[closestNode].currentLine !== null && 
                currentLine !== distances[closestNode].currentLine) {
                newTransfers++;
                // 在计算最短时间时，也要考虑换乘等候时间
                newTime += TRANSFER_TIME;
            }

            // 根据优化目标决定是否更新
            let shouldUpdate = false;
            if (optimizeFor === 'time') {
                // 对于时间优化，直接比较总时间（包括换乘等待时间）
                shouldUpdate = newTime < distances[neighbor].time;
            } else if (optimizeFor === 'transfers') {
                // 对于换乘优化，优先考虑换乘次数，次要考虑总时间
                shouldUpdate = newTransfers < distances[neighbor].transfers || 
                             (newTransfers === distances[neighbor].transfers && 
                              newTime < distances[neighbor].time);
            }

            if (shouldUpdate) {
                distances[neighbor] = {
                    time: newTime,
                    transfers: newTransfers,
                    currentLine: currentLine
                };
                previousNodes[neighbor] = closestNode;
                previousEdges[neighbor] = edge;
            }
        }
    }

    // 重建路径
    const path = [];
    const edges = [];
    let currentNode = end;
    
    while (currentNode !== null) {
        path.unshift(currentNode);
        if (previousEdges[currentNode]) {
            edges.unshift(previousEdges[currentNode]);
        }
        currentNode = previousNodes[currentNode];
    }

    return {
        path,
        edges,
        totalTime: distances[end].time,  // 这里返回的时间已经包含了换乘等待时间
        totalTransfers: distances[end].transfers
    };
}

function buildWeightedGraph(lines, options = {}) {
    const graph = {};
    const { excludeAirportLine = false } = options;
    const TRANSFER_TIME = 3; // 普通换乘等候时间（分钟）
    const FAST_TRANSFER_TIME = 1.5; // 快速换乘等候时间（分钟）

    // 创建站点到线路的映射
    const stationToLines = {};
    lines.forEach(line => {
        if (excludeAirportLine && line.name === "机场线") return;
        
        line.stations.forEach((station, index) => {
            if (!stationToLines[station.name]) {
                stationToLines[station.name] = [];
            }
            // 记录站点在线路中的位置和方向终点站
            const isDownbound = index > line.stations[Math.floor(line.stations.length / 2)].index;
            const directionEndStation = isDownbound ? 
                line.stations[line.stations.length - 1].name : 
                line.stations[0].name;
            
            stationToLines[station.name].push({
                line: line.name,
                index: index,
                totalStations: line.stations.length,
                travelTime: station.travelTime,
                directionEndStation: directionEndStation
            });
        });
    });

    // 为每个站点创建线路专用的节点
    lines.forEach(line => {
        if (excludeAirportLine && line.name === "机场线") return;

        line.stations.forEach(station => {
            const nodeId = `${station.name}_${line.name}`;
            graph[nodeId] = {};
        });
    });

    // 添加同一线路上相邻站点之间的边
    lines.forEach(line => {
        if (excludeAirportLine && line.name === "机场线") return;

        line.stations.forEach((station, index) => {
            if (index > 0) {
                const prevStation = line.stations[index - 1];
                const fromNode = `${prevStation.name}_${line.name}`;
                const toNode = `${station.name}_${line.name}`;
                const travelTime = prevStation.travelTime;

                // 添加双向边
                addWeightedEdge(graph, fromNode, toNode, {
                    time: travelTime,
                    line: line.name,
                    isTransfer: false
                });
                addWeightedEdge(graph, toNode, fromNode, {
                    time: travelTime,
                    line: line.name,
                    isTransfer: false
                });
            }
        });
    });

    // 添加同一站点不同线路之间的换乘边
    Object.keys(stationToLines).forEach(stationName => {
        const stationLines = stationToLines[stationName];
        if (stationLines.length > 1) {
            for (let i = 0; i < stationLines.length; i++) {
                for (let j = i + 1; j < stationLines.length; j++) {
                    const line1 = stationLines[i];
                    const line2 = stationLines[j];
                    const fromNode = `${stationName}_${line1.line}`;
                    const toNode = `${stationName}_${line2.line}`;

                    // 判断是否为特殊换乘站
                    let transferTime = TRANSFER_TIME;
                    
                    if (stationName === "海洋基地" && 
                        ((line1.line === "1号线" && line2.line === "2号线") || 
                         (line1.line === "2号线" && line2.line === "1号线"))) {
                        // 海洋基地站：临北路方向和临南中路方向之间，或冰岭西路方向和方形广场方向之间快速换乘
                        const isValidTransfer = 
                            // 临北路方向和临南中路方向之间
                            (line1.directionEndStation === "临北路" && line2.directionEndStation === "临南中路") ||
                            (line1.directionEndStation === "临南中路" && line2.directionEndStation === "临北路") ||
                            // 冰岭西路方向和方形广场方向之间
                            (line1.directionEndStation === "冰岭西路" && line2.directionEndStation === "方形广场") ||
                            (line1.directionEndStation === "方形广场" && line2.directionEndStation === "冰岭西路");
                        
                        if (isValidTransfer) {
                            transferTime = FAST_TRANSFER_TIME;
                        }
                    } else if (stationName === "忌城路" && 
                             ((line1.line === "1号线" && line2.line === "2号线") || 
                              (line1.line === "2号线" && line2.line === "1号线"))) {
                        // 忌城路站：临北路方向和方形广场方向之间，或冰岭西路和临南中路方向之间快速换乘
                        const isValidTransfer = 
                            // 临北路方向和方形广场方向之间
                            (line1.directionEndStation === "临北路" && line2.directionEndStation === "方形广场") ||
                            (line1.directionEndStation === "方形广场" && line2.directionEndStation === "临北路") ||
                            // 冰岭西路和临南中路方向之间
                            (line1.directionEndStation === "冰岭西路" && line2.directionEndStation === "临南中路") ||
                            (line1.directionEndStation === "临南中路" && line2.directionEndStation === "冰岭西路");
                        
                        if (isValidTransfer) {
                            transferTime = FAST_TRANSFER_TIME;
                        }
                    }

                    // 添加双向换乘边
                    addWeightedEdge(graph, fromNode, toNode, {
                        time: transferTime,
                        line: line2.line,
                        isTransfer: true
                    });
                    addWeightedEdge(graph, toNode, fromNode, {
                        time: transferTime,
                        line: line1.line,
                        isTransfer: true
                    });
                }
            }
        }
    });

    return graph;
}

function addWeightedEdge(graph, from, to, weight) {
    if (!graph[from]) {
        graph[from] = {};
    }
    graph[from][to] = weight;
}

function findShortestPath(start, end) {
    const queue = [{ node: start, path: [] }];
    const visited = new Set([start]);

    while (queue.length > 0) {
        const { node, path } = queue.shift();

        if (node === end) {
            return [...path, node];
        }

        const neighbors = getNeighbors(node);
        neighbors.forEach(neigh => {
            if (!visited.has(neigh)) {
                visited.add(neigh);
                queue.push({ node: neigh, path: [...path, node] });
            }
        });
    }

    return [];
}

function getNeighbors(station) {
    const neighbors = [];
    Object.keys(linesData).forEach(color => {
        linesData[color].forEach(line => {
            const startStation = findStationByCoordinates(line.x1, line.y1);
            const endStation = findStationByCoordinates(line.x2, line.y2);
            if (startStation && startStation.name === station) {
                neighbors.push(endStation.name);
            }
            if (endStation && endStation.name === station) {
                neighbors.push(startStation.name);
            }
        });
    });
    return neighbors;
}

function findStationByCoordinates(x, y) {
    for (const [name, data] of Object.entries(stationsData)) {
        if (data.x - x >= -20 && data.x - x <= 20 && data.y - y >= -20 && data.y - y <= 20) {
            return { name, ...data };
        }
    }
    return null;
}

function findLineBetweenStations(start, end, targetLine = null) {
    let bestMatch = null;
    let sharedLines = [];

    // 找出所有连接这两个站点的线段
    for (const color of Object.keys(linesData)) {
        for (const line of linesData[color]) {
            const startStation = findStationByCoordinates(line.x1, line.y1);
            const endStation = findStationByCoordinates(line.x2, line.y2);
            if ((startStation && endStation) && 
                ((startStation.name === start && endStation.name === end) ||
                 (startStation.name === end && endStation.name === start))) {
                sharedLines.push({...line, color});
                bestMatch = {...line, color};
            }
        }
    }

    // 如果指定了目标线路，尝试找到匹配的线段
    if (targetLine && sharedLines.length > 0) {
        const targetColor = lines.find(l => l.name === targetLine)?.color;
        const matchingLine = sharedLines.find(l => l.color === targetColor);
        if (matchingLine) {
            return matchingLine;
        }
    }

    return bestMatch;
}

function markStation(name, className) {
    const station = stationsData[name];
    if (station) {
        station.element.classList.add(className);
    }
}

function zoomIn() {
    zoomLevel += 0.1; // 调整缩放速度
    if (zoomLevel > 5) { // 防止缩放级别为负数
        zoomLevel = 5
    }
    updateTransform();
}

function zoomOut() {
    zoomLevel -= 0.1; // 调整缩放速度
    if (zoomLevel < 0.1) { // 防止缩放级别为负数
        zoomLevel = 0.1
    }
    updateTransform();
}

function updateTransform() {
    map.setAttribute("transform", `translate(${offsetX}, ${offsetY}) scale(${zoomLevel})`);
    
    // 如果当前有显示的站点信息，更新其位置
    if (currentStation && tooltip.style.display === "block") {
        showStationInfo(null, currentStation);
    }
}

function dragStart(event) {
    event.preventDefault();
    const transform = map.getAttribute("transform") || "translate(0, 0) scale(1)";
    const translateMatch = transform.match(/translate\((-?\d+), (-?\d+)\)/);
    offsetX = parseInt(translateMatch ? translateMatch[1] : 0, 10);
    offsetY = parseInt(translateMatch ? translateMatch[2] : 0, 10);
    startX = event.clientX;
    startY = event.clientY;
    document.addEventListener("mousemove", dragMove);
    document.addEventListener("mouseup", dragEnd);
}

function dragMove(event) {
    offsetX += event.clientX - startX;
    offsetY += event.clientY - startY;
    startX = event.clientX;
    startY = event.clientY;
    updateTransform();
}

function dragEnd() {
    document.removeEventListener("mousemove", dragMove);
    document.removeEventListener("mouseup", dragEnd);
}

map.addEventListener("mousedown", dragStart);

map.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = Math.sign(event.deltaY);
    if (delta > 0) {
        zoomOut();
    } else {
        zoomIn();
    }
});

map.addEventListener("touchstart", (event) => {
    if (event.touches.length === 2) {
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const initialDistance = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
        map.addEventListener("touchmove", (moveEvent) => {
            if (moveEvent.touches.length === 2) {
                const moveTouch1 = moveEvent.touches[0];
                const moveTouch2 = moveEvent.touches[1];
                const currentDistance = Math.hypot(moveTouch1.clientX - moveTouch2.clientX, moveTouch1.clientY - moveTouch2.clientY);
                const delta = currentDistance - initialDistance;
                if (delta > 0) {
                    zoomIn();
                } else {
                    zoomOut();
                }
            }
        }, { passive: false });
        map.addEventListener("touchend", () => {
            map.removeEventListener("touchmove", () => { });
        });
    } else {
        isDragging = true;
        dragStartX = event.touches[0].clientX;
        dragStartY = event.touches[0].clientY;
        startX = offsetX;
        startY = offsetY;
    }
}, { passive: false });

map.addEventListener("touchmove", (event) => {
    if (!isDragging || event.touches.length !== 1) return;
    event.preventDefault();
    const touch = event.touches[0];
    offsetX = startX + (touch.clientX - dragStartX);
    offsetY = startY + (touch.clientY - dragStartY);
    updateTransform();
}, { passive: false });

map.addEventListener("touchend", () => {
    isDragging = false;
});

function highlightRoute() {
    if (!startPoint || !endPoint) return;

    resetMap();

    // 获取不同的路径方案
    const timeOptimizedPath = findOptimalPath(startPoint, endPoint, 'time');
    const transferOptimizedPath = findOptimalPath(startPoint, endPoint, 'transfers');
    const noAirportPath = findOptimalPath(startPoint, endPoint, 'time', true);

    // 检查路线是否相同
    const isTimeAndTransferSame = areRoutesEqual(timeOptimizedPath, transferOptimizedPath);
    const isTransferAndNoAirportSame = areRoutesEqual(transferOptimizedPath, noAirportPath);

    // 显示路径结果
    showRouteResults([
        {
            type: isTimeAndTransferSame ? '推荐路线' : '时间短',
            path: timeOptimizedPath,
            isSelected: true
        },
        ...(isTimeAndTransferSame ? [] : [{
            type: isTransferAndNoAirportSame ? '普通路线' : '少换乘',
            path: transferOptimizedPath,
            isSelected: false
        }]),
        ...(!isTransferAndNoAirportSame && timeOptimizedPath.usesAirportLine ? [{
            type: '普通路线',
            path: noAirportPath,
            isSelected: false
        }] : [])
    ]);
}

// 比较两条路线是否相同
function areRoutesEqual(route1, route2) {
    if (route1.path.length !== route2.path.length) return false;
    
    for (let i = 0; i < route1.path.length; i++) {
        if (route1.path[i] !== route2.path[i]) return false;
    }
    
    return true;
}

function findOptimalPath(start, end, optimizeFor = 'time', excludeAirport = false) {
    const graph = buildWeightedGraph(lines, { excludeAirportLine: excludeAirport });
    
    // 获取起点和终点的所有可能线路
    const startLines = getLinesForStation(start);
    const endLines = getLinesForStation(end);
    
    let bestResult = null;
    let shortestTime = Infinity;
    let leastTransfers = Infinity;

    // 尝试所有可能的起点和终点线路组合
    for (const startLine of startLines) {
        for (const endLine of endLines) {
            const startNode = `${start}_${startLine}`;
            const endNode = `${end}_${endLine}`;
            
            if (graph[startNode] && graph[endNode]) {
                const result = dijkstraFindShortestPath(graph, startNode, endNode, optimizeFor);
                
                if (result.path.length > 0) {  // 确保找到了有效路径
                    if (optimizeFor === 'time' && result.totalTime < shortestTime) {
                        shortestTime = result.totalTime;
                        bestResult = result;
                    } else if (optimizeFor === 'transfers' && 
                        (result.totalTransfers < leastTransfers || 
                        (result.totalTransfers === leastTransfers && result.totalTime < shortestTime))) {
                        leastTransfers = result.totalTransfers;
                        shortestTime = result.totalTime;
                        bestResult = result;
                    }
                }
            }
        }
    }

    if (!bestResult) {
        return {
            path: [],
            edges: [],
            totalTime: 0,
            totalTransfers: 0,
            usesAirportLine: false,
            fare: { base: 0, additional: 0, airport: 0, total: 0 }
        };
    }

    // 检查是否使用了机场线
    const usesAirportLine = bestResult.edges.some(edge => {
        const line = lines.find(l => l.name === edge.line);
        return line && line.name === "机场线";
    });

    // 计算票价
    let fareZones = new Set(bestResult.path.map(station => {
        const stationName = station.split('_')[0];
        const stationData = stationsData[stationName];
        return stationData ? stationData.fareZone : null;
    }));
    let baseFare = 2;
    let additionalFare = fareZones.size > 1 ? fareZones.size - 2 : 0;
    let airportFare = usesAirportLine ? 15 : 0;
    let totalFare = baseFare + additionalFare + airportFare;

    return {
        ...bestResult,
        usesAirportLine,
        fare: {
            base: baseFare,
            additional: additionalFare,
            airport: airportFare,
            total: totalFare
        }
    };
}

function showRouteResults(routes) {
    const routeResult = document.getElementById('route-result');
        routeResult.style.display = "block";
    const routeList = document.getElementById('route-list');
    const lineSummary = document.getElementById('line-summary');
    const fareZoneSummary = document.getElementById('fare-zone-summary');

    // 清空现有内容
        routeList.innerHTML = '';
        lineSummary.innerHTML = '';
    fareZoneSummary.innerHTML = '';

    // 创建路线选择器
    const routeSelector = document.createElement('div');
    routeSelector.className = 'route-selector';
    routes.forEach(route => {
        const button = document.createElement('button');
        button.textContent = route.type;
        button.className = route.isSelected ? 'selected' : '';
        button.onclick = () => {
            document.querySelectorAll('.route-selector button').forEach(btn => btn.className = '');
            button.className = 'selected';
            displayRoute(route.path);
        };
        routeSelector.appendChild(button);
    });
    lineSummary.appendChild(routeSelector);

    // 显示选中的路线
    const selectedRoute = routes.find(r => r.isSelected);
    if (selectedRoute) {
        displayRoute(selectedRoute.path);
    }
}

function displayRoute(routeInfo) {
    resetMap();
    const { path, edges, totalTime, totalTransfers } = routeInfo;

    if (!path || path.length === 0) {
        console.error('No valid path found');
        return;
    }

    // 清空所有路线相关内容
    const lineSummary = document.getElementById('line-summary');
    const routeSelector = lineSummary.querySelector('.route-selector');
    lineSummary.innerHTML = '';
    if (routeSelector) {
        lineSummary.appendChild(routeSelector);
    }

    let currentLine = null;
    let currentSegment = {
        line: null,
        startStation: null,
        stations: 0,
        time: 0
    };
    const segments = [];

    // 计算实际运行时间和等候时间
    let actualRunningTime = 0;
    let totalWaitingTime = totalTransfers * 3; // 每次换乘3分钟等候时间

    // 调暗所有线路、站点和站点标签
    document.querySelectorAll('.line, .station, text').forEach(element => {
        element.classList.add('map-dimmed');
    });

    // 创建高亮组
    let highlightedGroup = document.querySelector('.highlighted-group');
    if (!highlightedGroup) {
        highlightedGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        highlightedGroup.setAttribute("class", "highlighted-group");
    }
    highlightedGroup.innerHTML = ''; // 清空之前的高亮内容

    // 处理每个站点
    const highlightedStations = new Set();
    for (let i = 0; i < path.length - 1; i++) {
        const edge = edges[i];
        const station = path[i].split('_')[0];
        const nextStation = path[i + 1].split('_')[0];

        // 记录站点
        highlightedStations.add(station);
        highlightedStations.add(nextStation);

        // 只累加运行时间，不包括换乘等候时间
        if (!edge.isTransfer) {
            actualRunningTime += edge.time;
        }

        // 如果是新的线路或第一个站点
        if (edge.line !== currentLine) {
            if (currentSegment.line) {
                segments.push({ ...currentSegment });
            }
            currentSegment = {
                line: edge.line,
                startStation: station,
                stations: 1,
                time: edge.time
            };
            currentLine = edge.line;
        } else {
            currentSegment.stations++;
            currentSegment.time += edge.time;
        }

        // 在高亮组中绘制线路
        if (!edge.isTransfer) {  // 只绘制非换乘边
            const line = findLineBetweenStations(station, nextStation, edge.line);
            if (line) {
                const highlightedLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
                highlightedLine.setAttribute("x1", line.x1);
                highlightedLine.setAttribute("y1", line.y1);
                highlightedLine.setAttribute("x2", line.x2);
                highlightedLine.setAttribute("y2", line.y2);
                highlightedLine.setAttribute("stroke", line.color);
                highlightedLine.setAttribute("class", "highlighted-line");
                highlightedGroup.appendChild(highlightedLine);
            }
        }
    }
    segments.push(currentSegment);

    // 在高亮组中绘制站点，并恢复相关站点和标签的不透明度
    highlightedStations.forEach(stationName => {
        const station = stationsData[stationName];
        if (station) {
            // 绘制高亮站点
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", station.x);
            circle.setAttribute("cy", station.y);
            circle.setAttribute("r", 6);
            circle.setAttribute("class", "station");
            circle.style.fill = "#fff";
            circle.style.stroke = station.element.style.stroke;
            highlightedGroup.appendChild(circle);

            // 恢复站点和对应标签的不透明度
            station.element.classList.remove('map-dimmed');
            const stationLabel = Array.from(document.querySelectorAll('text')).find(
                text => text.textContent === stationName
            );
            if (stationLabel) {
                stationLabel.classList.remove('map-dimmed');
            }
        }
    });

    // 确保高亮组在最上层
    map.appendChild(highlightedGroup);

    // 显示行程信息
    displaySegments(segments);
    markStation(startPoint, "start-point");
    markStation(endPoint, "end-point");

    // 显示票价和行程信息
    const fareZoneSummary = document.getElementById('fare-zone-summary');
    let fareText = `<p class="clickable-info" onclick="showFareDetail(${routeInfo.fare.base}, ${routeInfo.fare.additional}, ${routeInfo.fare.airport}, ${routeInfo.fare.total})">价格：${routeInfo.fare.total}元</p>`;
    
    fareZoneSummary.innerHTML = `
        ${fareText}
        <p class="clickable-info" onclick="showTimeDetail(${Math.ceil(actualRunningTime)}, ${totalWaitingTime})">总用时：${Math.ceil(actualRunningTime + totalWaitingTime)}分钟</p>
        <p>转向次数：${totalTransfers}次</p>
    `;

    // 添加鼠标样式
    const clickableInfos = fareZoneSummary.querySelectorAll('.clickable-info');
    clickableInfos.forEach(info => {
        info.style.cursor = 'pointer';
    });
}

function displaySegments(segments) {
    const lineSummary = document.getElementById('line-summary');
    
    segments.forEach((segment, index) => {
        const startItem = document.createElement('p');
        startItem.textContent = `${segment.startStation}站${index === 0 ? ' 出发' : ' 换'}`;
        startItem.style.fontWeight = index === 0 ? 'bold' : 'normal';
        startItem.className = index === 0 ? 'start' : 'transfer';
        lineSummary.appendChild(startItem);

        const lineItem = document.createElement('p');
        // 获取该线路的终点站（方向）
        const line = lines.find(l => l.name === segment.line);
        
        // 找到当前段的起点和终点在线路中的索引
        let startIndex = -1;
        let endIndex = -1;
        let nextStation = '';
        
        // 如果是最后一段，使用终点站，否则使用下一段的起点
        if (index < segments.length - 1) {
            nextStation = segments[index + 1].startStation;
        } else {
            nextStation = endPoint;
        }
        
        // 找到相关站点的索引
        for (let i = 0; i < line.stations.length; i++) {
            if (line.stations[i].name === segment.startStation) {
                startIndex = i;
            }
            if (line.stations[i].name === nextStation) {
                endIndex = i;
            }
        }
        
        // 根据实际运行方向判断上下行
        const isDownbound = startIndex < endIndex;
        const directionStation = isDownbound ? line.stations[line.stations.length - 1].name : line.stations[0].name;
        
        lineItem.textContent = `${segment.line} ${directionStation}方向\n  开行${segment.stations}出口 (${Math.ceil(segment.time)}分钟)`;
        lineItem.className = 'line-stations';
        lineItem.dataset.lineColor = getLineColorByName(segment.line);
        lineSummary.appendChild(lineItem);
    });

    const lastStation = document.createElement('p');
    lastStation.textContent = `到达 ${endPoint}站`;
    lastStation.style.fontWeight = 'bold';
    lastStation.className = 'end';
    lineSummary.appendChild(lastStation);

    setGrayTextColors();
}

function copyToClipboard() {
    const routeSelector = document.querySelector('.route-selector');
    const selectedButton = routeSelector.querySelector('button.selected');
    const selectedRouteType = selectedButton ? selectedButton.textContent : '推荐路线';

    // 获取所有行程信息段落
    const paragraphs = lineSummary.querySelectorAll('p');
    let routeText = '';

    // 遍历每个段落，根据类名添加相应的符号
    paragraphs.forEach(p => {
        if (p.className === 'start') {
            routeText += '● ' + p.textContent + '\n';
        } else if (p.className === 'transfer') {
            routeText += '○ ' + p.textContent + '\n';
        } else if (p.className === 'line-stations') {
            routeText += '↓ ' + p.textContent + '\n';
        } else if (p.className === 'end') {
            routeText += '● ' + p.textContent + '\n';
        }
    });

    // 获取票价和时间信息
    const fareInfo = fareZoneSummary.innerText.split('\n').filter(line => line.trim()).join('\n');

    const textToCopy = `${selectedRouteType}\n${routeText}\n${fareInfo}\n\n此方案由「雨城通」提供：yct.shangxiaoguan.top\n及其相关组织机构均为虚构`;
    
    navigator.clipboard.writeText(textToCopy)
        .then(() => {
            setToastText("已复制到剪贴板");
            showToast();
            setTimeout(() => hideToast(), 2000)
        })
        .catch(err => {
            console.error('无法复制文本: ', err);
            setToastText("复制失败，请尝试手动复制");
            showToast();
            setTimeout(() => hideToast(), 2000)
        });
}

function filterStations(query, type) {
    query = query.toLowerCase();
    const filteredStations = Object.keys(stationsData).filter(station => station.toLowerCase().includes(query));
    const searchInput = document.getElementById(`${type}-search`);
    searchInput.setAttribute("list", `${type}-stations`);

    const datalist = document.createElement("datalist");
    datalist.id = `${type}-stations`;
    searchInput.parentNode.replaceChild(datalist, searchInput.nextSibling);

    filteredStations.forEach(station => {
        const option = document.createElement("option");
        option.value = station;
        datalist.appendChild(option);
    });
}

function setRouteFromSearch() {
    const startValue = document.getElementById("start-search").value.trim();
    const endValue = document.getElementById("end-search").value.trim();

    if (startValue) {
        startPoint = startValue;
    }

    if (endValue) {
        endPoint = endValue;
    }

    highlightRoute();
    updateMarkers();
}

function updateMarkers() {
    removeMarkers();

    if (startPoint) {
        const startStation = stationsData[startPoint];
        if (startStation) {
            const marker = createMarker(startStation.x, startStation.y, "#008000");
            map.appendChild(marker);
        }
    }

    if (endPoint) {
        const endStation = stationsData[endPoint];
        if (endStation) {
            const marker = createMarker(endStation.x, endStation.y, "#ffa500");
            map.appendChild(marker);
        }
    }
}

function createMarker(x, y, color) {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.setAttribute("cx", x);
    marker.setAttribute("cy", y);
    marker.setAttribute("r", 8);
    marker.style.fill = color;
    marker.style.opacity = 1;
    marker.style.stroke = "white"; // Add a white stroke
    marker.style.strokeWidth = "4"; // Set the stroke width
    return marker;
}

function removeMarkers() {
    const markers = map.querySelectorAll("circle[r='8']");
    markers.forEach(marker => marker.remove());
}

lines.forEach(line => {
    const color = line.color;
    line.stations.forEach((station, index) => {
        const { name, coordinates, fareZone, labelOffset } = station;
        const isTransfer = lines.some(l => l.stations.some(s => s.name === name && l.color !== color));
        drawStation(coordinates.x, coordinates.y, name, isTransfer, color, labelOffset);
        if (index < line.stations.length - 1) {
            const nextStation = line.stations[index + 1];
            drawLine(coordinates.x, coordinates.y, nextStation.coordinates.x, nextStation.coordinates.y, color, `line_${line.name.replace(/\s+/g, '_').toLowerCase()}_${index}`);
        }
    });
});

// Auto-resize the SVG canvas based on the maximum coordinates
map.setAttribute("viewBox", `${minX - 100} ${minY - 100} ${maxX + 300} ${maxY + 300}`);

// Ensure stations are drawn after lines
const stationsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
map.querySelectorAll(".station").forEach(station => {
    stationsGroup.appendChild(station.nextSibling); // Append label text
    stationsGroup.appendChild(station);
});
map.appendChild(stationsGroup);

// Pre-fill the search inputs if startPoint or endPoint is already set
if (startPoint) {
    document.getElementById("start-search").value = startPoint;
}
if (endPoint) {
    document.getElementById("end-search").value = endPoint;
}

// Initial call to update markers if points are pre-set
updateMarkers();

function showToast() {
    const Toast = document.getElementById('toast');
    Toast.style.display = 'flex';
    setTimeout(() => {
        Toast.style.top = '12px';
    }, 300);
}

function hideToast() {
    const toast = document.getElementById('toast');
    toast.style.top = '-100px';
    setTimeout(() => {
        toast.style.display = 'none';
    }, 300); // 等待过渡动画完成
}

// 自定义弹窗文字内容
function setToastText(text) {
    document.getElementById('toastText').innerText = text;
}

// 初始化图例内容
function initializeLegend() {
    const lineLegend = document.getElementById('line-legend');
    
    // 清空现有图例
    lineLegend.innerHTML = '';
    
    // 生成线路图例
    lines.forEach(line => {
        const lineItem = document.createElement('div');
        lineItem.className = 'line-item';
        
        const lineColor = document.createElement('div');
        lineColor.className = 'line-color';
        lineColor.style.backgroundColor = line.color;
        
        const lineName = document.createElement('span');
        lineName.textContent = line.name;
        
        lineItem.appendChild(lineColor);
        lineItem.appendChild(lineName);
        lineLegend.appendChild(lineItem);
    });
}

function showLegend() {
    const legendContainer = document.getElementById('legend-container');
    if (legendContainer.style.display === 'none') {
        legendContainer.style.display = 'block';
    } else {
        legendContainer.style.display = 'none';
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 初始化图例内容
    initializeLegend();
    
    // 检查localStorage中是否有查询信息
    const tripId = localStorage.getItem('metroTransferQuery');
    if (tripId) {
        try {
            const savedOrders = localStorage.getItem('orders');
            if (savedOrders) {
                const orders = JSON.parse(savedOrders);
                const trip = orders.find(order => order.id === tripId);
                if (trip) {
                    // 等待一小段时间确保地图和数据都已加载
                    setTimeout(() => {
                        // 设置起点和终点
                        setStartPoint(trip.route.departure);
                        setTimeout(() => {
                            setEndPoint(trip.route.arrival);
                            
                            // 计算起点和终点的中心点
                            const startStation = stationsData[trip.route.departure];
                            const endStation = stationsData[trip.route.arrival];
                            /*if (startStation && endStation) {
                                // 计算中心点
                                const centerX = (startStation.x + endStation.x) / 2;
                                const centerY = (startStation.y + endStation.y) / 2;
                                
                                // 计算起点和终点之间的距离
                                const distance = Math.sqrt(
                                    Math.pow(endStation.x - startStation.x, 2) + 
                                    Math.pow(endStation.y - startStation.y, 2)
                                );
                                
                                // 根据距离调整缩放级别
                                zoomLevel = Math.min(2, Math.max(0.5, 400 / distance));
                                
                                // 设置偏移量，使中心点位于视图中心
                                offsetX = window.innerWidth / 2 - centerX * zoomLevel;
                                offsetY = window.innerHeight / 2 - centerY * zoomLevel;
                                
                                // 更新视图
                                updateTransform();
                            }*/
                        }, 100);
                    }, 100);
                    return; // 如果找到并处理了行程，就不再处理其他参数
                }
            }
        } catch (error) {
            console.error('读取行程数据失败:', error);
        }
    }
    
    // 检查URL参数
    const urlParams = new URLSearchParams(window.location.search);
    const stationName = urlParams.get('station');
    const action = urlParams.get('action');
    
    if (stationName) {
        // 等待一小段时间确保地图和数据都已加载
        setTimeout(() => {
            const station = stationsData[stationName];
            if (station) {
                // 设置缩放级别
                zoomLevel = 1.5;
                
                // 计算偏移量，使站点位于视图中心
                offsetX = window.innerWidth / 2 - station.x * zoomLevel;
                offsetY = window.innerHeight / 2 - station.y * zoomLevel;
                
                // 更新视图
                updateTransform();
                
                // 根据 action 参数执行相应操作
                if (action === 'start') {
                    setStartPoint(stationName);
                } else if (action === 'end') {
                    setStartPoint(stationName); // 如果没有起点，先设置起点
                    setTimeout(() => {
                        setEndPoint(stationName); // 然后设置终点
                    }, 100);
                } else {
                    // 显示站点信息
                    showStationInfo(null, stationName);
                    
                    // 高亮显示站点
                    station.element.style.fill = '#2c9678';
                    setTimeout(() => {
                        station.element.style.fill = '';
                    }, 2000);
                }
            } else {
                setToastText("未找到该站点");
                showToast();
                setTimeout(() => hideToast(), 2000);
            }
        }, 100);
    }
});

// 根据站名查找站点
function findStationByName(name) {
    for (const line of lines) {
        for (const station of line.stations) {
            if (station.name === name) {
                return station;
            }
        }
    }
    return null;
}

function hideLegend() {
    document.getElementById('legend-container').style.display = 'none';
    document.getElementById('background').style.display = 'none';
}

function saveAsImage() {
    const routeResult = document.getElementById('route-result');
    const shareButtons = routeResult.querySelector('.share-buttons');
    const imageFooter = document.getElementById('image-footer');
    const closeButton = routeResult.querySelector('.close-button');
    
    // 获取当前选中的路线类型
    const routeSelector = document.querySelector('.route-selector');
    const selectedButton = routeSelector.querySelector('button.selected');
    const routeType = selectedButton ? selectedButton.textContent : '推荐路线';
    
    // 生成文件名
    const fileName = `${startPoint}→${endPoint} ${routeType}.png`;
    
    // 临时隐藏不需要的元素，显示底部区域
    closeButton.style.display = 'none';
    shareButtons.style.display = 'none';
    imageFooter.style.display = 'block';
    
    html2canvas(routeResult, {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        scale: 2, // 使用2倍缩放以获得更清晰的图片
        useCORS: true,
        logging: false,
    }).then(canvas => {
        // 恢复原始显示状态
        closeButton.style.display = 'block';
        shareButtons.style.display = 'flex';
        imageFooter.style.display = 'none';
        
        // 将canvas转换为图片并下载
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL('image/png');
        link.click();
        
        // 显示提示
        setToastText("图片已保存");
        showToast();
        setTimeout(() => hideToast(), 2000);
    }).catch(error => {
        console.error('保存图片失败:', error);
        setToastText("保存失败，请重试");
        showToast();
        setTimeout(() => hideToast(), 2000);
        
        // 确保所有元素恢复原始显示状态
        closeButton.style.display = 'block';
        shareButtons.style.display = 'flex';
        imageFooter.style.display = 'none';
    });
}

// 显示添加行程对话框
function showAddTripDialog() {
    const dialog = document.getElementById('add-trip-dialog');
    const timeInput = document.getElementById('trip-time');
    
    // 设置默认时间为当前时间后30分钟
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30); // 默认设置为30分钟后
    
    // 使用toLocaleString来获取本地时间格式，然后转换为datetime-local所需的格式
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const defaultTime = `${year}-${month}-${day}T${hours}:${minutes}`;
    
    timeInput.value = defaultTime;
    dialog.style.display = 'flex';
}

// 隐藏添加行程对话框
function hideAddTripDialog() {
    const dialog = document.getElementById('add-trip-dialog');
    dialog.style.display = 'none';
}

// 添加行程提醒
function addTripReminder() {
    const timeInput = document.getElementById('trip-time');
    const timeType = document.querySelector('input[name="timeType"]:checked').value;
    const selectedTime = new Date(timeInput.value);
    
    // 获取路线信息
    const lineSummary = document.getElementById('line-summary');
    const fareZoneSummary = document.getElementById('fare-zone-summary');
    const paragraphs = lineSummary.querySelectorAll('p');
    
    // 提取起点和终点
    let departure = '';
    let arrival = '';
    let lines = [];
    let actualRunningTime = 0;
    let totalWaitingTime = 0;
    
    paragraphs.forEach(p => {
        if (p.className === 'start') {
            departure = p.textContent.replace('站 出发', '');
        } else if (p.className === 'end') {
            arrival = p.textContent.replace('到达 ', '').replace('站', '');
        } else if (p.className === 'line-stations') {
            const lineText = p.textContent.split(' ')[0]; // 获取线路名称
            lines.push(lineText);
        }
    });
    
    // 从fareZoneSummary中提取总用时信息
    const timeInfo = fareZoneSummary.textContent;
    const totalTimeMatch = timeInfo.match(/总用时：(\d+)分钟/);
    const totalJourneyTime = totalTimeMatch ? parseInt(totalTimeMatch[1]) : 0;
    
    if (!departure || !arrival) {
        alert('无效的路线信息');
        return;
    }
    
    // 根据时间类型处理时间
    let tripTime = selectedTime;
    let arrivalTime = selectedTime;
    if (timeType === 'arrival') {
        // 如果是到达时间，计算最晚出发时间
        tripTime = new Date(selectedTime.getTime() - totalJourneyTime * 60000); // 转换为毫秒
    }
    
    // 生成唯一ID
    const tripId = 'metro_' + Date.now();
    
    // 获取当前选中的路线类型
    const routeSelector = document.querySelector('.route-selector');
    const selectedButton = routeSelector.querySelector('button.selected');
    const routeType = selectedButton ? selectedButton.textContent : '推荐路线';
    
    // 创建行程对象
    const trip = {
        id: tripId,
        type: 'metro',
        date: tripTime.toISOString().split('T')[0],
        status: 'upcoming',
        route: {
            departure,
            arrival,
            time: tripTime.toTimeString().slice(0, 5),
            arrivalTime: arrivalTime.toTimeString().slice(0, 5), // 添加预计到达时间
            id: '',
            line: lines.join('→'),
            company: `地铁换乘查询·${routeType}`
        },
        lines: window.location.hash.slice(1) || lines.join(',')
    };
    
    // 获取现有行程
    let orders = [];
    try {
        const savedOrders = localStorage.getItem('orders');
        orders = savedOrders ? JSON.parse(savedOrders) : [];
    } catch (error) {
        console.error('读取行程数据失败:', error);
    }
    
    // 添加新行程
    orders.push(trip);
    
    // 保存到localStorage
    try {
        localStorage.setItem('orders', JSON.stringify(orders));
        hideAddTripDialog();
        setToastText(timeType === 'arrival' ? `已添加行程(出发时间${trip.route.time})` : `已添加行程(预计到达${trip.route.arrivalTime})`);
        showToast();
        setTimeout(() => hideToast(), 3000);
    } catch (error) {
        console.error('保存行程失败:', error);
        alert('保存行程失败，请重试');
    }
}

// 将函数暴露给全局作用域
window.showAddTripDialog = showAddTripDialog;
window.hideAddTripDialog = hideAddTripDialog;
window.addTripReminder = addTripReminder;
window.showFareDetail = showFareDetail;
window.showTimeDetail = showTimeDetail;

// 添加显示票价详情的函数
function showFareDetail(base, additional, airport, total) {
    let details = [`基础票价${base}元`];
    if (additional > 0) {
        details.push(`跨区附加费${additional}元`);
    }
    if (airport > 0) {
        details.push(`机场线附加费${airport}元`);
    }
    setToastText(details.join(' + '));
    showToast();
    setTimeout(() => hideToast(), 3000);
}

// 添加显示时间详情的函数
function showTimeDetail(runningTime, waitingTime) {
    let details = [`运行时间${runningTime}分钟`];
    if (waitingTime > 0) {
        details.push(`换乘等候${waitingTime}分钟`);
    }
    setToastText(details.join(' + '));
    showToast();
    setTimeout(() => hideToast(), 3000);
}
