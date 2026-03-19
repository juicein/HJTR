let feeds = JSON.parse(localStorage.getItem("feeds") || "[]");
let readList = JSON.parse(localStorage.getItem("read") || "[]");
let cache = JSON.parse(localStorage.getItem("cache") || "{}");

let recommendMode = JSON.parse(localStorage.getItem("recommend") || "false");
let currentTab = "全部";

init();

function init() {
  if (location.pathname.includes("article")) {
    loadArticle();
    return;
  }

  renderTabs();
  renderFeedList();
  loadFeeds();

  setInterval(loadFeeds, 300000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }
}

/* 推荐开关 */
function toggleRecommend(){
  recommendMode = !recommendMode;
  localStorage.setItem("recommend", JSON.stringify(recommendMode));
  render(window.ALL || []);
}

/* 时间 */
function timeAgo(date){
  let d=(Date.now()-date)/1000;
  if(d<60) return "刚刚";
  if(d<3600) return Math.floor(d/60)+"分钟前";
  if(d<86400) return Math.floor(d/3600)+"小时前";
  return Math.floor(d/86400)+"天前";
}

/* 图片 */
function extractImage(item){
  if(item.thumbnail) return item.thumbnail;
  let m=(item.description||"").match(/<img.*?src="(.*?)"/);
  return m?m[1]:"";
}

/* 加载 */
async function loadFeeds(){
  let all=[];

  for(let f of feeds){
    try{
      let res=await fetch("https://api.rss2json.com/v1/api.json?rss_url="+encodeURIComponent(f.url));
      let data=await res.json();

      data.items.forEach(item=>{
        let id=item.link;

        cache[id]=item; // 🔥缓存

        all.push({
          id,
          title:item.title,
          content:item.description,
          image:extractImage(item),
          date:new Date(item.pubDate),
          source:data.feed.title,
          link:item.link,
          category:f.category||"默认"
        });
      });

    }catch{}
  }

  localStorage.setItem("cache", JSON.stringify(cache));

  all.sort((a,b)=>b.date-a.date);

  if(recommendMode){
    all.sort((a,b)=> (readScore(b)-readScore(a)));
  }

  window.ALL=all;
  render(all);
}

/* 推荐算法 */
function readScore(item){
  let score=0;
  if(readList.includes(item.id)) score+=5;
  score+= (Date.now()-item.date)/10000000;
  return score;
}

/* 渲染 */
function render(list){
  let feed=document.getElementById("feed");
  feed.innerHTML="";

  let show=currentTab==="全部"?list:list.filter(i=>i.category===currentTab);

  show.forEach(item=>{
    let d=document.createElement("div");
    d.className="card "+(readList.includes(item.id)?"read":"");

    d.innerHTML=`
      ${item.image?`<div class="cover-wrap"><img src="${item.image}" class="cover"></div>`:""}
      <div class="title">${item.title}</div>
      <div class="meta">${item.source} · ${timeAgo(item.date)}</div>
    `;

    d.onclick=()=>openArticle(item);
    feed.appendChild(d);
  });
}

/* 打开 */
function openArticle(item){
  if(!readList.includes(item.id)){
    readList.push(item.id);
    localStorage.setItem("read", JSON.stringify(readList));
  }

  localStorage.setItem("currentArticle", JSON.stringify(item));
  location.href="article.html";
}

/* 离线 */
function loadArticle(){
  let item=JSON.parse(localStorage.getItem("currentArticle")||"{}");
  let cached=cache[item.id];

  document.getElementById("article").innerHTML=`
    <h2>${item.title}</h2>
    <p>${item.source} · ${timeAgo(new Date(item.date))}</p>
    ${item.image?`<img src="${item.image}">`:""}
    <div>${cached?.description || item.content}</div>
  `;
}

/* 分类 */
function renderTabs(){
  let tabs=document.getElementById("tabs");

  let cats=["全部"];
  feeds.forEach(f=>{
    if(f.category&&!cats.includes(f.category)) cats.push(f.category);
  });

  tabs.innerHTML="";

  cats.forEach(c=>{
    let d=document.createElement("div");
    d.className="tab "+(c===currentTab?"active":"");
    d.innerText=c;

    d.onclick=()=>{
      currentTab=c;
      renderTabs();
      render(window.ALL||[]);
    };

    tabs.appendChild(d);
  });
}

/* 管理 */
function addFeed(){
  let url=rssInput.value.trim();
  let name=rssName.value.trim();

  if(!url) return;

  feeds.push({url,category:name||"默认"});
  localStorage.setItem("feeds",JSON.stringify(feeds));

  renderTabs();
  renderFeedList();
  loadFeeds();
}

function removeFeed(i){
  feeds.splice(i,1);
  localStorage.setItem("feeds",JSON.stringify(feeds));
  renderFeedList();
  loadFeeds();
}

function renderFeedList(){
  let list=document.getElementById("feedList");
  list.innerHTML="";

  feeds.forEach((f,i)=>{
    let d=document.createElement("div");
    d.innerHTML=`${f.url} (${f.category}) <button onclick="removeFeed(${i})">删</button>`;
    list.appendChild(d);
  });
}

/* UI */
function openManager(){manager.classList.remove("hidden")}
function closeManager(){manager.classList.add("hidden")}
