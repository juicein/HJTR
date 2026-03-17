let feeds = JSON.parse(localStorage.getItem("feeds") || "[]");
let currentTab = "全部";

init();

function init() {
  renderTabs();
  renderFeedList();
  loadFeeds();
}

/* =========================
   📡 加载
========================= */
async function loadFeeds() {
  let all = [];

  for (let f of feeds) {
    try {
      const res = await fetch(
        "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(f.url)
      );
      const data = await res.json();

      data.items.forEach(item => {
        all.push({
          title: item.title,
          content: item.description,
          image: item.thumbnail,
          date: new Date(item.pubDate),
          source: data.feed.title,
          link: item.link,
          category: f.category || "默认"
        });
      });

    } catch (e) {}
  }

  all.sort((a, b) => b.date - a.date);

  window.ALL = all;
  render(all);
}

/* =========================
   📰 渲染
========================= */
function render(list) {
  const feed = document.getElementById("feed");
  feed.innerHTML = "";

  let show = list;

  if (currentTab !== "全部") {
    show = list.filter(i => i.category === currentTab);
  }

  show.forEach(item => {
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      ${item.image ? `<img src="${item.image}" class="cover">` : ""}
      <div class="title">${item.title}</div>
      <div class="meta">${item.source}</div>
    `;

    div.onclick = () => openArticle(item);
    feed.appendChild(div);
  });
}

/* =========================
   📖 详情页
========================= */
function openArticle(item) {
  const el = document.getElementById("article");

  el.innerHTML = `
    <button onclick="closeArticle()">返回</button>
    <h2>${item.title}</h2>
    <p>${item.source} · ${item.date.toLocaleString()}</p>
    ${item.image ? `<img src="${item.image}">` : ""}
    <div>${item.content}</div>
    <br>
    <a href="${item.link}" target="_blank">阅读原文</a>
  `;

  el.classList.remove("hidden");
}

function closeArticle() {
  document.getElementById("article").classList.add("hidden");
}

/* =========================
   📂 分类
========================= */
function renderTabs() {
  const tabs = document.getElementById("tabs");

  let cats = ["全部"];
  feeds.forEach(f => {
    if (f.category && !cats.includes(f.category)) {
      cats.push(f.category);
    }
  });

  tabs.innerHTML = "";

  cats.forEach(c => {
    const div = document.createElement("div");
    div.className = "tab " + (c === currentTab ? "active" : "");
    div.innerText = c;

    div.onclick = () => {
      currentTab = c;
      renderTabs();
      render(window.ALL || []);
    };

    tabs.appendChild(div);
  });
}

/* =========================
   ➕ 添加
========================= */
function addFeed() {
  const url = document.getElementById("rssInput").value.trim();
  const name = document.getElementById("rssName").value.trim();

  if (!url) return;

  feeds.push({
    url: url,
    category: name || "默认"
  });

  localStorage.setItem("feeds", JSON.stringify(feeds));

  renderTabs();
  renderFeedList();
  loadFeeds();
}

/* =========================
   ❌ 删除
========================= */
function removeFeed(i) {
  feeds.splice(i, 1);
  localStorage.setItem("feeds", JSON.stringify(feeds));

  renderTabs();
  renderFeedList();
  loadFeeds();
}

/* =========================
   📋 管理
========================= */
function renderFeedList() {
  const list = document.getElementById("feedList");
  list.innerHTML = "";

  feeds.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "feed-item";

    div.innerHTML = `
      <span>${f.url} (${f.category})</span>
      <button onclick="removeFeed(${i})">删</button>
    `;

    list.appendChild(div);
  });
}

/* UI */
function openManager() {
  document.getElementById("manager").classList.remove("hidden");
}

function closeManager() {
  document.getElementById("manager").classList.add("hidden");
}
