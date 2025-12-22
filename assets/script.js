let allNews = [];
let filteredNews = [];

document.addEventListener('DOMContentLoaded', () => {
    // 1. 先加载本地静态内容，不依赖 Fetch
    initMenu(); 
    loadSettings();
    
    // 2. 尝试获取新闻
    fetchNews();
    
    // 3. 事件监听
    setupEventListeners();
});

/* --- 菜单与侧边栏 --- */
function initMenu() {
    // 侧边栏 (assets/menu_data.js 中的 sidebarData)
    const sidebarList = document.getElementById('sidebarList');
    if(typeof sidebarData !== 'undefined' && sidebarList) {
        sidebarList.innerHTML = sidebarData.map(item => `
            <a href="${item.link}" class="nav-item">
                <span class="material-symbols-rounded">${item.icon}</span>
                <span>${item.name}</span>
            </a>
        `).join('');
    }

    // 快捷功能 (assets/menu_data.js 中的 menuData)
    const actionsGrid = document.getElementById('actionsGrid');
    if(typeof menuData !== 'undefined' && actionsGrid) {
        actionsGrid.innerHTML = menuData.map(item => `
            <div class="action-item">
                <div class="action-icon">
                    <span class="material-symbols-rounded">${item.icon}</span>
                </div>
                <span>${item.name}</span>
            </div>
        `).join('');
    }
}

/* --- 新闻数据获取 --- */
async function fetchNews() {
    try {
        const response = await fetch('data/news_content.json');
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        
        // 自动添加 ID 和 排序
        allNews = data.map((item, index) => ({
            ...item,
            id: index, 
            timestamp: parseDate(item.date)
        })).sort((a, b) => b.timestamp - a.timestamp);
        
        filteredNews = [...allNews];

        // 渲染页面组件
        renderHero(allNews);
        renderNewsList(filteredNews);
        populateLocationFilter(allNews);
        
        // 检查通知
        checkNotifications(allNews[0]);

    } catch (error) {
        console.error('加载新闻失败:', error);
        document.getElementById('newsList').innerHTML = 
            `<div style="padding:20px; text-align:center; color:red;">
                无法加载新闻数据。<br>请确保您是通过本地服务器(Live Server)运行的。
            </div>`;
    }
}

function parseDate(dateStr) {
    // 假定格式 MM-DD HH:MM
    const currentYear = new Date().getFullYear();
    return new Date(`${currentYear}-${dateStr}`).getTime();
}

/* --- 渲染逻辑 --- */
function renderHero(news) {
    // 过去7天
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    let recent = news.filter(n => n.timestamp > oneWeekAgo).slice(0, 4);
    
    // 如果没有近期新闻，强制显示最新的一条
    if (recent.length === 0 && news.length > 0) recent = [news[0]];

    const slider = document.getElementById('heroSlider');
    const progressContainer = document.getElementById('heroProgressContainer');

    if(!slider) return;

    if (recent.length <= 1 && progressContainer) progressContainer.style.display = 'none';

    slider.innerHTML = recent.map(item => `
        <a href="news_detail.html?id=${item.id}" class="hero-card ${!item.image ? 'no-img' : ''}" 
           style="background-image: url('${item.image || ''}')">
            <div class="hero-overlay">
                <span class="hero-tag">${item.location}</span>
                <div class="hero-title">${item.title}</div>
            </div>
        </a>
    `).join('');

    // 滚动监听
    if(progressContainer) {
        slider.addEventListener('scroll', () => {
            const maxScroll = slider.scrollWidth - slider.clientWidth;
            const percentage = (slider.scrollLeft / maxScroll) * 100;
            document.getElementById('heroProgressBar').style.width = `${Math.min(100, Math.max(0, percentage))}%`;
        });
    }
}

function renderNewsList(newsSource, isHistory = false) {
    const targetId = isHistory ? 'historyList' : 'newsList';
    const container = document.getElementById(targetId);
    if(!container) return;

    const list = isHistory ? newsSource : newsSource.slice(0, 7);

    container.innerHTML = list.map(item => `
        <a href="news_detail.html?id=${item.id}" class="glass-card news-card">
            ${item.image ? `<img src="${item.image}" class="news-thumb">` : ''}
            <div class="news-content">
                <div>
                    <div class="news-h-title">${item.title}</div>
                    <div class="news-h-desc">${item.content}</div>
                </div>
                <div class="news-meta">
                    <span class="loc-badge">${item.location}</span>
                    <span>${item.date}</span>
                </div>
            </div>
        </a>
    `).join('');
}

/* --- 交互逻辑 --- */
function toggleActions() {
    document.getElementById('actionsGrid').classList.toggle('expanded');
    const btnText = document.querySelector('#expandActionBtn span:last-child');
    const icon = document.querySelector('#expandActionBtn span:first-child');
    if(document.getElementById('actionsGrid').classList.contains('expanded')){
        btnText.innerText = '收起功能';
        icon.innerText = 'keyboard_arrow_up';
    } else {
        btnText.innerText = '展开全部';
        icon.innerText = 'keyboard_arrow_down';
    }
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ol = document.querySelector('.sidebar-overlay');
    sb.classList.toggle('active');
    ol.classList.toggle('active');
}

/* --- 设置与筛选 --- */
function populateLocationFilter(news) {
    const locs = [...new Set(news.map(n => n.location))];
    const sel = document.getElementById('locationSelect');
    if(!sel) return;
    
    // 保留第一个 "全部" 选项
    sel.innerHTML = '<option value="all">全部地区</option>';
    locs.forEach(l => {
        sel.innerHTML += `<option value="${l}">${l}</option>`;
    });

    // 恢复记忆
    const saved = localStorage.getItem('pref_location');
    if(saved) {
        sel.value = saved;
        filterLocation();
    }
}

function filterLocation() {
    const val = document.getElementById('locationSelect').value;
    localStorage.setItem('pref_location', val);
    
    if(val === 'all') filteredNews = [...allNews];
    else filteredNews = allNews.filter(n => n.location === val);
    
    renderNewsList(filteredNews);
}

function loadSettings() {
    // 1. 动画
    const bgAnim = localStorage.getItem('pref_bg_anim') !== 'false';
    const bgSwitch = document.getElementById('settingBgAnim');
    if(bgSwitch) bgSwitch.checked = bgAnim;
    toggleBgAnim();

    // 2. APP下载
    const appDl = localStorage.getItem('pref_app_dl') !== 'false';
    const appSwitch = document.getElementById('settingAppDl');
    if(appSwitch) appSwitch.checked = appDl;
    toggleAppDl();
}

function toggleBgAnim() {
    const on = document.getElementById('settingBgAnim').checked;
    localStorage.setItem('pref_bg_anim', on);
    const bg = document.getElementById('auroraBg');
    if(bg) on ? bg.classList.remove('hidden') : bg.classList.add('hidden');
}

function toggleAppDl() {
    const on = document.getElementById('settingAppDl').checked;
    localStorage.setItem('pref_app_dl', on);
    // 同时控制两个按钮 (Mobile & Desktop)
    const btns = document.querySelectorAll('.app-dl-wrapper'); 
    btns.forEach(b => b.style.display = on ? 'block' : 'none');
}

/* --- 搜索逻辑 --- */
function handleSearch(val) {
    const res = document.getElementById('searchResults');
    if(!val) { res.innerHTML = ''; return; }
    val = val.toLowerCase();
    
    const matchedNews = allNews.filter(n => n.title.toLowerCase().includes(val));
    const matchedMenu = typeof menuData !== 'undefined' ? menuData.filter(m => m.name.toLowerCase().includes(val)) : [];

    let html = '';
    if(matchedMenu.length) {
        html += `<div style="font-weight:bold;margin:10px 0;">功能</div>`;
        html += matchedMenu.map(m => `<div class="action-item" style="flex-direction:row;gap:10px;"><span class="material-symbols-rounded">${m.icon}</span>${m.name}</div>`).join('');
    }
    if(matchedNews.length) {
        html += `<div style="font-weight:bold;margin:10px 0;">新闻</div>`;
        html += matchedNews.map(n => `<a href="news_detail.html?id=${n.id}" style="display:block;padding:8px;border-bottom:1px solid #eee;color:inherit;text-decoration:none;">${n.title}</a>`).join('');
    }
    res.innerHTML = html || '无结果';
}

/* --- 模态框通用 --- */
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function openHistory() {
    openModal('historyModal');
    renderNewsList(allNews, true); // 渲染所有历史
}

function checkNotifications(latest) {
    if(!latest) return;
    if(localStorage.getItem('pref_notify') === 'false') return;
    
    const lastTitle = localStorage.getItem('last_notify_title');
    if(lastTitle !== latest.title) {
        if(Notification.permission === 'granted') {
            new Notification('新动态', { body: latest.title });
            localStorage.setItem('last_notify_title', latest.title);
        } else {
            Notification.requestPermission();
        }
    }
}

function setupEventListeners() {
    // 确保关闭侧边栏
    document.querySelector('.sidebar-overlay').addEventListener('click', toggleSidebar);
}
