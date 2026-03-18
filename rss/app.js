let feeds = JSON.parse(localStorage.getItem("feeds") || "[]");
let readList = JSON.parse(localStorage.getItem("read") || "[]");
let currentTab = "全部";

init();
setInterval(loadFeeds, 300000); // 自动刷新 5分钟

function init() {
  renderTabs();
  renderFeedList();
  loadFeeds();
}

/* 图片提取 */
function extractImage(item) {
  if (item.thumbnail) return item.thumbnail;
  let m = (item.description || "").match(/<img.*?src="(.*?)"/);
  return m ? m[1] : "";
}

/* 加载 */
async function loadFeeds() {
  let all = [];

  for (let f of feeds) {
    try {
      let res = await fetch(
        "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(f.url)
      );
      let data = await res.json();

      data.items.forEach(i => {
        all.push({
          title: i.title,
          content: i.description,
          image: extractImage(i),
          date: new Date(i.pubDate),
          source: data.feed.title,
          link: i.link,
          category: f.category || "默认",
          id: i.link
        });
      });

    } catch(e){}
  }

  all.sort((a,b)=>b.date-a.date);
  window.ALL = all;
  render(all);
}

/* 渲染 */
function render(list) {
  const feed = document.getElementById("feed");
  feed.innerHTML = "";

  let show = currentTab==="全部" ? list : list.filter(i=>i.category===currentTab);

  show.forEach(item=>{
    let read = readList.includes(item.id);

    let div = document.createElement("div");
    div.className = "card " + (read ? "read" : "");

    div.innerHTML = `
      ${item.image ? `<div class="cover-wrap"><img src="${item.image}" class="cover"></div>`:""}
      <div class="title">${item.title}</div>
      <div class="meta">${item.source}</div>
    `;

    div.onclick = ()=>{
      // 标记已读
      if(!readList.includes(item.id)){
        readList.push(item.id);
        localStorage.setItem("read", JSON.stringify(readList));
      }

      localStorage.setItem("currentArticle", JSON.stringify(item));
      location.href = "article.html";
    };

    feed.appendChild(div);
  });
}

/* 分类 */
function renderTabs(){
  let tabs=document.getElementById("tabs");
  let cats=["全部"];
  feeds.forEach(f=>{
    if(f.category && !cats.includes(f.category)) cats.push(f.category);
  });

  tabs.innerHTML="";
  cats.forEach(c=>{
    let d=document.createElement("div");
    d.className="tab "+(c===currentTab?"active":"");
    d.innerText=c;
    d.onclick=()=>{currentTab=c;renderTabs();render(window.ALL||[]);}
    tabs.appendChild(d);
  });
}

/* 订阅 */
function addFeed(){
  let url=document.getElementById("rssInput").value.trim();
  let cat=document.getElementById("rssCat").value.trim();

  if(!url) return;

  feeds.push({url, category:cat||"默认"});
  localStorage.setItem("feeds", JSON.stringify(feeds));

  renderTabs();
  renderFeedList();
  loadFeeds();
}

/* 删除 */
function removeFeed(i){
  feeds.splice(i,1);
  localStorage.setItem("feeds", JSON.stringify(feeds));
  renderTabs();
  renderFeedList();
  loadFeeds();
}

function renderFeedList(){
  let list=document.getElementById("feedList");
  list.innerHTML="";
  feeds.forEach((f,i)=>{
    let d=document.createElement("div");
    d.innerHTML = `${f.url} (${f.category}) <button onclick="removeFeed(${i})">删</button>`;
    list.appendChild(d);
  });
}

/* UI */
function openManager(){document.getElementById("manager").classList.remove("hidden")}
function closeManager(){document.getElementById("manager").classList.add("hidden")}
