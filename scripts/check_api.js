/**
 * 检查豆瓣 API 返回的原始数据，看日期字段精度
 */
const https = require('https');

function fetchUrl(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://book.douban.com/',
        ...extraHeaders,
      },
      timeout: 15000,
    }, (res) => {
      console.log(`   HTTP ${res.statusCode}`);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
        console.log(`   Body (first 500 chars): ${data.substring(0, 500)}`);
        resolve(data);
      } else reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function main() {
  // 豆瓣移动端 API - 新书速递
  const urls = [
    'https://m.douban.com/rexxar/api/v2/subject_collection/book_latest/items?start=0&count=20',
    'https://m.douban.com/rexxar/api/v2/subject_collection/book_latest/items?start=0&count=20&for_mobile=1',
  ];

  for (const url of urls) {
    try {
      console.log(`\n📡 ${url}`);
      const raw = await fetchUrl(url, { Referer: 'https://m.douban.com/' });
      const data = JSON.parse(raw);
      
      if (data.items && data.items.length > 0) {
        console.log(`   ✅ ${data.items.length} 本书\n`);
        data.items.slice(0, 5).forEach((item, i) => {
          console.log(`   ${i+1}.《${item.title}》`);
          console.log(`      card_subtitle: "${item.card_subtitle}"`);
          console.log(`      rating: ${item.rating?.value || '无'}`);
          // 打印所有字段看有没有日期
          const keys = Object.keys(item);
          console.log(`      keys: ${keys.join(', ')}`);
          // 检查是否有pub_date等字段
          if (item.pub_date) console.log(`      pub_date: ${item.pub_date}`);
          if (item.publish_date) console.log(`      publish_date: ${item.publish_date}`);
          if (item.release_date) console.log(`      release_date: ${item.release_date}`);
          console.log('');
        });
        
        // 统计 card_subtitle 中的日期格式
        console.log('   📊 card_subtitle 日期格式统计:');
        const yearOnly = [], monthLevel = [], dayLevel = [], other = [];
        data.items.forEach(item => {
          const sub = item.card_subtitle || '';
          // 提取日期部分: 通常是 "xxx / 日期 / xxx"
          const parts = sub.split('/').map(s => s.trim());
          // 找日期
          const datePattern = /^\d{4}(-\d{1,2}(-\d{1,2})?)?$/;
          const datePart = parts.find(p => datePattern.test(p));
          if (datePart) {
            if (/^\d{4}$/.test(datePart)) yearOnly.push({ title: item.title, date: datePart });
            else if (/^\d{4}-\d{1,2}$/.test(datePart)) monthLevel.push({ title: item.title, date: datePart });
            else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(datePart)) dayLevel.push({ title: item.title, date: datePart });
            else other.push({ title: item.title, date: datePart });
          } else {
            other.push({ title: item.title, date: sub });
          }
        });
        
        const total = data.items.length;
        console.log(`   总: ${total}`);
        console.log(`   年维度 (YYYY):      ${yearOnly.length} (${(yearOnly.length/total*100).toFixed(0)}%)`);
        console.log(`   月维度 (YYYY-MM):   ${monthLevel.length} (${(monthLevel.length/total*100).toFixed(0)}%)`);
        console.log(`   日维度 (YYYY-MM-DD): ${dayLevel.length} (${(dayLevel.length/total*100).toFixed(0)}%)`);
        console.log(`   其他:               ${other.length}`);
        
        if (yearOnly.length <= 5) {
          yearOnly.forEach(b => console.log(`     -《${b.title}》→ ${b.date}`));
        }
        if (monthLevel.length <= 5) {
          monthLevel.forEach(b => console.log(`     -《${b.title}》→ ${b.date}`));
        }
      }
    } catch (e) {
      console.log(`   ❌ ${e.message}`);
    }
  }
}

main().catch(e => console.error(e));
