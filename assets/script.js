fetch('news_content.json')
  .then(res => res.json())
  .then(news => {
    const container = document.getElementById('news-container');
    news.sort((a, b) => new Date(b.date) - new Date(a.date));

    container.innerHTML = '';
    news.forEach((item, index) => {
      const html = `
        <a href="news-detail.html?id=${index}" class="card">
          <img src="${item.image}" alt="${item.title}">
          <div class="card-content">
            <h3>${item.title}</h3>
            <p class="meta">${item.date} · ${item.location}</p>
            <p class="summary">${item.content.slice(0, 60)}...</p>
          </div>
        </a>
      `;
      container.innerHTML += html;
    });

    // 搜索功能
    document.getElementById('search').addEventListener('input', function () {
      const key = this.value.toLowerCase();
      const cards = document.querySelectorAll('.card');
      news.forEach((item, i) => {
        const match =
          item.title.toLowerCase().includes(key) ||
          item.content.toLowerCase().includes(key) ||
          item.location.toLowerCase().includes(key);
        cards[i].style.display = match ? 'block' : 'none';
      });
    });
  });






