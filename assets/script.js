let defaultCount = 6; // 初始显示条数
let visibleCount = defaultCount;
let newsData = [];
let isExpanded = false; // 是否已展开

fetch('news_content.json')
  .then(res => res.json())
  .then(news => {
    news.sort((a, b) => new Date(b.date) - new Date(a.date));
    newsData = news;
    renderNews();
  });

function renderNews() {
  const container = document.getElementById('news-container');
  container.innerHTML = '';
  newsData.slice(0, visibleCount).forEach((item, index) => {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = `news-detail/${index}.html`; // 跳转到对应详情页
    card.innerHTML = `
      <img src="${item.image}" alt="${item.title}">
      <div class="card-content">
        <h3>${item.title}</h3>
        <p>${item.date} · ${item.location}</p >
      </div>
    `;
    container.appendChild(card);
  });

  // 按钮文字切换
  const btn = document.getElementById('load-more');
  if (!isExpanded && visibleCount >= newsData.length) {
    btn.textContent = '收起';
    isExpanded = true;
  } else if (isExpanded && visibleCount >= newsData.length) {
    btn.textContent = '收起';
  } else {
    btn.textContent = '查看更多';
  }
}

document.getElementById('load-more').addEventListener('click', () => {
  if (isExpanded) {
    // 收起
    visibleCount = defaultCount;
    isExpanded = false;
  } else {
    // 展开
    visibleCount = newsData.length;
    isExpanded = true;
  }
  renderNews();
});

// 搜索功能
document.getElementById('search').addEventListener('input', function () {
  const keyword = this.value.toLowerCase();
  const filtered = newsData.filter(item =>
    item.title.toLowerCase().includes(keyword) ||
    item.content.toLowerCase().includes(keyword) ||
    item.location.toLowerCase().includes(keyword)
  );
  const container = document.getElementById('news-container');
  container.innerHTML = '';
  filtered.slice(0, visibleCount).forEach((item, index) => {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = `news/${index}.html`;
    card.innerHTML = `
      <img src="${item.image}" alt="${item.title}">
      <div class="card-content">
        <h3>${item.title}</h3>
        <p>${item.date} · ${item.location}</p >
      </div>
    `;
    container.appendChild(card);
  });
});
