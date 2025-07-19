fetch("News content.json")
  .then(res => res.json())
  .then(data => {
    const container = document.getElementById("news-container");
    data.forEach(item => {
      const card = document.createElement("a");
      card.className = "card";
      card.href = item.link;

      card.innerHTML = `
        < img src="${item.image}" alt="">
        <div class="card-content">
          <div class="card-title">${item.title}</div>
          <div class="card-meta">${item.author} ｜ ${item.date}</div>
        </div>
      `;
      container.appendChild(card);
    });
  });
