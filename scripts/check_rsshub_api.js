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
  return 'other';
}

async function main() {
  // RSSHub 实际调用的 API（文学类 = fiction）
  const url = 'https://m.douban.com/rexxar/api/v2/subject_collection/new_book_fiction/items?start=0&count=20&mode=collection&for_mobile=1';
  
  console.log(`📡 ${url}\n`);
  const raw = await fetchUrl(url);
  const data = JSON.parse(raw);
  const items = data.subject_collection_items || [];

  console.log(`API 返回 ${items.length} 本书\n`);

  const stats = { day: 0, month: 0, year: 0, other: 0 };
  const details = [];

  items.forEach((item, i) => {
    const info = item.info || '';
    const parts = info.split('/').map(s => s.trim());
    let dateRaw = '';
    for (const p of parts) {
      const cleaned = p.trim();
      if (/^\d{4}(-\d{1,2}(-\d{1,2})?)?$/.test(cleaned)) {
        dateRaw = cleaned;
        break;
      }
    }
    if (!dateRaw) {
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
  console.log('📊 new_book_fiction API info 字段日期精度:\n');
  console.log(`  日维度 (YYYY-MM-DD): ${String(stats.day).padStart(2)} 本 (${(stats.day/total*100).toFixed(0)}%)`);
  console.log(`  月维度 (YYYY-MM):    ${String(stats.month).padStart(2)} 本 (${(stats.month/total*100).toFixed(0)}%)`);
  console.log(`  年维度 (YYYY):       ${String(stats.year).padStart(2)} 本 (${(stats.year/total*100).toFixed(0)}%)`);
  if (stats.other) console.log(`  其他:                ${String(stats.other).padStart(2)} 本`);

  console.log('\n📋 全部明细:');
  details.forEach((d, i) => {
    const icon = { day: '📅', month: '📆', year: '🗓️', other: '❓' }[d.precision] || '  ';
    console.log(`  ${String(i+1).padStart(2)}. ${icon} [${d.precision.padEnd(5)}] "${d.dateRaw}" →《${d.title}》`);
  });

  // 检查 info 原始内容中日期部分
  console.log('\n📋 info 原始内容（含完整日期）:');
  details.forEach((d, i) => {
    console.log(`  ${String(i+1).padStart(2)}. info="${d.info}"`);
  });
  
  if (stats.year === total) {
    console.log('\n⚠️ 结论: new_book_fiction API 的 info 字段只有年份！');
    console.log('   这是豆瓣移动端API的设计，与网页版不同。');
  } else {
    console.log('\n✅ 该API包含多种精度。RSSHub若只显示年份，是RSSHub的问题。');
  }
}

main().catch(e => console.error('❌', e.message));
