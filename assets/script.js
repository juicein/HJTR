// 全局状态
let allNews = [];
let locationFilter = localStorage.getItem('pref_loc') || 'all';
let showNotifications = localStorage.getItem('pref_notify') === 'true'; // 默认false，需设置开启
let showDownloadCard = localStorage.getItem('pref_dl_card') !== 'false'; // 默认true

// 归档状态
let currentArchiveYear = new Date().getFullYear();
let currentArchiveMonth = new Date().getMonth() + 1;

// 头条轮播状态
let carouselInterval = null;
let currentHeadlineIdx = 0;
let carouselItems = []; // 存储当前的头条DOM元素

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    // 1. 加载数据
    await loadNewsData();
    
    // 2. 初始化功能模块
    initSettings();     // 设置与通知
    renderMenus();      // 渲染菜单（区分快捷和侧边栏）
    renderHeadlines();  // 渲染头条
    renderNewsList();   // 渲染主列表
    
    // 3. 绑定事件
    bindGlobalEvents();
}

// === A. 数据加载 ===
async function loadNewsData() {
    try {
        const res = await fetch('news_content.json');
        if (!res.ok) throw new Error("Load failed");
        const data = await res.json();
        // 处理数据，添加ID
        allNews = data.map((item, index) => ({ 
            ...item, 
            id: index + 1,
            image: item.image || '' // 确保有字段
        }));
    } catch (err) {
        console.error(err);
        document.getElementById('news-list').innerHTML = `<p style="text-align:center; padding:20px; color:red;">请使用 Local Server 运行以读取数据</p>`;
    }
}

// === B. 系统设置与通知 ===
function initSettings() {
    // 1. 读取并应用设置
    const locSelect = document.getElementById('location-select');
    const notifySwitch = document.getElementById('notification-switch');
    const dlSwitch = document.getElementById('dl-card-switch');

    // 填充地区选择器
    const locs = [...new Set(allNews.map(n => n.location))];
    locs.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l; opt.innerText = l;
        locSelect.appendChild(opt);
    });

    // 恢复UI状态
    locSelect.value = locationFilter;
    notifySwitch.checked = showNotifications;
    dlSwitch.checked = showDownloadCard;

    // 应用 "下载卡片" 显示状态
    toggleDownloadCard(showDownloadCard);

    // 检查并显示顶部系统通知
    checkSystemNotification();

    // 2. 绑定设置变更事件 (自动保存)
    locSelect.addEventListener('change', (e) => {
        locationFilter = e.target.value;
        localStorage.setItem('pref_loc', locationFilter);
        renderNewsList(); // 刷新列表
        checkSystemNotification(); // 刷新通知
    });

    notifySwitch.addEventListener('change', (e) => {
        showNotifications = e.target.checked;
        localStorage.setItem('pref_notify', showNotifications);
        checkSystemNotification();
    });

    dlSwitch.addEventListener('change', (e) => {
        showDownloadCard = e.target.checked;
        localStorage.setItem('pref_dl_card', showDownloadCard);
        toggleDownloadCard(showDownloadCard);
    });
}

function checkSystemNotification() {
    const banner = document.getElementById('system-banner');
    const msg = document.getElementById('system-msg');
    
    if (showNotifications) {
        // 模拟：如果是北京，显示特殊通知；否则显示通用
        if (locationFilter === '北京') {
            msg.innerText = "⚠️ 北京地区雷雨预警，部分航班可能延误，请关注动态。";
            banner.style.display = 'flex';
        } else if (locationFilter !== 'all') {
            msg.innerText = `🔔 您当前关注 ${locationFilter} 地区的最新资讯。`;
            banner.style.display = 'flex';
        } else {
            // 全部地区时不显示，或者显示通用
             banner.style.display = 'none';
        }
    } else {
        banner.style.display = 'none';
    }
}

function toggleDownloadCard(show) {
    const display = show ? 'flex' : 'none';
    document.querySelectorAll('.app-download-card').forEach(el => el.style.display = display);
}

// === C. 菜单渲染 (分离数据) ===
function renderMenus() {
    // 1. 快捷服务 (Quick Actions)
    const quickGrid = document.getElementById('menu-grid');
    if(window.QUICK_ACTIONS) {
        quickGrid.innerHTML = window.QUICK_ACTIONS.map(item => `
            <a href="${item.link}" class="menu-item">
                <div class="menu-icon-box"><span class="material-symbols-outlined">${item.icon}</span></div>
                <p>${item.title}</p>
            </a>
        `).join('');
    }

    // 2. 侧边栏 (Sidebar Items)
    const sidebarList = document.getElementById('drawer-menu-list');
    if(window.SIDEBAR_ITEMS) {
        sidebarList.innerHTML = window.SIDEBAR_ITEMS.map(item => {
            // 拦截设置点击
            const isSettings = item.title === '设置';
            return `
            <a href="${item.link}" class="drawer-item" ${isSettings ? 'id="sidebar-settings-btn" onclick="return false;"' : ''}>
                <span class="material-symbols-outlined">${item.icon}</span>
                <span>${item.title}</span>
            </a>
            `;
        }).join('');
    }

    // 侧边栏打开设置
    const setBtn = document.getElementById('sidebar-settings-btn');
    if(setBtn) setBtn.addEventListener('click', () => {
        document.getElementById('nav-drawer').classList.remove('open');
        document.getElementById('drawer-scrim').style.display = 'none';
        document.getElementById('settings-dialog').showModal();
    });
}

// === D. 新闻头条 (七天逻辑 & 滑动 & 柔和动画) ===
function renderHeadlines() {
    if (allNews.length === 0) return;

    // 1. 筛选最近7天的数据
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // 简单的日期比较 (假设格式 YYYY-MM-DD)
    let freshNews = allNews.filter(n => {
        const parts = n.date.split(/[- :]/); // 分割 2024-12-14 10:00
        // 简单构造Date对象，注意月份-1
        const nDate = new Date(parts[0], parts[1]-1, parts[2]);
        return nDate >= oneWeekAgo;
    });

    // 如果最近7天没新闻，取最新的3条兜底，防止空白
    if (freshNews.length === 0) {
        freshNews = allNews.slice(0, 3);
    }

    const container = document.getElementById('headlines-container');
    
    // 生成DOM
    container.innerHTML = freshNews.map((item, idx) => `
        <div class="headline-item ${idx === 0 ? 'active' : ''}" 
             style="background-image: url('${item.image || 'assets/default_bg.jpg'}');"
             data-id="${item.id}" onclick="location.href='news_detail.html?id=${item.id}'">
            <div class="headline-overlay">
                <span style="background:var(--md-sys-color-primary); width:fit-content; padding:4px 8px; border-radius:6px; font-size:0.75rem;">${item.location}</span>
                <div style="font-size:1.5rem; font-weight:bold; line-height:1.3; margin-top:4px;">${item.title}</div>
                <div style="font-size:0.95rem; opacity:0.9; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${item.content}</div>
                <div style="font-size:0.8rem; margin-top:8px; opacity:0.8;">${item.date} · ${item.author}</div>
            </div>
        </div>
    `).join('') + 
    // 指示器
    `<div class="carousel-indicators" style="position:absolute; bottom:16px; right:24px; display:flex; gap:8px; z-index:2;">
        ${freshNews.map((_, i) => `<div class="indicator-dot ${i===0?'active':''}" id="dot-${i}" style="width:8px; height:8px; background:rgba(255,255,255,0.5); border-radius:50%; transition:all 0.3s;"></div>`).join('')}
    </div>`;

    carouselItems = document.querySelectorAll('.headline-item');
    startCarousel();
    initTouchSwipe(container);
}

function startCarousel() {
    if(carouselItems.length < 2) return;
    if(carouselInterval) clearInterval(carouselInterval);
    carouselInterval = setInterval(() => nextHeadline(), 5000);
}

function nextHeadline() {
    switchHeadline((currentHeadlineIdx + 1) % carouselItems.length);
}
function prevHeadline() {
    switchHeadline((currentHeadlineIdx - 1 + carouselItems.length) % carouselItems.length);
}

function switchHeadline(nextIdx) {
    if(!carouselItems.length) return;
    
    // 移除当前类
    carouselItems[currentHeadlineIdx].classList.remove('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).style.background = 'rgba(255,255,255,0.5)';
    document.getElementById(`dot-${currentHeadlineIdx}`).style.width = '8px';

    // 激活下一类
    currentHeadlineIdx = nextIdx;
    carouselItems[currentHeadlineIdx].classList.add('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).style.background = '#fff';
    document.getElementById(`dot-${currentHeadlineIdx}`).style.width = '24px';
    document.getElementById(`dot-${currentHeadlineIdx}`).style.borderRadius = '4px';
}

// 触摸滑动逻辑
function initTouchSwipe(element) {
    let startX = 0;
    let endX = 0;

    element.addEventListener('touchstart', e => {
        startX = e.changedTouches[0].screenX;
        clearInterval(carouselInterval); // 触摸时暂停自动播放
    }, {passive: true});

    element.addEventListener('touchend', e => {
        endX = e.changedTouches[0].screenX;
        handleGesture();
        startCarousel(); // 恢复自动播放
    }, {passive: true});

    function handleGesture() {
        if (endX < startX - 50) nextHeadline(); // 左滑 -> 下一张
        if (endX > startX + 50) prevHeadline(); // 右滑 -> 上一张
    }
}

// === E. 列表渲染 (纯文稿逻辑) ===
function renderNewsList() {
    const container = document.getElementById('news-list');
    
    // 过滤逻辑
    let filtered = locationFilter === 'all' ? allNews : allNews.filter(n => n.location === locationFilter);
    const showCount = container.getAttribute('data-expanded') === 'true' ? filtered.length : 6;
    
    container.innerHTML = filtered.slice(0, showCount).map(news => createNewsCard(news)).join('');
    
    // 按钮逻辑
    const btn = document.getElementById('load-more-news');
    btn.style.display = filtered.length > 6 ? 'block' : 'none';
}

// 通用卡片生成器
function createNewsCard(news) {
    const hasImg = news.image && news.image.trim() !== "";
    const textOnlyClass = hasImg ? '' : 'text-only';
    
    return `
    <div class="news-card ${textOnlyClass}" onclick="location.href='news_detail.html?id=${news.id}'">
        ${hasImg ? `<img src="${news.image}" class="news-img" loading="lazy">` : ''}
        <div class="news-content">
            <div class="news-tag">${news.location}</div>
            <h4 class="news-title">${news.title}</h4>
            <div class="news-meta">${news.date} · ${news.author}</div>
        </div>
    </div>
    `;
}

// === F. 历史归档 (MD3 设计) ===
function initArchive() {
    const dialog = document.getElementById('history-dialog');
    const container = document.getElementById('archive-results');
    
    // 渲染年份选择和月份条
    document.getElementById('archive-toolbar').innerHTML = `
        <div class="year-selector">
            <button class="icon-btn" onclick="changeArchiveYear(-1)"><span class="material-symbols-outlined">chevron_left</span></button>
            <span id="archive-year-display">${currentArchiveYear}年</span>
            <button class="icon-btn" onclick="changeArchiveYear(1)"><span class="material-symbols-outlined">chevron_right</span></button>
        </div>
        <div class="month-scroller" id="month-scroller">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => 
                `<div class="month-chip ${m===currentArchiveMonth?'active':''}" onclick="selectArchiveMonth(${m})">${m}月</div>`
            ).join('')}
        </div>
    `;

    renderArchiveList();
}

window.changeArchiveYear = (delta) => {
    currentArchiveYear += delta;
    document.getElementById('archive-year-display').innerText = `${currentArchiveYear}年`;
    renderArchiveList();
};

window.selectArchiveMonth = (m) => {
    currentArchiveMonth = m;
    // 更新UI高亮
    document.querySelectorAll('.month-chip').forEach((el, idx) => {
        if((idx+1) === m) el.classList.add('active');
        else el.classList.remove('active');
    });
    renderArchiveList();
};

function renderArchiveList() {
    const container = document.getElementById('archive-results');
    // 筛选 年-月 (匹配 date 字符串 "2024-12-14")
    const target = `${currentArchiveYear}-${String(currentArchiveMonth).padStart(2, '0')}`;
    
    const filtered = allNews.filter(n => n.date.startsWith(target));
    
    if(filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:40px; color:#999;">该月份暂无归档新闻</div>`;
    } else {
        container.innerHTML = filtered.map(n => createNewsCard(n)).join('');
    }
}

// === G. 混合搜索 (功能+新闻) ===
function handleSearch(term) {
    const resBox = document.getElementById('search-results');
    if(!term) { resBox.innerHTML = ''; return; }
    
    term = term.toLowerCase();

    // 1. 搜功能 (Quick Actions & Sidebar)
    const matchedActions = [
        ...(window.QUICK_ACTIONS || []),
        ...(window.SIDEBAR_ITEMS || [])
    ].filter(i => i.title.toLowerCase().includes(term));

    // 2. 搜新闻
    const matchedNews = allNews.filter(n => 
        n.title.toLowerCase().includes(term) || 
        n.content.toLowerCase().includes(term)
    );

    let html = '';

    // 渲染功能入口 Chips
    if(matchedActions.length > 0) {
        html += `<div style="margin-bottom:16px;">
            <div style="font-size:0.8rem; color:var(--md-sys-color-outline); margin-bottom:8px;">快捷入口</div>
            <div>
                ${matchedActions.map(a => `
                    <a href="${a.link}" class="search-action-chip">
                        <span class="material-symbols-outlined" style="font-size:18px;">${a.icon}</span>
                        ${a.title}
                    </a>
                `).join('')}
            </div>
        </div>`;
    }

    // 渲染新闻列表
    if(matchedNews.length > 0) {
         html += `<div style="font-size:0.8rem; color:var(--md-sys-color-outline); margin-bottom:8px;">相关新闻</div>`;
         html += matchedNews.map(n => createNewsCard(n)).join('');
    } else if (matchedActions.length === 0) {
         html = `<div style="text-align:center; padding:20px; color:#999;">无相关结果</div>`;
    }

    resBox.innerHTML = html;
}

// === H. 事件绑定汇总 ===
function bindGlobalEvents() {
    // 侧边栏
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('drawer-scrim');
    document.getElementById('menu-btn').addEventListener('click', () => { drawer.classList.add('open'); scrim.style.display='block'; });
    const closeD = () => { drawer.classList.remove('open'); setTimeout(()=>scrim.style.display='none', 300); };
    document.getElementById('close-drawer').addEventListener('click', closeD);
    scrim.addEventListener('click', closeD);

    // 弹窗通用
    const bindDialog = (triggerId, dialogId, onOpen) => {
        const btn = document.getElementById(triggerId);
        const dlg = document.getElementById(dialogId);
        const closeBtn = dlg.querySelector('.icon-btn'); // 假设第一个是关闭
        if(btn) btn.addEventListener('click', () => {
            dlg.showModal();
            if(onOpen) onOpen();
        });
        if(closeBtn) closeBtn.addEventListener('click', () => dlg.close());
    };

    bindDialog('search-trigger', 'search-dialog');
    bindDialog('settings-trigger', 'settings-dialog');
    bindDialog('history-news-btn', 'history-dialog', initArchive); // 打开归档时初始化UI

    // 搜索输入
    document.getElementById('search-input').addEventListener('input', (e) => handleSearch(e.target.value));
    
    // 关闭系统通知
    document.getElementById('close-banner').addEventListener('click', () => {
        document.getElementById('system-banner').style.display = 'none';
    });

    // 展开更多
    document.getElementById('load-more-news').addEventListener('click', function() {
        const c = document.getElementById('news-list');
        c.setAttribute('data-expanded', c.getAttribute('data-expanded') !== 'true');
        renderNewsList();
        this.innerText = c.getAttribute('data-expanded') === 'true' ? "收起" : "展开更多";
    });
}
