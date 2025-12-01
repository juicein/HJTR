const express = require("express");
const bodyParser = require("body-parser");
const webpush = require("web-push");

const app = express();
app.use(bodyParser.json());

const subs = [];

webpush.setVapidDetails(
  "mailto:admin@test.com",
  "你的 VAPID 公钥",
  "你的 VAPID 私钥"
);

// 保存订阅
app.post("/save-subscription", (req, res) => {
  subs.push(req.body);
  res.send("ok");
});

// 推送航班进度
app.get("/send-flight", (req, res) => {
  const progress = Number(req.query.p || 10); // ?p=30
  const status =
    progress >= 100 ? "到达" :
    progress >= 80 ? "准备降落" :
    progress >= 40 ? "巡航中" :
    progress >= 10 ? "已起飞" : "等待起飞";

  const payload = JSON.stringify({
    type: "flight_activity",
    flightID: "CZ3802",
    progress,                        // 百分比
    status,
    eta: "14:55"
  });

  subs.forEach(s => webpush.sendNotification(s, payload));

  res.send("OK 已推送航班进度 " + progress + "%");
});

app.listen(3000, () => console.log("Server running..."));
