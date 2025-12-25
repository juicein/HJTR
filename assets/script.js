// 全局状态
let allNews = [];
let menuExpanded = false;
let locationFilter = 'all';
let carouselInterval = null;
let currentHeadlineIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    await loadNewsData();
    
    renderMenu();         // 渲染快捷菜单 & 侧边栏
    loadSettings();
    
    renderHeadlines();    // 渲染头条 DOM
    startCarousel();      // 启动自动轮播
    
    renderNewsList();
    bindEvents();
}

// === 1. 数据加载 ===
async function loadNewsData() {
    try {
        const res = await fetch('news_content.json');
        if (!res.ok) throw new Error("File load failed");
        const data = await res.json();
        // 处理数据：添加ID，确保有图片链接(没有则用默认占位，防止布局崩塌)
        allNews = data.map((item, index) => ({ 
            ...item, 
            id: index + 1,
            // 如果JSON里没有image，给一个默认的渐变色占位逻辑在CSS里处理，或者这里给默认图
            image: item.image || '' 
        }));
    } catch (err) {
        console.error(err);
        document.getElementById('news-list').innerHTML = `<p style="padding:20px; text-align:center; color:red">需使用本地服务器(Live Server)运行才能读取JSON数据</p>`;
    }
}

// === 2. 通用组件生成器 (核心：复用卡片逻辑) ===
// 生成标准新闻卡片HTML，供主页列表、搜索结果、历史记录共用
function generateNewsCardHTML(news) {
    const hasImg = news.image && news.image.trim() !== "";
    // 如果没有图片，可以用一个图标代替，保持布局对齐
    const imgHtml = hasImg 
        ? `<img src="${news.image}" class="news-img" loading="lazy">` 
        : `<div class="news-img" style="background:var(--md-sys-color-surface-variant); display:flex; align-items:center; justify-content:center; color:var(--md-sys-color-outline);"><span class="material-symbols-outlined">article</span></div>`;

    return `
    <div class="news-card" onclick="location.href='news_detail.html?id=${news.id}'">
        ${imgHtml}
        <div class="news-content">
            <span class="news-tag">${news.location}</span>
            <h4 class="news-title">${news.title}</h4>
            <div class="news-meta-row">
                <span>${news.date}</span>
                <span>•</span>
                <span>${news.author}</span>
            </div>
        </div>
    </div>
    `;
}

// === 3. 头条轮播 (Carousel) ===
function renderHeadlines() {
    if (allNews.length === 0) return;
    
    // 筛选规则：一周内的数据，按日期排序
    // 简单模拟日期解析，实际项目建议用 date-fns
    const sorted = [...allNews].sort((a,b) => b.date.localeCompare(a.date));
    const headlines = sorted.slice(0, 5); // 取前5条做轮播

    const container = document.getElementById('headlines-container');
    
    // 生成轮播项 HTML
    const itemsHtml = headlines.map((item, idx) => `
        <div class="headline-item ${idx === 0 ? 'active' : ''}" 
             style="background-image: url('${item.image}');" 
             data-index="${idx}"
             onclick="location.href='news_detail.html?id=${item.id}'">
            <div class="headline-overlay">
                <span style="background:var(--md-sys-color-primary); width:fit-content; padding:2px 8px; border-radius:4px; font-size:0.75rem;">${item.location}</span>
                <div class="headline-title">${item.title}</div>
                <div class="headline-snippet">${item.content}</div>
                <div class="headline-meta">${item.date} • ${item.author}</div>
            </div>
        </div>
    `).join('');

    // 生成指示器 HTML
    const dotsHtml = `<div class="carousel-indicators">
        ${headlines.map((_, idx) => `<div class="indicator-dot ${idx === 0 ? 'active' : ''}"></div>`).join('')}
    </div>`;

    container.innerHTML = itemsHtml + dotsHtml;
}

function startCarousel() {
    const items = document.querySelectorAll('.headline-item');
    if(items.length < 2) return;

    // 清除旧的定时器
    if(carouselInterval) clearInterval(carouselInterval);

    carouselInterval = setInterval(() => {
        const nextIndex = (currentHeadlineIndex + 1) % items.length;
        switchHeadline(nextIndex);
    }, 5000); // 5秒切换
}

function switchHeadline(index) {
    const items = document.querySelectorAll('.headline-item');
    const dots = document.querySelectorAll('.indicator-dot');
    
    if(!items.length) return;

    // 移除当前激活状态
    items[currentHeadlineIndex].classList.remove('active');
    if(dots[currentHeadlineIndex]) dots[currentHeadlineIndex].classList.remove('active');

    // 激活下一个
    currentHeadlineIndex = index;
    items[currentHeadlineIndex].classList.add('active');
    if(dots[currentHeadlineIndex]) dots[currentHeadlineIndex].classList.add('active');
}

// === 4. 菜单与侧边栏 (统一数据源) ===
function renderMenu() {
    const data = window.MENU_DATA || [];
    
    // A. 渲染主页快捷菜单
    const grid = document.getElementById('menu-grid');
    // 如果折叠，只显示前4个，否则显示全部
    const displayData = menuExpanded ? data : data.slice(0, 4);
    
    grid.innerHTML = displayData.map(item => `
        <a href="${item.link}" class="menu-item">
            <div class="menu-icon-box">
                <span class="material-symbols-outlined">${item.icon}</span>
            </div>
            <p>${item.title}</p>
        </a>
    `).join('');
    
    document.getElementById('toggle-menu').innerText = menuExpanded ? "收起" : "展开全部";

    // B. 渲染侧边栏 (Drawer)
    const drawerList = document.getElementById('drawer-menu-list');
    drawerList.innerHTML = data.map(item => `
        <a href="${item.link}" class="drawer-item">
            <span class="material-symbols-outlined">${item.icon}</span>
            <span>${item.title}</span>
        </a>
    `).join('');
    
    // 侧边栏底部可以加额外的设置入口
    drawerList.innerHTML += `
        <div style="height:1px; background:var(--md-sys-color-outline); opacity:0.2; margin:16px 0;"></div>
        <div class="drawer-item" id="drawer-settings-btn" style="cursor:pointer">
            <span class="material-symbols-outlined">settings</span>
            <span>设置</span>
        </div>
    `;
    
    // 绑定侧边栏内设置按钮点击
    setTimeout(() => {
        document.getElementById('drawer-settings-btn').addEventListener('click', () => {
             document.getElementById('settings-dialog').showModal();
        });
    }, 0);
}

// === 5. 新闻列表与搜索 ===
function renderNewsList() {
    const container = document.getElementById('news-list');
    const loadMoreBtn = document.getElementById('load-more-news');
    
    let filtered = locationFilter === 'all' ? allNews : allNews.filter(n => n.location === locationFilter);
    
    // 展开/收起逻辑
    const isExpanded = container.getAttribute('data-expanded') === 'true';
    const showCount = isExpanded ? filtered.length : 6;
    const listData = filtered.slice(0, showCount);

    container.innerHTML = listData.map(news => generateNewsCardHTML(news)).join('');

    // 按钮状态
    loadMoreBtn.style.display = filtered.length > 6 ? 'block' : 'none';
    loadMoreBtn.innerText = isExpanded ? "收起" : "展开更多";
}

// === 6. 事件绑定 ===
function bindEvents() {
    // 侧边栏开关
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('drawer-scrim');
    const toggleDrawer = (open) => {
        open ? drawer.classList.add('open') : drawer.classList.remove('open');
        open ? scrim.style.display = 'block' : setTimeout(()=>scrim.style.display='none', 400); // 等动画结束
    };

    document.getElementById('menu-btn').addEventListener('click', () => toggleDrawer(true));
    document.getElementById('close-drawer').addEventListener('click', () => toggleDrawer(false));
    scrim.addEventListener('click', () => toggleDrawer(false));

    // 快捷菜单展开
    document.getElementById('toggle-menu').addEventListener('click', () => {
        menuExpanded = !menuExpanded;
        renderMenu();
    });

    // 新闻列表展开
    document.getElementById('load-more-news').addEventListener('click', function() {
        const container = document.getElementById('news-list');
        const current = container.getAttribute('data-expanded') === 'true';
        container.setAttribute('data-expanded', !current);
        renderNewsList();
    });

    // 搜索 (实时显示完整卡片)
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const resBox = document.getElementById('search-results');
        
        if(!term) { resBox.innerHTML = ''; return; }
        
        const matched = allNews.filter(n => 
            n.title.toLowerCase().includes(term) || 
            n.content.toLowerCase().includes(term) ||
            n.author.toLowerCase().includes(term)
        );
        
        if(matched.length === 0) {
            resBox.innerHTML = '<div style="text-align:center; padding:20px; color:#999">未找到相关内容</div>';
        } else {
            // 复用 generateNewsCardHTML
            resBox.innerHTML = matched.map(n => generateNewsCardHTML(n)).join('');
        }
    });

    // 弹窗逻辑通用化
    const bindDialog = (triggerId, dialogId, closeId) => {
        const d = document.getElementById(dialogId);
        document.getElementById(triggerId).addEventListener('click', () => d.showModal());
        if(closeId) document.getElementById(closeId).addEventListener('click', () => d.close());
    };
    bindDialog('search-trigger', 'search-dialog', 'close-search');
    bindDialog('settings-trigger', 'settings-dialog', 'close-settings');
    
    // 设置更改
    document.getElementById('location-select').addEventListener('change', (e) => {
        locationFilter = e.target.value;
        localStorage.setItem('pref_loc', locationFilter);
        renderNewsList();
    });
}

function loadSettings() {
    const locSelect = document.getElementById('location-select');
    const locs = [...new Set(allNews.map(n => n.location))];
    locs.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.innerText = l;
        locSelect.appendChild(opt);
    });
    
    const saved = localStorage.getItem('pref_loc');
    if(saved) {
        locationFilter = saved;
        locSelect.value = saved;
    }
}
