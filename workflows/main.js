async function update() {
  const res = await fetch("https://你的workers子域.workers.dev/progress");
  const data = await res.json();

  const pct = Math.floor(data.progress * 100);

  document.getElementById("bar").style.width = pct + "%";
  document.getElementById("text").innerText = `飞行进度：${pct}%`;
}

setInterval(update, 5000);
update();
