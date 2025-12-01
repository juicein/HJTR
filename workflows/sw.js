self.addEventListener("push", (event) => {
  const data = event.data.json();

  // 普通通知
  if (data.type === "notification") {
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/plane.png"
      })
    );
  }

  // 航班进度条更新（Live Activity）
  if (data.type === "flight_activity") {
    const body = `
航班 ${data.flightID}
状态：${data.status}
进度：${data.progress}%
预计到达：${data.eta}
    `;

    event.waitUntil(
      self.registration.showNotification("航班实时进度", {
        body,
        tag: "flight-progress",  // 必须相同 → 实现覆盖更新
        renotify: true,
        icon: "/plane.png"
      })
    );
  }
});
