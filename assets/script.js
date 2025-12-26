// 全局状态
let allNews = [];
let locationFilter = localStorage.getItem('pref_loc') || 'all';
let showNotifications = localStorage.getItem('pref_notify') === 'true';
let showDownloadCard = localStorage.getItem('pref_dl_card') !== 'false';

// 归档状态
let currentArchiveYear = new Date().getFullYear();
let currentArchiveMonth = new Date().getMonth() + 1;

// 头条轮播
let carouselInterval = null;
let currentHeadlineIdx = 0;
let carouselItems = [];

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

// === 数据加载 ===
async function loadNewsData() {
    try {
        const res = await fetch('news_content.json');
        if (!res.ok) throw new Error("Load failed");
        const data = await res.json();
        allNews = data.map((item, index) => ({ ...item, id: index + 1 }));
    } catch (err) {
        console.error(err);
        document.getElementById('news-list').innerHTML = `<p style="padding:20px; text-align:center;">无法读取数据 (请检查JSON文件)</p>`;
    }
}

// === 1. 菜单渲染 ===
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

    const toggleBtn = document.getElementById('toggle-menu-btn');
    toggleBtn.addEventListener('click', () => {
        const isExpanded = quickGrid.classList.contains('expanded');
        quickGrid.classList.toggle('expanded');
        toggleBtn.innerText = isExpanded ? "全部" : "收起";
    });

    const sidebarList = document.getElementById('drawer-menu-list');
    if(window.SIDEBAR_ITEMS) {
        sidebarList.innerHTML = window.SIDEBAR_ITEMS.map(item => `
            <a href="${item.link}" class="drawer-item" ${item.title === '设置' ? 'id="sidebar-settings"' : ''}>
                <span class="material-symbols-outlined">${item.icon}</span>
                <span>${item.title}</span>
            </a>
        `).join('');
        
        document.getElementById('sidebar-settings')?.addEventListener('click', (e) => {
            e.preventDefault();
            closeDrawer();
            document.getElementById('settings-dialog').showModal();
        });
    }
}

// === 2. 新闻头条 (含触摸滑动 Swipe) ===
function renderHeadlines() {
    if (allNews.length === 0) return;
    const headlines = allNews.slice(0, 4);
    const container = document.getElementById('headlines-container');
    
    let slidesHtml = headlines.map((item, idx) => `
        <div class="headline-item ${idx === 0 ? 'active' : ''}" 
             style="background-image: url('${item.image || 'assets/default_bg.jpg'}');"
             onclick="location.href='news_detail.html?id=${item.id}'">
            <div class="headline-overlay">
                <span style="background:var(--md-sys-color-primary); width:fit-content; padding:2px 8px; border-radius:4px; font-size:0.75rem;">${item.location}</span>
                <div style="font-size:1.4rem; font-weight:bold; line-height:1.3;">${item.title}</div>
            </div>
        </div>
    `).join('');
    
    let dotsHtml = `<div class="indicators">
        ${headlines.map((_, i) => `<div class="dot ${i===0?'active':''}" id="dot-${i}"></div>`).join('')}
    </div>`;
    
    container.innerHTML = slidesHtml + dotsHtml;
    carouselItems = document.querySelectorAll('.headline-item');
    startCarousel();
    
    // --- 增加触摸滑动支持 ---
    let touchStartX = 0;
    let touchEndX = 0;
    
    container.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        clearInterval(carouselInterval); // 触摸时暂停
    }, {passive: true});
    
    container.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
        startCarousel(); // 恢复播放
    }, {passive: true});
    
    function handleSwipe() {
        if (touchEndX < touchStartX - 50) { // 左滑 -> 下一张
            switchHeadline((currentHeadlineIdx + 1) % carouselItems.length);
        }
        if (touchEndX > touchStartX + 50) { // 右滑 -> 上一张
            switchHeadline((currentHeadlineIdx - 1 + carouselItems.length) % carouselItems.length);
        }
    }
}

function startCarousel() {
    if(carouselItems.length < 2) return;
    if(carouselInterval) clearInterval(carouselInterval);
    carouselInterval = setInterval(() => {
        switchHeadline((currentHeadlineIdx + 1) % carouselItems.length);
    }, 5000);
}

function switchHeadline(nextIdx) {
    carouselItems[currentHeadlineIdx].classList.remove('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).classList.remove('active');
    
    currentHeadlineIdx = nextIdx;
    
    carouselItems[currentHeadlineIdx].classList.add('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).classList.add('active');
}

// === 3. 新闻列表 (支持三行内容、作者、时间) ===
function renderNewsList() {
    const container = document.getElementById('news-list');
    let filtered = locationFilter === 'all' ? allNews : allNews.filter(n => n.location === locationFilter);
    const isExpanded = container.getAttribute('data-expanded') === 'true';
    const showCount = isExpanded ? filtered.length : 6;
    
    container.innerHTML = filtered.slice(0, showCount).map(createNewsCard).join('');
    
    const btn = document.getElementById('load-more-news');
    if (filtered.length <= 6) btn.style.display = 'none';
    else {
        btn.style.display = 'block';
        btn.innerText = isExpanded ? "收起" : "展开更多";
    }
}

function createNewsCard(news) {
    const hasImg = news.image && news.image.trim() !== "";
    // 如果没有 content 字段，使用 title 代替演示
    const summary = news.content || news.title;
    
    return `
    <a href="news_detail.html?id=${news.id}" class="news-card ${hasImg ? '' : 'text-only'}">
        ${hasImg ? `<img src="${news.image}" class="news-img" loading="lazy">` : ''}
        <div class="news-content">
            <div class="news-tag">${news.location}</div>
            <h4 class="news-title">${news.title}</h4>
            <div class="news-desc">${summary}</div>
            <div class="news-meta">
                ${news.date} · ${news.author || '官方发布'}
            </div>
        </div>
    </a>`;
}

// === 4. 历史归档 ===
function initArchive() {
    const container = document.getElementById('archive-toolbar');
    container.innerHTML = `
        <div class="year-selector" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <button class="icon-btn" onclick="changeArchiveYear(-1)"><span class="material-symbols-outlined">chevron_left</span></button>
            <span id="archive-year" style="font-weight:bold; font-size:1.2rem;">${currentArchiveYear}年</span>
            <button class="icon-btn" onclick="changeArchiveYear(1)"><span class="material-symbols-outlined">chevron_right</span></button>
        </div>
        <div class="month-scroller" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:8px;">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => 
                `<button class="tonal-btn ${m===currentArchiveMonth?'active-month':''}" 
                         style="${m===currentArchiveMonth?'background:var(--md-sys-color-primary);color:white;':''}"
                         onclick="selectArchiveMonth(${m})">${m}月</button>`
            ).join('')}
        </div>
    `;
    renderArchiveList();
}

window.changeArchiveYear = (delta) => {
    currentArchiveYear += delta;
    document.getElementById('archive-year').innerText = `${currentArchiveYear}年`;
    renderArchiveList();
};

window.selectArchiveMonth = (m) => {
    currentArchiveMonth = m;
    initArchive(); 
};

function renderArchiveList() {
    const container = document.getElementById('archive-results');
    const targetMonthStr = String(currentArchiveMonth).padStart(2, '0');
    
    const filtered = allNews.filter(n => {
        let dateStr = n.date.split(' ')[0];
        // 简单逻辑：假设数据格式为 "MM-DD" 或 "YYYY-MM-DD"
        if (dateStr.length <= 5) {
             const thisYear = new Date().getFullYear();
             if (currentArchiveYear !== thisYear) return false;
             return dateStr.startsWith(targetMonthStr);
        } else {
             return dateStr.startsWith(`${currentArchiveYear}-${targetMonthStr}`);
        }
    });

    if(filtered.length === 0) container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--md-sys-color-outline)">该月份暂无归档</div>`;
    else container.innerHTML = filtered.map(createNewsCard).join('');
}

// === 5. 设置与事件 ===
function bindGlobalEvents() {
    // 侧边栏
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('drawer-scrim');
    window.openDrawer = () => { drawer.classList.add('open'); scrim.classList.add('visible'); };
    window.closeDrawer = () => { drawer.classList.remove('open'); scrim.classList.remove('visible'); };
    
    document.getElementById('menu-btn').addEventListener('click', openDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);

    // Dialogs 通用打开逻辑
    const openDialog = (id, initFunc) => {
        document.getElementById(id).showModal();
        if(initFunc) initFunc();
    };

    document.getElementById('search-trigger').addEventListener('click', () => openDialog('search-dialog'));
    document.getElementById('settings-trigger').addEventListener('click', () => openDialog('settings-dialog'));
    document.getElementById('history-news-btn').addEventListener('click', () => openDialog('history-dialog', initArchive));

    // Dialog 关闭逻辑
    document.getElementById('close-search').addEventListener('click', () => document.getElementById('search-dialog').close());
    document.getElementById('close-settings').addEventListener('click', () => document.getElementById('settings-dialog').close());
    document.getElementById('close-history').addEventListener('click', () => document.getElementById('history-dialog').close());

    // 搜索输入
    document.getElementById('search-input').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const resBox = document.getElementById('search-results');
        if(!term) { resBox.innerHTML = ''; return; }
        
        const matched = allNews.filter(n => n.title.toLowerCase().includes(term) || (n.content && n.content.toLowerCase().includes(term)));
        resBox.innerHTML = matched.length ? matched.map(createNewsCard).join('') : '<p style="text-align:center; color:#999">无结果</p>';
    });

    // 展开更多
    document.getElementById('load-more-news').addEventListener('click', function() {
        const c = document.getElementById('news-list');
        const isExpanded = c.getAttribute('data-expanded') === 'true';
        c.setAttribute('data-expanded', !isExpanded);
        renderNewsList();
    });
    
    // 关闭系统横幅
    document.getElementById('close-banner').addEventListener('click', () => {
        document.getElementById('system-banner').style.display = 'none';
    });
}

function initSettings() {
    const locSelect = document.getElementById('location-select');
    const notifySwitch = document.getElementById('notification-switch');
    const dlSwitch = document.getElementById('dl-card-switch');
    
    // 填充地区
    const locs = [...new Set(allNews.map(n => n.location))];
    locs.forEach(l => { const opt = document.createElement('option'); opt.value = l; opt.innerText = l; locSelect.appendChild(opt); });
    
    // 读取状态
    locSelect.value = locationFilter;
    notifySwitch.checked = showNotifications;
    dlSwitch.checked = showDownloadCard;
    
    toggleDlCard(showDownloadCard);
    
    // 监听变更
    locSelect.addEventListener('change', (e) => { locationFilter = e.target.value; localStorage.setItem('pref_loc', locationFilter); renderNewsList(); });
    notifySwitch.addEventListener('change', (e) => localStorage.setItem('pref_notify', e.target.checked));
    dlSwitch.addEventListener('change', (e) => { toggleDlCard(e.target.checked); localStorage.setItem('pref_dl_card', e.target.checked); });
}

function toggleDlCard(show) {
    const desktopCard = document.getElementById('dl-card-desktop');
    const mobileCard = document.getElementById('dl-card-mobile');
    
    // 基础显示逻辑，配合 CSS media query
    if (!show) {
        desktopCard.style.display = 'none';
        mobileCard.style.display = 'none';
    } else {
        desktopCard.style.removeProperty('display'); // 移除内联样式，交给 CSS 类控制
        mobileCard.style.removeProperty('display');
    }
}
