async function loadNews() {
  const res = await fetch('news_content.json');
  if (!res.ok) { console.error('news.json 读取失败'); return; }
  const newsList = await res.json();

  newsList.sort((a,b) => new Date(b.date) - new Date(a.date));

  const container = document.getElementById('news-container');
  const searchInput = document.getElementById('search');

  function render(list) {
    container.innerHTML = '';
    list.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'card';
      const imgSrc = item.image || 'https://via.placeholder.com/300x180?text=No+Image';
      card.innerHTML = `
        <img src="${imgSrc}">
        <div class="text">
          <h3>${item.title}</h3>
          <p class="meta">${item.date} · ${item.location}</p>
        </div>
      `;
      card.onclick = () => window.location.href = `news/${idx}.html`;
      container.appendChild(card);
    });
  }

  render(newsList);

  searchInput.addEventListener('input', () => {
    const key = searchInput.value.trim().toLowerCase();
    render(newsList.filter(n =>
      n.title.toLowerCase().includes(key) ||
      n.content.toLowerCase().includes(key) ||
      n.location.toLowerCase().includes(key)
    ));
  });
}

loadNews();
