const metro_name = "地铁";
const metro_name_en = "Lindong Metro";

const metro_logo = "https://wiki.shangxiaoguan.top/images/1/10/%E4%B8%B4%E4%B8%9C%E5%9C%B0%E9%93%81%E6%A0%87%E8%AF%86%E5%89%AA%E6%8E%89%E7%A9%BA%E7%99%BD.png";

// 站点数据说明：
// travelTime: 从当前站到下一站的运行时间（分钟）
// 例如：如果 A站的travelTime为3，表示从A站到B站需要3分钟

const lines = [

   {
        name: "会展线",
        nameEN: "Line 6",
        color: "#ec6941",
        stations: [
            { name: "豪金中央", nameEN: "JINYANGDAJIE", coordinates: { x: 300, y: 100 }, fareZone: "北站", labelOffset: { x: 8, y: -8 }, travelTime: 3.6, platformSide: "left", },
            { name: " 千里马T3航站楼", nameEN: "RENJIEHUGONGYUAN", coordinates: { x: 200, y: 350 }, fareZone: "北站", labelOffset: { x: 8, y: -8 }, travelTime: 2.2, platformSide: "left", },
            { name: "江滨大学", nameEN: "BEITAILU", coordinates: { x: 200, y: 450 }, fareZone: "北站", labelOffset: { x: 8, y: -8 }, travelTime: 2.5, platformSide: "left", }
           // { name: "草仓路", nameEN: "CAOCANGLU", coordinates: { x: 300, y: 400 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.4, platformSide: "left", },
         //   { name: "宣庆文化宫", nameEN: "XUANQINGWENHUAGONG", coordinates: { x: 300, y: 500 }, fareZone: "市区", labelOffset: { x: -90, y: -8 }, travelTime: 2, platformSide: "left", },
          //  { name: "青年大街", nameEN: "QINGNIANDAJIE", coordinates: { x: 300, y: 600 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.5, platformSide: "left", },
           // { name: "新阳路", nameEN: "XINYANGLU", coordinates: { x: 300, y: 750 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.6, platformSide: "left", },
          //  { name: "仁德路", nameEN: "RENDELU", coordinates: { x: 300, y: 900 }, fareZone: "仁德", labelOffset: { x: 8, y: -8 }, travelTime: 2, platformSide: "left", }
        ]
    },

   {
        name: "空港线",
        nameEN: "Line 6",
        color: "#ec6981",
        stations: [
            { name: "豪金中央", nameEN: "JINYANGDAJIE", coordinates: { x: 300, y: 100 }, fareZone: "北站", labelOffset: { x: 8, y: -8 }, travelTime: 3.6, platformSide: "left", },
            { name: "空港经济区", nameEN: "RENJIEHUGONGYUAN", coordinates: { x: 300, y: 400 }, fareZone: "北站", labelOffset: { x: 8, y: -8 }, travelTime: 2.2, platformSide: "left", },
          { name: "长安西", nameEN: "BEITAILU", coordinates: { x: 300, y: 500 }, fareZone: "北站", labelOffset: { x: 8, y: -8 }, travelTime: 2.5, platformSide: "left", }
           // { name: "草仓路", nameEN: "CAOCANGLU", coordinates: { x: 300, y: 400 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.4, platformSide: "left", },
         //   { name: "宣庆文化宫", nameEN: "XUANQINGWENHUAGONG", coordinates: { x: 300, y: 500 }, fareZone: "市区", labelOffset: { x: -90, y: -8 }, travelTime: 2, platformSide: "left", },
          //  { name: "青年大街", nameEN: "QINGNIANDAJIE", coordinates: { x: 300, y: 600 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.5, platformSide: "left", },
           // { name: "新阳路", nameEN: "XINYANGLU", coordinates: { x: 300, y: 750 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.6, platformSide: "left", },
          //  { name: "仁德路", nameEN: "RENDELU", coordinates: { x: 300, y: 900 }, fareZone: "仁德", labelOffset: { x: 8, y: -8 }, travelTime: 2, platformSide: "left", }
        ]
    },
    /*{
        name: "机场线",
        nameEN: "Aero Express",
        color: "rgb(82 0 160)",
        stations: [
            { name: "坂田客运港", nameEN: "BANTIANKEYUNGANG", coordinates: { x: 540, y: 360 }, fareZone: "坂田", labelOffset: { x: 8, y: -8 }, travelTime: 3, platformSide: "right", },
            { name: "白塔河路", nameEN: "BAITAHELU", coordinates: { x: 540, y: 630 }, fareZone: "出生点", labelOffset: { x: 8, y: 12 }, travelTime: 3, platformSide: "left", trainPosition: 0.5 },
            { name: "临东大学", nameEN: "LINDONGDAXUE", coordinates: { x: 540, y: 900 }, fareZone: "出生点", labelOffset: { x: 8, y: -8 }, travelTime: 3, platformSide: "left", trainPosition: 0.5 },
        ]
    },*/
];
