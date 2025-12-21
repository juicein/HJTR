// assets/script.js

// --- State Management ---
const state = {
    news: [],
    settings: {
        bgAnimation: true,
        notifications: true,
        locationFilter: 'all'
    },
    shortcutsExpanded: false,
    jsonUrl: 'data/news_content.json'
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    loadSettings();
    await fetchNews();
    
    // Check if we are on index.html
    if (document.getElementById('hero-section')) {
        initHomePage();
    }
    
    initCommonFeatures();
    initBackground();
});

// --- Core Data Logic ---
async function fetchNews() {
    try {
        // In real scenario, append cache buster if notification logic requires distinct check
        const response = await fetch(state.jsonUrl);
        const rawData = await response.json();
        
        // Auto-Generate IDs (0, 1, 2...)
        state.news = rawData.map((item, index) => ({
            ...item,
            id: index
        }));

        // Notification Check (Simple Implementation)
        const lastNewsTitle = localStorage.getItem('last_news_title');
        if (state.settings.notifications && state.news.length > 0) {
            if (lastNewsTitle && lastNewsTitle !== state.news[0].title) {
                sendNotification("新动态发布", state.news[0].title);
            }
            localStorage.setItem('last_news_title', state.news[0].title);
        }
        
    } catch (error) {
        console.error("Failed to load news:", error);
    }
}

// --- Page Rendering (Index) ---
function initHomePage() {
    renderHero();
    renderShortcuts();
    renderNewsFeed();
    setupLocationFilter();
    
    // Button Listeners
    document.getElementById('shortcut-toggle').addEventListener('click', toggleShortcuts);
    document.getElementById('history-btn').addEventListener('click', () => {
        const dialog = document.getElementById('history-dialog');
        renderHistoryFeed();
        dialog.showModal();
    });
    document.getElementById('close-history').addEventListener('click', () => document.getElementById('history-dialog').close());
}

// 1. Hero Carousel Logic
function renderHero() {
    const track = document.getElementById('hero-track');
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Filter logic: < 1 week OR at least the latest one
    let heroNews = state.news.filter(n => {
        // Assume 'date' format is MM-DD HH:MM, append current year for comparison
        // Note: Simple parsing for demo. In prod, use robust date parsing.
        return true; // Simplified for demo as date format in JSON is partial
    }).slice(0, 4); 

    if (heroNews.length === 0 && state.news.length > 0) heroNews = [state.news[0]];

    track.innerHTML = heroNews.map(item => `
        <div class="hero-card" onclick="location.href='news_detail.html?id=${item.id}'" 
             style="background-image: url('${item.image || 'assets/default_hero.jpg'}')">
            <div class="hero-overlay"></div>
            <div class="hero-content">
                <div class="hero-badge">头条</div>
                <div class="hero-title">${item.title}</div>
                <div class="hero-snippet">${item.content.substring(0, 50)}...</div>
            </div>
        </div>
    `).join('');

    // Scroll Progress Logic
    if (heroNews.length > 1) {
        track.addEventListener('scroll', () => {
            const scrollLeft = track.scrollLeft;
            const maxScroll = track.scrollWidth - track.clientWidth;
            const progress = (scrollLeft / maxScroll) * 100;
            document.getElementById('hero-progress').style.width = `${progress}%`;
        });
    } else {
        document.getElementById('hero-progress-wrapper').style.display = 'none';
    }
}

// 2. Shortcuts Logic
function renderShortcuts() {
    const grid = document.getElementById('shortcuts-grid');
    const items = menuData.filter(i => i.type === 'shortcut'); // Or all items logic
    
    // Initial render: show all but hide via CSS max-height or class
    // Here we rerender for simplicity based on state
    const displayItems = state.shortcutsExpanded ? items : items.slice(0, 4);
    
    grid.innerHTML = displayItems.map(item => `
        <div class="shortcut-item">
            <div class="shortcut-icon-box">
                <span class="material-symbols-outlined">${item.icon}</span>
            </div>
            <span class="shortcut-label">${item.name}</span>
        </div>
    `).join('');
    
    const icon = document.getElementById('shortcut-icon');
    icon.textContent = state.shortcutsExpanded ? 'expand_less' : 'expand_more';
}

function toggleShortcuts() {
    state.shortcutsExpanded = !state.shortcutsExpanded;
    renderShortcuts();
}

// 3. News Feed Logic (Main & History)
function renderNewsFeed() {
    const container = document.getElementById('news-feed');
    // Filter by location if set
    let filtered = state.news;
    if (state.settings.locationFilter !== 'all') {
        filtered = state.news.filter(n => n.location === state.settings.locationFilter);
    }

    const recent = filtered.slice(0, 7); // Max 7
    container.innerHTML = recent.map(item => createNewsCardHTML(item)).join('');
}

function renderHistoryFeed() {
    const container = document.getElementById('history-feed');
    container.innerHTML = state.news.map(item => createNewsCardHTML(item)).join('');
}

function createNewsCardHTML(item) {
    const hasImage = item.image && item.image !== "";
    const cardClass = hasImage ? "news-card glass-card has-image" : "news-card glass-card";
    
    return `
    <a href="news_detail.html?id=${item.id}" class="${cardClass}">
        ${hasImage ? `<img src="${item.image}" class="news-card-img" loading="lazy">` : ''}
        <div class="news-card-content">
            <div>
                <div class="news-title">${item.title}</div>
                ${!hasImage ? `<div class="news-snippet">${item.content}</div>` : ''}
            </div>
            <div class="news-meta">
                <span class="location-tag">${item.location}</span>
                <span>${item.author}</span>
                <span>${item.date}</span>
            </div>
        </div>
    </a>
    `;
}

// --- Common Features (Sidebar, Search, Settings) ---
function initCommonFeatures() {
    // Sidebar
    const drawer = document.getElementById('nav-drawer');
    const scrim = document.getElementById('drawer-scrim');
    const drawerList = document.getElementById('drawer-list');

    // Populate Sidebar
    drawerList.innerHTML = menuData.map(item => `
        <a href="${item.url}" class="nav-item">
            <span class="material-symbols-outlined">${item.icon}</span>
            ${item.name}
        </a>
    `).join('');

    document.getElementById('menu-btn').addEventListener('click', () => {
        drawer.classList.add('open');
        scrim.classList.add('open');
    });
    scrim.addEventListener('click', () => {
        drawer.classList.remove('open');
        scrim.classList.remove('open');
    });

    // Search
    const searchDialog = document.getElementById('search-dialog');
    document.getElementById('search-btn').addEventListener('click', () => searchDialog.showModal());
    document.getElementById('close-search').addEventListener('click', () => searchDialog.close());
    
    document.getElementById('search-input').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const resultsDiv = document.getElementById('search-results');
        if (!query) { resultsDiv.innerHTML = ''; return; }
        
        // Search Logic: Menu items + News
        const foundMenu = menuData.filter(m => m.name.toLowerCase().includes(query));
        const foundNews = state.news.filter(n => n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query));
        
        let html = '';
        if(foundMenu.length) {
            html += `<h4>功能</h4>` + foundMenu.map(m => `<div class="nav-item"><span class="material-symbols-outlined">${m.icon}</span>${m.name}</div>`).join('');
        }
        if(foundNews.length) {
            html += `<h4>新闻</h4>` + foundNews.map(n => createNewsCardHTML(n)).join('');
        }
        resultsDiv.innerHTML = html;
    });

    // Settings
    const settingsDialog = document.getElementById('settings-dialog');
    document.getElementById('settings-btn').addEventListener('click', () => settingsDialog.showModal());
    document.getElementById('close-settings').addEventListener('click', () => settingsDialog.close());

    // Settings Toggles
    const bgSwitch = document.getElementById('bg-anim-switch');
    bgSwitch.checked = state.settings.bgAnimation;
    bgSwitch.addEventListener('change', (e) => {
        state.settings.bgAnimation = e.target.checked;
        saveSettings();
        initBackground(); // Reload bg state
    });

    const notifySwitch = document.getElementById('notify-switch');
    notifySwitch.checked = state.settings.notifications;
    notifySwitch.addEventListener('change', (e) => {
        state.settings.notifications = e.target.checked;
        if(e.target.checked) Notification.requestPermission();
        saveSettings();
    });

    const locSelect = document.getElementById('location-select');
    locSelect.value = state.settings.locationFilter;
    locSelect.addEventListener('change', (e) => {
        state.settings.locationFilter = e.target.value;
        saveSettings();
        if(document.getElementById('news-feed')) renderNewsFeed();
    });
}

function setupLocationFilter() {
    const locations = [...new Set(state.news.map(n => n.location))];
    const select = document.getElementById('location-select');
    // Keep first option
    select.innerHTML = `<option value="all">显示全部地区</option>` + 
        locations.map(loc => `<option value="${loc}">${loc}</option>`).join('');
    select.value = state.settings.locationFilter;
}

function loadSettings() {
    const saved = localStorage.getItem('app_settings');
    if (saved) state.settings = JSON.parse(saved);
}

function saveSettings() {
    localStorage.setItem('app_settings', JSON.stringify(state.settings));
}

function sendNotification(title, body) {
    if (Notification.permission === 'granted') {
        new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') new Notification(title, { body });
        });
    }
}

// --- Background Animation (Canvas) ---
let animId;
function initBackground() {
    const canvas = document.getElementById('ambient-canvas');
    if (!state.settings.bgAnimation) {
        if (animId) cancelAnimationFrame(animId);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0, canvas.width, canvas.height);
        return;
    }

    const ctx = canvas.getContext('2d');
    let width, height;
    
    // Particles
    const particles = [];
    const colors = window.matchMedia('(prefers-color-scheme: dark)').matches 
        ? ['#004b72', '#1a1c1e', '#006495'] // Dark theme blues
        : ['#cbe6ff', '#fdfcff', '#dff2fc']; // Light theme blues

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.vx = (Math.random() - 0.5) * 0.5;
            this.vy = (Math.random() - 0.5) * 0.5;
            this.size = Math.random() * 200 + 100;
            this.color = colors[Math.floor(Math.random() * colors.length)];
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            if (this.x < -this.size) this.x = width + this.size;
            if (this.x > width + this.size) this.x = -this.size;
            if (this.y < -this.size) this.y = height + this.size;
            if (this.y > height + this.size) this.y = -this.size;
        }
        draw() {
            ctx.beginPath();
            const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size);
            g.addColorStop(0, this.color);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.globalAlpha = 0.6;
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for(let i=0; i<5; i++) particles.push(new Particle());

    function animate() {
        ctx.clearRect(0, 0, width, height);
        // Base bg
        ctx.fillStyle = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#1a1c1e' : '#fdfcff';
        ctx.fillRect(0,0,width,height);
        
        particles.forEach(p => { p.update(); p.draw(); });
        animId = requestAnimationFrame(animate);
    }
    animate();
}
