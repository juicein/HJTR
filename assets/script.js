// === 全局状态 ===
let allNews = [];
let locationFilter = localStorage.getItem('pref_loc') || 'all';
let showNotifications = localStorage.getItem('pref_notify') === 'true';
let showDownloadCard = localStorage.getItem('pref_dl_card') !== 'false';

// 快捷服务状态 (新增)
let isQuickMenuExpanded = false;

// 归档状态
let currentArchiveYear = new Date().getFullYear();
let currentArchiveMonth = new Date().getMonth() + 1;

// 头条轮播状态
let carouselInterval = null;
let currentHeadlineIdx = 0;
let carouselItems = [];

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    await loadNewsData();
    
    initSettings();
    renderQuickActions(); // 独立渲染快捷菜单
    renderSidebar();      // 独立渲染侧边栏
    renderHeadlines();
    renderNewsList();
    bindGlobalEvents();
}

// === A. 数据加载 & 标准化 ===
async function loadNewsData() {
    try {
        const res = await fetch('news_content.json');
        if (!res.ok) throw new Error("Load failed");
        const data = await res.json();
        
        allNews = data.map((item, index) => ({ 
            ...item, 
            id: index + 1,
            image: item.image || '',
            // 核心修复：标准化日期格式为 YYYY-MM-DD
            date: normalizeDate(item.date) 
        }));
    } catch (err) {
        console.error(err);
        document.getElementById('news-list').innerHTML = `<div style="text-align:center; padding:32px; color:var(--md-sys-color-error, red);">无法加载数据，请检查本地服务器配置。<br><small>${err.message}</small></div>`;
    }
}

// 辅助函数：将 2024.12.5 或 2024/1/1 转为 2024-01-01
function normalizeDate(dateStr) {
    if(!dateStr) return "";
    // 替换所有非数字字符为 -
    let normal = dateStr.replace(/[\/\.年\s]/g, '-').replace(/[月日]/g, '');
    const parts = normal.split('-');
    if(parts.length === 3) {
        // 补0
        const y = parts[0];
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return dateStr;
}

// === B. 快捷服务 (Quick Actions) - 核心修改 ===
function renderQuickActions() {
    const container = document.getElementById('menu-grid');
    const btn = document.getElementById('quick-expand-btn');
    
    if(!window.QUICK_ACTIONS) return;

    // 逻辑：如果展开，显示所有；否则只显示前4个
    const itemsToShow = isQuickMenuExpanded ? window.QUICK_ACTIONS : window.QUICK_ACTIONS.slice(0, 4);
    
    container.innerHTML = itemsToShow.map(item => `
        <a href="${item.link}" class="menu-item">
            <div class="menu-icon-box"><span class="material-symbols-outlined">${item.icon}</span></div>
            <p>${item.title}</p>
        </a>
    `).join('');

    // 按钮文案更新
    btn.innerText = isQuickMenuExpanded ? "收起" : "查看全部服务";
    btn.onclick = () => {
        isQuickMenuExpanded = !isQuickMenuExpanded;
        renderQuickActions(); // 重新渲染
    };
}

// === C. 侧边栏 (Sidebar) - 核心修改 ===
function renderSidebar() {
    const list = document.getElementById('drawer-menu-list');
    if(window.SIDEBAR_ITEMS) {
        list.innerHTML = window.SIDEBAR_ITEMS.map(item => {
            const isSettings = item.title === '设置';
            return `
            <a href="${item.link}" class="drawer-item" ${isSettings ? 'id="sidebar-settings-btn" onclick="return false;"' : ''}>
                <span class="material-symbols-outlined">${item.icon}</span>
                <span>${item.title}</span>
            </a>
            `;
        }).join('');
    }
    
    // 重新绑定侧边栏内的设置按钮
    const setBtn = document.getElementById('sidebar-settings-btn');
    if(setBtn) setBtn.addEventListener('click', () => {
        closeDrawer();
        setTimeout(() => document.getElementById('settings-dialog').showModal(), 200);
    });
}

// 侧边栏开关逻辑
function openDrawer() {
    document.getElementById('drawer-scrim').classList.add('visible');
    document.getElementById('nav-drawer').classList.add('open');
}
function closeDrawer() {
    document.getElementById('drawer-scrim').classList.remove('visible');
    document.getElementById('nav-drawer').classList.remove('open');
}

// === D. 新闻头条 (柔和动画) ===
function renderHeadlines() {
    if (allNews.length === 0) return;

    // 筛选逻辑保持不变...
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let freshNews = allNews.filter(n => new Date(n.date) >= oneWeekAgo);
    if (freshNews.length === 0) freshNews = allNews.slice(0, 3); // 兜底

    const container = document.getElementById('headlines-container');
    container.innerHTML = freshNews.map((item, idx) => `
        <div class="headline-item ${idx === 0 ? 'active' : ''}" 
             style="background-image: url('${item.image || 'assets/default_bg.jpg'}');"
             onclick="location.href='news_detail.html?id=${item.id}'">
            <div class="headline-overlay">
                <div class="headline-tag">${item.location}</div>
                <div class="headline-title">${item.title}</div>
            </div>
        </div>
    `).join('') + 
    `<div class="carousel-indicators">
        ${freshNews.map((_, i) => `<div class="indicator-dot ${i===0?'active':''}" id="dot-${i}"></div>`).join('')}
    </div>`;

    carouselItems = document.querySelectorAll('.headline-item');
    startCarousel();
    initTouchSwipe(container);
}

function startCarousel() {
    if(carouselItems.length < 2) return;
    stopCarousel(); // 防止重复
    carouselInterval = setInterval(nextHeadline, 5000); // 5秒切换
}
function stopCarousel() {
    if(carouselInterval) clearInterval(carouselInterval);
}

function nextHeadline() {
    switchHeadline((currentHeadlineIdx + 1) % carouselItems.length);
}
function prevHeadline() {
    switchHeadline((currentHeadlineIdx - 1 + carouselItems.length) % carouselItems.length);
}

function switchHeadline(nextIdx) {
    if(!carouselItems.length) return;
    
    // CSS transition 处理了淡入淡出，这里只负责切换 class
    carouselItems[currentHeadlineIdx].classList.remove('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).classList.remove('active');

    currentHeadlineIdx = nextIdx;
    
    carouselItems[currentHeadlineIdx].classList.add('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).classList.add('active');
}

function initTouchSwipe(element) {
    let startX = 0;
    element.addEventListener('touchstart', e => {
        startX = e.changedTouches[0].screenX;
        stopCarousel(); // 触摸暂停
    }, {passive: true});

    element.addEventListener('touchend', e => {
        const endX = e.changedTouches[0].screenX;
        if (endX < startX - 50) nextHeadline();
        if (endX > startX + 50) prevHeadline();
        startCarousel(); // 触摸结束恢复
    }, {passive: true});
}

// === E. 列表渲染 & 设置 ===
function renderNewsList() {
    const container = document.getElementById('news-list');
    let filtered = locationFilter === 'all' ? allNews : allNews.filter(n => n.location === locationFilter);
    
    // 展开更多逻辑
    const isExpanded = container.getAttribute('data-expanded') === 'true';
    const showCount = isExpanded ? filtered.length : 6;
    
    container.innerHTML = filtered.slice(0, showCount).map(news => createNewsCard(news)).join('');
    
    const btn = document.getElementById('load-more-news');
    // 如果总数小于等于6，彻底隐藏按钮；否则根据状态显示
    if (filtered.length <= 6) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'block';
        btn.innerText = isExpanded ? "收起" : "展开更多";
    }
}

function createNewsCard(news) {
    const hasImg = news.image && news.image.trim() !== "";
    return `
    <div class="news-card ${hasImg ? '' : 'text-only'}" onclick="location.href='news_detail.html?id=${news.id}'">
        ${hasImg ? `<img src="${news.image}" class="news-img" loading="lazy">` : ''}
        <div class="news-content">
            <div class="news-tag">${news.location}</div>
            <h4 class="news-title">${news.title}</h4>
            <div class="news-meta">
                <span class="material-symbols-outlined" style="font-size:14px;">schedule</span>
                ${news.date} · ${news.author}
            </div>
        </div>
    </div>
    `;
}

// === F. 历史归档 (核心修复) ===
function initArchive() {
    renderArchiveToolbar();
    renderArchiveList();
}

function renderArchiveToolbar() {
    const tb = document.getElementById('archive-toolbar');
    tb.innerHTML = `
        <div class="year-selector">
            <button class="icon-btn" onclick="changeArchiveYear(-1)"><span class="material-symbols-outlined">chevron_left</span></button>
            <span>${currentArchiveYear}年</span>
            <button class="icon-btn" onclick="changeArchiveYear(1)"><span class="material-symbols-outlined">chevron_right</span></button>
        </div>
        <div class="month-scroller">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => 
                `<div class="month-chip ${m===currentArchiveMonth?'active':''}" onclick="selectArchiveMonth(${m})">${m}月</div>`
            ).join('')}
        </div>
    `;
}

// 暴露给全局以便 HTML onclick 调用
window.changeArchiveYear = (delta) => {
    currentArchiveYear += delta;
    initArchive(); // 重新渲染Toolbar(更新年份)和列表
};

window.selectArchiveMonth = (m) => {
    currentArchiveMonth = m;
    initArchive(); // 重新渲染Toolbar(更新高亮)和列表
};

function renderArchiveList() {
    const container = document.getElementById('archive-results');
    // 关键修复：构造 "2024-05" 这样的字符串
    const target = `${currentArchiveYear}-${String(currentArchiveMonth).padStart(2, '0')}`;
    
    const filtered = allNews.filter(n => n.date && n.date.startsWith(target));
    
    if(filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:48px 20px; color:var(--md-sys-color-outline);">
                <span class="material-symbols-outlined" style="font-size:48px; opacity:0.5; margin-bottom:12px;">event_busy</span>
                <p>本月暂无新闻归档</p>
            </div>`;
    } else {
        container.innerHTML = filtered.map(n => createNewsCard(n)).join('');
    }
}

// === G. 设置与初始化 ===
function initSettings() {
    // 填充地区
    const locSelect = document.getElementById('location-select');
    const locs = [...new Set(allNews.map(n => n.location))];
    locSelect.innerHTML = `<option value="all">全部地区</option>` + locs.map(l => `<option value="${l}">${l}</option>`).join('');
    
    locSelect.value = locationFilter;
    locSelect.addEventListener('change', (e) => {
        locationFilter = e.target.value;
        localStorage.setItem('pref_loc', locationFilter);
        renderNewsList();
        checkSystemNotification();
    });

    // 通知开关
    const nSwitch = document.getElementById('notification-switch');
    nSwitch.checked = showNotifications;
    nSwitch.addEventListener('change', e => {
        showNotifications = e.target.checked;
        localStorage.setItem('pref_notify', showNotifications);
        checkSystemNotification();
    });

    // 下载卡片开关
    const dSwitch = document.getElementById('dl-card-switch');
    dSwitch.checked = showDownloadCard;
    toggleDownloadCard(showDownloadCard);
    dSwitch.addEventListener('change', e => {
        showDownloadCard = e.target.checked;
        localStorage.setItem('pref_dl_card', showDownloadCard);
        toggleDownloadCard(showDownloadCard);
    });

    checkSystemNotification();
}

function checkSystemNotification() {
    const banner = document.getElementById('system-banner');
    const msg = document.getElementById('system-msg');
    if(showNotifications && locationFilter !== 'all') {
        msg.innerText = `🔔 正在为您展示 ${locationFilter} 地区的资讯`;
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

function toggleDownloadCard(show) {
    const val = show ? 'flex' : 'none';
    document.querySelectorAll('.app-download-card').forEach(el => el.style.display = val);
}

// === H. 事件绑定 ===
function bindGlobalEvents() {
    // 侧边栏
    document.getElementById('menu-btn').addEventListener('click', openDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    document.getElementById('drawer-scrim').addEventListener('click', closeDrawer);

    // 弹窗通用绑定
    const bindDlg = (btnId, dlgId, onShow) => {
        const btn = document.getElementById(btnId);
        const dlg = document.getElementById(dlgId);
        if(btn && dlg) {
            btn.addEventListener('click', () => {
                dlg.showModal();
                if(onShow) onShow();
            });
            dlg.querySelectorAll('.close-dialog-btn').forEach(b => b.addEventListener('click', () => dlg.close()));
        }
    };

    bindDlg('search-trigger', 'search-dialog');
    bindDlg('settings-trigger', 'settings-dialog');
    bindDlg('history-news-btn', 'history-dialog', initArchive);

    // 搜索
    document.getElementById('search-input').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const res = document.getElementById('search-results');
        if(!term) { res.innerHTML = ''; return; }
        
        const hits = allNews.filter(n => n.title.toLowerCase().includes(term));
        res.innerHTML = hits.length ? hits.map(createNewsCard).join('') : '<p style="text-align:center;color:#999;padding:20px">无搜索结果</p>';
    });

    // 关闭通知栏
    document.getElementById('close-banner').addEventListener('click', () => {
        document.getElementById('system-banner').style.display = 'none';
    });

    // 展开更多新闻
    document.getElementById('load-more-news').addEventListener('click', function() {
        const c = document.getElementById('news-list');
        const isExpanded = c.getAttribute('data-expanded') === 'true';
        c.setAttribute('data-expanded', !isExpanded);
        renderNewsList(); // 重新渲染
    });
}
