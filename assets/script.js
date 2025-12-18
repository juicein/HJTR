/* assets/script.js */

let globalNewsData = [];
let currentHeroMode = 'news'; // 'news' or 'brand'
let heroOverrideId = null; // 指定头条ID，null则默认第一条

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 获取并处理数据
    await fetchNewsData();
    
    // 2. 初始化页面组件
    renderMenu();
    renderNewsList(globalNewsData); // 默认渲染所有
    updateHeroSection();
    
    // 3. 绑定事件
    setupEventListeners();
});

async function fetchNewsData() {
    try {
        const response = await fetch('../news_content.json');
        const rawData = await response.json();
        
        // 自动生成 ID 并添加索引
        globalNewsData = rawData.map((item, index) => ({
            ...item,
            id: index, 
            // 如果 JSON 中日期不带年份，这里简单补全用于归档逻辑（假设当前年）
            fullDate: parseDate(item.date) 
        }));
    } catch (error) {
        console.error("Failed to load news data:", error);
    }
}

// 简单的日期解析，假设数据格式为 "12-14 14:21"
function parseDate(dateStr) {
    const now = new Date();
    const year = now.getFullYear();
    // 简单的正则匹配 MM-DD
    const match = dateStr.match(/(\d{1,2})[-/](\d{1,2})/); 
    if (match) {
        return new Date(year, parseInt(match[1])-1, parseInt(match[2]));
    }
    return now; // 默认
}

// --- 渲染逻辑 ---

function renderMenu() {
    const grid = document.getElementById('menu-grid');
    const toggleBtn = document.getElementById('menu-toggle-icon');
    const container = document.querySelector('.menu-container');
    let isExpanded = true;

    // 渲染图标
    grid.innerHTML = MENU_ITEMS.map(item => `
        <div class="menu-item" onclick="window.location.href='${item.link}'">
            <span class="material-symbols-outlined">${item.icon}</span>
            <p>${item.name}</p>
        </div>
    `).join('');

    // 折叠逻辑
    document.querySelector('.menu-header').addEventListener('click', () => {
        isExpanded = !isExpanded;
        if(isExpanded) {
            grid.style.display = 'grid';
            toggleBtn.style.transform = 'rotate(0deg)';
        } else {
            grid.style.display = 'none';
            toggleBtn.style.transform = 'rotate(180deg)';
        }
    });
}

function renderNewsList(data) {
    const list = document.getElementById('news-list');
    
    // 过滤掉当前作为头条显示的新闻（如果是新闻模式且未指定）
    // 简化逻辑：这里全部渲染列表，但在CSS中控制? 或者仅仅渲染列表
    // 根据需求：主页新闻显示近期几个。
    const recentNews = data.slice(0, 10); 

    list.innerHTML = recentNews.map(news => {
        const hasImage = news.image && news.image !== "";
        const imageHtml = hasImage ? `<img src="${news.image}" class="nc-img" alt="${news.title}" loading="lazy">` : '';
        const textOnlyClass = hasImage ? '' : 'text-only';
        
        return `
        <a href="news_detail.html?id=${news.id}" class="news-card ${textOnlyClass}">
            <div class="nc-content">
                <div class="nc-title">${news.title}</div>
                <div class="nc-meta">
                    <span>${news.author}</span>
                    <span>•</span>
                    <span>${news.date}</span>
                </div>
            </div>
            ${imageHtml}
        </a>
        `;
    }).join('');
}

function updateHeroSection() {
    const heroContainer = document.getElementById('hero-section');
    
    if (currentHeroMode === 'brand') {
        // 模式2：企业展示
        heroContainer.innerHTML = `
            <div class="hero-card hero-brand">
                <div class="brand-logo">HAOJIN</div>
                <div class="brand-sub">CONNECTING THE FUTURE</div>
            </div>
        `;
    } else {
        // 模式1：新闻头条
        // 默认第一条，或者指定ID
        const heroNews = heroOverrideId !== null 
            ? globalNewsData.find(n => n.id === heroOverrideId) 
            : globalNewsData[0];
            
        if (!heroNews) return;

        const bgImage = heroNews.image || 'assets/default_hero.jpg'; // 需要一个默认图
        
        heroContainer.innerHTML = `
            <div class="hero-card hero-news" onclick="window.location.href='news_detail.html?id=${heroNews.id}'">
                <img src="${bgImage}" class="hero-img" alt="Hero">
                <div class="hero-content">
                    <div class="hero-tag">HEADLINE</div>
                    <div class="hero-title">${heroNews.title}</div>
                    <div style="font-size: 14px; opacity: 0.9; margin-top:8px">${heroNews.date}</div>
                </div>
            </div>
        `;
    }
}

// --- 搜索与设置逻辑 ---

function setupEventListeners() {
    const searchDialog = document.getElementById('search-dialog');
    const settingsDialog = document.getElementById('settings-dialog');
    
    // 打开搜索
    document.getElementById('btn-search').addEventListener('click', () => {
        searchDialog.showModal();
    });
    
    // 打开设置
    document.getElementById('btn-settings').addEventListener('click', () => {
        settingsDialog.showModal();
    });

    // 搜索输入监听
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        if(val.length < 1) {
            searchResults.style.display = 'none';
            return;
        }
        
        // 搜索菜单 + 新闻
        const matchedMenu = MENU_ITEMS.filter(m => m.name.includes(val));
        const matchedNews = globalNewsData.filter(n => n.title.toLowerCase().includes(val));
        
        let html = '';
        matchedMenu.forEach(m => {
            html += `<div class="search-item" onclick="window.location.href='${m.link}'">Functional: ${m.name}</div>`;
        });
        matchedNews.forEach(n => {
            html += `<div class="search-item" onclick="window.location.href='news_detail.html?id=${n.id}'">News: ${n.title}</div>`;
        });
        
        searchResults.innerHTML = html || '<div class="search-item">No results</div>';
        searchResults.style.display = 'block';
    });

    // 设置：切换模式
    document.getElementById('mode-switch').addEventListener('change', (e) => {
        currentHeroMode = e.target.value;
        updateHeroSection();
    });

    // 设置：查档 (按年份/季度) - 这是一个简单演示
    document.getElementById('archive-select').addEventListener('change', (e) => {
        const val = e.target.value; // "2025-Q4"
        if(val === 'all') {
            renderNewsList(globalNewsData);
        } else {
            // 解析逻辑: 假设 val 是 "2025" (只按年演示)
            // 实际项目需更复杂的 Date Quarter 运算
            const filtered = globalNewsData.filter(n => n.fullDate.getFullYear().toString() === val);
            renderNewsList(filtered);
            settingsDialog.close();
        }
    });
}
