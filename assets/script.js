// script.js（替换现有文件内容）
let defaultCount = 6; // 初始显示条数
let visibleCount = defaultCount;
let newsData = [];
let isExpanded = false; // 是否已展开

// 读取数据并初始化
fetch('news_content.json')
  .then(res => res.json())
  .then(news => {
    // 按时间倒序（新->旧）
    news.sort((a, b) => new Date(b.date) - new Date(a.date));
    newsData = news;
    renderNews(); // 首次渲染
  })
  .catch(err => {
    console.error('读取 news.json 失败:', err);
  });

/**
 * renderNews(optionalList)
 * - optionalList: 可选的过滤列表（用于搜索）
 * - 渲染时始终把链接指向 news-detail.html?id=<originalIndex>
 */
function renderNews(optionalList) {
  const list = optionalList || newsData;
  const container = document.getElementById('news-container');
  container.innerHTML = '';

  // 切片显示（折叠 / 展开）
  const sliceList = list.slice(0, visibleCount);

  sliceList.forEach(item => {
    // 获取 item 在原始 newsData 中的索引（原始序号）
    const originalIndex = newsData.indexOf(item);
    const card = document.createElement('a');
    card.className = 'card';
    // 关键：改为参数式详情页，避免静态页面/模板不匹配
    card.href = `news-detail.html?id=${originalIndex}`;
    card.innerHTML = `
      <img src="${item.image || 'https://via.placeholder.com/800x450?text=No+Image'}" alt="${escapeHtml(item.title)}">
      <div class="card-content">
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.date)} · ${escapeHtml(item.location || '')}</p >
      </div>
    `;
    container.appendChild(card);
  });

  // 控制按钮显示与文字
  const btn = document.getElementById('load-more');
  if (!btn) return; // 如果页面没有这个按钮，直接返回
  if (newsData.length <= defaultCount) {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'inline-block';
    btn.textContent = isExpanded ? '收起' : '查看更多';
  }
}

// 点击“查看更多 / 收起”
const loadBtn = document.getElementById('load-more');
if (loadBtn) {
  loadBtn.addEventListener('click', () => {
    if (isExpanded) {
      visibleCount = defaultCount;
      isExpanded = false;
    } else {
      visibleCount = newsData.length;
      isExpanded = true;
    }
    // 如果当前有搜索关键字，重新使用搜索结果渲染
    const key = (document.getElementById('search') && document.getElementById('search').value) || '';
    if (key.trim()) {
      doSearchRender(key.trim().toLowerCase());
    } else {
      renderNews();
    }
    // 平滑滚动到顶部（体验更好）
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// 搜索：保持原始索引映射，避免错位
const searchInput = document.getElementById('search');
if (searchInput) {
  searchInput.addEventListener('input', function () {
    const key = this.value.trim().toLowerCase();
    if (!key) {
      // 取消搜索，使用当前折叠状态渲染
      visibleCount = isExpanded ? newsData.length : defaultCount;
      renderNews();
      return;
    }
    doSearchRender(key);
  });
}

function doSearchRender(key) {
  const filtered = newsData.filter(item =>
    (item.title || '').toLowerCase().includes(key) ||
    (item.content || '').toLowerCase().includes(key) ||
    (item.location || '').toLowerCase().includes(key)
  );
  // 如果收起状态，只显示 defaultCount 条（或少于 filtered 长度）
  const prevVisible = visibleCount;
  visibleCount = isExpanded ? filtered.length : Math.min(defaultCount, filtered.length);
  renderNews(filtered);
  // 恢复 visibleCount（renderNews 使用 sliceList 从 filtered 中读取）
  visibleCount = prevVisible;
}

// 简单的 HTML 转义，防止标题中有引号破坏 DOM
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
