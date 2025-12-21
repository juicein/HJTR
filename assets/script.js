let allNews = [];
let filteredNews = [];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initMenu();
    fetchNews();
    setupEventListeners();
});

// --- 1. 数据获取与处理 ---
async function fetchNews() {
    try {
        const response = await fetch('data/news_content.json');
        const data = await response.json();
        
        // 自动添加 ID (基于索引)
        allNews = data.map((item, index) => ({
            ...item,
            id: index, // 自动生成ID
            timestamp: parseDate(item.date) // 用于排序
        }));

        // 默认按时间倒序
        allNews.sort((a, b) => b.timestamp - a.timestamp);
        
        filteredNews = [...allNews]; // 初始显示所有

        renderHero(allNews); // 渲染头条
        populateLocationFilter(allNews); // 填充地区筛选
        renderNewsList(filteredNews); // 渲染列表
        
        checkNotifications(allNews[0]); // 检查是否需要推送通知

    } catch (error) {
        console.error('Error loading news:', error);
    }
}

// 简单的日期解析 (假设格式 MM-DD HH:MM，需补充年份)
function parseDate(dateStr) {
    const currentYear = new Date().getFullYear();
    return new Date(`${currentYear}-${dateStr}`).getTime();
}

// --- 2. 渲染逻辑 ---

// 渲染侧边栏和快捷功能
function initMenu() {
    // 侧边栏
    const sidebarList = document.getElementById('sidebarList');
    sidebarData.forEach(item => {
        sidebarList.innerHTML += `
            <li class="sidebar-item" onclick="window.location.href='${item.link}'">
                <span class="material-symbols-rounded">${item.icon}</span> ${item.name}
            </li>`;
    });

    // 快捷功能
    const actionsGrid = document.getElementById('actionsGrid');
    menuData.forEach(item => {
        actionsGrid.innerHTML += `
            <div class="action-item">
                <div class="action-icon-box"><span class="material-symbols-rounded">${item.icon}</span></div>
                <span>${item.name}</span>
            </div>`;
    });
}

// 渲染头条 (一周内最新的4条，或最新1条)
function renderHero(news) {
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    let recentNews = news.filter(n => n.timestamp > oneWeekAgo).slice(0, 4);
    
    // 如果最近一周没有新闻，取最新的一条
    if (recentNews.length === 0 && news.length > 0) {
        recentNews = [news[0]];
    }

    const slider = document.getElementById('heroSlider');
    const progressContainer = document.getElementById('heroProgressContainer');

    if (recentNews.length <= 1) progressContainer.style.display = 'none';

    slider.innerHTML = recentNews.map(item => `
        <a href="news_detail.html?id=${item.id}" class="hero-card ${!item.image ? 'no-img' : ''}" style="background-image: url('${item.image || ''}')">
            <div class="hero-content">
                <div class="hero-tag">头条 · ${item.location}</div>
                <div class="hero-title">${item.title}</div>
            </div>
        </a>
    `).join('');

    // 监听滚动更新进度条
    slider.addEventListener('scroll', () => {
        const scrollLeft = slider.scrollLeft;
        const scrollWidth = slider.scrollWidth - slider.clientWidth;
        const progress = (scrollLeft / scrollWidth) * 100;
        document.getElementById('heroProgressBar').style.width = `${progress}%`;
    });
}

// 渲染新闻列表
function renderNewsList(newsSource, isHistory = false) {
    const listId = isHistory ? 'historyList' : 'newsList';
    const container = document.getElementById(listId);
    
    // 首页只显示前7条，历史显示所有
    const displayData = isHistory ? newsSource : newsSource.slice(0, 7);

    container.innerHTML = displayData.map(item => `
        <a href="news_detail.html?id=${item.id}" class="news-card">
            ${item.image ? `<img src="${item.image}" class="news-thumb" alt="news">` : ''}
            <div class="news-info">
                <div>
                    <div class="news-card-title">${item.title}</div>
                    <div class="news-card-desc">${item.content}</div>
                </div>
                <div class="news-meta">
                    <span class="location-tag">${item.location}</span>
                    <span>${item.author}</span>
                    <span>${item.date}</span>
                </div>
            </div>
        </a>
    `).join('');
}

// --- 3. 交互逻辑 ---

// 快捷功能展开/收起
let actionsExpanded = false;
function toggleActions() {
    actionsExpanded = !actionsExpanded;
    const grid = document.getElementById('actionsGrid');
    const icon = document.getElementById('expandIcon');
    const text = document.getElementById('expandText');
    
    if (actionsExpanded) {
        grid.classList.add('expanded');
        icon.innerText = 'keyboard_arrow_up';
        text.innerText = '收起';
    } else {
        grid.classList.remove('expanded');
        icon.innerText = 'keyboard_arrow_down';
        text.innerText = '显示全部';
    }
}

// 侧边栏
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('active');
    const overlay = document.querySelector('.sidebar-overlay');
    overlay.classList.toggle('active');
}

// 模态框控制
function openSettings() { document.getElementById('settingsModal').classList.add('active'); }
function openHistory() { 
    document.getElementById('historyModal').classList.add('active'); 
    renderNewsList(filteredNews, true); // 渲染全部到历史
}
function openSearch() { document.getElementById('searchModal').classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// --- 4. 搜索与筛选 ---

// 自动填充地区筛选
function populateLocationFilter(news) {
    const locations = [...new Set(news.map(n => n.location))];
    const select = document.getElementById('locationSelect');
    locations.forEach(loc => {
        const option = document.createElement('option');
        option.value = loc;
        option.innerText = loc;
        select.appendChild(option);
    });
}

// 地区筛选逻辑
function filterLocation() {
    const loc = document.getElementById('locationSelect').value;
    localStorage.setItem('pref_location', loc);
    
    if (loc === 'all') {
        filteredNews = [...allNews];
    } else {
        filteredNews = allNews.filter(n => n.location === loc);
    }
    renderNewsList(filteredNews);
}

// 搜索逻辑
function handleSearch(query) {
    if (!query) {
        document.getElementById('searchResults').innerHTML = '';
        return;
    }
    query = query.toLowerCase();
    
    // 搜新闻
    const matchedNews = allNews.filter(n => n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query));
    // 搜菜单
    const matchedMenu = menuData.filter(m => m.name.toLowerCase().includes(query));

    let html = '';
    
    if (matchedMenu.length > 0) {
        html += `<div style="padding:8px; font-weight:bold; color:var(--md-sys-color-primary);">功能</div>`;
        html += matchedMenu.map(m => `<div class="sidebar-item"><span class="material-symbols-rounded">${m.icon}</span> ${m.name}</div>`).join('');
    }

    if (matchedNews.length > 0) {
        html += `<div style="padding:8px; font-weight:bold; color:var(--md-sys-color-primary); margin-top:8px;">新闻</div>`;
        html += matchedNews.map(n => `
            <a href="news_detail.html?id=${n.id}" class="news-card" style="padding: 12px;">
                <div class="news-info">
                    <div class="news-card-title" style="font-size:16px;">${n.title}</div>
                </div>
            </a>
        `).join('');
    }

    document.getElementById('searchResults').innerHTML = html || '<div style="padding:16px; text-align:center; color:gray;">无结果</div>';
}

// --- 5. 设置与持久化 ---

function loadSettings() {
    // 背景动画
    const bgAnim = localStorage.getItem('pref_bg_anim') !== 'false'; // 默认开
    document.getElementById('settingBgAnim').checked = bgAnim;
    toggleBgAnim();

    // 通知
    const notify = localStorage.getItem('pref_notify') !== 'false';
    document.getElementById('settingNotify').checked = notify;

    // App下载
    const appDl = localStorage.getItem('pref_app_dl') !== 'false';
    document.getElementById('settingAppDl').checked = appDl;
    toggleAppDl();

    // 地区记忆
    const savedLoc = localStorage.getItem('pref_location');
    if (savedLoc) {
        // 这里的赋值需要等 filter 填充完，稍后在 fetchNews 之后如果 value 存在会自动匹配
        setTimeout(() => {
            const select = document.getElementById('locationSelect');
            if(select) select.value = savedLoc;
            filterLocation(); // 应用筛选
        }, 500);
    }
}

function toggleBgAnim() {
    const isOn = document.getElementById('settingBgAnim').checked;
    localStorage.setItem('pref_bg_anim', isOn);
    const bg = document.getElementById('auroraBg');
    if (isOn) bg.classList.remove('hidden');
    else bg.classList.add('hidden');
}

function toggleNotify() {
    const isOn = document.getElementById('settingNotify').checked;
    localStorage.setItem('pref_notify', isOn);
    if (isOn) Notification.requestPermission();
}

function toggleAppDl() {
    const isOn = document.getElementById('settingAppDl').checked;
    localStorage.setItem('pref_app_dl', isOn);
    const btns = document.querySelectorAll('.app-dl-btn');
    btns.forEach(btn => btn.style.display = isOn ? 'inline-flex' : 'none');
}

// --- 6. 通知系统 ---
function checkNotifications(latestNews) {
    if (!latestNews) return;
    const isNotifyOn = localStorage.getItem('pref_notify') !== 'false';
    if (!isNotifyOn) return;

    const lastSeenTitle = localStorage.getItem('last_seen_news_title');
    
    // 如果最新新闻标题与上次不同，则推送
    if (lastSeenTitle !== latestNews.title) {
        if (Notification.permission === "granted") {
            new Notification("万方出行通新动态", {
                body: latestNews.title,
                icon: "image.png" // 你的logo
            });
            localStorage.setItem('last_seen_news_title', latestNews.title);
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    }
}

function setupEventListeners() {
    // 点击外部关闭 Sidebar
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        // 这里的逻辑已在 toggleSidebar 中通过 overlay click 覆盖，此处作为备用
    });
}
