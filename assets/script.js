/* assets/script.js */

// --- Global State ---
let newsDB = [];
let currentSettings = {
    animBg: true,
    notifications: true,
    locationFilter: 'all',
    showQuickMenu: true
};
let heroInterval;
let currentHeroIndex = 0;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    loadSettings();
    updateTheme();
    
    // Check which page we are on
    if(document.getElementById('home-root')) {
        await initHome();
    } else if(document.getElementById('detail-root')) {
        await initDetail();
    }
    
    setupGlobalEvents();
});

// --- Core Data Logic ---
async function fetchNews() {
    try {
        const res = await fetch('../news_content.json');
        const data = await res.json();
        // Process Data: Add ID (index) and Date Object
        newsDB = data.map((item, index) => ({
            ...item,
            id: index, // Auto-generate ID based on sequence
            timestamp: parseDate(item.date) // Helper for sorting
        })).sort((a, b) => b.timestamp - a.timestamp); // Sort Newest First

        checkNotifications();
        return true;
    } catch (e) {
        console.error("Data Load Failed", e);
        return false;
    }
}

function parseDate(dateStr) {
    // Assuming format "MM-DD HH:MM", add current year for comparison
    const year = new Date().getFullYear();
    return new Date(`${year}-${dateStr}`);
}

// --- Home Page Logic ---
async function initHome() {
    await fetchNews();
    renderHero();
    renderQuickMenu();
    renderNewsFeed();
    setupDrawer();
    populateLocationFilter();
}

// 1. Hero Carousel
function renderHero() {
    const container = document.getElementById('hero-slides');
    const indicator = document.getElementById('hero-progress');
    
    // Logic: Get news from last 7 days. If < 1, take the absolute latest.
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    let heroes = newsDB.filter(n => n.timestamp >= oneWeekAgo).slice(0, 4);
    if(heroes.length === 0) heroes = [newsDB[0]];

    container.innerHTML = heroes.map((item, i) => {
        const bg = item.image 
            ? `<img src="${item.image}" class="hero-img">` 
            : `<div class="hero-img" style="background:linear-gradient(135deg, var(--md-sys-color-primary), #001e30)"></div>`;
        
        return `
            <div class="hero-slide ${i===0?'active':''}" data-index="${i}" onclick="window.location.href='news_detail.html?id=${item.id}'">
                ${bg}
                <div class="hero-content">
                    <span class="hero-badge">今日头条</span>
                    <div class="hero-title">${item.title}</div>
                    <p class="hero-snippet">${item.content}</p>
                </div>
            </div>
        `;
    }).join('');

    // Carousel Logic
    if(heroes.length > 1) {
        startHeroCarousel(heroes.length);
        setupSwipe(document.getElementById('hero-section'), (dir) => {
            changeHero(dir === 'left' ? 1 : -1, heroes.length);
        });
    } else {
        indicator.style.display = 'none'; // Hide progress if only 1
    }
}

function startHeroCarousel(count) {
    const bar = document.getElementById('hero-progress-bar');
    let progress = 0;
    clearInterval(heroInterval);
    
    heroInterval = setInterval(() => {
        progress += 1;
        bar.style.width = `${progress}%`;
        if(progress >= 100) {
            changeHero(1, count);
            progress = 0;
        }
    }, 50); // 50ms * 100 = 5000ms total
}

function changeHero(dir, count) {
    const slides = document.querySelectorAll('.hero-slide');
    slides[currentHeroIndex].classList.remove('active');
    
    currentHeroIndex = (currentHeroIndex + dir + count) % count;
    
    slides[currentHeroIndex].classList.add('active');
    document.getElementById('hero-progress-bar').style.width = '0%';
}

// 2. Quick Menu
function renderQuickMenu() {
    const grid = document.getElementById('menu-grid');
    if(!currentSettings.showQuickMenu) {
        document.getElementById('menu-section').style.display = 'none';
        return;
    }
    document.getElementById('menu-section').style.display = 'block';

    const items = menuData.quickActions;
    grid.innerHTML = items.map(item => `
        <div class="menu-item" onclick="window.location.href='${item.link}'">
            <div class="menu-icon-box">
                <span class="material-symbols-outlined">${item.icon}</span>
            </div>
            <span>${item.name}</span>
        </div>
    `).join('');
    
    toggleMenu(false); // Init collapsed
}

window.toggleMenu = function(forceOpen) {
    const grid = document.getElementById('menu-grid');
    const btn = document.getElementById('menu-toggle-btn');
    const isCollapsed = grid.style.maxHeight === '100px';
    
    if(forceOpen || isCollapsed) {
        grid.style.maxHeight = '1000px';
        btn.innerText = '收起';
    } else {
        grid.style.maxHeight = '100px'; // Approx height for 1 row
        btn.innerText = '展开更多';
    }
}

// 3. News Feed
function renderNewsFeed() {
    const list = document.getElementById('news-list');
    let data = newsDB;
    
    // Filter by Location
    if(currentSettings.locationFilter !== 'all') {
        data = data.filter(n => n.location === currentSettings.locationFilter);
    }
    
    // Limit to 7 for main feed
    const displayData = data.slice(0, 7);
    
    list.innerHTML = displayData.map(item => createNewsCard(item)).join('');
}

function createNewsCard(item) {
    const imgHtml = item.image 
        ? `<img src="${item.image}" class="nc-img" loading="lazy">` 
        : ``; // No image, text expands
        
    return `
        <div class="news-card" onclick="window.location.href='news_detail.html?id=${item.id}'">
            <div class="nc-loc-tag">${item.location}</div>
            <div class="nc-content">
                <div class="nc-title">${item.title}</div>
                <div class="nc-meta">${item.author} · ${item.date}</div>
            </div>
            ${imgHtml}
        </div>
    `;
}

// --- Detail Page Logic ---
async function initDetail() {
    await fetchNews();
    const params = new URLSearchParams(window.location.search);
    const id = parseInt(params.get('id'));
    
    const item = newsDB.find(n => n.id === id);
    const container = document.getElementById('detail-content');
    
    if(!item) {
        container.innerHTML = "<h1>新闻未找到</h1>";
        return;
    }
    
    // Header (Image or Color)
    const heroHtml = item.image 
        ? `<img src="${item.image}" class="detail-img">`
        : `<div class="detail-color-block" style="background:var(--md-sys-color-primary)">HAOJIN</div>`;
        
    // Link Button
    const linkHtml = item.link 
        ? `<a href="${item.link}" target="_blank" class="link-btn">
             <span>访问原文 / 相关链接</span>
             <span class="material-symbols-outlined">open_in_new</span>
           </a>` 
        : '';

    container.innerHTML = `
        <div class="detail-hero-box">
            ${heroHtml}
            <div class="icon-btn" onclick="window.history.back()" style="position:absolute; top:16px; left:16px; background:rgba(0,0,0,0.3); color:white;">
                <span class="material-symbols-outlined">arrow_back</span>
            </div>
        </div>
        <article class="detail-content-card">
            <div style="display:flex; gap:10px; margin-bottom:16px;">
                <span style="background:var(--md-sys-color-surface-variant); padding:4px 8px; border-radius:4px; font-size:12px; font-weight:bold;">${item.location}</span>
            </div>
            <h1 style="font-size:24px; margin-bottom:10px;">${item.title}</h1>
            <div style="color:var(--md-sys-color-outline); font-size:14px; margin-bottom:24px;">
                ${item.date} · ${item.author}
            </div>
            <div style="line-height:1.8; font-size:16px; white-space:pre-wrap;">${item.content}</div>
            ${linkHtml}
        </article>
    `;
}

// --- Settings & Utils ---
function loadSettings() {
    const saved = localStorage.getItem('haojin_settings');
    if(saved) currentSettings = { ...currentSettings, ...JSON.parse(saved) };
}

function saveSettings() {
    localStorage.setItem('haojin_settings', JSON.stringify(currentSettings));
    updateTheme();
}

function updateTheme() {
    // Bg Anim
    const bg = document.getElementById('anim-bg');
    if(bg) {
        if(currentSettings.animBg) bg.classList.add('active');
        else bg.classList.remove('active');
    }
    
    // Quick Menu toggle check
    if(document.getElementById('home-root')) renderQuickMenu();
}

function populateLocationFilter() {
    const select = document.getElementById('loc-filter-select');
    if(!select) return;
    
    const locs = [...new Set(newsDB.map(n => n.location))];
    select.innerHTML = `<option value="all">所有地区</option>` + 
        locs.map(l => `<option value="${l}" ${currentSettings.locationFilter===l?'selected':''}>${l}</option>`).join('');
}

// --- Search & Drawer ---
window.openSearch = () => {
    document.getElementById('search-overlay').classList.add('open');
    document.getElementById('search-input').focus();
}

window.handleSearch = (query) => {
    const resDiv = document.getElementById('search-results');
    if(!query) { resDiv.innerHTML = ''; return; }
    
    const q = query.toLowerCase();
    // Search Menu
    const menus = menuData.quickActions.filter(m => m.name.toLowerCase().includes(q));
    // Search News
    const news = newsDB.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    
    let html = '';
    if(menus.length) {
        html += `<div style="font-weight:bold; margin:10px 0;">功能</div>` + 
        menus.map(m => `<div onclick="window.location.href='${m.link}'" style="padding:10px; border-bottom:1px solid #eee;">${m.name}</div>`).join('');
    }
    if(news.length) {
        html += `<div style="font-weight:bold; margin:10px 0;">新闻</div>` + 
        news.map(n => `<div onclick="window.location.href='news_detail.html?id=${n.id}'" style="padding:10px; border-bottom:1px solid #eee;">${n.title}</div>`).join('');
    }
    resDiv.innerHTML = html;
}

// --- Notifications Mock ---
function checkNotifications() {
    if(!currentSettings.notifications || newsDB.length === 0) return;
    
    const lastTop = localStorage.getItem('last_top_news');
    const currentTop = newsDB[0].title;
    
    if(lastTop !== currentTop) {
        showToast(`新动态：${currentTop}`);
        localStorage.setItem('last_top_news', currentTop);
    }
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerHTML = `<span class="material-symbols-outlined">notifications</span> ${msg}`;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 4000);
}

// --- Event Helpers ---
function setupGlobalEvents() {
    // Overlays Close
    document.querySelectorAll('.overlay').forEach(ov => {
        ov.addEventListener('click', (e) => {
            if(e.target === ov) ov.classList.remove('open');
        });
    });
}

function setupDrawer() {
    const dList = document.getElementById('drawer-list');
    dList.innerHTML = menuData.drawerItems.map(item => `
        <div onclick="window.location.href='${item.link}'" style="display:flex; gap:16px; padding:16px; cursor:pointer; align-items:center;">
            <span class="material-symbols-outlined">${item.icon}</span>
            <span>${item.name}</span>
        </div>
    `).join('');
}

window.toggleDrawer = () => {
    const d = document.getElementById('app-drawer');
    const o = document.getElementById('drawer-overlay');
    if(d.classList.contains('open')) {
        d.classList.remove('open'); o.classList.remove('open');
    } else {
        d.classList.add('open'); o.classList.add('open');
    }
}

window.openHistory = () => {
    const ov = document.getElementById('history-overlay');
    const list = document.getElementById('history-list');
    list.innerHTML = newsDB.map(item => createNewsCard(item)).join('');
    ov.classList.add('open');
}

window.openSettings = () => {
    populateLocationFilter(); // Refresh locs
    document.getElementById('settings-overlay').classList.add('open');
    
    // Set Toggle States
    document.getElementById('sw-bg').className = `switch ${currentSettings.animBg?'on':''}`;
    document.getElementById('sw-notif').className = `switch ${currentSettings.notifications?'on':''}`;
    document.getElementById('sw-menu').className = `switch ${currentSettings.showQuickMenu?'on':''}`;
}

window.toggleSetting = (key) => {
    currentSettings[key] = !currentSettings[key];
    saveSettings();
    openSettings(); // Re-render state
}

window.changeLocFilter = (val) => {
    currentSettings.locationFilter = val;
    saveSettings();
    if(document.getElementById('home-root')) renderNewsFeed();
}

function setupSwipe(el, callback) {
    let touchStartX = 0;
    let touchEndX = 0;
    el.addEventListener('touchstart', e => touchStartX = e.changedTouches[0].screenX);
    el.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        if (touchEndX < touchStartX - 50) callback('left');
        if (touchEndX > touchStartX + 50) callback('right');
    });
}
