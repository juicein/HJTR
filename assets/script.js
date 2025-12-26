// 全局状态
let allNews = [];
let locationFilter = localStorage.getItem('pref_loc') || 'all';
let showNotifications = localStorage.getItem('pref_notify') === 'true'; 
let showDownloadCard = localStorage.getItem('pref_dl_card') !== 'false';

// 归档状态
let currentArchiveYear = new Date().getFullYear();
let currentArchiveMonth = new Date().getMonth() + 1;

// 轮播状态
let carouselInterval = null;
let currentHeadlineIdx = 0;
let carouselItems = [];

// 快捷菜单状态
let isQuickMenuExpanded = false;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    await loadNewsData();
    initSettings();
    renderMenus(); 
    renderHeadlines();
    renderNewsList();
    bindGlobalEvents();
}

// === A. 数据加载 ===
async function loadNewsData() {
    try {
        const res = await fetch('news_content.json');
        if (!res.ok) throw new Error("Load failed");
        const data = await res.json();
        
        const currentYear = new Date().getFullYear();
        allNews = data.map((item, index) => {
            let dateObj = null;
            if (item.date && item.date.includes('-')) {
                const [datePart] = item.date.split(' ');
                const [m, d] = datePart.split('-');
                dateObj = new Date(currentYear, parseInt(m)-1, parseInt(d));
                if (dateObj > new Date()) dateObj.setFullYear(currentYear - 1);
            }
            return { 
                ...item, 
                id: index + 1,
                image: item.image || '',
                parsedDate: dateObj 
            };
        });
    } catch (err) {
        console.error(err);
        document.getElementById('news-list').innerHTML = `<p style="padding:20px; text-align:center; color:var(--md-sys-color-outline);">无法读取数据，请确保使用 Local Server 运行。</p>`;
    }
}

// === B. 菜单渲染 ===
function renderMenus() {
    const quickGrid = document.getElementById('menu-grid');
    if(window.QUICK_ACTIONS) {
        quickGrid.innerHTML = window.QUICK_ACTIONS.map(item => `
            <a href="${item.link}" class="menu-item">
                <div class="menu-icon-box"><span class="material-symbols-outlined">${item.icon}</span></div>
                <p>${item.title}</p>
            </a>
        `).join('');
    }

    const sidebarList = document.getElementById('drawer-menu-list');
    if(window.SIDEBAR_ITEMS) {
        sidebarList.innerHTML = window.SIDEBAR_ITEMS.map(item => {
            const isSettings = item.title === '设置';
            return `
            <a href="${item.link}" class="drawer-item" ${isSettings ? 'id="drawer-settings-btn" onclick="return false;"' : ''}>
                <span class="material-symbols-outlined">${item.icon}</span>
                <span>${item.title}</span>
            </a>`;
        }).join('');
    }

    // 设置按钮点击
    const setBtn = document.getElementById('drawer-settings-btn');
    if(setBtn) setBtn.addEventListener('click', () => {
        closeDrawer();
        document.getElementById('settings-dialog').showModal();
    });

    // 快捷菜单展开/收起
    document.getElementById('toggle-quick-menu').addEventListener('click', toggleQuickMenu);
}

function toggleQuickMenu() {
    const grid = document.getElementById('menu-grid');
    const btn = document.getElementById('toggle-quick-menu');
    isQuickMenuExpanded = !isQuickMenuExpanded;
    if (isQuickMenuExpanded) {
        grid.classList.add('expanded');
        btn.innerText = "收起";
    } else {
        grid.classList.remove('expanded');
        btn.innerText = "全部";
    }
}

// === C. 头条 (修复：滑动、内容、作者) ===
function renderHeadlines() {
    if (allNews.length === 0) return;
    let headlines = allNews.filter(n => n.image && n.image !== "").slice(0, 4);
    if (headlines.length === 0) headlines = allNews.slice(0, 4);

    const container = document.getElementById('headlines-container');
    
    container.innerHTML = headlines.map((item, idx) => `
        <div class="headline-item ${idx === 0 ? 'active' : ''}" 
             style="background-image: url('${item.image || 'assets/default_bg.jpg'}');"
             onclick="location.href='news_detail.html?id=${item.id}'">
            <div class="headline-overlay">
                <span style="background:var(--md-sys-color-primary); width:fit-content; padding:2px 8px; border-radius:6px; font-size:0.75rem;">${item.location}</span>
                <div class="headline-title">${item.title}</div>
                <div class="headline-desc">${item.content}</div>
                <div class="headline-meta">${item.date} · ${item.author}</div>
            </div>
        </div>
    `).join('') + 
    `<div style="position:absolute; bottom:16px; right:20px; display:flex; gap:6px; z-index:2;">
        ${headlines.map((_, i) => `<div class="indicator-dot" id="dot-${i}" style="width:6px; height:6px; background:rgba(255,255,255,0.4); border-radius:50%; transition:all 0.3s;"></div>`).join('')}
    </div>`;

    carouselItems = document.querySelectorAll('.headline-item');
    updateIndicators(0);

    if (headlines.length > 1) {
        startCarousel();
        initTouchSwipe(container); // 添加触摸监听
    }
}

function startCarousel() {
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
    carouselItems[currentHeadlineIdx].classList.remove('active');
    carouselItems[nextIdx].classList.add('active');
    updateIndicators(nextIdx);
    currentHeadlineIdx = nextIdx;
}

function updateIndicators(idx) {
    document.querySelectorAll('.indicator-dot').forEach((dot, i) => {
        if(i === idx) {
            dot.style.background = '#fff';
            dot.style.width = '16px'; dot.style.borderRadius = '4px';
        } else {
            dot.style.background = 'rgba(255,255,255,0.4)';
            dot.style.width = '6px';
        }
    });
}

// 触摸滑动逻辑
function initTouchSwipe(element) {
    let startX = 0;
    element.addEventListener('touchstart', e => {
        startX = e.changedTouches[0].screenX;
        clearInterval(carouselInterval);
    }, {passive: true});

    element.addEventListener('touchend', e => {
        const endX = e.changedTouches[0].screenX;
        if (endX < startX - 50) nextHeadline();
        if (endX > startX + 50) prevHeadline();
        startCarousel();
    }, {passive: true});
}

// === D. 搜索功能 (修复) ===
function handleSearch(term) {
    const resBox = document.getElementById('search-results');
    if(!term) { resBox.innerHTML = ''; return; }
    term = term.toLowerCase();

    // 搜功能
    const matchedActions = [
        ...(window.QUICK_ACTIONS || []),
        ...(window.SIDEBAR_ITEMS || [])
    ].filter(i => i.title.toLowerCase().includes(term));

    // 搜新闻
    const matchedNews = allNews.filter(n => 
        n.title.toLowerCase().includes(term) || 
        n.content.toLowerCase().includes(term)
    );

    let html = '';
    if(matchedActions.length > 0) {
        html += `<div style="margin-bottom:16px;">
            <div style="font-size:0.8rem; color:var(--md-sys-color-outline); margin-bottom:8px;">快捷入口</div>
            <div>${matchedActions.map(a => `
                <a href="${a.link}" class="search-action-chip">
                    <span class="material-symbols-outlined" style="font-size:18px;">${a.icon}</span>${a.title}
                </a>`).join('')}
            </div>
        </div>`;
    }
    if(matchedNews.length > 0) {
         html += `<div style="font-size:0.8rem; color:var(--md-sys-color-outline); margin-bottom:8px;">相关新闻</div>`;
         html += matchedNews.map(n => createNewsCard(n)).join('');
    } else if (matchedActions.length === 0) {
         html += `<div style="text-align:center; padding:20px; color:var(--md-sys-color-outline);">无相关结果</div>`;
    }
    resBox.innerHTML = html;
}

// === E. 列表与归档 ===
function renderNewsList() {
    const container = document.getElementById('news-list');
    let filtered = locationFilter === 'all' ? allNews : allNews.filter(n => n.location === locationFilter);
    
    const isExpanded = container.getAttribute('data-expanded') === 'true';
    const showCount = isExpanded ? filtered.length : 6;
    
    container.innerHTML = filtered.slice(0, showCount).map(news => createNewsCard(news)).join('');
    
    const btn = document.getElementById('load-more-news');
    btn.style.display = filtered.length > 6 ? 'block' : 'none';
    btn.innerText = isExpanded ? "收起" : "展开更多";
}

function createNewsCard(news) {
    const hasImg = news.image && news.image.trim() !== "";
    return `
    <div class="news-card ${hasImg ? '' : 'text-only'}" onclick="location.href='news_detail.html?id=${news.id}'">
        ${hasImg ? `<img src="${news.image}" class="news-img" loading="lazy">` : ''}
        <div class="news-content">
            <div class="news-tag">${news.location}</div>
            <h4 class="news-title">${news.title}</h4>
            <div class="news-meta">${news.date} · ${news.author}</div>
        </div>
    </div>`;
}

// 归档渲染 (MD3 风格)
function initArchive() {
    document.getElementById('archive-toolbar').innerHTML = `
        <div class="year-selector">
            <button class="icon-btn" onclick="changeArchiveYear(-1)"><span class="material-symbols-outlined">chevron_left</span></button>
            <span id="archive-year-display">${currentArchiveYear}年</span>
            <button class="icon-btn" onclick="changeArchiveYear(1)"><span class="material-symbols-outlined">chevron_right</span></button>
        </div>
        <div class="month-scroller">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => 
                `<div class="month-chip ${m===currentArchiveMonth?'active':''}" onclick="selectArchiveMonth(${m})">${m}</div>`
            ).join('')}
        </div>
    `;
    renderArchiveList();
}

window.changeArchiveYear = (d) => { currentArchiveYear += d; document.getElementById('archive-year-display').innerText = `${currentArchiveYear}年`; renderArchiveList(); };
window.selectArchiveMonth = (m) => { currentArchiveMonth = m; initArchive(); };

function renderArchiveList() {
    const container = document.getElementById('archive-results');
    const filtered = allNews.filter(n => n.parsedDate && n.parsedDate.getFullYear() === currentArchiveYear && (n.parsedDate.getMonth() + 1) === currentArchiveMonth);
    container.innerHTML = filtered.length ? filtered.map(n => createNewsCard(n)).join('') : 
        `<div style="text-align:center; padding:40px; color:var(--md-sys-color-outline);">本月暂无归档</div>`;
}

// === F. 设置与事件绑定 ===
function initSettings() {
    const locSelect = document.getElementById('location-select');
    const locs = [...new Set(allNews.map(n => n.location))];
    locs.forEach(l => {
        const opt = document.createElement('option'); opt.value = l; opt.innerText = l; locSelect.appendChild(opt);
    });
    
    locSelect.value = locationFilter;
    locSelect.addEventListener('change', (e) => {
        locationFilter = e.target.value;
        localStorage.setItem('pref_loc', locationFilter);
        renderNewsList();
    });

    // 简单的开关状态保存，不涉及通知条显示
    const nSwitch = document.getElementById('notification-switch');
    if(nSwitch) {
        nSwitch.checked = showNotifications;
        nSwitch.addEventListener('change', e => localStorage.setItem('pref_notify', e.target.checked));
    }
    
    const dSwitch = document.getElementById('dl-card-switch');
    dSwitch.checked = showDownloadCard;
    updateDownloadCardVisibility();
    dSwitch.addEventListener('change', (e) => {
        showDownloadCard = e.target.checked;
        localStorage.setItem('pref_dl_card', showDownloadCard);
        updateDownloadCardVisibility();
    });
}

function updateDownloadCardVisibility() {
    document.querySelectorAll('.app-download-card').forEach(el => el.style.display = showDownloadCard ? 'flex' : 'none');
}

function openDrawer() { document.getElementById('nav-drawer').classList.add('open'); }
function closeDrawer() { document.getElementById('nav-drawer').classList.remove('open'); }

function bindGlobalEvents() {
    document.getElementById('menu-btn').addEventListener('click', openDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    document.getElementById('drawer-scrim').addEventListener('click', closeDrawer);

    // 绑定弹窗
    const bindDlg = (btnId, dlgId, cb) => {
        const btn = document.getElementById(btnId);
        if(btn) btn.addEventListener('click', () => {
            document.getElementById(dlgId).showModal();
            if(cb) cb();
        });
    };
    bindDlg('search-trigger', 'search-dialog');
    bindDlg('settings-trigger', 'settings-dialog');
    bindDlg('history-news-btn', 'history-dialog', initArchive);

    document.querySelectorAll('.method-close').forEach(btn => {
        btn.addEventListener('click', function() { this.closest('dialog').close(); });
    });

    // 搜索输入绑定
    document.getElementById('search-input').addEventListener('input', (e) => handleSearch(e.target.value));

    document.getElementById('load-more-news').addEventListener('click', function() {
        const c = document.getElementById('news-list');
        c.setAttribute('data-expanded', c.getAttribute('data-expanded') !== 'true');
        renderNewsList();
    });
}
