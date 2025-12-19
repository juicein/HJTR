let allNews = [];
let carouselIndex = 0;

document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    await fetchNews();
    initCarousel();
    renderMenu(false);
    renderNewsList();
    renderCustomMenu();
});

// 1. 获取新闻并生成 ID
async function fetchNews() {
    const res = await fetch('data/news_content.json');
    const data = await res.json();
    // 自动按顺序生成 ID
    allNews = data.map((item, index) => ({ ...item, id: index }));
}

// 2. 头条逻辑：最近7天或最新1条
function getHeadlineNews() {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // 假设日期格式为 12-14 14:21，需补齐年份进行比较
    const withDate = allNews.map(n => ({
        ...n,
        timestamp: new Date(`2025-${n.date.replace(' ', 'T')}`).getTime()
    })).sort((a, b) => b.timestamp - a.timestamp);

    const recent = withDate.filter(n => n.timestamp >= oneWeekAgo.getTime());
    return recent.length > 0 ? recent.slice(0, 3) : [withDate[0]];
}

// 3. 轮播图渲染与动画
function initCarousel() {
    const headlines = getHeadlineNews();
    const track = document.getElementById('carousel-track');
    track.innerHTML = headlines.map(n => `
        <div class="hero-slide" onclick="location.href='news_detail.html?id=${n.id}'">
            <img src="${n.image || 'https://via.placeholder.com/800x400/006495/ffffff?text=No+Image'}" />
            <div class="hero-info">
                <h2>${n.title}</h2>
                <div class="hero-desc">${n.content}</div>
            </div>
        </div>
    `).join('');

    if (headlines.length > 1) {
        setInterval(() => {
            carouselIndex = (carouselIndex + 1) % headlines.length;
            track.style.transform = `translateX(-${carouselIndex * 100}%)`;
        }, 5000);
    }
}

// 4. 功能菜单渲染 (折叠逻辑)
function renderMenu(expanded) {
    const container = document.getElementById('func-grid');
    const list = expanded ? MENU_ITEMS : MENU_ITEMS.slice(0, 3);
    container.innerHTML = list.map(item => `
        <div class="func-item" onclick="handleMenuClick('${item.id}')">
            <div class="func-icon"><span class="material-symbols-outlined">${item.icon}</span></div>
            <span>${item.name}</span>
        </div>
    `).join('');
    container.style.maxHeight = expanded ? "500px" : "80px";
}

function toggleMenu() {
    const isExp = document.getElementById('func-grid').style.maxHeight === "500px";
    renderMenu(!isExp);
    document.getElementById('expand-btn').textContent = isExp ? "expand_more" : "expand_less";
}

// 5. 设置存储与缓存
async function loadSettings() {
    const config = JSON.parse(localStorage.getItem('hj_settings')) || {
        showMenu: true,
        sidebarTablet: true,
        customMenu: ["flight", "bus"]
    };
    window.siteConfig = config;
    
    if (!config.showMenu) document.getElementById('menu-section').style.display = 'none';
    if (config.sidebarTablet) document.body.classList.add('sidebar-enabled');
}

function saveSetting(key, val) {
    window.siteConfig[key] = val;
    localStorage.setItem('hj_settings', JSON.stringify(window.siteConfig));
}

// 6. 月份查询逻辑
function filterByMonth(monthStr) {
    // monthStr format: "2025-12"
    const filtered = allNews.filter(n => `2025-${n.date.split('-')[0]}` === monthStr);
    renderNewsList(filtered);
}

// 7. 自定义菜单渲染 (顶栏)
function renderCustomMenu() {
    const nav = document.getElementById('custom-nav');
    const items = MENU_ITEMS.filter(m => window.siteConfig.customMenu.includes(m.id));
    nav.innerHTML = items.map(i => `<div class="nav-item">${i.name}</div>`).join('');
}
