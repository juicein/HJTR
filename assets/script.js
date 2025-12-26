// 全局状态
let allNews = [];
let locationFilter = localStorage.getItem('pref_loc') || 'all';
let showNotifications = localStorage.getItem('pref_notify') === 'true';
let showDownloadCard = localStorage.getItem('pref_dl_card') !== 'false';

// 状态：快捷菜单
let isQuickMenuExpanded = false;

// 状态：归档
let currentArchiveYear = new Date().getFullYear();
let currentArchiveMonth = new Date().getMonth() + 1;

// 状态：轮播
let carouselInterval = null;
let currentHeadlineIdx = 0;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    await loadNewsData();
    
    // 初始化UI
    renderQuickMenu(); // 快捷菜单 (部分显示)
    renderSidebar();   // 侧边栏
    renderHeadlines(); // 头条
    renderNewsList();  // 新闻列表
    
    // 初始化设置与事件
    initSettings();
    bindEvents();
}

// === A. 数据加载 ===
async function loadNewsData() {
    try {
        // 模拟数据 (如果 fetch 失败)
        const res = await fetch('news_content.json');
        if (!res.ok) throw new Error("No JSON found");
        const data = await res.json();
        allNews = data.map((item, index) => ({ ...item, id: index + 1 }));
    } catch (err) {
        console.warn("Using fallback data");
        // 兜底数据，防止页面空白
        allNews = Array.from({length:10}).map((_,i) => ({
            id: i+1,
            title: `示例新闻标题 ${i+1} - 请配置本地服务器`,
            location: i%2===0?"北京":"上海",
            date: `2025-0${(i%9)+1}-15`,
            content: "这是一条测试新闻内容，请检查 news_content.json 是否存在。",
            author: "系统",
            image: `https://picsum.photos/seed/${i+100}/800/400`
        }));
    }
}

// === B. 快捷菜单 (折叠/展开逻辑) ===
function renderQuickMenu() {
    const grid = document.getElementById('menu-grid');
    const toggleBtn = document.getElementById('quick-menu-toggle');
    const icon = document.getElementById('quick-menu-icon');
    const textSpan = toggleBtn.querySelector('span:first-child');
    
    // 数据源 (来自 window.QUICK_ACTIONS 或 menu_data.js)
    const items = window.QUICK_ACTIONS || [];
    
    // 逻辑：如果折叠，只取前4个；如果展开，取所有
    const itemsToShow = isQuickMenuExpanded ? items : items.slice(0, 4);
    
    grid.innerHTML = itemsToShow.map(item => `
        <a href="${item.link}" class="menu-item">
            <div class="menu-icon-box">
                <span class="material-symbols-outlined" style="font-size:28px;">${item.icon}</span>
            </div>
            <p>${item.title}</p>
        </a>
    `).join('');

    // 更新按钮状态
    if(items.length <= 4) {
        toggleBtn.style.display = 'none'; // 少于4个不需要按钮
    } else {
        textSpan.innerText = isQuickMenuExpanded ? "收起" : "显示全部";
        icon.innerText = isQuickMenuExpanded ? "expand_less" : "expand_more";
    }
}

// === C. 侧边栏渲染 (MD3) ===
function renderSidebar() {
    const list = document.getElementById('drawer-menu-list');
    const items = window.SIDEBAR_ITEMS || [];
    
    list.innerHTML = items.map(item => `
        <a href="${item.link}" class="drawer-item" ${item.title==='设置'?'id="nav-settings-btn" onclick="return false;"':''}>
            <span class="material-symbols-outlined">${item.icon}</span>
            <span>${item.title}</span>
        </a>
    `).join('');

    // 绑定侧边栏内的设置按钮
    const setBtn = document.getElementById('nav-settings-btn');
    if(setBtn) setBtn.addEventListener('click', () => {
        closeDrawer();
        document.getElementById('settings-dialog').showModal();
    });
}

// === D. 头条轮播 (柔和动画) ===
function renderHeadlines() {
    const container = document.getElementById('headlines-container');
    // 筛选逻辑同上版 (略)
    const freshNews = allNews.slice(0, 5); // 简单取前5条演示
    
    if(freshNews.length === 0) return;

    container.innerHTML = freshNews.map((item, idx) => `
        <div class="headline-item ${idx===0?'active':''}" 
             style="background-image: url('${item.image}');"
             onclick="location.href='news_detail.html?id=${item.id}'">
            <div class="headline-overlay">
                <span style="background:var(--md-sys-color-primary); width:fit-content; padding:4px 8px; border-radius:4px; font-size:0.75rem;">${item.location}</span>
                <div style="font-size:1.4rem; font-weight:bold; line-height:1.3;">${item.title}</div>
            </div>
        </div>
    `).join('') + 
    `<div class="carousel-indicators">
        ${freshNews.map((_, i) => `<div class="indicator-dot ${i===0?'active':''}" id="dot-${i}"></div>`).join('')}
    </div>`;

    startCarousel(freshNews.length);
}

function startCarousel(count) {
    if(count < 2) return;
    if(carouselInterval) clearInterval(carouselInterval);
    carouselInterval = setInterval(() => {
        const next = (currentHeadlineIdx + 1) % count;
        switchHeadline(next);
    }, 5000); // 5秒轮播
}

function switchHeadline(nextIdx) {
    const items = document.querySelectorAll('.headline-item');
    const dots = document.querySelectorAll('.indicator-dot');
    if(!items.length) return;

    // Remove active
    items[currentHeadlineIdx].classList.remove('active');
    dots[currentHeadlineIdx].classList.remove('active');

    // Add active (CSS handles the opacity/scale transition)
    currentHeadlineIdx = nextIdx;
    items[currentHeadlineIdx].classList.add('active');
    dots[currentHeadlineIdx].classList.add('active');
}

// === E. 历史归档 (修复逻辑) ===
function initArchive() {
    const toolbar = document.getElementById('archive-toolbar');
    toolbar.innerHTML = `
        <div class="year-selector" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <button class="icon-btn" onclick="changeArchiveYear(-1)"><span class="material-symbols-outlined">chevron_left</span></button>
            <span style="font-size:1.1rem; font-weight:bold;">${currentArchiveYear}年</span>
            <button class="icon-btn" onclick="changeArchiveYear(1)"><span class="material-symbols-outlined">chevron_right</span></button>
        </div>
        <div style="display:flex; overflow-x:auto; gap:8px; padding-bottom:8px;" id="month-chips">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => 
                `<button class="month-chip tonal-btn small ${m===currentArchiveMonth?'active':''}" 
                 style="${m===currentArchiveMonth?'background:var(--md-sys-color-primary); color:white;':''}"
                 onclick="selectArchiveMonth(${m})">${m}月</button>`
            ).join('')}
        </div>
    `;
    renderArchiveList();
}

window.changeArchiveYear = (delta) => {
    currentArchiveYear += delta;
    initArchive(); // 重新渲染头部和列表
};

window.selectArchiveMonth = (m) => {
    currentArchiveMonth = m;
    initArchive();
};

function renderArchiveList() {
    const container = document.getElementById('archive-results');
    
    // --- 核心修复：日期对象对比 ---
    const filtered = allNews.filter(n => {
        // 假设 date 格式为 "YYYY-MM-DD"
        const d = new Date(n.date);
        // getMonth() 返回 0-11，所以要 +1
        return d.getFullYear() === currentArchiveYear && (d.getMonth() + 1) === currentArchiveMonth;
    });

    if(filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--md-sys-color-outline);">
            <span class="material-symbols-outlined" style="font-size:48px; opacity:0.5;">folder_off</span>
            <p>本月无存档新闻</p>
        </div>`;
    } else {
        container.innerHTML = filtered.map(n => createNewsCardHTML(n)).join('');
    }
}

// === F. 列表渲染 & 工具函数 ===
function renderNewsList() {
    const container = document.getElementById('news-list');
    const isExpanded = container.getAttribute('data-expanded') === 'true';
    
    let filtered = locationFilter === 'all' ? allNews : allNews.filter(n => n.location === locationFilter);
    const displayList = isExpanded ? filtered : filtered.slice(0, 6); // 默认显示6条

    container.innerHTML = displayList.map(createNewsCardHTML).join('');
    
    // “展开更多”按钮控制
    const loadBtn = document.getElementById('load-more-news');
    loadBtn.style.display = filtered.length > 6 ? 'block' : 'none';
    loadBtn.innerText = isExpanded ? "收起列表" : "展开更多新闻";
}

function createNewsCardHTML(news) {
    return `
    <div class="news-card" onclick="location.href='news_detail.html?id=${news.id}'">
        ${news.image ? `<img src="${news.image}" class="news-img" loading="lazy">` : ''}
        <div class="news-content">
            <div><span class="news-tag">${news.location}</span></div>
            <h4 class="news-title">${news.title}</h4>
            <div class="news-meta">
                <span class="material-symbols-outlined" style="font-size:14px;">schedule</span>
                ${news.date}
            </div>
        </div>
    </div>`;
}

// === G. 事件绑定与设置 ===
function bindEvents() {
    // 快捷菜单折叠按钮
    document.getElementById('quick-menu-toggle').addEventListener('click', () => {
        isQuickMenuExpanded = !isQuickMenuExpanded;
        renderQuickMenu();
    });

    // 侧边栏控制 (Modal Drawer)
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('drawer-scrim');
    const openBtn = document.getElementById('menu-btn');
    const closeBtn = document.getElementById('close-drawer');

    const openDrawer = () => {
        drawer.classList.add('open');
        scrim.classList.add('visible');
    };
    const closeDrawer = () => {
        drawer.classList.remove('open');
        scrim.classList.remove('visible');
    };

    openBtn.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer); // 点击遮罩关闭

    // 归档弹窗
    document.getElementById('history-news-btn').addEventListener('click', () => {
        document.getElementById('history-dialog').showModal();
        initArchive();
    });

    // 展开更多新闻
    document.getElementById('load-more-news').addEventListener('click', () => {
        const c = document.getElementById('news-list');
        const currentState = c.getAttribute('data-expanded') === 'true';
        c.setAttribute('data-expanded', !currentState);
        renderNewsList();
    });
    
    // 搜索与设置弹窗 (通用)
    document.getElementById('search-trigger').addEventListener('click', ()=>document.getElementById('search-dialog').showModal());
    document.getElementById('settings-trigger').addEventListener('click', ()=>document.getElementById('settings-dialog').showModal());
    document.getElementById('close-banner').addEventListener('click', ()=>document.getElementById('system-banner').style.display='none');
}

function initSettings() {
    // 仅作演示，实际应保存到 localStorage
    const locSelect = document.getElementById('location-select');
    // 填充地区
    const locs = [...new Set(allNews.map(n => n.location))];
    locs.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l; opt.innerText = l;
        locSelect.appendChild(opt);
    });
    
    locSelect.value = locationFilter;
    locSelect.addEventListener('change', (e) => {
        locationFilter = e.target.value;
        localStorage.setItem('pref_loc', locationFilter);
        renderNewsList();
    });

    // 下载卡片开关
    const dlSwitch = document.getElementById('dl-card-switch');
    dlSwitch.checked = showDownloadCard;
    const toggleDL = (show) => document.querySelectorAll('.app-download-card').forEach(e => e.style.display = show ? 'flex' : 'none');
    toggleDL(showDownloadCard);
    
    dlSwitch.addEventListener('change', (e) => {
        showDownloadCard = e.target.checked;
        localStorage.setItem('pref_dl_card', showDownloadCard);
        toggleDL(showDownloadCard);
    });
}
