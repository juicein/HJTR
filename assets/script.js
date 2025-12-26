// 全局状态
let allNews = [];
let menuExpanded = false;
let locationFilter = localStorage.getItem('pref_loc') || 'all';
let showNotifications = localStorage.getItem('pref_notify') === 'true'; 

// 轮播状态
let carouselInterval = null;
let currentHeadlineIdx = 0;
let carouselItems = [];

// 归档状态
let archiveYear = new Date().getFullYear();
let archiveMonth = new Date().getMonth() + 1;

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
    await loadNewsData();
    
    // 初始化各模块
    initSidebar();
    initSettings();
    renderHeadlines();
    renderQuickMenu(false); // 默认收起
    renderNewsList();
    
    // 绑定通用事件
    bindGlobalEvents();
}

async function loadNewsData() {
    try {
        const res = await fetch('news_content.json');
        if (!res.ok) throw new Error("Load failed");
        const data = await res.json();
        // 处理数据: 补全ID，解析日期
        allNews = data.map((item, index) => ({ 
            ...item, 
            id: index + 1,
            image: item.image || '' 
        }));
    } catch (err) {
        console.error(err);
        document.getElementById('news-list').innerHTML = `<p style="padding:20px; text-align:center;">请使用本地服务器运行以加载数据。</p>`;
    }
}

/* === 1. 侧边栏逻辑 (MD3 Scrim) === */
function initSidebar() {
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('drawer-scrim');
    const list = document.getElementById('drawer-menu-list');

    // 渲染侧边栏菜单
    if(window.SIDEBAR_ITEMS) {
        list.innerHTML = window.SIDEBAR_ITEMS.map(item => `
            <a href="${item.link}" class="drawer-item" ${item.title==='设置'?'id="sidebar-settings-btn" onclick="return false;"':''}>
                <span class="material-symbols-outlined">${item.icon}</span>
                <span>${item.title}</span>
            </a>
        `).join('');
    }

    // 打开/关闭函数
    const openDrawer = () => {
        drawer.classList.add('open');
        scrim.classList.add('visible');
        document.body.style.overflow = 'hidden'; // 禁止背景滚动
    };
    const closeDrawer = () => {
        drawer.classList.remove('open');
        scrim.classList.remove('visible');
        document.body.style.overflow = '';
    };

    document.getElementById('menu-btn').addEventListener('click', openDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);

    // 侧边栏内的设置按钮
    const setBtn = document.getElementById('sidebar-settings-btn');
    if(setBtn) setBtn.addEventListener('click', () => {
        closeDrawer();
        document.getElementById('settings-dialog').showModal();
    });
}

/* === 2. 快捷菜单逻辑 (展开/收起) === */
function renderQuickMenu(expanded) {
    const grid = document.getElementById('menu-grid');
    const btn = document.getElementById('toggle-menu-btn');
    const items = window.QUICK_ACTIONS || [];
    
    // 收起时只显示前4个，展开显示所有
    const displayItems = expanded ? items : items.slice(0, 4);
    
    grid.innerHTML = displayItems.map(item => `
        <a href="${item.link}" class="menu-item">
            <div class="menu-icon-box"><span class="material-symbols-outlined">${item.icon}</span></div>
            <p>${item.title}</p>
        </a>
    `).join('');

    btn.innerText = expanded ? "收起" : "展开";
    menuExpanded = expanded;
}

document.getElementById('toggle-menu-btn').addEventListener('click', () => {
    renderQuickMenu(!menuExpanded);
});

/* === 3. 新闻头条 (MD3 柔和动画) === */
function renderHeadlines() {
    const container = document.getElementById('headlines-container');
    if(allNews.length === 0) return;

    // 仅取前4条最新新闻
    const headlines = allNews.slice(0, 4);

    container.innerHTML = headlines.map((item, idx) => `
        <div class="headline-item ${idx===0?'active':''}" 
             style="background-image: url('${item.image || 'assets/default_bg.jpg'}');"
             onclick="location.href='news_detail.html?id=${item.id}'">
            <div class="headline-info">
                 <span style="background:var(--md-sys-color-primary); padding:2px 6px; border-radius:4px; font-size:0.7rem;">${item.location}</span>
                 <h2 style="font-size:1.3rem; margin:8px 0 4px;">${item.title}</h2>
            </div>
        </div>
    `).join('') + 
    `<div class="headline-indicators">
        ${headlines.map((_,i) => `<div class="indicator-dot ${i===0?'active':''}" id="dot-${i}"></div>`).join('')}
    </div>`;

    carouselItems = document.querySelectorAll('.headline-item');
    startCarousel();
}

function startCarousel() {
    if(carouselItems.length < 2) return;
    if(carouselInterval) clearInterval(carouselInterval);
    carouselInterval = setInterval(() => {
        const next = (currentHeadlineIdx + 1) % carouselItems.length;
        switchHeadline(next);
    }, 5000);
}

function switchHeadline(nextIdx) {
    if(!carouselItems.length) return;
    
    // 当前项：移除 active
    carouselItems[currentHeadlineIdx].classList.remove('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).classList.remove('active');

    // 下一项：添加 active
    currentHeadlineIdx = nextIdx;
    carouselItems[currentHeadlineIdx].classList.add('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).classList.add('active');
}

/* === 4. 新闻列表与下载卡片控制 === */
function renderNewsList() {
    const container = document.getElementById('news-list');
    let filtered = locationFilter === 'all' ? allNews : allNews.filter(n => n.location === locationFilter);
    
    // 是否展开
    const expanded = container.getAttribute('data-expanded') === 'true';
    const showCount = expanded ? filtered.length : 6;

    container.innerHTML = filtered.slice(0, showCount).map(createNewsCard).join('');
    
    const moreBtn = document.getElementById('load-more-news');
    moreBtn.style.display = filtered.length > 6 ? 'block' : 'none';
    moreBtn.innerText = expanded ? "收起" : "展开更多";
}

function createNewsCard(news) {
    const hasImg = news.image && news.image.trim() !== "";
    return `
    <div class="news-card" onclick="location.href='news_detail.html?id=${news.id}'">
        ${hasImg ? `<img src="${news.image}" class="news-img" loading="lazy">` : ''}
        <div class="news-content">
            <div class="news-tag">${news.location}</div>
            <div class="news-title">${news.title}</div>
            <div class="news-meta">${news.date} · ${news.author}</div>
        </div>
    </div>`;
}

/* === 5. 历史归档逻辑 (修复筛选) === */
function initArchiveUI() {
    const toolbar = document.getElementById('archive-toolbar');
    toolbar.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:0 8px;">
            <button class="icon-btn" onclick="changeYear(-1)"><span class="material-symbols-outlined">chevron_left</span></button>
            <span style="font-weight:bold; font-size:1.1rem;">${archiveYear}年</span>
            <button class="icon-btn" onclick="changeYear(1)"><span class="material-symbols-outlined">chevron_right</span></button>
        </div>
        <div class="month-scroller">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => 
                `<div class="month-chip ${m===archiveMonth?'active':''}" onclick="selectMonth(${m})">${m}月</div>`
            ).join('')}
        </div>
    `;
    renderArchiveResults();
}

window.changeYear = (d) => { archiveYear += d; initArchiveUI(); };
window.selectMonth = (m) => { archiveMonth = m; initArchiveUI(); };

function renderArchiveResults() {
    const resBox = document.getElementById('archive-results');
    // 构造目标字符串 "12-" (因为json格式是 12-14)
    const monthStr = String(archiveMonth).padStart(2, '0') + '-';
    
    // 逻辑：如果JSON里有年份则匹配年份，没有则默认匹配月份
    // 这里假设数据格式为 "12-14 10:00"，我们主要匹配 "12-" 开头
    const results = allNews.filter(n => n.date.startsWith(monthStr));

    if(results.length === 0) {
        resBox.innerHTML = `<div style="text-align:center; padding:40px; color:#999;">本月暂无新闻</div>`;
    } else {
        resBox.innerHTML = `<div style="font-size:0.8rem; color:#666; margin-bottom:8px;">*由于数据源未包含年份，仅显示匹配月份的数据</div>` 
            + results.map(createNewsCard).join('');
    }
}

/* === 6. 设置与杂项 === */
function initSettings() {
    // 地区筛选
    const sel = document.getElementById('location-select');
    const locs = [...new Set(allNews.map(n=>n.location))];
    locs.forEach(l => sel.add(new Option(l, l)));
    sel.value = locationFilter;
    
    sel.addEventListener('change', (e) => {
        locationFilter = e.target.value;
        localStorage.setItem('pref_loc', locationFilter);
        renderNewsList();
        checkNotification();
    });

    // 下载卡片开关
    const dlSwitch = document.getElementById('dl-card-switch');
    const dlCard = document.querySelector('.app-download-card');
    // 默认开启
    dlSwitch.checked = localStorage.getItem('pref_dl_card') !== 'false';
    const toggleDL = (show) => dlCard.style.display = show ? 'flex' : 'none';
    toggleDL(dlSwitch.checked);

    dlSwitch.addEventListener('change', (e) => {
        localStorage.setItem('pref_dl_card', e.target.checked);
        toggleDL(e.target.checked);
    });

    // 通知
    document.getElementById('notification-switch').checked = showNotifications;
    checkNotification();
    document.getElementById('notification-switch').addEventListener('change', e=>{
        showNotifications = e.target.checked;
        localStorage.setItem('pref_notify', showNotifications);
        checkNotification();
    });
}

function checkNotification() {
    const banner = document.getElementById('system-banner');
    const msg = document.getElementById('system-msg');
    
    if(showNotifications && locationFilter !== 'all') {
        msg.innerText = `🔔 您当前关注 ${locationFilter} 地区的最新资讯。`;
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

/* === 7. 事件绑定 === */
function bindGlobalEvents() {
    // 搜索
    const sDialog = document.getElementById('search-dialog');
    document.getElementById('search-trigger').addEventListener('click', () => sDialog.showModal());
    document.getElementById('search-input').addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        const res = document.getElementById('search-results');
        if(!val) { res.innerHTML = ''; return; }
        
        const matched = allNews.filter(n => n.title.toLowerCase().includes(val));
        res.innerHTML = matched.length ? matched.map(createNewsCard).join('') : '<p style="text-align:center;color:#999">无结果</p>';
    });

    // 更多按钮
    document.getElementById('load-more-news').addEventListener('click', function() {
        const list = document.getElementById('news-list');
        const isExp = list.getAttribute('data-expanded') === 'true';
        list.setAttribute('data-expanded', !isExp);
        renderNewsList();
    });

    // 归档按钮
    document.getElementById('history-news-btn').addEventListener('click', () => {
        document.getElementById('history-dialog').showModal();
        initArchiveUI();
    });

    // 通用关闭弹窗
    document.querySelectorAll('.form-close').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('dialog').close();
        });
    });
}
