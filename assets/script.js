/* script.js */// assets/script.js

let newsData = [];
let headlineMode = localStorage.getItem('headlineMode') || 'news'; // 'news' or 'brand'

// 初始化数据
async function init() {
    try {
        const response = await fetch('data/news_content.json');
        const rawData = await response.json();
        
        // 自动生成 ID (按顺序)
        newsData = rawData.map((item, index) => ({ ...item, id: index }));
        
        renderHeadline();
        renderNewsList();
    } catch (e) {
        console.error("加载数据失败", e);
    }
}

// 渲染头条
function renderHeadline(specifiedId = null) {
    const container = document.getElementById('headline-container');
    const headlineNews = specifiedId !== null ? newsData[specifiedId] : newsData[0];

    if (headlineMode === 'brand') {
        container.innerHTML = `
            <div class="headline-card headline-brand">
                <div class="brand-bg-effect"></div>
                <div class="brand-content">
                    <h1>HAOJIN</h1>
                    <p>探索未来的无限可能</p>
                </div>
            </div>`;
    } else {
        container.innerHTML = `
            <div class="headline-card" onclick="location.href='news_detail.html?id=${headlineNews.id}'">
                ${headlineNews.image ? `<img src="${headlineNews.image}">` : `<div style="background:var(--md-sys-color-primary); height:100%"></div>`}
                <div class="headline-info">
                    <h2>${headlineNews.title}</h2>
                    <p>${headlineNews.author} · ${headlineNews.date}</p>
                </div>
            </div>`;
    }
}

// 渲染新闻列表 (排除头条)
function renderNewsList() {
    const list = document.getElementById('news-list');
    // 过滤掉第一条（作为头条的）
    const displayNews = newsData.slice(1, 10); 

    list.innerHTML = displayNews.map(item => `
        <a href="news_detail.html?id=${item.id}" class="news-card ${item.image ? 'has-img' : 'no-img'}">
            <div class="card-txt">
                <div style="font-size:0.8rem; color:var(--md-sys-color-outline)">${item.location}</div>
                <h3 style="margin:8px 0">${item.title}</h3>
                <div style="font-size:0.8rem">${item.date}</div>
            </div>
            ${item.image ? `<img src="${item.image}">` : ''}
        </a>
    `).join('');
}

// 功能菜单折叠
function toggleMenu() {
    const content = document.getElementById('nav-menu');
    const arrow = document.getElementById('menu-arrow');
    content.classList.toggle('expanded');
    arrow.style.transform = content.classList.contains('expanded') ? 'rotate(180deg)' : 'rotate(0)';
}

// 搜索逻辑
function toggleSearch() {
    const modal = document.getElementById('searchModal');
    modal.style.display = (modal.style.display === 'block') ? 'none' : 'block';
}

function handleSearch(query) {
    if(!query) return;
    const results = newsData.filter(n => n.title.includes(query) || n.content.includes(query));
    const resDiv = document.getElementById('search-results');
    resDiv.innerHTML = results.map(r => `<div onclick="location.href='news_detail.html?id=${r.id}'" style="padding:12px; border-bottom:1px solid #eee; cursor:pointer;">${r.title}</div>`).join('');
}

// 设置逻辑 (模式切换)
function toggleSettings() {
    headlineMode = (headlineMode === 'news') ? 'brand' : 'news';
    localStorage.setItem('headlineMode', headlineMode);
    renderHeadline();
}

window.onload = init;
