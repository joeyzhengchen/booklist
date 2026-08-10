const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://book.douban.com/',
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
  });
}

function classifyDate(raw) {
  if (!raw) return 'empty';
  const s = raw.trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return 'day';
  if (/^\d{4}-\d{1,2}$/.test(s)) return 'month';
  if (/^\d{4}$/.test(s)) return 'year';
  // 2021-8 格式（无前导零的月份）
  if (/^\d{4}-\d{1,2}$/.test(s)) return 'month';
  return 'other';
}

async function main() {
  const raw = await fetchUrl('https://m.douban.com/rexxar/api/v2/subject_collection/book_latest/items?start=0&count=20');
  const data = JSON.parse(raw);
  const items = data.subject_collection_items || [];

  console.log(`API 返回 ${items.length} 本书\n`);

  const stats = { day: 0, month: 0, year: 0, other: 0 };
  const details = [];

  items.forEach((item, i) => {
    const info = item.info || '';
    // info 格式: "作者/出版社/日期" 或 "作者 / 出版社 / 日期"
    const parts = info.split('/').map(s => s.trim());
    // 找日期（通常是最后一段中的数字）
    let dateRaw = '';
    for (const p of parts) {
      const cleaned = p.trim();
      if (/^\d{4}(-\d{1,2}(-\d{1,2})?)?$/.test(cleaned)) {
        dateRaw = cleaned;
        break;
      }
    }
    // 也检查一下所有part
    if (!dateRaw && parts.length >= 3) {
      // 尝试从倒数第二或最后部分提取
      for (let j = parts.length - 1; j >= 0; j--) {
        const match = parts[j].match(/(\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?)/);
        if (match) { dateRaw = match[1]; break; }
      }
    }

    const precision = classifyDate(dateRaw);
    stats[precision] = (stats[precision] || 0) + 1;
    details.push({ title: item.title, info, dateRaw, precision });
  });

  const total = items.length;
  console.log('📊 API info 字段中的日期精度分布:\n');
  console.log(`  日维度 (YYYY-MM-DD): ${stats.day} 本 (${(stats.day/total*100).toFixed(0)}%)`);
  console.log(`  月维度 (YYYY-MM):    ${stats.month} 本 (${(stats.month/total*100).toFixed(0)}%)`);
  console.log(`  年维度 (YYYY):       ${stats.year} 本 (${(stats.year/total*100).toFixed(0)}%)`);
  if (stats.other) console.log(`  其他:                ${stats.other} 本`);

  console.log('\n📋 全部明细:');
  details.forEach((d, i) => {
    const icon = { day: '📅', month: '📆', year: '🗓️', other: '❓' }[d.precision] || '  ';
    console.log(`  ${String(i+1).padStart(2)}. ${icon} [${d.precision}] "${d.dateRaw}" ← info="${d.info.substring(0,60)}" →《${d.title}》`);
  });

  // 对比: 如果全部是年维度，说明API本身就这样
  if (stats.year === total) {
    console.log('\n⚠️ 结论: 豆瓣API的info字段本身就只提供年份！');
    console.log('   因此RSSHub输出的日期自然只有年精度。');
    console.log('   网页版之所以有月/日精度，是因为HTML页面用的是不同的数据源。');
  } else {
    console.log(`\n✅ API自身就包含不同精度：年${stats.year} / 月${stats.month} / 日${stats.day}`);
    console.log('   RSSHub如果只显示年份，说明是RSSHub自己截断了。');
  }
}

main().catch(e => console.error('❌', e.message));
