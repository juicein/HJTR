const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
canvas.width = 400;
canvas.height = 600;

let audio, chart, score = 0, combo = 0, maxCombo = 0, totalNotes = 0, hitNotes = 0;
let notes = [];

// 加载数据
async function loadGame() {
  const chartFile = localStorage.getItem("chartFile");
  const audioFile = localStorage.getItem("audioFile");

  chart = await fetch(chartFile).then(res => res.json());
  audio = new Audio(audioFile);

  totalNotes = chart.length;
  notes = chart.map(n => ({...n, y: -100}));

  audio.play();
  requestAnimationFrame(update);
}

function update() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const currentTime = audio.currentTime;

  // 画判定线
  ctx.fillStyle = "white";
  ctx.fillRect(0, canvas.height - 100, canvas.width, 5);

  // 更新音符
  notes.forEach(note => {
    note.y = (note.time - currentTime) * 300 + (canvas.height - 100);
    if (note.y < canvas.height && note.y > -50) {
      ctx.fillStyle = "cyan";
      ctx.beginPath();
      ctx.arc(50 + note.lane * 80, note.y, 15, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  requestAnimationFrame(update);
}

// 点击判定
window.addEventListener("keydown", e => {
  const currentTime = audio.currentTime;
  let hit = false;

  notes.forEach(note => {
    if (!note.hit && Math.abs(note.time - currentTime) < 0.15) {
      note.hit = true;
      hit = true;
      score += 1000;
      combo++;
      hitNotes++;
      if (combo > maxCombo) maxCombo = combo;
    }
  });

  if (!hit) {
    combo = 0;
  }

  document.getElementById("scoreBoard").innerText =
    `分数: ${score} | 连击: ${combo}`;

  if (hitNotes === totalNotes) endGame();
});

function endGame() {
  localStorage.setItem("score", score);
  localStorage.setItem("maxCombo", maxCombo);
  localStorage.setItem("accuracy", ((hitNotes / totalNotes) * 100).toFixed(2));
  location.href = "result.html";
}

loadGame();
