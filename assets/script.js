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
  })
  .catch(() => {
    const container = document.getElementById('news-container');
    container.innerHTML = '<p style="color:red;">新闻加载失败，请刷新重试</p >';
  });

function renderNews() {
  const container = document.getElementById('news-container');
  container.innerHTML = '';
  newsData.slice(0, visibleCount).forEach((item, index) => {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = `news-detail.html?id=${index}`; // 跳转到统一详情页模板
    card.innerHTML = `
      <img src="${item.image}" alt="${item.title}" />
      <div class="card-content">
        <h3>${item.title}</h3>
        <p>${item.date} · ${item.location}</p >
      </div>
    `;
    container.appendChild(card);
  });

  const btn = document.getElementById('load-more');
  if (isExpanded) {
    btn.textContent = '收起';
  } else {
    btn.textContent = '查看更多';
  }

  // 当新闻条数不足，隐藏按钮
  btn.style.display = (newsData.length <= defaultCount) ? 'none' : 'inline-block';
}

document.getElementById('load-more').addEventListener('click', () => {
  if (isExpanded) {
    visibleCount = defaultCount;
    isExpanded = false;
  } else {
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
    card.href = `news-detail.html?id=${newsData.indexOf(item)}`; // 保证跳转正确ID
    card.innerHTML = `
      <img src="${item.image}" alt="${item.title}" />
      <div class="card-content">
        <h3>${item.title}</h3>
        <p>${item.date} · ${item.location}</p >
      </div>
    `;
    container.appendChild(card);
  });

  // 搜索时也要控制“查看更多”按钮显示与文字
  const btn = document.getElementById('load-more');
  if (isExpanded) {
    btn.textContent = '收起';
  } else {
    btn.textContent = '查看更多';
  }
  btn.style.display = (filtered.length <= defaultCount) ? 'none' : 'inline-block';
});
