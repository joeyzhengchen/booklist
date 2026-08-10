const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://m.douban.com/',
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
      });
    });
    req.on('error', reject);
  });
}

async function main() {
  // 尝试不同 URL 变体
  const urls = [
    'https://m.douban.com/rexxar/api/v2/subject_collection/new_book_fiction/items?start=0&count=10&mode=collection&for_mobile=1',
    'https://m.douban.com/rexxar/api/v2/subject_collection/new_book_fiction/items?start=0&count=10',
    'https://m.douban.com/rexxar/api/v2/subject_collection/new_book_all/items?start=0&count=10&mode=collection&for_mobile=1',
    'https://m.douban.com/rexxar/api/v2/subject_collection/new_book_all/items?start=0&count=10',
  ];

  for (const url of urls) {
    try {
      console.log(`\n📡 ${url}`);
      const raw = await fetchUrl(url);
      const data = JSON.parse(raw);
      
      // Check what format the response is in
      console.log(`   keys: ${Object.keys(data).join(', ')}`);
      
      let items = [];
      if (data.items) {
        items = data.items;
        console.log(`   data.items: ${items.length} 本`);
      }
      if (data.subject_collection_items) {
        items = data.subject_collection_items;
        console.log(`   data.subject_collection_items: ${items.length} 本`);
      }
      
      if (items.length > 0) {
        // 看第一本书的 card_subtitle
        const first = items[0];
        console.log(`   第一本: 《${first.title}》`);
        console.log(`   card_subtitle: "${first.card_subtitle}"`);
        console.log(`   info: "${first.info}"`);
        console.log(`   keys: ${Object.keys(first).join(', ')}`);
      } else {
        console.log(`   无数据，完整响应: ${raw.substring(0, 300)}`);
      }
    } catch (e) {
      console.log(`   ❌ ${e.message}`);
    }
  }
}

main().catch(e => console.error('❌', e.message));
