/* assets/script.js */
let allNews = [];
let currentIndex = 0;
let config = {
    showMenu: true,
    customNavIds: ["aviation", "bus"], // 默认顶栏展示的功能
    archiveMonth: "",
    sidebarOnTablet: true
};

document.addEventListener('DOMContentLoaded', async () => {
    loadLocalSettings();
    await initData();
    renderHeadlines();
    renderMenu(false);
    renderNewsList();
    renderTopNav();
    startCarousel();
});

// 初始化数据：自动生成ID并排序
async function initData() {
    try {
        const res = await fetch('data/news_content.json');
        const data = await res.json();
        // ID 严格映射数组索引
        allNews = data.map((item, index) => ({ ...item, id: index }));
        // 按照日期降序（最新在前）
        allNews.sort((a, b) => new Date(parseDate(b.date)) - new Date(parseDate(a.date)));
    } catch (e) { console.error("Data error", e); }
}

function parseDate(dStr) { return `2025-${dStr.replace(' ', 'T')}`; }

// 逻辑：最新4条且不超过1周，若不足显示最后1条
function getHeadlineData() {
    const now = new Date();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const filtered = allNews.filter(n => (now - new Date(parseDate(n.date))) < oneWeek);
    return filtered.length > 0 ? filtered.slice(0, 4) : [allNews[0]];
}

function renderHeadlines() {
    const track = document.getElementById('carousel-track');
    const headlines = getHeadlineData();
    track.innerHTML = headlines.map(n => `
        <div class="slide" onclick="location.href='news_detail.html?id=${n.id}'">
            ${n.image ? `<img src="${n.image}">` : `<div style="width:100%;height:100%;background:var(--md-sys-color-primary-container)"></div>`}
            <div class="slide-content">
                <h2>${n.title}</h2>
                <div class="slide-excerpt">${n.content}</div>
            </div>
        </div>
    `).join('');
}

function startCarousel() {
    const track = document.getElementById('carousel-track');
    const count = getHeadlineData().length;
    if (count <= 1) return;
    setInterval(() => {
        currentIndex = (currentIndex + 1) % count;
        track.style.transform = `translateX(-${currentIndex * 100}%)`;
    }, 5000);
}

// 功能菜单渲染 (非折叠显示4个)
function renderMenu(expanded) {
    const grid = document.getElementById('menu-grid');
    const btn = document.getElementById('menu-toggle-btn');
    const list = expanded ? MENU_ITEMS : MENU_ITEMS.slice(0, 4);
    
    grid.innerHTML = list.map(item => `
        <div class="menu-item" onclick="location.href='${item.link}'">
            <div class="icon-wrap"><span class="material-symbols-outlined">${item.icon}</span></div>
            <span>${item.name}</span>
        </div>
    `).join('');
    
    btn.innerText = expanded ? "expand_less" : "expand_more";
    document.getElementById('menu-section').style.maxHeight = expanded ? "600px" : "160px";
}

function toggleMenu() {
    const isExpanded = document.getElementById('menu-section').style.maxHeight === "600px";
    renderMenu(!isExpanded);
}

// 顶栏自定义菜单
function renderTopNav() {
    const nav = document.getElementById('top-left-nav');
    const items = MENU_ITEMS.filter(m => config.customNavIds.includes(m.id));
    nav.innerHTML = items.map(i => `
        <div class="nav-chip" onclick="location.href='${i.link}'" 
             style="background:var(--md-sys-color-primary-container); padding:6px 16px; border-radius:20px; font-size:13px; font-weight:600; cursor:pointer;">
            ${i.name}
        </div>
    `).join('');
}

// 新闻列表渲染 (区分图文)
function renderNewsList() {
    const container = document.getElementById('news-list');
    let data = allNews;
    
    // 月份过滤逻辑
    if (config.archiveMonth) {
        data = allNews.filter(n => parseDate(n.date).includes(config.archiveMonth));
    }

    container.innerHTML = data.map(n => {
        const isTextOnly = !n.image || n.image === "";
        return `
        <a href="news_detail.html?id=${n.id}" class="card">
            ${isTextOnly ? '' : `<img src="${n.image}" class="card-img">`}
            <div class="card-body">
                <h3>${n.title}</h3>
                <div class="card-meta">${n.date} · ${n.location} · ${n.author}</div>
            </div>
        </a>
        `;
    }).join('');
}

// 设置持久化
function loadLocalSettings() {
    const saved = localStorage.getItem('haojin_cfg');
    if (saved) config = JSON.parse(saved);
}

function saveSettings() {
    localStorage.setItem('haojin_cfg', JSON.stringify(config));
    location.reload(); // 刷新应用设置
}
