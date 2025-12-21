/* assets/script.js */
let newsData = [];
let config = JSON.parse(localStorage.getItem('hj_v3_cfg')) || {
    bgAnim: true,
    notif: true,
    location: "全部"
};

const SIDEBAR_MENU = [
    { name: "主页概览", icon: "dashboard", link: "index.html" },
    { name: "官方下载", icon: "download", link: "#" },
    { name: "地区资讯", icon: "map", link: "#" }
];

async function init() {
    try {
        const res = await fetch('../news_content.json');
        const raw = await res.json();
        // 关键：自动分配原始索引作为 ID
        newsData = raw.map((item, index) => ({ ...item, id: index }));
        
        applyConfig();
        renderSidebar();
        renderHeadlines();
        renderFunctions(false);
        renderRecentNews();
        populateLocationSelector();
    } catch (e) {
        console.error("加载失败:", e);
    }
}

// --- 1. 头条逻辑：最近7天或最新1条 ---
function renderHeadlines() {
    const track = document.getElementById('hero-track');
    const now = new Date();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    
    let headlines = newsData.filter(n => (now - new Date("2025-" + n.date.split(' ')[0])) < oneWeek);
    if (headlines.length === 0) headlines = [newsData[0]];
    headlines = headlines.slice(0, 4);

    track.innerHTML = headlines.map(n => `
        <div class="hero-slide" onclick="location.href='news_detail.html?id=${n.id}'">
            <img src="${n.image || 'https://via.placeholder.com/800x400'}">
            <div class="hero-overlay">
                <div class="loc-tag">${n.location}</div>
                <h2 style="margin:8px 0">${n.title}</h2>
                <p style="opacity:0.8; display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${n.content}</p>
            </div>
        </div>
    `).join('');

    renderProgressDots(headlines.length);
}

// 滑动切换
let currentHero = 0;
function moveHero(dir) {
    const slides = document.querySelectorAll('.hero-slide');
    currentHero = (currentHero + dir + slides.length) % slides.length;
    document.getElementById('hero-track').style.transform = `translateX(-${currentHero * 100}%)`;
    updateDots();
}

// --- 2. 搜索逻辑 ---
function handleSearch(val) {
    const results = newsData.filter(n => n.title.includes(val) || n.content.includes(val));
    const container = document.getElementById('search-results');
    container.innerHTML = results.map(n => `
        <div class="news-card" onclick="location.href='news_detail.html?id=${n.id}'">
            <div style="flex:1">
                <b>${n.title}</b>
                <p style="font-size:12px; margin-top:4px">${n.date}</p>
            </div>
        </div>
    `).join('');
}

// --- 3. 设置与持久化 ---
function updateSetting(key, val) {
    config[key] = val;
    localStorage.setItem('hj_v3_cfg', JSON.stringify(config));
    applyConfig();
}

function applyConfig() {
    document.getElementById('bg-anim-wrap').style.display = config.bgAnim ? 'block' : 'none';
    if(config.notif) console.log("通知系统已就绪");
    renderRecentNews(); 
}

// 初始化
window.onload = init;
