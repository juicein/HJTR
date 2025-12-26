// 全局状态
let allNews = [];
let locationFilter = localStorage.getItem('pref_loc') || 'all';
let showNotifications = localStorage.getItem('pref_notify') === 'true'; 
let showDownloadCard = localStorage.getItem('pref_dl_card') !== 'false';

// 归档状态 (默认为当前年月)
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

// === A. 数据加载与预处理 ===
async function loadNewsData() {
    try {
        const res = await fetch('news_content.json');
        if (!res.ok) throw new Error("Load failed");
        const data = await res.json();
        
        // 关键修正：预处理日期，为归档功能添加年份信息
        // 假设 JSON 数据里的 date 格式是 "MM-DD HH:mm" (12-14 14:21)
        // 我们默认这些新闻是当年的，或者根据逻辑推断
        const currentYear = new Date().getFullYear();

        allNews = data.map((item, index) => {
            // 解析日期字符串 "12-14 14:21"
            let dateObj = null;
            let fullDateStr = item.date;
            
            if (item.date && item.date.includes('-')) {
                const [datePart] = item.date.split(' '); // "12-14"
                const [m, d] = datePart.split('-');
                // 构造一个真实的 Date 对象用于比较
                dateObj = new Date(currentYear, parseInt(m)-1, parseInt(d));
                // 如果构建出来的日期在未来（比如现在是1月，数据是12月），可能是去年的
                if (dateObj > new Date()) {
                    dateObj.setFullYear(currentYear - 1);
                }
                // 更新 fullDateStr 为带年份的格式，方便归档显示 (可选)
                // fullDateStr = `${dateObj.getFullYear()}-${item.date}`; 
            }

            return { 
                ...item, 
                id: index + 1,
                image: item.image || '',
                parsedDate: dateObj // 存储解析后的日期对象用于归档筛选
            };
        });
    } catch (err) {
        console.error(err);
        document.getElementById('news-list').innerHTML = `<p style="padding:20px; text-align:center; color:var(--md-sys-color-error);">无法读取数据，请确保使用 Local Server 运行。</p>`;
    }
}

// === B. 菜单与侧边栏 ===
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

    // 2. 侧边栏 (Drawer List)
    const sidebarList = document.getElementById('drawer-menu-list');
    if(window.SIDEBAR_ITEMS) {
        sidebarList.innerHTML = window.SIDEBAR_ITEMS.map(item => {
            const isSettings = item.title === '设置';
            return `
            <a href="${item.link}" class="drawer-item" ${isSettings ? 'id="drawer-settings-btn" onclick="return false;"' : ''}>
                <span class="material-symbols-outlined">${item.icon}</span>
                <span>${item.title}</span>
            </a>
            `;
        }).join('');
    }

    // 绑定侧边栏内的设置按钮
    const setBtn = document.getElementById('drawer-settings-btn');
    if(setBtn) setBtn.addEventListener('click', () => {
        closeDrawer();
        document.getElementById('settings-dialog').showModal();
    });

    // 绑定快捷菜单的展开/收起
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

// === C. 侧边栏交互逻辑 ===
function openDrawer() {
    document.getElementById('nav-drawer').classList.add('open');
}
function closeDrawer() {
    document.getElementById('nav-drawer').classList.remove('open');
}

// === D. 新闻头条 (限制4条 + 柔和动画) ===
function renderHeadlines() {
    if (allNews.length === 0) return;

    // 逻辑：优先取有图的、最新的，且限制最多 4 条
    let headlines = allNews.filter(n => n.image && n.image !== "").slice(0, 4);
    
    // 如果没有图片新闻，就取前4条纯文本的作为兜底
    if (headlines.length === 0) headlines = allNews.slice(0, 4);

    const container = document.getElementById('headlines-container');
    
    container.innerHTML = headlines.map((item, idx) => `
        <div class="headline-item ${idx === 0 ? 'active' : ''}" 
             style="background-image: url('${item.image || 'assets/default_bg.jpg'}');"
             onclick="location.href='news_detail.html?id=${item.id}'">
            <div class="headline-overlay">
                <span style="background:var(--md-sys-color-primary); padding:2px 6px; border-radius:4px; font-size:0.7rem;">${item.location}</span>
                <div style="font-size:1.3rem; font-weight:bold; line-height:1.3; margin-top:4px;">${item.title}</div>
            </div>
        </div>
    `).join('') + 
    // 指示器
    `<div style="position:absolute; bottom:12px; right:16px; display:flex; gap:6px; z-index:2;">
        ${headlines.map((_, i) => `<div class="indicator-dot ${i===0?'active':''}" id="dot-${i}" style="width:6px; height:6px; background:rgba(255,255,255,0.4); border-radius:50%; transition:all 0.3s;"></div>`).join('')}
    </div>`;

    carouselItems = document.querySelectorAll('.headline-item');
    
    // 只有大于1条才开启轮播
    if (headlines.length > 1) {
        startCarousel();
    }
}

function startCarousel() {
    if(carouselInterval) clearInterval(carouselInterval);
    carouselInterval = setInterval(() => nextHeadline(), 5000);
}

function nextHeadline() {
    const nextIdx = (currentHeadlineIdx + 1) % carouselItems.length;
    
    // UI更新
    carouselItems[currentHeadlineIdx].classList.remove('active');
    document.getElementById(`dot-${currentHeadlineIdx}`).style.background = 'rgba(255,255,255,0.4)';
    document.getElementById(`dot-${currentHeadlineIdx}`).style.width = '6px';
    
    carouselItems[nextIdx].classList.add('active');
    document.getElementById(`dot-${nextIdx}`).style.background = '#fff';
    document.getElementById(`dot-${nextIdx}`).style.width = '16px';
    document.getElementById(`dot-${nextIdx}`).style.borderRadius = '4px';

    currentHeadlineIdx = nextIdx;
}

// === E. 列表渲染 ===
function renderNewsList() {
    const container = document.getElementById('news-list');
    let filtered = locationFilter === 'all' ? allNews : allNews.filter(n => n.location === locationFilter);
    
    // 展开/收起逻辑
    const isExpanded = container.getAttribute('data-expanded') === 'true';
    const showCount = isExpanded ? filtered.length : 6;
    
    container.innerHTML = filtered.slice(0, showCount).map(news => createNewsCard(news)).join('');
    
    // 按钮显隐
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
    </div>
    `;
}

// === F. 历史归档 (真实逻辑) ===
function initArchive() {
    // 渲染工具栏
    document.getElementById('archive-toolbar').innerHTML = `
        <div class="year-selector">
            <button class="icon-btn" onclick="changeArchiveYear(-1)"><span class="material-symbols-outlined">chevron_left</span></button>
            <span id="archive-year-display">${currentArchiveYear}年</span>
            <button class="icon-btn" onclick="changeArchiveYear(1)"><span class="material-symbols-outlined">chevron_right</span></button>
        </div>
        <div class="month-scroller">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => 
                `<div class="month-chip ${m===currentArchiveMonth?'active':''}" onclick="selectArchiveMonth(${m})">${m}月</div>`
            ).join('')}
        </div>
    `;
    renderArchiveList();
}

// 挂载到 window 供 HTML onclick 调用
window.changeArchiveYear = (d) => { currentArchiveYear += d; document.getElementById('archive-year-display').innerText = `${currentArchiveYear}年`; renderArchiveList(); };
window.selectArchiveMonth = (m) => { currentArchiveMonth = m; initArchive(); /* 重新渲染以更新高亮 */ };

function renderArchiveList() {
    const container = document.getElementById('archive-results');
    
    // 筛选逻辑：对比 parsedDate 的年份和月份
    const filtered = allNews.filter(n => {
        if (!n.parsedDate) return false;
        return n.parsedDate.getFullYear() === currentArchiveYear && 
               (n.parsedDate.getMonth() + 1) === currentArchiveMonth;
    });

    if(filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--md-sys-color-outline);">本月暂无归档</div>`;
    } else {
        container.innerHTML = filtered.map(n => createNewsCard(n)).join('');
    }
}

// === G. 设置与事件绑定 ===
function initSettings() {
    const locSelect = document.getElementById('location-select');
    // 去重获取所有地点
    const locs = [...new Set(allNews.map(n => n.location))];
    locs.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l; opt.innerText = l;
        locSelect.appendChild(opt);
    });
    
    // 恢复设置
    locSelect.value = locationFilter;
    locSelect.addEventListener('change', (e) => {
        locationFilter = e.target.value;
        localStorage.setItem('pref_loc', locationFilter);
        renderNewsList();
    });

    document.getElementById('notification-switch').checked = showNotifications;
    document.getElementById('dl-card-switch').checked = showDownloadCard;
    
    updateDownloadCardVisibility();

    document.getElementById('dl-card-switch').addEventListener('change', (e) => {
        showDownloadCard = e.target.checked;
        localStorage.setItem('pref_dl_card', showDownloadCard);
        updateDownloadCardVisibility();
    });
}

function updateDownloadCardVisibility() {
    // 同时控制桌面和移动端的卡片显示（虽然只有一个可见，但都要控制 DOM）
    document.querySelectorAll('.app-download-card').forEach(el => {
        el.style.display = showDownloadCard ? 'flex' : 'none';
    });
}

function bindGlobalEvents() {
    // 侧边栏
    document.getElementById('menu-btn').addEventListener('click', openDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    document.getElementById('drawer-scrim').addEventListener('click', closeDrawer);

    // 弹窗
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

    // 弹窗关闭按钮 (通用)
    document.querySelectorAll('.method-close').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('dialog').close();
        });
    });

    // 展开更多新闻
    document.getElementById('load-more-news').addEventListener('click', function() {
        const c = document.getElementById('news-list');
        // 切换状态
        c.setAttribute('data-expanded', c.getAttribute('data-expanded') !== 'true');
        renderNewsList();
    });
}
