/* assets/script.js */
let allNews = [];
let carouselIndex = 0;
let config = JSON.parse(localStorage.getItem('hj_settings')) || {
    bgAnim: true,
    locationFilter: "全部",
    notifications: true
};

document.addEventListener('DOMContentLoaded', async () => {
    applySettings();
    await fetchNews();
    renderSidebar();
    renderMenu(false);
    renderHero();
    renderRecentNews();
    initSearch();
});

// 1. 获取并处理数据
async function fetchNews() {
    const res = await fetch('data/news_content.json');
    const data = await res.json();
    allNews = data.map((n, i) => ({ ...n, id: i })); // 自动ID
}

// 2. 渲染近期动态 (限7条)
function renderRecentNews() {
    const container = document.getElementById('recent-list');
    let filtered = allNews;
    if (config.locationFilter !== "全部") {
        filtered = allNews.filter(n => n.location === config.locationFilter);
    }
    const displayList = filtered.slice(0, 7);
    container.innerHTML = displayList.map(n => createNewsCard(n)).join('');
}

function createNewsCard(n) {
    return `
    <a href="news_detail.html?id=${n.id}" class="card">
        ${n.image ? `<img src="${n.image}" style="width:100px; height:80px; border-radius:12px; object-fit:cover;">` : ''}
        <div style="flex:1">
            <span class="loc-badge">${n.location}</span>
            <h3 style="margin:4px 0; font-size:16px;">${n.title}</h3>
            <p style="font-size:12px; opacity:0.7;">${n.date} · ${n.author}</p>
        </div>
    </a>`;
}

// 3. 搜索功能 (全能搜索)
function initSearch() {
    const input = document.getElementById('search-input');
    input.addEventListener('input', (e) => {
        const key = e.target.value.toLowerCase();
        const results = allNews.filter(n => n.title.toLowerCase().includes(key) || n.content.toLowerCase().includes(key));
        const resDiv = document.getElementById('search-results');
        resDiv.innerHTML = results.map(n => `<div onclick="location.href='news_detail.html?id=${n.id}'" style="padding:10px; cursor:pointer; border-bottom:1px solid rgba(0,0,0,0.1)">${n.title}</div>`).join('');
    });
}

// 4. 头条滑动 (带进度栏)
let startX = 0;
function renderHero() {
    const track = document.getElementById('hero-track');
    const headlines = allNews.slice(0, 4); // 默认前4
    track.innerHTML = headlines.map(n => `
        <div class="slide" style="min-width:100%; position:relative;">
            <img src="${n.image || 'https://via.placeholder.com/800x400'}" style="width:100%; height:350px; object-fit:cover;">
            <div style="position:absolute; bottom:0; padding:20px; background:linear-gradient(transparent, rgba(0,0,0,0.8)); color:white; width:100%">
                <h2>${n.title}</h2>
                <p style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${n.content}</p>
            </div>
        </div>
    `).join('');
    
    // 进度条逻辑
    const bar = document.getElementById('hero-progress');
    if (headlines.length <= 1) {
        document.querySelector('.progress-container').style.display = 'none';
    } else {
        bar.style.width = `${(1 / headlines.length) * 100}%`;
    }
}

// 5. 设置逻辑
function applySettings() {
    document.getElementById('fluid-bg').style.display = config.bgAnim ? 'block' : 'none';
    localStorage.setItem('hj_settings', JSON.stringify(config));
    
    // 通知检查 (比对最后一条ID)
    if (config.notifications) {
        const lastId = localStorage.getItem('last_news_id');
        if (allNews.length > 0 && lastId != allNews[0].id) {
            showNotification(allNews[0].title);
            localStorage.setItem('last_news_id', allNews[0].id);
        }
    }
}

function showNotification(title) {
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("浩金新资讯", { body: title });
    }
}
