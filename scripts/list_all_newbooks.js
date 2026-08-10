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

async function fetchPage(start, count) {
  const raw = await fetchUrl(`https://m.douban.com/rexxar/api/v2/subject_collection/new_book_fiction/items?start=${start}&count=${count}`);
  return JSON.parse(raw);
}

async function main() {
  // 先获取 total
  const first = await fetchPage(0, 50);
  const total = first.total || 0;
  console.log(`📊 新书速递 total = ${total} 本`);

  // 收集所有书
  const allBooks = [...(first.items || [])];
  const pageSize = 50;
  let start = 50;

  while (start < total) {
    console.log(`  抓取 ${start} ~ ${Math.min(start + pageSize - 1, total)} ...`);
    try {
      const page = await fetchPage(start, pageSize);
      if (!page.items || page.items.length === 0) break;
      allBooks.push(...page.items);
      start += page.items.length;
      if (page.items.length < pageSize) break;
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
      break;
    }
  }

  console.log(`\n✅ 共获取 ${allBooks.length} 本\n`);

  // 按出版月分组统计
  const byMonth = {};
  allBooks.forEach(book => {
    const date = extractDate(book.info);
    const month = date.substring(0, 7); // YYYY-MM
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(book);
  });

  console.log('📅 按出版月份分布:');
  const sortedMonths = Object.keys(byMonth).sort().reverse();
  sortedMonths.forEach(m => {
    const count = byMonth[m].length;
    const bar = '█'.repeat(Math.round(count / 3));
    console.log(`  ${m}  ${String(count).padStart(3)}  ${bar}`);
  });

  // 输出完整表格
  console.log('\n' + '─'.repeat(78));
  console.log('序号 | 书名'.padEnd(42) + ' | 出版时间   | 评分');
  console.log('─'.repeat(78));

  allBooks.forEach((book, i) => {
    const title = (book.title || '').substring(0, 35).padEnd(35, ' ');
    const date = extractDate(book.info).padEnd(11, ' ');
    const rating = book.rating && book.rating.value ? String(book.rating.value) : '-';
    console.log(`${String(i + 1).padStart(3)} | ${title} | ${date} | ${rating}`);
  });
}

main().catch(e => console.error('❌', e.message));
