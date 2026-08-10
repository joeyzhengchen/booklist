const https = require('https');
const cheerio = require('cheerio');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html,application/json', 'Referer': 'https://book.douban.com/' },
      timeout: 20000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
  });
}

async function main() {
  // 1. HTML "最新" 页面
  console.log('📡 [1/3] 抓取 HTML "最新" 页面...');
  const html = await fetchUrl('https://book.douban.com/latest?subcat=文学');
  const $ = cheerio.load(html);
  const htmlBooks = [];
  $('.article li').each((i, el) => {
    const titleLink = $(el).find('h2 a').first();
    if (!titleLink.length) return;
    const title = titleLink.text().trim();
    const url = titleLink.attr('href') || '';
    const subjectIdMatch = url.match(/\/subject\/(\d+)/);
    htmlBooks.push({ title, subjectId: subjectIdMatch ? subjectIdMatch[1] : '', source: 'HTML最新' });
  });
  console.log(`   ✅ ${htmlBooks.length} 本`);

  // 2. API "新书速递" - 不带 mode=collection（有info字段）
  console.log('📡 [2/3] 抓取 API "新书速递" (new_book_fiction)...');
  const apiRaw = await fetchUrl('https://m.douban.com/rexxar/api/v2/subject_collection/new_book_fiction/items?start=0&count=50');
  const apiData = JSON.parse(apiRaw);
  const apiBooks = (apiData.items || []).map(item => ({
    title: item.title,
    subjectId: item.id || '',
    info: item.info || '',
    card_subtitle: item.card_subtitle || '',
    source: 'API新书速递'
  }));
  console.log(`   ✅ ${apiBooks.length} 本`);

  // 3. 对比
  console.log('\n' + '='.repeat(60));
  console.log('  📊 对比分析');
  console.log('='.repeat(60));
  console.log(`  HTML "最新":    ${htmlBooks.length} 本`);
  console.log(`  API "新书速递": ${apiBooks.length} 本`);

  // 按书名匹配
  const htmlTitles = new Set(htmlBooks.map(b => b.title));
  const apiTitles = new Set(apiBooks.map(b => b.title));
  
  const overlap = [...htmlTitles].filter(t => apiTitles.has(t));
  const onlyHtml = [...htmlTitles].filter(t => !apiTitles.has(t));
  const onlyApi = [...apiTitles].filter(t => !htmlTitles.has(t));

  console.log(`\n  交集（两边都有）: ${overlap.length} 本`);
  console.log(`  仅在 HTML "最新": ${onlyHtml.length} 本`);
  console.log(`  仅在 API "新书速递": ${onlyApi.length} 本`);

  if (overlap.length > 0) {
    console.log(`\n  📋 交集书籍:`);
    overlap.forEach(t => console.log(`     ✓ 《${t}》`));
  }

  console.log(`\n  📋 仅在 HTML "最新" (${onlyHtml.length}):`);
  onlyHtml.forEach(t => console.log(`     - 《${t}》`));

  console.log(`\n  📋 仅在 API "新书速递" (${onlyApi.length}):`);
  onlyApi.forEach(t => {
    const b = apiBooks.find(x => x.title === t);
    const dateMatch = (b.info || '').match(/\d{4}-\d{1,2}(-\d{1,2})?/);
    const date = dateMatch ? dateMatch[0] : (b.card_subtitle || '').match(/\d{4}/)?.[0] || '?';
    console.log(`     + 《${t}》 (${date})`);
  });

  console.log(`\n  📊 结论: ${overlap.length === 0 ? '两个数据源完全没有重叠，是两套独立书目！' : `交集 ${overlap.length} 本`}`);
  if (overlap.length === 0) {
    console.log('  HTML "最新" = 最近录入豆瓣数据库的书');
    console.log('  API "新书速递" = 豆瓣编辑精选的新书合集');
    console.log('  两者互补，合并使用覆盖面最大。');
  }
}

main().catch(e => console.error('❌', e.message));
