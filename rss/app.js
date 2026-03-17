let feeds = JSON.parse(localStorage.getItem("feeds") || "[]");

let allArticles = [];
let categories = {};
let currentTab = "推荐";

init();

function init() {
  renderFeedList();
  loadFeeds();
}

/* =========================
   📡 加载 RSS
========================= */
async function loadFeeds() {
  allArticles = [];
  categories = {};

  for (let url of feeds) {
    try {
      const res = await fetch(
        "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(url)
      );
      const data = await res.json();

      const source = data.feed.title;

      categories[source] = [];

      data.items.forEach(item => {
        const obj = {
          title: item.title,
          content: item.content,
          image: item.thumbnail || "",
          date: new Date(item.pubDate),
          source: source,
          link: item.link
        };

        allArticles.push(obj);
        categories[source].push(obj);
      });

    } catch (e) {
      console.log("失败:", url);
    }
  }

  allArticles.sort((a, b) => b.date - a.date);

  renderTabs();
  renderFeed();
}

/* =========================
   🧭 分类栏
========================= */
function renderTabs() {
  const tabs = document.getElementById("tabs");
  tabs.innerHTML = "";

  const allTabs = ["推荐", ...Object.keys(categories)];

  allTabs.forEach(name => {
    const div = document.createElement("div");
    div.className = "tab " + (name === currentTab ? "active" : "");
    div.innerText = name;

    div.onclick = () => {
      currentTab = name;
      renderTabs();
      renderFeed();
    };

    tabs.appendChild(div);
  });
}

/* =========================
   📰 渲染信息流
========================= */
function renderFeed() {
  const feed = document.getElementById("feed");
  feed.innerHTML = "";

  let list = currentTab === "推荐"
    ? allArticles
    : categories[currentTab] || [];

  list.forEach(item => {
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      ${item.image ? `<img src="${item.image}" class="cover">` : ""}
      <div class="title">${item.title}</div>
      <div class="meta">${item.source} · ${item.date.toLocaleString()}</div>
    `;

    div.onclick = () => openArticle(item);
    feed.appendChild(div);
  });
}

/* =========================
   📖 详情页（核心）
========================= */
function openArticle(item) {
  const page = document.getElementById("article");

  page.innerHTML = `
    <div class="back" onclick="closeArticle()">← 返回</div>
    <h2>${item.title}</h2>
    <div class="meta">${item.source} · ${item.date.toLocaleString()}</div>
    ${item.image ? `<img src="${item.image}">` : ""}
    <div>${item.content}</div>
    <br>
    <a href="${item.link}" target="_blank">阅读原文</a>
  `;

  page.classList.remove("hidden");
}

function closeArticle() {
  document.getElementById("article").classList.add("hidden");
}

/* =========================
   ➕ 添加订阅
========================= */
function addFeed() {
  const input = document.getElementById("rssInput");
  const url = input.value.trim();

  if (!url) return;

  feeds.push(url);
  localStorage.setItem("feeds", JSON.stringify(feeds));

  input.value = "";
  renderFeedList();
  loadFeeds();
}

/* =========================
   ❌ 删除订阅
========================= */
function removeFeed(index) {
  feeds.splice(index, 1);
  localStorage.setItem("feeds", JSON.stringify(feeds));

  renderFeedList();
  loadFeeds();
}

/* =========================
   📋 订阅列表
========================= */
function renderFeedList() {
  const list = document.getElementById("feedList");
  list.innerHTML = "";

  feeds.forEach((url, i) => {
    const div = document.createElement("div");
    div.className = "feed-item";

    div.innerHTML = `
      <span>${url}</span>
      <button onclick="removeFeed(${i})">删除</button>
    `;

    list.appendChild(div);
  });
}

/* =========================
   UI 控制
========================= */
function openManager() {
  document.getElementById("manager").classList.remove("hidden");
}

function closeManager() {
  document.getElementById("manager").classList.add("hidden");
}
