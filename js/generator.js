const fs = require('fs');
const path = require('path');

const newsData = JSON.parse(fs.readFileSync('news.json', 'utf-8'));

newsData.forEach((item, index) => {
  const html = `
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <title>${item.title}</title>
  <link rel="stylesheet" href="../assets/style.css">
  <style>
    body { max-width: 800px; margin: auto; padding: 20px; background: white; }
    h1 { margin-bottom: 10px; }
    .meta { color: #888; font-size: 14px; }
    img { max-width: 100%; border-radius: 8px; margin-top: 10px; }
    p { line-height: 1.6; }
  </style>
</head>
<body>
  <h1>${item.title}</h1>
  <p class="meta">${item.date} • ${item.author} • ${item.location}</p>
  <img src="${item.image}" alt="">
  <p>${item.content}</p>
  <p><a href="../index.html">← 返回首页</a></p>
</body>
</html>
`;

  const outputPath = path.join(__dirname, 'news', `${index}.html`);
  fs.writeFileSync(outputPath, html, 'utf-8');
});
