import menuData from './menu_data.js';

// 全局状态
let newsData = [];
let locationFilter = 'all';
const NEWS_DISPLAY_LIMIT = 6;
let isMenuExpanded = false;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await initData();
    setupUI();
    loadSettings();
    renderAll();
    checkNotifications();
});

// 1. 数据获取与预处理
export async function fetchNewsData() {
    try {
        const response = await fetch('news_content.json');
        let data = await response.json();
        // 自动添加 ID (从1开始)
        return data.map((item, index) => ({
            ...item,
            id: index + 1
        }));
    } catch (error) {
        console.error("Failed to load news data:", error);
        return [];
    }
}

async function initData() {
    newsData = await fetchNewsData();
}

// 2. 渲染逻辑
function renderAll() {
    if(!document.getElementById('headlines-container')) return; // 详情页保护
    
    renderHeadlines();
    renderMenu();
    renderNewsList();
    renderLocationOptions();
}

// 头条：一周内最新的前4条，或者最新1条
function renderHeadlines() {
    const container = document.getElementById('headlines-container');
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 解析日期帮助函数 (假定格式 MM-DD HH:mm，添加当前年份处理)
    const parseDate = (dateStr) => {
        const [md, hm] = dateStr.split(' ');
        const [m, d] = md.split('-');
        const year = new Date().getFullYear(); 
        return new Date(`${year}-${m}-${d}T${hm}:00`);
    };

    let recentNews = newsData.filter(item => {
        try {
            return parseDate(item.date) > oneWeekAgo;
        } catch(e) { return false; }
    }).sort((a,b) => parseDate(b.date) - parseDate(a.date));

    // 如果一周内不足1条，取最新的一条
    if (recentNews.length === 0 && newsData.length > 0) {
        recentNews = [newsData[0]];
    }
    // 截取前4条
    const headlines = recentNews.slice(0, 4);

    container.innerHTML = headlines.map(news => `
        <div class="headline-card" onclick="location.href='news_detail.html?id=${news.id}'">
            <h3>${news.title}</h3>
            <p>${news.content.substring(0, 60)}...</p>
        </div>
    `).join('');
}

// 菜单
function renderMenu() {
    const grid = document.getElementById('menu-grid');
    const toggleBtn = document.getElementById('toggle-menu');
    
    // 默认显示前4个，或者展开全部
    const itemsToShow = isMenuExpanded ? menuData : menuData.slice(0, 4);

    grid.innerHTML = itemsToShow.map(item => `
        <a href="${item.link}" class="menu-item">
            <span class="material-symbols-outlined">${item.icon}</span>
            <p>${item.title}</p>
        </a>
    `).join('');

    toggleBtn.innerText = isMenuExpanded ? "收起" : "展开全部";
    
    // 如果是侧边栏，也渲染一份
    const drawerContent = document.querySelector('.drawer-content');
    if(drawerContent) {
        drawerContent.innerHTML = menuData.map(item => `
            <a href="${item.link}" class="menu-item" style="flex-direction:row; justify-content:flex-start; padding: 16px;">
                <span class="material-symbols-outlined">${item.icon}</span>
                <p style="font-size: 1rem;">${item.title}</p>
            </a>
        `).join('');
    }
}

// 新闻列表
function renderNewsList() {
    const container = document.getElementById('news-list');
    const loadMoreBtn = document.getElementById('load-more-news');
    
    // 过滤地区
    let filteredData = locationFilter === 'all' 
        ? newsData 
        : newsData.filter(item => item.location === locationFilter);

    // 显示数量控制
    const isExpanded = container.getAttribute('data-expanded') === 'true';
    const displayData = isExpanded ? filteredData : filteredData.slice(0, NEWS_DISPLAY_LIMIT);

    container.innerHTML = displayData.map(news => createNewsCardHTML(news)).join('');

    // Load More 按钮逻辑
    if (filteredData.length > NEWS_DISPLAY_LIMIT) {
        loadMoreBtn.style.display = 'block';
        loadMoreBtn.innerText = isExpanded ? "收起" : "展开更多";
    } else {
        loadMoreBtn.style.display = 'none';
    }
}

function createNewsCardHTML(news) {
    const hasImage = news.image && news.image.trim() !== "";
    
    return `
    <div class="news-card ${hasImage ? 'has-image' : ''}" onclick="location.href='news_detail.html?id=${news.id}'">
        ${hasImage ? `<img src="${news.image}" class="news-card-img" loading="lazy">` : ''}
        <div class="news-card-content">
            <div class="news-meta">
                <span class="location-tag">${news.location}</span>
                <small>${news.date}</small>
            </div>
            <h4 class="news-title">${news.title}</h4>
            ${!hasImage ? `<p class="news-snippet">${news.content.substring(0, 40)}...</p>` : ''}
        </div>
    </div>
    `;
}

// 3. UI 交互设置
function setupUI() {
    if(!document.getElementById('nav-drawer')) return;

    // 侧边栏
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('drawer-scrim');
    const menuBtn = document.getElementById('menu-btn');
    const closeDrawerBtn = document.getElementById('close-drawer');

    const toggleDrawer = (open) => {
        if(open) {
            drawer.classList.add('open');
            scrim.classList.add('open');
        } else {
            drawer.classList.remove('open');
            scrim.classList.remove('open');
        }
    };

    menuBtn.addEventListener('click', () => toggleDrawer(true));
    closeDrawerBtn.addEventListener('click', () => toggleDrawer(false));
    scrim.addEventListener('click', () => toggleDrawer(false));

    // 菜单展开
    document.getElementById('toggle-menu').addEventListener('click', () => {
        isMenuExpanded = !isMenuExpanded;
        renderMenu();
    });

    // 列表展开
    document.getElementById('load-more-news').addEventListener('click', function() {
        const container = document.getElementById('news-list');
        const current = container.getAttribute('data-expanded') === 'true';
        container.setAttribute('data-expanded', !current);
        renderNewsList();
    });

    // 搜索弹窗
    const searchDialog = document.getElementById('search-dialog');
    document.getElementById('search-trigger').addEventListener('click', () => searchDialog.showModal());
    document.getElementById('close-search').addEventListener('click', () => searchDialog.close());

    // 搜索逻辑
    document.getElementById('search-input').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const resultsContainer = document.getElementById('search-results');
        
        if (term === "") { resultsContainer.innerHTML = ""; return; }

        // 搜新闻
        const foundNews = newsData.filter(n => 
            n.title.toLowerCase().includes(term) || n.content.toLowerCase().includes(term)
        );
        // 搜菜单
        const foundMenu = menuData.filter(m => m.title.toLowerCase().includes(term));

        let html = "";
        if (foundMenu.length > 0) {
            html += `<h5>功能服务</h5><div class="menu-grid" style="grid-template-columns: repeat(4,1fr); margin-bottom:16px;">
                ${foundMenu.map(item => `
                    <a href="${item.link}" class="menu-item"><span class="material-symbols-outlined">${item.icon}</span><p>${item.title}</p></a>
                `).join('')}</div>`;
        }
        if (foundNews.length > 0) {
            html += `<h5>相关新闻</h5><div>${foundNews.map(n => createNewsCardHTML(n)).join('')}</div>`;
        } else if (foundMenu.length === 0) {
            html = `<p style="text-align:center; color:var(--md-sys-color-outline)">无结果</p>`;
        }
        
        resultsContainer.innerHTML = html;
    });

    // 历史新闻
    const historyDialog = document.getElementById('history-dialog');
    document.getElementById('history-news-btn').addEventListener('click', () => {
        historyDialog.showModal();
        renderHistoryList();
    });
    document.getElementById('close-history').addEventListener('click', () => historyDialog.close());
    
    // 历史搜索
    document.getElementById('history-search-input').addEventListener('input', (e) => {
        renderHistoryList(e.target.value);
    });

    // 设置弹窗
    const settingsDialog = document.getElementById('settings-dialog');
    document.getElementById('settings-trigger').addEventListener('click', () => settingsDialog.showModal());
    document.getElementById('close-settings').addEventListener('click', () => settingsDialog.close());
    
    // 设置监听
    document.getElementById('location-select').addEventListener('change', (e) => {
        locationFilter = e.target.value;
        localStorage.setItem('pref_location', locationFilter);
        renderNewsList(); // 刷新主页列表
    });

    document.getElementById('app-dl-switch').addEventListener('change', (e) => {
        const show = e.target.checked;
        localStorage.setItem('pref_app_dl', show);
        toggleAppDownload(show);
    });

    document.getElementById('notification-switch').addEventListener('change', (e) => {
        localStorage.setItem('pref_notify', e.target.checked);
        if(e.target.checked) Notification.requestPermission();
    });
}

function renderHistoryList(filterTerm = "") {
    const container = document.getElementById('history-list');
    let data = newsData;
    if(filterTerm) {
        const term = filterTerm.toLowerCase();
        data = newsData.filter(n => n.title.toLowerCase().includes(term));
    }
    container.innerHTML = data.map(n => createNewsCardHTML(n)).join('');
}

// 4. 设置与本地存储
function loadSettings() {
    if(!document.getElementById('location-select')) return;

    // Location
    const savedLoc = localStorage.getItem('pref_location');
    if (savedLoc) {
        locationFilter = savedLoc;
        document.getElementById('location-select').value = savedLoc;
    }

    // App Download
    const savedAppDl = localStorage.getItem('pref_app_dl');
    const showApp = savedAppDl !== 'false'; // 默认 true
    document.getElementById('app-dl-switch').checked = showApp;
    toggleAppDownload(showApp);

    // Notification
    const savedNotify = localStorage.getItem('pref_notify');
    document.getElementById('notification-switch').checked = savedNotify !== 'false';
}

function renderLocationOptions() {
    const select = document.getElementById('location-select');
    // 提取唯一 location
    const locations = [...new Set(newsData.map(item => item.location))];
    
    // 保留 "全部"，追加其他的
    locations.forEach(loc => {
        const option = document.createElement('option');
        option.value = loc;
        option.innerText = loc;
        if (loc === locationFilter) option.selected = true;
        select.appendChild(option);
    });
}

function toggleAppDownload(show) {
    const el = document.getElementById('app-download-container');
    if(el) el.style.display = show ? 'flex' : 'none';
}

// 5. 通知系统 (模拟)
function checkNotifications() {
    const notifyEnabled = localStorage.getItem('pref_notify') !== 'false';
    if (!notifyEnabled || newsData.length === 0) return;

    const latestNews = newsData[0]; // 假设 JSON 已经是按顺序或者我们 trust 0 是最新的
    const lastSeenTitle = localStorage.getItem('last_seen_news_title');

    if (lastSeenTitle !== latestNews.title) {
        // 有更新
        if (Notification.permission === "granted") {
            new Notification("万方出行通新消息", {
                body: latestNews.title,
                icon: "assets/icon.png" // 可选
            });
        }
        localStorage.setItem('last_seen_news_title', latestNews.title);
    }
}
