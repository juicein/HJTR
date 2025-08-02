const metro_name = "地铁";
const metro_name_en = "Lindong Metro";

const metro_logo = "https://wiki.shangxiaoguan.top/images/1/10/%E4%B8%B4%E4%B8%9C%E5%9C%B0%E9%93%81%E6%A0%87%E8%AF%86%E5%89%AA%E6%8E%89%E7%A9%BA%E7%99%BD.png";

// 站点数据说明：
// travelTime: 从当前站到下一站的运行时间（分钟）
// 例如：如果 A站的travelTime为3，表示从A站到B站需要3分钟

const lines = [
  /*  {
        name: "1号线",
        nameEN: "Line 1",
        color: "#e60012",
        stations: [
            { name: "临北路", nameEN: "LINBEILU", coordinates: { x: 460, y: 140 }, fareZone: "坂田", labelOffset: { x: 8, y: -8 }, travelTime: 3.2, platformSide: "left", },
            { name: "江阳路", nameEN: "JIANGYANGLU", coordinates: { x: 460, y: 240 }, fareZone: "坂田", labelOffset: { x: 8, y: -8 }, travelTime: 2.5, platformSide: "left", },
            { name: "度假基地", nameEN: "DUJIAJIDI", coordinates: { x: 460, y: 340 }, fareZone: "坂田", labelOffset: { x: 8, y: -8 }, travelTime: 2.6, platformSide: "left", },
            { name: "花城广场", nameEN: "HUACHENGGUANGCHANG", coordinates: { x: 400, y: 400 }, fareZone: "坂田", labelOffset: { x: 8, y: 8 }, travelTime: 2.4, platformSide: "left", },
            { name: "建业街临医二院", nameEN: "JIANYEJIELINYIERYUAN", coordinates: { x: 400, y: 500 }, fareZone: "坂田", labelOffset: { x: 8, y: 24 }, travelTime: 2, platformSide: "left", },
            { name: "中华路", nameEN: "ZHONGHUALU", coordinates: { x: 400, y: 600 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.5, platformSide: "left", },
            { name: "市府大路", nameEN: "SHIFUDALU", coordinates: { x: 460, y: 660 }, fareZone: "出生点", labelOffset: { x: -72, y: 12 }, travelTime: 2.4, platformSide: "left", },
            { name: "海洋基地", nameEN: "HAIYANGJIDI", coordinates: { x: 520, y: 720 }, fareZone: "出生点", labelOffset: { x: 28, y: -8 }, travelTime: 3, platformSide: "left", },
            { name: "忌城路", nameEN: "JICHENGLU", coordinates: { x: 520, y: 820 }, fareZone: "出生点", labelOffset: { x: 28, y: -8 }, travelTime: 3, platformSide: "left", },
            { name: "冰岭西路", nameEN: "BINGLINGXILU", coordinates: { x: 640, y: 820 }, fareZone: "出生点", labelOffset: { x: 8, y: -8 }, travelTime: 2, platformSide: "right", }
        ]
    },*/
    /*{
        name: "2号线",
        nameEN: "Line 2",
        color: "#00a0e9",
        stations: [
            { name: "方形广场", nameEN: "FANGXINGGUANGCHANG", coordinates: { x: 530, y: 450 }, fareZone: "坂田", labelOffset: { x: 18, y: -8 }, travelTime: 2, platformSide: "both", trainPosition: 0.5 },
            { name: "白塔河路", nameEN: "BAITAHELU", coordinates: { x: 530, y: 630 }, fareZone: "出生点", labelOffset: { x: 18, y: 12 }, travelTime: 2, platformSide: "left", trainPosition: 0.5 },
            { name: "海洋基地", nameEN: "HAIYANGJIDI", coordinates: { x: 530, y: 720 }, fareZone: "出生点", labelOffset: { x: 18, y: -8 }, travelTime: 3, platformSide: "right", trainPosition: 0.5 },
            { name: "忌城路", nameEN: "JICHENGLU", coordinates: { x: 530, y: 820 }, fareZone: "出生点", labelOffset: { x: 18, y: -8 }, travelTime: 3, platformSide: "left", trainPosition: 0.5 },
            { name: "临东大学", nameEN: "LINDONGDAXUE", coordinates: { x: 530, y: 900 }, fareZone: "出生点", labelOffset: { x: 18, y: -8 }, travelTime: 2, platformSide: "left", trainPosition: 0.5 },
            { name: "远航路", nameEN: "YUANHANGLU", coordinates: { x: 530, y: 1000 }, fareZone: "出生点", labelOffset: { x: 8, y: -8 }, travelTime: 2, platformSide: "left", trainPosition: 0.5 },
            { name: "雪乡中学", nameEN: "XUEXIANGZHONGXUE", coordinates: { x: 530, y: 1100 }, fareZone: "出生点", labelOffset: { x: 8, y: -8 }, travelTime: 2, platformSide: "left", trainPosition: 0.5 },
            { name: "雪乡展览馆", nameEN: "XUEXIANGZHANLANGUAN", coordinates: { x: 530, y: 1200 }, fareZone: "机场", labelOffset: { x: 8, y: -8 }, travelTime: 2, platformSide: "left", trainPosition: 0.5 },
            { name: "临南中路", nameEN: "LINANZHONGLU", coordinates: { x: 530, y: 1300 }, fareZone: "机场", labelOffset: { x: 8, y: -8 }, travelTime: 2, platformSide: "left", trainPosition: 0.5  }
        ]
    },*/
   /* {
        name: "3号线",
        nameEN: "Line 3",
        color: "#f5d000",
        stations: [
            { name: "临湖路", nameEN: "LINHULU", coordinates: { x: 100, y: 600 }, fareZone: "铁西", labelOffset: { x: -48, y: -8 }, travelTime: 4, platformSide: "left", },
            { name: "临东站", nameEN: "LINDONGZHAN", coordinates: { x: 200, y: 600 }, fareZone: "市区", labelOffset: { x: -54, y: -8 }, travelTime: 2.4, platformSide: "left", },
            { name: "青年大街", nameEN: "QINGNIANDAJIE", coordinates: { x: 300, y: 600 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.2, platformSide: "left", },
            { name: "中华路", nameEN: "ZHONGHUALU", coordinates: { x: 400, y: 600 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.2, platformSide: "left", },
            { name: "精卫街", nameEN: "JINGWEIJIE", coordinates: { x: 500, y: 600 }, fareZone: "出生点", labelOffset: { x: -48, y: 18 }, travelTime: 2, platformSide: "right", },
            /*{ name: "临东湾", nameEN: "LINDONGWAN", coordinates: { x: 600, y: 600 }, fareZone: "出生点", labelOffset: { x: 8, y: -8 }, travelTime: 2 },
            { name: "开发区", nameEN: "KAIFAQU", coordinates: { x: 700, y: 600 }, fareZone: "出生点", labelOffset: { x: 8, y: -8 }, travelTime: 2 },
            { name: "保税区", nameEN: "BAOSHUIQU", coordinates: { x: 800, y: 600 }, fareZone: "碧湖", labelOffset: { x: 8, y: -8 }, travelTime: 2 },
            { name: "双E港", nameEN: "SHUANGEGANG", coordinates: { x: 900, y: 600 }, fareZone: "碧湖", labelOffset: { x: 8, y: -8 }, travelTime: 2 },
            { name: "碧湖中心", nameEN: "BIHUZHONGXIN", coordinates: { x: 1000, y: 600 }, fareZone: "碧湖", labelOffset: { x: 8, y: -8 }, travelTime: 2 }*/
        ]
    },*/
   {
        name: "会展线",
        nameEN: "Line 6",
        color: "#ec6941",
        stations: [
            { name: "豪金中央", nameEN: "JINYANGDAJIE", coordinates: { x: 300, y: 100 }, fareZone: "北站", labelOffset: { x: 8, y: -8 }, travelTime: 3.6, platformSide: "left", },
            { name: " 千里马T3航站楼", nameEN: "RENJIEHUGONGYUAN", coordinates: { x: 300, y: 300 }, fareZone: "北站", labelOffset: { x: 8, y: -8 }, travelTime: 2.2, platformSide: "left", },
           // { name: "北台路", nameEN: "BEITAILU", coordinates: { x: 300, y: 300 }, fareZone: "北站", labelOffset: { x: 8, y: -8 }, travelTime: 2.5, platformSide: "left", },
           // { name: "草仓路", nameEN: "CAOCANGLU", coordinates: { x: 300, y: 400 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.4, platformSide: "left", },
         //   { name: "宣庆文化宫", nameEN: "XUANQINGWENHUAGONG", coordinates: { x: 300, y: 500 }, fareZone: "市区", labelOffset: { x: -90, y: -8 }, travelTime: 2, platformSide: "left", },
          //  { name: "青年大街", nameEN: "QINGNIANDAJIE", coordinates: { x: 300, y: 600 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.5, platformSide: "left", },
           // { name: "新阳路", nameEN: "XINYANGLU", coordinates: { x: 300, y: 750 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.6, platformSide: "left", },
          //  { name: "仁德路", nameEN: "RENDELU", coordinates: { x: 300, y: 900 }, fareZone: "仁德", labelOffset: { x: 8, y: -8 }, travelTime: 2, platformSide: "left", }
        ]
    },
    /*{
        name: "9号线",
        nameEN: "Line 9",
        color: "#e4007f",
        stations: [
            { name: "工人村", nameEN: "GONGRENCUN", coordinates: { x: 40, y: 900 }, fareZone: "仁德", labelOffset: { x: 8, y: -8 }, travelTime: 2 },
            { name: "骆家堡", nameEN: "LUOJIAPU", coordinates: { x: 120, y: 900 }, fareZone: "仁德", labelOffset: { x: 8, y: -8 }, travelTime: 2 },
            { name: "和平门", nameEN: "HEPINGMEN", coordinates: { x: 200, y: 900 }, fareZone: "仁德", labelOffset: { x: 8, y: -8 }, travelTime: 2 },
            { name: "仁德路", nameEN: "RENDELU", coordinates: { x: 300, y: 900 }, fareZone: "仁德", labelOffset: { x: 8, y: -8 }, travelTime: 2 },
            { name: "标识湾", nameEN: "BIAOZHIWAN", coordinates: { x: 420, y: 900 }, fareZone: "仁德", labelOffset: { x: 8, y: -8 }, travelTime: 2 },
            { name: "临东大学", nameEN: "LINDONGDAXUE", coordinates: { x: 530, y: 900 }, fareZone: "出生点", labelOffset: { x: 18, y: -8 }, travelTime: 2 },
            { name: "红山公园", nameEN: "HONGSHANGONGYUAN", coordinates: { x: 640, y: 900 }, fareZone: "出生点", labelOffset: { x: 8, y: -8 }, travelTime: 2 }
        ]
    },*/
   /* {
        name: "会展线",
        nameEN: "Line 10",
        color: "#57d33e",
        stations: [
           // { name: "坂田客运港", nameEN: "BANTIANKEYUNGANG", coordinates: { x: 530, y: 360 }, fareZone: "坂田", labelOffset: { x: 18, y: -8 }, travelTime: 2.5, platformSide: "right", },
            { name: "方形广场", nameEN: "FANGXINGGUANGCHANG", coordinates: { x: 530, y: 450 }, fareZone: "坂田", labelOffset: { x: 18, y: -8 }, travelTime: 3.6, platformSide: "left", },
            { name: "工农桥", nameEN: "GONGNONGQIAO", coordinates: { x: 480, y: 500 }, fareZone: "坂田", labelOffset: { x: -48, y: -8 }, travelTime: 2, platformSide: "left", },
            { name: "建业街临医二院", nameEN: "JIANYEJIELINYIERYUAN", coordinates: { x: 400, y: 500 }, fareZone: "坂田", labelOffset: { x: 8, y: 24 }, travelTime: 2.4, platformSide: "left", },
            { name: "宣庆文化宫", nameEN: "XUANQINGWENHUAGONG", coordinates: { x: 300, y: 500 }, fareZone: "市区", labelOffset: { x: -90, y: -8 }, travelTime: 3.2, platformSide: "left", },
            { name: "临东站", nameEN: "LINDONGZHAN", coordinates: { x: 200, y: 600 }, fareZone: "市区", labelOffset: { x: -54, y: -8 }, travelTime: 2.2, platformSide: "right", },
            { name: "百鸟公园", nameEN: "BAINIAOGONGYUAN", coordinates: { x: 200, y: 700 }, fareZone: "市区", labelOffset: { x: 8, y: -8 }, travelTime: 2.4, platformSide: "right", },
            { name: "南市场", nameEN: "NANSHICHANG", coordinates: { x: 200, y: 800 }, fareZone: "仁德", labelOffset: { x: 8, y: -8 }, travelTime: 2, platformSide: "right", },
            { name: "和平门", nameEN: "HEPINGMEN", coordinates: { x: 200, y: 900 }, fareZone: "仁德", labelOffset: { x: 8, y: -8 }, travelTime: 2, platformSide: "right", }
        ]
    },*/
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
