// 1. 首页-快捷服务 (Quick Actions)
window.QUICK_ACTIONS = [
    { id: 1, title: "航班信息", icon: "flight_takeoff", link: "/flights" },
    { id: 2, title: "航班动态", icon: "connecting_airports", link: "/flights_map" },
    { id: 3, title: "公共交通", icon: "bus", link: "/Bus" },
  //  { id: 4, title: "行李查询", icon: "luggage", link: "#" },
  //  { id: 5, title: "中转服务", icon: "connecting_airports", link: "#" },
  //  { id: 6, title: "贵宾厅", icon: "diamond", link: "#" },
  //  { id: 7, title: "餐饮购物", icon: "restaurant", link: "#" },
  //  { id: 8, title: "交通指南", icon: "directions_bus", link: "#" }monitor
  ];
  
  // 2. 侧边栏-导航 (Navigation Drawer)
  window.SIDEBAR_ITEMS = [
    { id: 101, title: "首页", icon: "home", link: "index.html" },
   // { id: 102, title: "我的行程", icon: "calendar_month", link: "#" },
   // { id: 103, title: "会员中心", icon: "account_circle", link: "#" },
   // { id: 104, title: "消息通知", icon: "notifications", link: "#" },
    { id: 105, title: "设置", icon: "settings", link: "#" }, // 逻辑上我们会拦截这个点击打开弹窗
    { id: 106, title: "关于", icon: "info", link: "#" }
  ];
