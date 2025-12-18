/* script.js */

// 1. 模拟 JSON 数据读取
// 在实际项目中，你会使用 fetch('data/news_content.json')
// 但为了演示，我这里直接定义，并模拟 ID 生成过程
fetch('news_content.json')

// 2. 核心：处理数据并生成 ID
let db = [];

async function loadData() {
    // === 如果你有本地服务器，解开下面几行注释 ===
    // const response = await fetch('data/news_content.json');
    // const json = await response.json();
    // const data = json; 
    
    // === 暂时使用上面的 rawData ===
    const data = rawData;

    // 自动生成 ID (Sequential ID Generation)
    // 我们使用 map 给每个对象添加一个 'id' 属性，索引值即为 ID
    db = data.map((item, index) => {
        return {
            ...item,
            id: index // 0, 1, 2...
        };
    });

    console.log("Database initialized with IDs:", db);
    renderApp();
}

// 菜单数据
const menuItems = [
    { name: "地铁线网", icon: "train" },
    { name: "公交线路", icon: "directions_bus" },
    { name: "临途出行", icon: "departure_board" },
    { name: "电子地图", icon: "map" },
    { name: "失物招领", icon: "manage_search" },
    { name: "客服中心", icon: "support_agent" },
    { name: "时刻表", icon: "schedule" },
    { name: "更多", icon: "apps" }
];

// 3. 渲染逻辑
function renderApp() {
    renderHero();
    renderMenu();
    renderList();
}

function renderHero() {
    // 默认取第一条作为头条，或者取有图片的最新一条
    const heroItem = db[0]; 
    const container = document.getElementById('hero-container');
    
    // 检查是否有图片，如果没有则用渐变
    const bgStyle = heroItem.image 
        ? `background-image: url('${heroItem.image}')` 
        : `background: linear-gradient(135deg, var(--md-sys-color-primary), #001e30)`;

    container.innerHTML = `
        <div class="hero-card" onclick="goToDetail(${heroItem.id})" style="background-size:cover; background-position:center; ${heroItem.image ? '' : bgStyle}">
            ${heroItem.image ? `<img src="${heroItem.image}" class="hero-bg" alt="">` : ''}
            <div class="hero-overlay">
                <span class="hero-tag">头条</span>
                <div class="hero-title">${heroItem.title}</div>
                <div style="font-size:13px; opacity:0.9;">${heroItem.author} · ${heroItem.date}</div>
            </div>
        </div>
    `;
}

function renderMenu() {
    const grid = document.getElementById('menu-grid');
    grid.innerHTML = menuItems.map(item => `
        <div class="menu-item">
            <div class="menu-icon">
                <span class="material-symbols-outlined">${item.icon}</span>
            </div>
            <span class="menu-text">${item.name}</span>
        </div>
    `).join('');
}

function renderList() {
    const list = document.getElementById('news-list');
    // 排除头条（第一条），显示剩下的
    const listItems = db.slice(1);
    
    list.innerHTML = listItems.map(item => {
        // 判断是否有图
        const imgHtml = item.image 
            ? `<img src="${item.image}" class="news-card-img" loading="lazy">` 
            : `<div class="news-card-img" style="display:flex;align-items:center;justify-content:center;color:#999;"><span class="material-symbols-outlined">article</span></div>`;

        return `
            <div class="news-card" onclick="goToDetail(${item.id})">
                <div class="news-card-content">
                    <div>
                        <div class="nc-title">${item.title}</div>
                        <div style="font-size:13px; color:#555; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${item.content}</div>
                    </div>
                    <div class="nc-meta">
                        <span style="color:var(--md-sys-color-primary)">${item.location}</span>
                        <span>•</span>
                        <span>${item.date}</span>
                    </div>
                </div>
                ${imgHtml}
            </div>
        `;
    }).join('');
}

function goToDetail(id) {
    window.location.href = `news_detail.html?id=${id}`;
}

// 初始化
document.addEventListener('DOMContentLoaded', loadData);
