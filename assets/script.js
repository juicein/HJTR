document.addEventListener('DOMContentLoaded', () => {
    // === 状态与DOM元素 ===
    let newsData = [];
    let settings = JSON.parse(localStorage.getItem('user_settings')) || {
        enableAurora: false,
        locationFilter: 'all',
        enableNotifications: true,
        showAppDownload: true
    };

    const els = {
        aurora: document.querySelector('.aurora-bg'),
        newsList: document.getElementById('news-list'),
        heroTrack: document.getElementById('hero-track'),
        heroProgress: document.getElementById('hero-progress'),
        quickGrid: document.getElementById('quick-grid'),
        sidebar: document.getElementById('sidebar'),
        sidebarOverlay: document.getElementById('sidebar-overlay'),
        dialogSearch: document.getElementById('dialog-search'),
        dialogSettings: document.getElementById('dialog-settings'),
        dialogHistory: document.getElementById('dialog-history'),
        appCard: document.getElementById('app-download-card'),
        locationSelect: document.getElementById('setting-location')
    };

    // === 初始化 ===
    init();

    async function init() {
        await loadData();
        applySettings();
        renderSidebar();
        renderQuickActions();
        processAndRenderNews();
        setupEventListeners();
        checkNotifications();
    }

    // === 1. 数据处理 ===
    async function loadData() {
        try {
            const response = await fetch('data/news_content.json');
            const rawData = await response.json();
            
            // 自动生成ID：使用索引 (生产环境建议用hash)
            newsData = rawData.map((item, index) => ({
                ...item,
                id: index, // 自动生成ID
                timestamp: parseDate(item.date) // 解析时间方便排序
            }));

            // 填充 Location 选项
            const locations = [...new Set(newsData.map(item => item.location))];
            locations.forEach(loc => {
                const opt = document.createElement('option');
                opt.value = loc;
                opt.innerText = loc;
                els.locationSelect.appendChild(opt);
            });
            els.locationSelect.value = settings.locationFilter;

        } catch (e) {
            console.error("Data load failed", e);
            els.newsList.innerHTML = `<div style="padding:20px; text-align:center">数据加载失败</div>`;
        }
    }

    function parseDate(dateStr) {
        // 假设格式为 "MM-DD HH:mm", 补全年份为当前年份或根据逻辑推断
        const now = new Date();
        const [datePart, timePart] = dateStr.split(' ');
        const [month, day] = datePart.split('-');
        return new Date(now.getFullYear(), month - 1, day, ...timePart.split(':'));
    }

    // === 2. 核心渲染逻辑 ===
    function processAndRenderNews() {
        // 1. 过滤地区
        let filtered = settings.locationFilter === 'all' 
            ? newsData 
            : newsData.filter(n => n.location === settings.locationFilter);

        // 2. 区分头条与列表
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        // 头条逻辑：最近一周的前4条。如果不足1条，则强制取最新1条。
        let heroItems = filtered.filter(n => n.timestamp > oneWeekAgo);
        heroItems.sort((a, b) => b.timestamp - a.timestamp);
        
        if (heroItems.length === 0 && filtered.length > 0) {
            heroItems = [filtered[0]]; // 强制一条
        } else {
            heroItems = heroItems.slice(0, 4);
        }

        // 渲染头条
        renderHero(heroItems);

        // 列表逻辑：排除头条后的数据，取前7条显示在主页
        const heroIds = new Set(heroItems.map(h => h.id));
        const listItems = filtered.filter(n => !heroIds.has(n.id));
        
        // 主页显示前 7 条
        const homeList = listItems.slice(0, 7);
        renderNewsList(homeList, els.newsList);

        // 历史记录逻辑：所有数据（或者剩余数据）
        renderNewsList(listItems, document.getElementById('history-list'));
    }

    function renderHero(items) {
        els.heroTrack.innerHTML = '';
        if (items.length === 0) {
            els.heroTrack.innerHTML = '<div class="hero-card" style="background:#ddd; color:#333; justify-content:center; align-items:center">暂无头条</div>';
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'hero-card';
            // 使用图片或默认渐变
            card.style.backgroundImage = item.image ? `url(${item.image})` : `linear-gradient(45deg, var(--md-sys-color-primary), #000)`;
            
            // 截取3行内容在CSS中完成 (-webkit-line-clamp)
            card.innerHTML = `
                <div class="hero-content">
                    <span class="hero-tag">头条</span>
                    <div class="hero-title">${item.title}</div>
                    <div class="hero-desc">${item.content}</div>
                </div>
            `;
            // 点击跳转
            card.onclick = () => window.location.href = `news_detail.html?id=${item.id}`;
            els.heroTrack.appendChild(card);
        });

        // 进度条逻辑
        if (items.length > 1) {
            els.heroProgress.style.display = 'block';
            els.heroTrack.onscroll = () => {
                const scrollLeft = els.heroTrack.scrollLeft;
                const maxScroll = els.heroTrack.scrollWidth - els.heroTrack.clientWidth;
                const percent = (scrollLeft / maxScroll) * 100;
                document.querySelector('.progress-fill').style.width = `${percent}%`;
            };
        } else {
            els.heroProgress.style.display = 'none';
        }
    }

    function renderNewsList(items, container) {
        container.innerHTML = '';
        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'news-card';
            
            const hasImg = item.image && item.image !== "";
            
            card.innerHTML = `
                ${hasImg ? `<img src="${item.image}" class="news-thumb" alt="news">` : ''}
                <div class="news-info">
                    <div>
                        <div class="news-title">${item.title}</div>
                        <div style="font-size:14px; color:var(--md-sys-color-outline); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${item.content}</div>
                    </div>
                    <div class="news-meta">
                        <span class="location-tag">${item.location}</span>
                        <span>${item.author}</span>
                        <span>${item.date}</span>
                    </div>
                </div>
            `;
            card.onclick = () => window.location.href = `news_detail.html?id=${item.id}`;
            container.appendChild(card);
        });
    }

    // === 3. 菜单与侧边栏 ===
    function renderQuickActions() {
        if (typeof menuData === 'undefined') return;
        els.quickGrid.innerHTML = '';
        menuData.quickActions.forEach(action => {
            const item = document.createElement('a');
            item.className = 'action-item';
            item.href = action.link;
            item.innerHTML = `
                <div class="action-icon"><span class="material-icons">${action.icon}</span></div>
                <span>${action.title}</span>
            `;
            els.quickGrid.appendChild(item);
        });
    }

    function renderSidebar() {
        if (typeof menuData === 'undefined') return;
        const container = els.sidebar;
        // 清空旧的 nav-items 但保留 Logo位置（如果有）
        // 这里简单直接追加
        menuData.sidebar.forEach(item => {
            const el = document.createElement('a');
            el.className = 'nav-item';
            el.href = item.link;
            el.innerHTML = `<span class="material-icons">${item.icon}</span>${item.title}`;
            container.appendChild(el);
        });
    }

    // === 4. 设置与交互 ===
    function applySettings() {
        // 背景动画
        if (settings.enableAurora) els.aurora.classList.add('active');
        else els.aurora.classList.remove('active');
        document.getElementById('switch-bg').checked = settings.enableAurora;

        // App下载卡片
        els.appCard.classList.toggle('show', settings.showAppDownload);
        document.getElementById('switch-app').checked = settings.showAppDownload;

        // 通知开关UI
        document.getElementById('switch-notify').checked = settings.enableNotifications;
    }

    function saveSettings() {
        localStorage.setItem('user_settings', JSON.stringify(settings));
        applySettings();
        processAndRenderNews(); // 重新渲染以应用地区过滤
    }

    // 事件监听
    function setupEventListeners() {
        // 侧边栏
        document.getElementById('btn-menu').onclick = () => {
            els.sidebar.classList.add('open');
            els.sidebarOverlay.classList.add('open');
        };
        els.sidebarOverlay.onclick = () => {
            els.sidebar.classList.remove('open');
            els.sidebarOverlay.classList.remove('open');
        };

        // 快捷功能展开/收起
        document.getElementById('btn-expand-quick').onclick = (e) => {
            els.quickGrid.classList.toggle('expanded');
            const icon = e.currentTarget.querySelector('.material-icons');
            icon.innerText = els.quickGrid.classList.contains('expanded') ? 'expand_less' : 'expand_more';
        };

        // 搜索
        document.getElementById('btn-search').onclick = () => els.dialogSearch.showModal();
        document.getElementById('search-input').oninput = handleSearch;

        // 设置
        document.getElementById('btn-settings').onclick = () => els.dialogSettings.showModal();
        
        document.getElementById('switch-bg').onchange = (e) => {
            settings.enableAurora = e.target.checked;
            saveSettings();
        };
        document.getElementById('switch-app').onchange = (e) => {
            settings.showAppDownload = e.target.checked;
            saveSettings();
        };
        document.getElementById('switch-notify').onchange = (e) => {
            settings.enableNotifications = e.target.checked;
            saveSettings();
            if(settings.enableNotifications) Notification.requestPermission();
        };
        els.locationSelect.onchange = (e) => {
            settings.locationFilter = e.target.value;
            saveSettings();
        };

        // 历史记录
        document.getElementById('btn-history').onclick = () => els.dialogHistory.showModal();

        // 关闭 Dialog (点击backdrop)
        document.querySelectorAll('dialog').forEach(d => {
            d.onclick = (e) => { if (e.target === d) d.close(); };
        });
    }

    function handleSearch(e) {
        const val = e.target.value.toLowerCase();
        const resContainer = document.getElementById('search-results');
        resContainer.innerHTML = '';
        
        if (!val) return;

        // 搜新闻
        const matchedNews = newsData.filter(n => n.title.toLowerCase().includes(val) || n.content.toLowerCase().includes(val));
        // 搜菜单
        const matchedMenu = menuData.quickActions.filter(m => m.title.toLowerCase().includes(val));

        matchedMenu.forEach(m => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = `<span class="material-icons">star</span> ${m.title}`;
            div.onclick = () => window.location.href = m.link;
            resContainer.appendChild(div);
        });

        matchedNews.forEach(n => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = `<span class="material-icons">article</span> ${n.title}`;
            div.onclick = () => window.location.href = `news_detail.html?id=${n.id}`;
            resContainer.appendChild(div);
        });
    }

    // === 5. 通知系统 (静态模拟) ===
    function checkNotifications() {
        if (!settings.enableNotifications || !("Notification" in window)) return;
        
        // 获取最新的新闻
        const latestNews = newsData[0]; // 假设json已按时间排序或第一个是最新的
        const lastNotifiedId = localStorage.getItem('last_notified_id');

        // 如果 ID 不同，说明有更新
        if (latestNews && String(latestNews.id) !== lastNotifiedId) {
            // 请求权限并发送
            if (Notification.permission === "granted") {
                new Notification(latestNews.title, {
                    body: latestNews.content,
                    icon: "assets/logo.png"
                });
                localStorage.setItem('last_notified_id', latestNews.id);
            } else if (Notification.permission !== "denied") {
                Notification.requestPermission().then(permission => {
                    if (permission === "granted") {
                        // 递归调用一次
                        checkNotifications(); 
                    }
                });
            }
        }
    }
});
