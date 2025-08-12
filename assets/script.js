// assets/script.js
let defaultCount = 6; // 初始显示条数
let visibleCount = defaultCount;
let newsData = [];      // 原始数据（每条会带上 _idx）
let currentList = [];   // 当前用于渲染的列表（受搜索影响）
let isExpanded = false; // 是否已展开（针对 currentList）

// 载入并初始化（给每条数据标记原始索引 _idx）
fetch('news_content.json')
  .then(res => {
    if (!res.ok) throw new Error('无法读取 news.json: ' + res.status);
    return res.json();
  })
  .then(raw => {
    // sort by date (降序)，注意 date 字符串格式需要可 new Date() 解析
    raw.sort((a, b) => new Date(b.date) - new Date(a.date));
    newsData = raw.map((it, i) => ({ ...it, _idx: i }));
    currentList = newsData.slice();
    renderNews();
  })
  .catch(err => {
    console.error(err);
    const container = document.getElementById('news-container');
    if (container) container.innerHTML = '<p style="color:red">加载新闻失败，请检查 news.json。</p >';
  });

// 渲染函数：呈现 currentList（受 visibleCount 限制）
function renderNews() {
  const container = document.getElementById('news-container');
  const loadBtn = document.getElementById('load-more');
  if (!container) return;

  container.innerHTML = '';

  // slice 安全处理
  const showList = currentList.slice(0, visibleCount);

  showList.forEach(item => {
    const a = document.createElement('a');
    a.className = 'card';
    // 关键：跳转到统一详情页，通过 id=原始索引 _idx
    a.href = `news-detail.html?id=${item._idx}`;
    a.innerHTML = `
      <img src="${item.image || 'https://via.placeholder.com/600x320?text=No+Image'}" alt="${escapeHtml(item.title || '')}">
      <div class="card-content">
        <h3>${escapeHtml(item.title || '')}</h3>
        <p class="meta">${escapeHtml(item.date || '')} · ${escapeHtml(item.location || '')}</p >
      </div>
    `;
    container.appendChild(a);
  });

  // 控制按钮显示与文字
  if (!loadBtn) return;
  if (currentList.length <= defaultCount) {
    loadBtn.style.display = 'none';
  } else {
    loadBtn.style.display = 'inline-block';
    loadBtn.textContent = isExpanded ? '收起' : '查看更多';
  }
}

// 展开/收起行为（针对 currentList）
const btn = document.getElementById('load-more');
if (btn) {
  btn.addEventListener('click', () => {
    if (!isExpanded) {
      visibleCount = currentList.length;
      isExpanded = true;
    } else {
      visibleCount = defaultCount;
      isExpanded = false;
      // 在收起时，若当前搜索结果小于 defaultCount，也保持一致
      if (currentList.length < visibleCount) visibleCount = currentList.length;
    }
    renderNews();
    // 平滑滚动回到列表顶部（用户体验）
    document.getElementById('news-container').scrollIntoView({ behavior: 'smooth' });
  });
}

// 搜索：会改变 currentList，并收起（恢复默认显示）
const searchInput = document.getElementById('search');
if (searchInput) {
  searchInput.addEventListener('input', () => {
    const key = searchInput.value.trim().toLowerCase();
    if (key === '') {
      currentList = newsData.slice();
    } else {
      currentList = newsData.filter(item =>
        (item.title || '').toLowerCase().includes(key) ||
        (item.content || '').toLowerCase().includes(key) ||
        (item.location || '').toLowerCase().includes(key) ||
        (item.author || '').toLowerCase().includes(key)
      );
    }
    // 重置展开状态（搜索后默认收起）
    isExpanded = false;
    visibleCount = Math.min(defaultCount, currentList.length);
    renderNews();
  });
}

// 小工具：防止 XSS（对显示文本做最小转义）
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
