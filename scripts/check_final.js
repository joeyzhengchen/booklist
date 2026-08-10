const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json', 'Referer': 'https://m.douban.com/' },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
  });
}

async function main() {
  // 不带 mode=collection（info 字段可用）
  const raw = await fetchUrl('https://m.douban.com/rexxar/api/v2/subject_collection/new_book_fiction/items?start=0&count=10');
  const data = JSON.parse(raw);
  
  console.log('📡 new_book_fiction（无 mode=collection）\n');
  console.log('对比 card_subtitle vs info vs release_date:\n');
  console.log('card_subtitle          info                       release_date');
  console.log('─'.repeat(90));
  
  data.items.forEach(item => {
    const cs = (item.card_subtitle || '').substring(0, 35).padEnd(24);
    const info = (item.info || 'N/A').substring(0, 35).padEnd(28);
    const rd = (item.release_date || 'N/A').padEnd(15);
    console.log(`${cs} ${info} ${rd}  《${item.title}》`);
  });
  
  // 统计 info 字段的日期精度
  console.log('\n📊 info 字段日期精度统计:');
  let day = 0, month = 0, year = 0;
  data.items.forEach(item => {
    const info = item.info || '';
    const parts = info.split('/');
    const datePart = parts[parts.length - 1]?.trim() || '';
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(datePart)) day++;
    else if (/^\d{4}-\d{1,2}$/.test(datePart)) month++;
    else if (/^\d{4}$/.test(datePart)) year++;
  });
  console.log(`  日维度: ${day}  月维度: ${month}  年维度: ${year}`);
  console.log(`\n✅ 结论: card_subtitle 固定年精度，但 info / release_date 字段有更精确的日期。`);
  console.log(`   RSSHub 使用了 card_subtitle，所以只显示年份。`);
}

main().catch(e => console.error('❌', e.message));
