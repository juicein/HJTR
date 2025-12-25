// 全局状态
let allNews = [];
let menuExpanded = false;
let locationFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    // 1. 加载数据
    await loadNewsData();
    
    // 2. 渲染静态内容
    renderMenu();
    loadSettings();
    
    // 3. 渲染动态内容
    renderHeadlines();
    renderNewsList();
    
    // 4. 绑定所有事件
    bindEvents();
}

// === 数据层 ===
async function loadNewsData() {
    try {
        const res = await fetch('news_content.json');
        if (!res.ok) throw new Error("File not found");
        const data = await res.json();
        // 为数据添加 ID
        allNews = data.map((item, index) => ({ ...item, id: index + 1 }));
    } catch (err) {
        console.error("Data Load Error:", err);
        // 如果 fetch 失败 (通常是 CORS 问题)，给用户明确提示
        const errorMsg = `<div style="padding:20px; color:red; text-align:center;">
            <h3>无法读取数据</h3>
            <p>错误原因：${err.message}</p>
            <p><b>请注意：</b> 必须使用 Local Server (如 VSCode Live Server 插件) 运行，不能直接双击 HTML 文件。</p>
        </div>`;
        document.getElementById('news-list').innerHTML = errorMsg;
        document.getElementById('headlines-container').innerHTML = errorMsg;
    }
}

// === 渲染层 ===
function renderMenu() {
    // 使用 window.MENU_DATA (来自 menu_data.js)
    const data = window.MENU_DATA || [];
    const grid = document.getElementById('menu-grid');
    const drawerList = document.getElementById('drawer-menu-list');
    
    // 主页菜单
    const displayData = menuExpanded ? data : data.slice(0, 4);
    grid.innerHTML = displayData.map(item => `
        <a href="${item.link}" class="menu-item">
            <span class="material-symbols-outlined">${item.icon}</span>
            <p>${item.title}</p>
        </a>
    `).join('');
    
    document.getElementById('toggle-menu').innerText = menuExpanded ? "收起" : "展开全部";

    // 侧边栏菜单
    drawerList.innerHTML = data.map(item => `
        <a href="${item.link}" class="menu-item" style="flex-direction:row; padding:12px; font-size:1.1rem;">
            <span class="material-symbols-outlined" style="font-size:24px;">${item.icon}</span>
            <span style="font-size:1rem; color:var(--md-sys-color-on-surface);">${item.title}</span>
        </a>
    `).join('');
}

function renderHeadlines() {
    if(allNews.length === 0) return;
    
    // 筛选一周内新闻，若无则取最新一条
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let headlines = allNews.filter(n => {
        // 简单日期解析 "12-14 14:21" -> 假定当前年份
        try {
            const [d, t] = n.date.split(' ');
            const [mon, day] = d.split('-');
            const dateObj = new Date(new Date().getFullYear(), mon-1, day);
            return dateObj > oneWeekAgo;
        } catch(e) { return false; }
    });

    if (headlines.length === 0) headlines = [allNews[0]]; // 兜底
    headlines = headlines.slice(0, 4);

    const container = document.getElementById('headlines-container');
    container.innerHTML = headlines.map(item => `
        <div class="headline-card" onclick="location.href='news_detail.html?id=${item.id}'">
            <h3>${item.title}</h3>
            <div style="margin-top:auto; font-size:0.8rem; opacity:0.9;">${item.date}</div>
        </div>
    `).join('');
}

function renderNewsList() {
    if(allNews.length === 0) return;

    const container = document.getElementById('news-list');
    const loadMoreBtn = document.getElementById('load-more-news');
    
    // 筛选地区
    let filtered = locationFilter === 'all' ? allNews : allNews.filter(n => n.location === locationFilter);
    
    // 展开逻辑
    const isExpanded = container.getAttribute('data-expanded') === 'true';
    const showCount = isExpanded ? filtered.length : 6;
    const listData = filtered.slice(0, showCount);

    container.innerHTML = listData.map(news => {
        const hasImg = news.image && news.image.trim() !== "";
        return `
        <div class="news-card" onclick="location.href='news_detail.html?id=${news.id}'">
            ${hasImg ? `<img src="${news.image}" class="news-img" loading="lazy">` : ''}
            <div class="news-content">
                <span class="news-tag">${news.location}</span>
                <h4 class="news-title">${news.title}</h4>
                ${!hasImg ? `<p class="news-desc">${news.content}</p>` : ''}
                <small style="color:var(--md-sys-color-outline); margin-top:8px;">${news.date} · ${news.author}</small>
            </div>
        </div>
        `;
    }).join('');

    // 按钮状态
    loadMoreBtn.style.display = filtered.length > 6 ? 'block' : 'none';
    loadMoreBtn.innerText = isExpanded ? "收起" : "展开更多";
}

// === 交互逻辑 ===
function bindEvents() {
    // 侧边栏
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('drawer-scrim');
    const closeDrawer = () => { drawer.classList.remove('open'); scrim.classList.remove('open'); };
    const openDrawer = () => { drawer.classList.add('open'); scrim.classList.add('open'); };
    
    document.getElementById('menu-btn').addEventListener('click', openDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);

    // 菜单展开
    document.getElementById('toggle-menu').addEventListener('click', () => {
        menuExpanded = !menuExpanded;
        renderMenu();
    });

    // 新闻展开
    document.getElementById('load-more-news').addEventListener('click', function() {
        const container = document.getElementById('news-list');
        const current = container.getAttribute('data-expanded') === 'true';
        container.setAttribute('data-expanded', !current);
        renderNewsList();
    });

    // 弹窗管理
    const setupDialog = (triggerId, dialogId, closeId) => {
        const dialog = document.getElementById(dialogId);
        document.getElementById(triggerId).addEventListener('click', () => dialog.showModal());
        document.getElementById(closeId).addEventListener('click', () => dialog.close());
    };
    setupDialog('search-trigger', 'search-dialog', 'close-search');
    setupDialog('settings-trigger', 'settings-dialog', 'close-settings');
    setupDialog('history-news-btn', 'history-dialog', 'close-history');

    // 搜索功能
    document.getElementById('search-input').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const resBox = document.getElementById('search-results');
        if(!term) { resBox.innerHTML = ''; return; }
        
        const matched = allNews.filter(n => n.title.toLowerCase().includes(term) || n.content.toLowerCase().includes(term));
        resBox.innerHTML = matched.length ? matched.map(n => `<div style="padding:10px; border-bottom:1px solid #eee;" onclick="location.href='news_detail.html?id=${n.id}'"><b>${n.title}</b><p style="font-size:0.8rem; color:#666;">${n.content.substring(0,30)}...</p></div>`).join('') : '<p>无结果</p>';
    });

    // 历史搜索
    document.getElementById('history-search-input').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const container = document.getElementById('history-list');
        const filtered = allNews.filter(n => n.title.toLowerCase().includes(term));
        container.innerHTML = filtered.map(n => `<div style="padding:10px;" onclick="location.href='news_detail.html?id=${n.id}'">${n.date} - ${n.title}</div>`).join('');
    });

    // 设置监听
    document.getElementById('location-select').addEventListener('change', (e) => {
        locationFilter = e.target.value;
        localStorage.setItem('pref_loc', locationFilter);
        renderNewsList();
    });
    
    document.getElementById('app-dl-switch').addEventListener('change', (e) => {
        const show = e.target.checked;
        localStorage.setItem('pref_dl', show);
        updateDlVisibility(show);
    });
}

function loadSettings() {
    // 地区选项
    const locSelect = document.getElementById('location-select');
    const locs = [...new Set(allNews.map(n => n.location))];
    locs.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.innerText = l;
        locSelect.appendChild(opt);
    });

    // 恢复偏好
    const savedLoc = localStorage.getItem('pref_loc');
    if(savedLoc) { 
        locationFilter = savedLoc; 
        locSelect.value = savedLoc;
    }
    
    const savedDl = localStorage.getItem('pref_dl');
    if(savedDl !== null) {
        const show = savedDl === 'true';
        document.getElementById('app-dl-switch').checked = show;
        updateDlVisibility(show);
    }
}

function updateDlVisibility(show) {
    const display = show ? 'flex' : 'none';
    if(document.getElementById('mobile-app-dl')) document.getElementById('mobile-app-dl').style.display = display;
    if(document.getElementById('desktop-app-dl')) document.getElementById('desktop-app-dl').style.display = display;
}
