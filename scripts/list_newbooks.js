const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://m.douban.com/',
      },
      timeout: 20000,
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

function extractDate(info) {
  if (!info) return '无';
  const parts = info.split('/').map(s => s.trim());
  for (const p of parts) {
    const t = p.trim();
    if (/^\d{4}(-\d{1,2}(-\d{1,2})?)?$/.test(t)) return t;
  }
  return '无';
}

async function main() {
  const raw = await fetchUrl('https://m.douban.com/rexxar/api/v2/subject_collection/new_book_fiction/items?start=0&count=50');
  const data = JSON.parse(raw);
  const items = data.items || [];

  console.log(`新书速递 API (new_book_fiction) 共 ${items.length} 本\n`);
  console.log('序号 | 书名                                    | 出版时间    | 评分');
  console.log('─'.repeat(78));

  items.forEach((item, i) => {
    const title = (item.title || '').substring(0, 35).padEnd(35, ' ');
    const date = extractDate(item.info).padEnd(12, ' ');
    const rating = item.rating && item.rating.value ? String(item.rating.value) : '-';
    // 标记当月新书
    const isCurrentMonth = date.startsWith('2026-6');
    const marker = isCurrentMonth ? ' ← 当月' : '';
    console.log(`${String(i + 1).padStart(2)} | ${title} | ${date} | ${rating}${marker}`);
  });

  // 统计
  const monthCount = items.filter(it => {
    const d = extractDate(it.info);
    return d.startsWith('2026-6');
  }).length;
  console.log('\n统计:');
  console.log(`  总计: ${items.length} 本`);
  console.log(`  6月(当月): ${monthCount} 本`);
  console.log(`  5月: ${items.filter(it => extractDate(it.info).startsWith('2026-5')).length} 本`);
  console.log(`  4月及更早: ${items.length - monthCount - items.filter(it => extractDate(it.info).startsWith('2026-5')).length} 本`);
}

main().catch(e => console.error('❌', e.message));
