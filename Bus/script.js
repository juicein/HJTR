// 全局状态
let allLines = [];
let allStations = new Set();
let uniqueRegions = new Set();

// 1. 初始化与数据读取
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('Data/bus_data.txt');
        if (!response.ok) throw new Error("无法读取数据文件");
        const text = await response.text();
        parseData(text);
        
        initUI();
        renderList(allLines);
    } catch (error) {
        console.error(error);
        alert("错误：请确保在本地服务器环境运行（如 VS Code Live Server），否则无法读取 data.txt。");
    }
});

// 2. 数据解析 (Regex)
function parseData(text) {
    const lines = text.split('\n');
    lines.forEach(lineStr => {
        if (!lineStr.trim()) return;

        // 正则提取各个部分
        const nameMatch = lineStr.match(/【(.*?)】/);
        const companyMatch = lineStr.match(/-\{(.*?)\}/);
        const noteMatch = lineStr.match(/《(.*?)》/);
        const regionMatch = lineStr.match(/『(.*?)』/);
        const startMatch = lineStr.match(/§(.*?)§/);
        const endMatch = lineStr.match(/@(.*?)@/);
        const typeMatch = lineStr.match(/θ(.*?)θ/);
        const colorMatch = lineStr.match(/∮(.*?)∮/);

        // 提取站点：在 】 和 -{ 之间的内容
        let stationsStr = "";
        const startIdx = lineStr.indexOf('】') + 1;
        const endIdx = lineStr.indexOf('-{');
        if (startIdx > 0 && endIdx > startIdx) {
            stationsStr = lineStr.substring(startIdx, endIdx);
        }

        if (nameMatch) {
            const rawStations = stationsStr.split('-').filter(s => s.trim() !== "");
            // 清理站点名称中的箭头 (用于搜索和显示)
            const cleanStations = rawStations.map(s => s.replace(/[↓↑]/g, '').trim());
            
            cleanStations.forEach(s => allStations.add(s));
            const region = regionMatch ? regionMatch[1] : "未知";
            uniqueRegions.add(region);

            allLines.push({
                id: nameMatch[1],
                name: nameMatch[1],
                stations: rawStations, // 保留箭头用于可能的逻辑，但展示时需注意
                cleanStations: cleanStations,
                company: companyMatch ? companyMatch[1] : "",
                note: noteMatch ? noteMatch[1] : "",
                region: region,
                startTime: startMatch ? startMatch[1] : "",
                endTime: endMatch ? endMatch[1] : "",
                type: typeMatch ? typeMatch[1] : "公交", // 默认为公交
                color: colorMatch ? colorMatch[1] : null
            });
        }
    });

    // 填充设置页的筛选下拉框
    const regionSelect = document.getElementById('region-filter');
    uniqueRegions.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.innerText = r;
        regionSelect.appendChild(opt);
    });
}

// 3. UI 逻辑
function initUI() {
    // 导航处理
    document.getElementById('plan-btn').onclick = () => switchView('view-planner', "出行规划");
    document.getElementById('back-btn').onclick = () => {
        switchView('view-home', "线路列表");
        // 如果是从详情页返回，隐藏按钮
        document.getElementById('back-btn').style.display = 'none';
        document.getElementById('plan-btn').style.display = 'block';
        document.getElementById('filter-btn').style.display = 'block';
    };

    // 设置弹窗
    const dialog = document.getElementById('settings-dialog');
    document.getElementById('filter-btn').onclick = () => dialog.showModal();
    document.getElementById('confirm-filter').onclick = (e) => {
        e.preventDefault();
        applyFilter();
        dialog.close();
    };

    // 搜索建议
    setupAutocomplete('start-input', 'start-suggestions');
    setupAutocomplete('end-input', 'end-suggestions');

    // 查询路线
    document.getElementById('search-route-btn').onclick = findRoute;

    // Web Push 模拟
    document.getElementById('ride-btn').onclick = () => {
        if ("Notification" in window) {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    const lineName = document.getElementById('detail-name').innerText;
                    new Notification("乘车提醒设置成功", {
                        body: `正在为您监控 ${lineName}，到站将自动提醒。`,
                        icon: "https://cdn-icons-png.flaticon.com/512/3448/3448636.png"
                    });
                }
            });
        } else {
            alert("您的浏览器不支持 Web Push 通知");
        }
    };
    
    // 筛选标签点击
    document.querySelectorAll('.chip').forEach(chip => {
        chip.onclick = function() {
            document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
        }
    });
}

function switchView(viewId, title) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    document.getElementById('page-title').innerText = title;
    
    if (viewId !== 'view-home') {
        document.getElementById('back-btn').style.display = 'block';
        document.getElementById('plan-btn').style.display = 'none';
        document.getElementById('filter-btn').style.display = 'none';
    }
}

// 4. 渲染列表
function renderList(lines) {
    const container = document.getElementById('line-list');
    container.innerHTML = '';
    
    lines.forEach(line => {
        const card = document.createElement('div');
        card.className = 'card';
        
        // 类型图标
        let iconName = 'directions_bus';
        if (line.type.includes('地铁') || line.type.includes('铁路')) iconName = 'train';
        if (line.type.includes('电车')) iconName = 'tram';

        // 颜色处理
        const iconStyle = line.color ? `background-color: #${line.color}; color: #fff;` : '';

        const startStation = line.cleanStations[0];
        const endStation = line.cleanStations[line.cleanStations.length - 1];

        card.innerHTML = `
            <div class="card-icon" style="${iconStyle}">
                <span class="material-symbols-rounded">${iconName}</span>
            </div>
            <div class="card-content">
                <span class="line-name">${line.name}</span>
                <span class="line-route">${startStation} <span class="material-symbols-rounded" style="font-size:12px; vertical-align:middle">arrow_forward</span> ${endStation}</span>
            </div>
        `;

        card.onclick = () => showDetail(line);
        container.appendChild(card);
    });
}

function showDetail(line) {
    switchView('view-detail', line.name);
    
    document.getElementById('detail-name').innerText = line.name;
    document.getElementById('detail-region').innerText = line.region;
    document.getElementById('detail-time').innerText = `首班 ${line.startTime} / 末班 ${line.endTime}`;
    document.getElementById('detail-price').innerText = line.note;
    document.getElementById('detail-company').innerText = line.company;

    // 图标
    let iconName = 'directions_bus';
    if (line.type.includes('地铁')) iconName = 'train';
    document.getElementById('detail-icon').className = `material-symbols-rounded`;
    document.getElementById('detail-icon').innerText = iconName;
    document.getElementById('detail-icon').style.fontSize = '32px';

    // 头部颜色
    const header = document.getElementById('detail-header-bg');
    if (line.color) {
        header.style.backgroundColor = `#${line.color}`;
        header.style.color = '#fff';
    } else {
        header.style.backgroundColor = 'var(--md-sys-color-primary-container)';
        header.style.color = 'var(--md-sys-color-on-primary-container)';
    }

    // 渲染站点
    const ul = document.getElementById('detail-stations');
    ul.innerHTML = '';
    line.stations.forEach(s => {
        const li = document.createElement('li');
        // 处理上下行箭头显示
        li.innerText = s.replace('↓', ' (仅下行)').replace('↑', ' (仅上行)');
        ul.appendChild(li);
    });
}

// 5. 筛选功能
function applyFilter() {
    const region = document.getElementById('region-filter').value;
    const types = Array.from(document.querySelectorAll('.checkbox-group input:checked')).map(cb => cb.value); // bus, subway
    
    const filtered = allLines.filter(line => {
        const matchRegion = region === 'all' || line.region === region;
        
        let isSubway = line.type.includes('地铁');
        let matchType = false;
        
        if (types.includes('bus') && !isSubway) matchType = true;
        if (types.includes('subway') && isSubway) matchType = true;
        
        return matchRegion && matchType;
    });
    
    renderList(filtered);
    switchView('view-home', "线路列表"); // 刷新回首页
}

// 6. 自动补全
function setupAutocomplete(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);

    input.addEventListener('input', () => {
        const val = input.value.toLowerCase();
        list.innerHTML = '';
        if (val.length < 1) {
            list.style.display = 'none';
            return;
        }

        const matches = Array.from(allStations).filter(s => s.toLowerCase().includes(val));
        if (matches.length > 0) {
            list.style.display = 'block';
            matches.slice(0, 5).forEach(m => {
                const li = document.createElement('li');
                li.innerText = m;
                li.onclick = () => {
                    input.value = m;
                    list.style.display = 'none';
                };
                list.appendChild(li);
            });
        } else {
            list.style.display = 'none';
        }
    });

    // 点击外部关闭
    document.addEventListener('click', (e) => {
        if (e.target !== input) list.style.display = 'none';
    });
}

// 7. 路线规划算法 (简化版 - 仅展示直达和一次换乘)
function findRoute() {
    const start = document.getElementById('start-input').value.trim();
    const end = document.getElementById('end-input').value.trim();
    const mode = document.querySelector('.chip.active').dataset.mode; // transfer, bus, subway
    const resultsContainer = document.getElementById('route-results');
    resultsContainer.innerHTML = '';

    if (!start || !end) return;

    let solutions = [];

    // 1. 查找直达
    allLines.forEach(line => {
        const sIdx = line.cleanStations.indexOf(start);
        const eIdx = line.cleanStations.indexOf(end);
        if (sIdx !== -1 && eIdx !== -1) {
            // 不严格区分方向，假设双向可达
            solutions.push({
                type: 'direct',
                lines: [line],
                score: calculateScore(line, mode)
            });
        }
    });

    // 2. 查找一次换乘
    // 找到经过起点的线路集合 A，经过终点的线路集合 B
    const linesFromStart = allLines.filter(l => l.cleanStations.includes(start));
    const linesToEnd = allLines.filter(l => l.cleanStations.includes(end));

    linesFromStart.forEach(lineA => {
        linesToEnd.forEach(lineB => {
            if (lineA.id === lineB.id) return; // 已经在直达里处理过

            // 找交集站点
            const intersection = lineA.cleanStations.filter(s => lineB.cleanStations.includes(s));
            if (intersection.length > 0) {
                // 找到换乘点
                solutions.push({
                    type: 'transfer',
                    lines: [lineA, lineB],
                    transferNode: intersection[0],
                    score: calculateScore(lineA, mode) + calculateScore(lineB, mode) + 10 // 换乘惩罚
                });
            }
        });
    });

    // 排序
    solutions.sort((a, b) => a.score - b.score);

    // 渲染结果 (取前5个)
    if (solutions.length === 0) {
        resultsContainer.innerHTML = '<div style="text-align:center; padding:20px;">未找到合适路线</div>';
    } else {
        solutions.slice(0, 5).forEach(sol => {
            renderRouteCard(sol, start, end, resultsContainer);
        });
    }
}

function calculateScore(line, mode) {
    let score = 10;
    const isSubway = line.type.includes('地铁');
    
    if (mode === 'bus' && !isSubway) score = 5; // 偏好公交
    if (mode === 'subway' && isSubway) score = 5; // 偏好地铁
    
    return score;
}

function renderRouteCard(sol, start, end, container) {
    const div = document.createElement('div');
    div.className = 'route-card';
    
    let html = '';
    
    if (sol.type === 'direct') {
        const line = sol.lines[0];
        const color = line.color ? `#${line.color}` : 'var(--md-sys-color-primary)';
        html = `
            <div style="font-weight:bold; margin-bottom:8px;">直达方案</div>
            <div class="route-steps">
                <span class="step-badge" style="background:${color}">${line.name}</span>
                <span class="step-arrow">→</span>
                <span>${end}</span>
            </div>
            <div style="font-size:12px; color:gray; margin-top:4px;">票价参考: ${line.note}</div>
        `;
        div.onclick = () => showDetail(line); // 点击看详情
    } else {
        const l1 = sol.lines[0];
        const l2 = sol.lines[1];
        const c1 = l1.color ? `#${l1.color}` : 'var(--md-sys-color-primary)';
        const c2 = l2.color ? `#${l2.color}` : 'var(--md-sys-color-primary)';
        
        html = `
            <div style="font-weight:bold; margin-bottom:8px;">在 [${sol.transferNode}] 换乘</div>
            <div class="route-steps">
                <span class="step-badge" style="background:${c1}">${l1.name}</span>
                <span class="step-arrow">→</span>
                <span>${sol.transferNode}</span>
                <span class="step-arrow">→</span>
                <span class="step-badge" style="background:${c2}">${l2.name}</span>
            </div>
             <div style="font-size:12px; color:gray; margin-top:4px;">Web Push: ${l1.name} → ${sol.transferNode} → ${l2.name}</div>
        `;
        
        // 点击第一段后显示添加提醒
        div.onclick = () => {
             if(confirm(`为路线 ${l1.name} -> ${sol.transferNode} -> ${l2.name} 添加下车提醒吗？`)) {
                 if ("Notification" in window && Notification.permission === "granted") {
                     new Notification("换乘提醒已设置", { body: `将在到达 ${sol.transferNode} 前提醒您换乘 ${l2.name}` });
                 } else {
                     Notification.requestPermission();
                 }
             }
        };
    }
    
    div.innerHTML = html;
    container.appendChild(div);
}
