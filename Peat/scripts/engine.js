let story = []; // 每个章节脚本会给 story 赋值
let index = 0;

const nameBox = document.getElementById("name-box");
const textBox = document.getElementById("text-box");
const bgBox = document.getElementById("background");
const charBox = document.getElementById("character");
const voicePlayer = document.getElementById("voice-player");

function renderLine() {
  const line = story[index];
  if (!line) return;

  nameBox.innerText = line.name;
  textBox.innerText = line.text;

  if (line.bg) bgBox.style.backgroundImage = `url(${line.bg})`;
  if (line.char) charBox.style.backgroundImage = `url(${line.char})`;
  else charBox.style.backgroundImage = "none";

  if (line.voice) {
    voicePlayer.src = line.voice;
    voicePlayer.play();
  }
}

function nextLine() {
  index++;
  if (index < story.length) {
    renderLine();
  } else {
    alert("本章结束");
  }
}

document.getElementById("next-btn").addEventListener("click", nextLine);

function initGame() {
  index = 0;
  renderLine();
}
