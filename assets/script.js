document.addEventListener('DOMContentLoaded', init);

let globalData = [];
let userSettings = {
  bgAnim: true,
  notifications: true,
  appCard: true,
  locationFilter: 'all'
};

async function init() {
  loadSettings();
  await fetchData();
  
  // Render Static/Menu items
  renderSidebar();
  renderQuickActions(false); // Default collapsed
  
  // Event Listeners
  setupInteractions();
  setupBackground();
  
  // Responsive Check
  handleResize();
  window.addEventListener('resize', handleResize);
}

/* --- Data Handling --- */
async function fetchData() {
  try {
    const response = await fetch('data/news_content.json');
    const rawData = await response.json();
    
    // Add IDs and Process Data
    globalData = rawData.map((item, index) => ({
      ...item,
      id: index, // Simple index-based ID as requested (Auto generated)
      timestamp: parseDate(item.date)
    }));

    // Check for Notifications (Simulated)
    checkNotifications(globalData);

    // Initial Render
    filterAndRender();
    populateLocationSelect();

  } catch (e) {
    console.error("Data load failed", e);
    document.getElementById('news-list').innerHTML = '<div style="padding:20px; text-align:center">加载失败</div>';
  }
}

function parseDate(dateStr) {
  // Assuming format "MM-DD HH:mm", adding current year for sorting
  const year = new Date().getFullYear();
  return new Date(`${year}-${dateStr.replace(' ', 'T')}`).getTime();
}

function filterAndRender() {
  let filtered = globalData;
  
  // Location Filter
  if (userSettings.locationFilter !== 'all') {
    filtered = filtered.filter(item => item.location === userSettings.locationFilter);
  }

  // Headlines Logic: Newest 4 within 7 days, OR just the latest 1
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  let headlines = filtered.filter(item => item.timestamp > sevenDaysAgo);
  
  // Sort by date desc
  headlines.sort((a, b) => b.timestamp - a.timestamp);
  
  if (headlines.length === 0 && filtered.length > 0) {
    headlines = [filtered[0]]; // Fallback to latest
  }
  headlines = headlines.slice(0, 4); // Max 4

  renderHeadlines(headlines);
  renderNewsList(filtered.slice(0, 7), 'news-list'); // Main list max 7
  renderNewsList(filtered, 'history-list'); // History list all
}

/* --- Rendering Functions --- */
function renderHeadlines(items) {
  const track = document.getElementById('headline-track');
  const dots = document.getElementById('carousel-dots');
  
  if(!items.length) {
    track.parentElement.style.display = 'none';
    return;
  }
  track.parentElement.style.display = 'block';

  track.innerHTML = items.map(item => `
    <div class="headline-card" onclick="location.href='news_detail.html?id=${item.id}'" 
         style="background-image: url('${item.image || 'assets/default_bg.jpg'}')">
      <div class="headline-content">
        <div class="headline-tag">${item.location}</div>
        <div class="headline-title">${item.title}</div>
        <div class="headline-desc" style="color:rgba(255,255,255,0.9);">${item.content}</div>
      </div>
    </div>
  `).join('');

  // Dots logic
  if(items.length > 1) {
    dots.innerHTML = items.map((_, i) => `<div class="dot ${i===0?'active':''}"></div>`).join('');
    // Simple Scroll spy
    track.addEventListener('scroll', () => {
      const index = Math.round(track.scrollLeft / track.clientWidth);
      Array.from(dots.children).forEach((d, i) => d.classList.toggle('active', i === index));
    });
  } else {
    dots.innerHTML = '';
  }
}

function renderQuickActions(expanded) {
  const container = document.getElementById('qa-container');
  const items = expanded ? menuData.quickActions : menuData.quickActions.slice(0, 4);
  
  container.innerHTML = items.map(item => `
    <div class="qa-item" onclick="${item.action ? item.action + '()' : `location.href='${item.link}'`}">
      <div class="qa-icon-box">
        <span class="material-symbols-outlined">${item.icon}</span>
      </div>
      <div class="qa-text">${item.text}</div>
    </div>
  `).join('');
  
  // Set height animation
  const card = document.getElementById('quick-actions-card');
  // Auto height trick: quick calculation approx
  card.style.height = expanded ? 'auto' : ''; // CSS handles transition? Better to use fixed heights for smooth anim, but auto works for simple
}

function renderNewsList(items, elementId) {
  const container = document.getElementById(elementId);
  container.innerHTML = items.map(item => {
    const hasImg = item.image && item.image.length > 0;
    return `
    <div class="news-card" onclick="location.href='news_detail.html?id=${item.id}'">
      ${hasImg ? `<img src="${item.image}" class="news-img" loading="lazy">` : ''}
      <div class="news-body">
        <div>
          <div class="news-title">${item.title}</div>
          <div style="font-size:13px; opacity:0.8; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">
            ${item.content}
          </div>
        </div>
        <div class="news-meta">
          <span class="location-tag">${item.location}</span>
          <span>${item.date}</span>
          <span style="margin-left:auto">${item.author}</span>
        </div>
      </div>
    </div>
  `}).join('');
}

function renderSidebar() {
  const sidebar = document.getElementById('sidebar-content');
  sidebar.innerHTML = menuData.sidebar.map(item => `
    <a href="${item.link || 'javascript:void(0)'}" class="nav-item" 
       onclick="${item.action ? item.action + '()' : ''}">
      <span class="material-symbols-outlined">${item.icon}</span>
      ${item.text}
    </a>
  `).join('');
}

/* --- Search Logic --- */
function handleSearch(query) {
  const resContainer = document.getElementById('search-results');
  if(!query) { resContainer.innerHTML = ''; return; }
  
  query = query.toLowerCase();
  
  // Search News
  const newsMatches = globalData.filter(i => i.title.includes(query) || i.content.includes(query));
  // Search Menu
  const menuMatches = [...menuData.sidebar, ...menuData.quickActions].filter(i => i.text.toLowerCase().includes(query));
  
  let html = '';
  
  if(menuMatches.length) {
    html += `<div style="font-size:12px; opacity:0.6; margin:8px 0;">功能</div>`;
    html += menuMatches.map(i => `
      <div class="nav-item" onclick="${i.action ? i.action + '()' : `location.href='${i.link}'`}">
        <span class="material-symbols-outlined">${i.icon}</span>${i.text}
      </div>`).join('');
  }
  
  if(newsMatches.length) {
    html += `<div style="font-size:12px; opacity:0.6; margin:16px 0 8px 0;">新闻</div>`;
    html += newsMatches.map(i => `
      <div class="news-card" style="margin-bottom:8px" onclick="location.href='news_detail.html?id=${i.id}'">
        <div class="news-body"><div class="news-title">${i.title}</div></div>
      </div>`).join('');
  }
  
  if(!html) html = '<div style="text-align:center; padding:20px; opacity:0.5">未找到结果</div>';
  resContainer.innerHTML = html;
}

/* --- Interaction & Settings --- */
function setupInteractions() {
  // Sidebar
  document.getElementById('menu-btn').onclick = () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
  };
  document.getElementById('sidebar-overlay').onclick = () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  };

  // Quick Actions Toggle
  const qaToggle = document.getElementById('qa-toggle');
  let qaExpanded = false;
  qaToggle.onclick = () => {
    qaExpanded = !qaExpanded;
    renderQuickActions(qaExpanded);
    qaToggle.style.transform = qaExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
  };

  // Search
  const sModal = document.getElementById('search-modal');
  document.getElementById('search-btn').onclick = () => sModal.classList.add('open');
  sModal.onclick = (e) => { if(e.target === sModal) sModal.classList.remove('open'); };
  document.getElementById('global-search').addEventListener('input', (e) => handleSearch(e.target.value));

  // Settings
  const setModal = document.getElementById('settings-modal');
  document.getElementById('settings-btn').onclick = () => setModal.classList.add('open');
  setModal.onclick = (e) => { if(e.target === setModal) setModal.classList.remove('open'); };

  // History
  const hModal = document.getElementById('history-modal');
  document.getElementById('history-btn').onclick = () => hModal.classList.add('open');
  hModal.onclick = (e) => { if(e.target === hModal) hModal.classList.remove('open'); };

  // Switches
  setupSwitch('sw-bg', 'bgAnim', setupBackground);
  setupSwitch('sw-notif', 'notifications');
  setupSwitch('sw-app', 'appCard', () => {
    document.getElementById('app-dl-card').style.display = userSettings.appCard ? 'flex' : 'none';
  });
  
  // Location Select
  const locSel = document.getElementById('loc-select');
  locSel.onchange = (e) => {
    userSettings.locationFilter = e.target.value;
    saveSettings();
    filterAndRender();
  };
}

function setupSwitch(id, key, callback) {
  const el = document.getElementById(id);
  // Set initial state
  if(userSettings[key]) el.classList.add('active'); else el.classList.remove('active');
  
  el.onclick = () => {
    userSettings[key] = !userSettings[key];
    el.classList.toggle('active', userSettings[key]);
    saveSettings();
    if(callback) callback();
  };
}

function loadSettings() {
  const saved = localStorage.getItem('wf_settings');
  if(saved) userSettings = { ...userSettings, ...JSON.parse(saved) };
  
  // Apply immediate effects
  if(!userSettings.appCard) document.getElementById('app-dl-card').style.display = 'none';
}

function saveSettings() {
  localStorage.setItem('wf_settings', JSON.stringify(userSettings));
}

function setupBackground() {
  const bg = document.getElementById('fluid-bg');
  if(userSettings.bgAnim) bg.classList.remove('hidden');
  else bg.classList.add('hidden');
}

function populateLocationSelect() {
  const locs = [...new Set(globalData.map(i => i.location))];
  const sel = document.getElementById('loc-select');
  locs.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.innerText = l;
    if(userSettings.locationFilter === l) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* --- Notifications (Simulated) --- */
function checkNotifications(newData) {
  if(!userSettings.notifications) return;
  
  const lastId = localStorage.getItem('wf_last_notify_id');
  // If we have data and the first item is different from last time
  if(newData.length > 0 && String(newData[0].id) !== lastId) {
    // Trigger notification
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("万方出行通", { body: newData[0].title });
    } else if ("Notification" in window && Notification.permission !== "denied") {
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          new Notification("万方出行通", { body: newData[0].title });
        }
      });
    }
    localStorage.setItem('wf_last_notify_id', String(newData[0].id));
  }
}

// Global exposure for menu actions
window.openHistory = () => document.getElementById('history-modal').classList.add('open');
window.openSettings = () => document.getElementById('settings-modal').classList.add('open');
function handleResize() { /* Optional JS layout adjustments if needed */ }
