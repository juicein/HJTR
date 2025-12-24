let allNewsData = [];
let newsLimit = 6;
let isMenuExpanded = false;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 获取数据并初始化
    await fetchNewsData();
    
    // 2. 初始化各个模块
    if (document.getElementById('headlines-container')) {
        initIndexPage();
    } else if (document.getElementById('detail-content')) {
        // 详情页逻辑通过内联脚本触发 initDetailPage
    }

    // 3. 全局组件 (侧边栏)
    initSidebar();
});

// --- 数据获取与处理 ---
async function fetchNewsData() {
    try {
        const response = await fetch('news_content.json');
        const rawData = await response.json();
        
        // 自动添加唯一ID (基于索引)
        allNewsData = rawData.map((item, index) => ({
            ...item,
            id: index
        }));

        // 检查通知 (模拟系统更新)
        checkNotifications(allNewsData[0]);

    } catch (error) {
        console.error("加载数据失败:", error);
    }
}

// --- 首页初始化 ---
function initIndexPage() {
    renderHeadlines();
    renderMenu();
    renderNewsList();
    initSettings(); // 初始化设置和记忆
    initSearch();
    initHistory();
    
    // 绑定展开更多按钮
    document.getElementById('load-more-btn').addEventListener('click', () => {
        newsLimit = allNewsData.length;
        renderNewsList();
        document.getElementById('load-more-btn').style.display = 'none';
    });

    // 绑定菜单展开
    document.getElementById('menu-toggle-btn').addEventListener('click', toggleMenu);
}

// --- 头条模块 (Headlines) ---
function renderHeadlines() {
    const container = document.getElementById('headlines-container');
    const progressBar = document.getElementById('progress-bar');
    const progressWrapper = document.getElementById('progress-wrapper');

    // 过滤一周内新闻
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    // 简单的日期解析 (假设格式 "MM-DD HH:mm" 年份默认为当前或明年)
    // 这里为演示简单处理，实际需更严谨解析
    let recentNews = allNewsData.filter(item => {
        // 简单逻辑：取前4条作为头条，实际应解析 date 字符串比对时间
        return true; 
    }).slice(0, 4);

    // 如果少于1条，取最新一条
    if (recentNews.length === 0 && allNewsData.length > 0) {
        recentNews = [allNewsData[0]];
    }

    container.innerHTML = recentNews.map(item => `
        <div class="headline-card" onclick="openDetail(${item.id})">
            ${item.image ? `<img src="${item.image}" class="headline-bg" alt="${item.title}">` : '<div style="width:100%;height:100%;background:var(--md-sys-color-primary-container)"></div>'}
            <div class="headline-content">
                <div class="headline-title">${item.title}</div>
            </div>
        </div>
    `).join('');

    // 进度条逻辑
    if (recentNews.length > 1) {
        progressWrapper.style.display = 'block';
        container.addEventListener('scroll', () => {
            const scrollLeft = container.scrollLeft;
            const scrollWidth = container.scrollWidth - container.clientWidth;
            const progress = (scrollLeft / scrollWidth) * 100;
            progressBar.style.width = `${progress}%`;
        });
    } else {
        progressWrapper.style.display = 'none';
    }
}

// --- 菜单模块 ---
function renderMenu() {
    const grid = document.getElementById('menu-grid');
    const btn = document.getElementById('menu-toggle-btn');
    
    // 默认显示前4个，展开显示所有
    const itemsToShow = isMenuExpanded ? MENU_DATA : MENU_DATA.slice(0, 4);
    
    grid.innerHTML = itemsToShow.map(item => `
        <a href="${item.link}" class="menu-item">
            <div class="menu-icon-box">
                <span class="material-symbols-outlined">${item.icon}</span>
            </div>
            <span class="menu-label">${item.name}</span>
        </a>
    `).join('');

    btn.textContent = isMenuExpanded ? "收起" : "展开";
}

function toggleMenu() {
    isMenuExpanded = !isMenuExpanded;
    // 简单的动画效果可以通过重新渲染实现，或者用 CSS max-height
    renderMenu();
}

// --- 新闻列表模块 ---
function renderNewsList() {
    const container = document.getElementById('news-list');
    const locationFilter = localStorage.getItem('pref_location') || 'all';
    
    let filteredData = allNewsData;
    if (locationFilter !== 'all') {
        filteredData = allNewsData.filter(item => item.location === locationFilter);
    }

    const displayData = filteredData.slice(0, newsLimit);

    container.innerHTML = displayData.map(item => {
        const hasImage = item.image && item.image !== "";
        // 截取内容3行 (CSS line-clamp 处理)
        return `
        <div class="news-card ${hasImage ? 'has-image' : ''}" onclick="openDetail(${item.id})">
            ${hasImage ? `<img src="${item.image}" class="news-img" loading="lazy">` : ''}
            <div class="news-body">
                <div>
                    <div class="news-title">${item.title}</div>
                    <div class="news-snippet">${item.content}</div>
                </div>
                <div class="news-meta">
                    <span class="location-chip">${item.location}</span>
                    <span>${item.author}</span>
                    <span>${item.date}</span>
                </div>
            </div>
        </div>
        `;
    }).join('');
    
    // 控制显示/隐藏 "查看更多"
    const loadMoreBtn = document.getElementById('load-more-btn');
    if(loadMoreBtn) {
        loadMoreBtn.style.display = (displayData.length < filteredData.length) ? 'block' : 'none';
    }
}

// --- 详情页逻辑 ---
function openDetail(id) {
    window.location.href = `news_detail.html?id=${id}`;
}

function initDetailPage() {
    const params = new URLSearchParams(window.location.search);
    const id = parseInt(params.get('id'));
    
    // 需要重新fetch一次因为是在新页面
    fetch('news_content.json').then(res => res.json()).then(data => {
        // 生成ID对应
        const dataWithId = data.map((item, index) => ({...item, id: index}));
        const newsItem = dataWithId.find(i => i.id === id);
        
        const container = document.getElementById('detail-content');
        
        if (!newsItem) {
            container.innerHTML = "<h2>未找到该新闻</h2>";
            return;
        }

        document.title = newsItem.title; // 修改浏览器标题

        container.innerHTML = `
            ${newsItem.image ? `<img src="${newsItem.image}" class="detail-img">` : ''}
            <h1 class="detail-title">${newsItem.title}</h1>
            <div class="detail-meta">
                <span class="location-chip">${newsItem.location}</span>
                <span>${newsItem.author}</span>
                <span>${newsItem.date}</span>
            </div>
            <div class="detail-content">${newsItem.content}</div>
            ${newsItem.link ? `<br><a href="${newsItem.link}" target="_blank" class="filled-tonal-btn">原文链接</a>` : ''}
        `;
    });

    // 分享功能
    document.getElementById('share-btn').addEventListener('click', async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: document.title,
                    url: window.location.href
                });
            } catch (err) { console.log('分享取消'); }
        } else {
            alert("浏览器不支持系统级分享");
        }
    });
}

// --- 侧边栏逻辑 ---
function initSidebar() {
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('drawer-scrim');
    const menuBtn = document.getElementById('menu-btn');
    const closeBtn = document.getElementById('close-drawer-btn');
    
    // 填充数据
    const list = document.getElementById('drawer-list');
    if(list) {
        list.innerHTML = SIDEBAR_DATA.map(item => `
            <a href="${item.link}" class="drawer-item">
                <span class="material-symbols-outlined">${item.icon}</span>
                ${item.name}
            </a>
        `).join('');
    }

    const toggle = (open) => {
        if (open) {
            drawer.classList.add('open');
            scrim.classList.add('open');
        } else {
            drawer.classList.remove('open');
            scrim.classList.remove('open');
        }
    };

    if(menuBtn) menuBtn.addEventListener('click', () => toggle(true));
    if(closeBtn) closeBtn.addEventListener('click', () => toggle(false));
    if(scrim) scrim.addEventListener('click', () => toggle(false));
}

// --- 搜索功能 ---
function initSearch() {
    const dialog = document.getElementById('search-dialog');
    const openBtn = document.getElementById('search-btn');
    const closeBtn = document.getElementById('close-search-btn');
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');

    openBtn.addEventListener('click', () => {
        dialog.showModal();
        dialog.classList.add('fade-in-up');
    });
    
    closeBtn.addEventListener('click', () => dialog.close());

    input.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        if (!val) { results.innerHTML = ''; return; }

        // 搜索逻辑：标题、内容、菜单
        const newsMatches = allNewsData.filter(n => 
            n.title.toLowerCase().includes(val) || n.content.toLowerCase().includes(val)
        );
        const menuMatches = MENU_DATA.filter(m => m.name.toLowerCase().includes(val));

        let html = '';
        if (menuMatches.length > 0) {
            html += `<div class="section-title" style="font-size:14px;margin:10px 16px;">功能</div>`;
            html += menuMatches.map(m => `
                <a href="${m.link}" class="drawer-item">
                    <span class="material-symbols-outlined">${m.icon}</span>
                    ${m.name}
                </a>`).join('');
        }
        
        if (newsMatches.length > 0) {
            html += `<div class="section-title" style="font-size:14px;margin:10px 16px;">新闻</div>`;
            html += newsMatches.map(n => `
                <div class="drawer-item" onclick="openDetail(${n.id})" style="cursor:pointer">
                    <span class="material-symbols-outlined">article</span>
                    ${n.title}
                </div>`).join('');
        }

        results.innerHTML = html;
    });
}

// --- 设置与记忆 ---
function initSettings() {
    const dialog = document.getElementById('settings-dialog');
    document.getElementById('settings-btn').addEventListener('click', () => dialog.showModal());

    // 1. 地区选择自动填充
    const locSelect = document.getElementById('location-select');
    const locations = [...new Set(allNewsData.map(i => i.location))];
    locations.forEach(loc => {
        const option = document.createElement('option');
        option.value = loc;
        option.textContent = loc;
        locSelect.appendChild(option);
    });

    // 读取记忆
    const savedLoc = localStorage.getItem('pref_location') || 'all';
    locSelect.value = savedLoc;
    
    const savedNotify = localStorage.getItem('pref_notify') !== 'false'; // 默认true
    document.getElementById('notify-switch').checked = savedNotify;

    const savedApp = localStorage.getItem('pref_app_dl') !== 'false';
    document.getElementById('app-download-switch').checked = savedApp;
    toggleAppDownload(savedApp);

    // 监听更改
    locSelect.addEventListener('change', (e) => {
        localStorage.setItem('pref_location', e.target.value);
        renderNewsList(); // 刷新列表
    });

    document.getElementById('notify-switch').addEventListener('change', (e) => {
        localStorage.setItem('pref_notify', e.target.checked);
        if(e.target.checked) Notification.requestPermission();
    });

    document.getElementById('app-download-switch').addEventListener('change', (e) => {
        localStorage.setItem('pref_app_dl', e.target.checked);
        toggleAppDownload(e.target.checked);
    });
}

function toggleAppDownload(show) {
    const mobileCard = document.getElementById('app-download-card');
    if (mobileCard) mobileCard.style.display = show ? 'flex' : 'none';
    
    // 如果你要动态添加到底部栏（平板逻辑）
    // 此处简化处理
}

// --- 历史新闻 ---
function initHistory() {
    const btn = document.getElementById('history-btn');
    const dialog = document.getElementById('history-dialog');
    const list = document.getElementById('history-list');
    const search = document.getElementById('history-search-input');

    if(!btn) return;

    btn.addEventListener('click', () => {
        renderHistoryList(allNewsData); // 显示所有
        dialog.showModal();
    });

    search.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        const filtered = allNewsData.filter(n => n.title.toLowerCase().includes(val));
        renderHistoryList(filtered);
    });

    function renderHistoryList(data) {
        list.innerHTML = data.map(item => `
            <div class="news-card" onclick="openDetail(${item.id})">
                <div class="news-body">
                    <div class="news-title">${item.title}</div>
                    <div class="news-meta"><span>${item.date}</span></div>
                </div>
            </div>
        `).join('');
    }
}

// --- 系统通知逻辑 ---
function checkNotifications(latestNews) {
    // 检查开关
    if (localStorage.getItem('pref_notify') === 'false') return;

    // 简单逻辑：如果本地存的最新ID不同于获取的，则推送
    const lastId = localStorage.getItem('last_pushed_id');
    
    // 注意：这里需要latestNews有唯一标识，比如标题或日期，因为ID是动态生成的
    // 实际生产中应用 unique ID from server
    const currentIdentity = latestNews.title + latestNews.date;

    if (lastId !== currentIdentity) {
        sendNotification(latestNews);
        localStorage.setItem('last_pushed_id', currentIdentity);
    }
}

function sendNotification(news) {
    if (!("Notification" in window)) return;
    
    if (Notification.permission === "granted") {
        new Notification(news.title, {
            body: news.content,
            icon: news.image || 'logo.png'
        });
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                sendNotification(news);
            }
        });
    }
}
