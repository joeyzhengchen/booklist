/**
 * 扫描 booklist-site/ 目录下所有 YYYY-MM-DD.html，自动生成静态 index.html
 * 按年月分组，当前月份默认展开，历史月份默认收起
 */
const fs = require('fs');
const path = require('path');

const BOOKLIST_DIR = process.env.BOOKLIST_SITE_DIR || 'F:/workbuddy/results/Claw/booklist-site';
const INDEX_PATH = path.join(BOOKLIST_DIR, 'index.html');

function getWeekday(dateStr) {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const d = new Date(dateStr + 'T00:00:00+08:00');
  return weekdays[d.getDay()];
}

function main() {
  const files = fs.readdirSync(BOOKLIST_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .map(f => f.replace('.html', ''))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.log('⚠️  booklist-site/ 下无日期文件，跳过 index.html 更新');
    return;
  }

  // 使用本地日期（避免 toISOString 在 GMT+8 时区返回前一天 UTC 日期）
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentMonth = files[0].substring(0, 7);
  const total = files.length;

  const groups = {};
  for (const dateStr of files) {
    const month = dateStr.substring(0, 7);
    if (!groups[month]) groups[month] = [];
    groups[month].push(dateStr);
  }

  const months = Object.keys(groups).sort().reverse();

  let cardsHtml = '';
  for (const month of months) {
    const isCurrent = month === currentMonth;
    const openAttr = isCurrent ? ' open' : '';
    const monthLabel = month.replace('-', '年') + '月';
    const count = groups[month].length;

    let dayCards = '';
    for (const dateStr of groups[month]) {
      const weekday = getWeekday(dateStr);
      const todayBadge = dateStr === todayStr
        ? '<span style="background:#D44444;color:#fff;font-size:11px;padding:1px 8px;border-radius:8px;margin-left:6px;">今天</span>'
        : '';
      dayCards += `
<a class="day-card" href="${dateStr}.html">
  <div>
    <div class="date">${dateStr} ${weekday}${todayBadge}</div>
    <div class="info">点击查看当日新书与推荐</div>
  </div>
  <div class="arrow">→</div>
</a>`;
    }

    cardsHtml += `
<details class="month-group"${openAttr}>
  <summary class="month-bar">
    <span class="month-label">${monthLabel}</span>
    <span class="month-count">${count} 期</span>
    <span class="month-arrow">▾</span>
  </summary>
  <div class="month-days">
    ${dayCards}
  </div>
</details>`;
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>每日人文社科新书速递</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    background: #F5F2EB;
    color: #2C2416;
    min-height: 100vh;
  }
  .hero {
    background: linear-gradient(135deg, #2C3E50, #4A6A7A);
    color: #fff;
    padding: 60px 20px 40px;
    text-align: center;
  }
  .hero h1 { font-size: 36px; margin-bottom: 8px; letter-spacing: 2px; }
  .hero p { font-size: 15px; color: #C8C8C3; }
  .hero .sub { color: #F0D78C; font-size: 13px; letter-spacing: 3px; margin-bottom: 8px; }
  .container { max-width: 900px; margin: 0 auto; padding: 30px 20px 60px; }
  .month-group {
    background: #fff;
    border-radius: 10px;
    margin-bottom: 14px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    overflow: hidden;
  }
  .month-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    cursor: pointer;
    list-style: none;
    font-weight: bold;
    font-size: 18px;
    background: #fff;
    transition: background 0.15s;
  }
  .month-bar::-webkit-details-marker { display: none; }
  .month-bar:hover { background: #F9F7F2; }
  .month-label { color: #2C2416; }
  .month-count { font-size: 13px; color: #9B8C7A; font-weight: normal; margin-left: 10px; flex: 1; }
  .month-arrow { font-size: 14px; color: #9B8C7A; transition: transform 0.2s; }
  .month-group[open] .month-arrow { transform: rotate(180deg); }
  .month-days { padding: 0 24px 20px; }
  .day-card {
    background: #F9F7F2;
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: transform 0.15s, background 0.15s;
    text-decoration: none;
    color: inherit;
  }
  .day-card:last-child { margin-bottom: 0; }
  .day-card:hover { transform: translateX(4px); background: #F0EDE6; }
  .day-card .date { font-size: 16px; font-weight: bold; color: #4A4A4A; }
  .day-card .info { font-size: 12px; color: #9B8C7A; margin-top: 2px; }
  .day-card .arrow { font-size: 18px; color: #C9A96E; }
  .footer { text-align: center; padding: 40px 20px; color: #9B8C7A; font-size: 13px; line-height: 1.8; }
  .footer a { color: #8B6914; text-decoration: none; }
  .stats {
    display: flex; justify-content: center; gap: 20px;
    margin: 24px 0;
  }
  .stat {
    background: rgba(255,255,255,0.12);
    border-radius: 20px;
    padding: 8px 20px;
    font-size: 14px;
  }
  .stat b { color: #F0D78C; }
</style>
  </style>
</head>
<body>
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-SX9PKL424Z"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-SX9PKL424Z');
</script>

<div class="hero">
  <div class="sub">DAILY BOOKS</div>
  <h1>人文社科新书速递</h1>
  <p>文学 历史 哲学 社科 文化 艺术 传记</p>
  <div class="stats">
    <div class="stat">已生成 <b>${total}</b> 期</div>
    <div class="stat">每日 12:45 自动更新</div>
  </div>
</div>

<div class="container">
${cardsHtml}
</div>

<div class="footer">
  本页面由每日人文社科新书采集器 v5 自动部署<br>
  数据来源：<a href="https://book.douban.com">豆瓣网</a> ｜
  <a href="https://github.com/joeyzhengchen/booklist">GitHub</a>
</div>

</body>
</html>`;

  fs.writeFileSync(INDEX_PATH, html, 'utf-8');
  console.log(`✅ index.html 已更新（${total} 期，${months.length} 个月，最新: ${files[0]}）`);
}

main();
