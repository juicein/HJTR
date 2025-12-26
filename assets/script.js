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
        document.getElementById('news-list').innerHTML = `<p style="padding:20px; text-align:center;">无法读取数据，请确保运行在本地服务器环境。</p>`;
    }
}

// === 1. 菜单渲染 (支持折叠) ===
function renderMenus() {
    // 快捷服务 - 渲染全部，CSS控制显示前4个
    const quickGrid = document.getElementById('menu-grid');
    if(window.QUICK_ACTIONS) {
        quickGrid.innerHTML = window.QUICK_ACTIONS.map(item => `
            <a href="${item.link}" class="menu-item">
                <div class="menu-icon-box"><span class="material-symbols-outlined">${item.icon}</span></div>
                <p>${item.title}</p>
            </a>
        `).join('');
    }

    // 折叠/展开按钮逻辑
    const toggleBtn = document.getElementById('toggle-menu-btn');
    toggleBtn.addEventListener('click', () => {
        const isExpanded = quickGrid.classList.contains('expanded');
        if (isExpanded) {
            quickGrid.classList.remove('expanded');
            toggleBtn.innerText = "全部";
        } else {
            quickGrid.classList.add('expanded');
            toggleBtn.innerText = "收起";
        }
    });

    // 侧边栏菜单
    const sidebarList = document.getElementById('drawer-menu-list');
    if(window.SIDEBAR_ITEMS) {
        sidebarList.innerHTML = window.SIDEBAR_ITEMS.map(item => `
            <a href="${item.link}" class="drawer-item" ${item.title === '设置' ? 'id="sidebar-settings"' : ''}>
                <span class="material-symbols-outlined">${item.icon}</span>
                <span>${item.title}</span>
            </a>
        `).join('');
        
        // 侧边栏设置按钮联动
        document.getElementById('sidebar-settings')?.addEventListener('click', (e) => {
            e.preventDefault();
            closeDrawer();
            document.getElementById('settings-dialog').showModal();
        });
    }
}

// === 2. 新闻头条 (柔和动画, 限4条) ===
function renderHeadlines() {
    if (allNews.length === 0) return;
    
    // 只取前4条作为头条
    const headlines = allNews.slice(0, 4);
    const container = document.getElementById('headlines-container');
    
    // 生成 HTML
    let slidesHtml = headlines.map((item, idx) => `
        <div class="headline-item ${idx === 0 ? 'active' : ''}" 
             style="background-image: url('${item.image || 'assets/default_bg.jpg'}');"
             onclick="location.href='news_detail.html?id=${item.id}'">
            <div class="headline-overlay">
                <span style="background:var(--md-sys-color-primary); width:fit-content; padding:2px 8px; border-radius:4px; font-size:0.7rem;">${item.location}</span>
                <div style="font-size:1.3rem; font-weight:bold; line-height:1.3;">${item.title}</div>
            </div>
        </div>
    `).join('');
    
    let dotsHtml = `<div class="indicators">
        ${headlines.map((_, i) => `<div class="dot ${i===0?'active':''}" id="dot-${i}"></div>`).join('')}
    </div>`;
    
    container.innerHTML = slidesHtml + dotsHtml;
    carouselItems = document.querySelectorAll('.headline-item');
    startCarousel();
}

function startCarousel() {
    if(carouselItems.length < 2) return;
    if(carouselInterval) clearInterval(carouselInterval);
    carouselInterval = setInterval(() => {
        let next = (currentHeadlineIdx + 1) % carouselItems.length;
        switchHeadline(next);
    }, 5000);
}

function switchHeadline(nextIdx) {
    // 柔和切换：CSS transition 处理 opacity
    carouselItems[currentHeadlineIdx].classList.remove('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).classList.remove('active');
    
    currentHeadlineIdx = nextIdx;
    
    carouselItems[currentHeadlineIdx].classList.add('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).classList.add('active');
}

// === 3. 新闻列表 ===
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
    return `
    <a href="news_detail.html?id=${news.id}" class="news-card ${hasImg ? '' : 'text-only'}">
        ${hasImg ? `<img src="${news.image}" class="news-img" loading="lazy">` : ''}
        <div class="news-content">
            <div class="news-tag">${news.location}</div>
            <h4 class="news-title">${news.title}</h4>
            <div class="news-meta">${news.date}</div>
        </div>
    </a>`;
}

// === 4. 历史归档 (日期匹配修复) ===
function initArchive() {
    const container = document.getElementById('archive-toolbar');
    container.innerHTML = `
        <div class="year-selector">
            <span class="material-symbols-outlined" onclick="changeArchiveYear(-1)" style="cursor:pointer">chevron_left</span>
            <span id="archive-year">${currentArchiveYear}年</span>
            <span class="material-symbols-outlined" onclick="changeArchiveYear(1)" style="cursor:pointer">chevron_right</span>
        </div>
        <div class="month-scroller">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => 
                `<div class="month-chip ${m===currentArchiveMonth?'active':''}" onclick="selectArchiveMonth(${m})">${m}月</div>`
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
    initArchive(); // 重新渲染高亮
};

function renderArchiveList() {
    const container = document.getElementById('archive-results');
    // 构造匹配字符串：假如 JSON 是 "12-14"，我们需要假定年份
    // 逻辑：如果 JSON 只有 "MM-DD"，我们认为它是当年。
    // 如果 JSON 是 "YYYY-MM-DD"，则正常匹配。
    
    const targetMonthStr = String(currentArchiveMonth).padStart(2, '0');
    
    const filtered = allNews.filter(n => {
        let dateStr = n.date.split(' ')[0]; // "12-14"
        let fullDate;
        
        if (dateStr.length <= 5) {
            // 补全当前年份用于比较 (假设数据都是当年的，或者你需要在 JSON 里加年份)
            // 这里我们用一种宽容匹配：检查 "MM-DD" 是否以 targetMonth 开头
            // 且 currentArchiveYear 必须等于 当前实际年份 (这是一个妥协，因为数据没年份)
            const thisYear = new Date().getFullYear();
            if (currentArchiveYear !== thisYear) return false; 
            return dateStr.startsWith(targetMonthStr);
        } else {
            // 如果数据有年份 "2024-12-14"
            return dateStr.startsWith(`${currentArchiveYear}-${targetMonthStr}`);
        }
    });

    if(filtered.length === 0) container.innerHTML = `<div style="text-align:center; padding:30px; color:#999">暂无该月新闻</div>`;
    else container.innerHTML = filtered.map(createNewsCard).join('');
}

// === 5. 事件绑定与设置 ===
function bindGlobalEvents() {
    // 侧边栏
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('drawer-scrim');
    
    window.openDrawer = () => { drawer.classList.add('open'); scrim.classList.add('visible'); };
    window.closeDrawer = () => { drawer.classList.remove('open'); scrim.classList.remove('visible'); };
    
    document.getElementById('menu-btn').addEventListener('click', openDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);

    // 弹窗
    const bindDialog = (btnId, dialogId, callback) => {
        const btn = document.getElementById(btnId);
        if(btn) btn.addEventListener('click', () => {
            document.getElementById(dialogId).showModal();
            if(callback) callback();
        });
    };
    
    bindDialog('search-trigger', 'search-dialog');
    bindDialog('settings-trigger', 'settings-dialog');
    bindDialog('history-news-btn', 'history-dialog', initArchive);

    // 展开更多新闻
    document.getElementById('load-more-news').addEventListener('click', function() {
        const c = document.getElementById('news-list');
        const isExpanded = c.getAttribute('data-expanded') === 'true';
        c.setAttribute('data-expanded', !isExpanded);
        renderNewsList();
    });
}

// 设置与通知逻辑 (简化版)
function initSettings() {
    const locSelect = document.getElementById('location-select');
    const notifySwitch = document.getElementById('notification-switch');
    const dlSwitch = document.getElementById('dl-card-switch');
    
    // 填充地区
    const locs = [...new Set(allNews.map(n => n.location))];
    locs.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l; opt.innerText = l;
        locSelect.appendChild(opt);
    });
    
    locSelect.value = locationFilter;
    notifySwitch.checked = showNotifications;
    dlSwitch.checked = showDownloadCard;
    
    toggleDlCard(showDownloadCard);
    
    locSelect.addEventListener('change', (e) => { locationFilter = e.target.value; localStorage.setItem('pref_loc', locationFilter); renderNewsList(); });
    dlSwitch.addEventListener('change', (e) => { toggleDlCard(e.target.checked); localStorage.setItem('pref_dl_card', e.target.checked); });
}

function toggleDlCard(show) {
    // 控制 Mobile 和 Desktop 的卡片显示，利用 CSS class 辅助
    const display = show ? '' : 'none';
    document.getElementById('dl-card-desktop').style.display = show ? (window.innerWidth >= 900 ? 'flex' : 'none') : 'none';
    document.getElementById('dl-card-mobile').style.display = show ? (window.innerWidth < 900 ? 'flex' : 'none') : 'none';
}

// 窗口大小改变时修正下载卡片显示
window.addEventListener('resize', () => {
    const show = document.getElementById('dl-card-switch').checked;
    toggleDlCard(show);
});
