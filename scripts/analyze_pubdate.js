/**
 * 豆瓣出版时间精度分析脚本
 * 统计文学类新书列表中：年维度 / 月维度 / 日维度 的占比
 */

const https = require('https');
const cheerio = require('cheerio');

const URL = 'https://book.douban.com/latest?subcat=文学';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => res.statusCode === 200 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}`)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function classifyDate(raw) {
  if (!raw || raw.trim() === '') return { precision: 'unknown', raw };
  
  const s = raw.trim();
  
  // 2026-06-17 格式
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return { precision: 'day', raw: s };
  // 2026-06 或 2026-6 格式
  if (/^\d{4}-\d{1,2}$/.test(s)) return { precision: 'month', raw: s };
  // 纯四位年份 2026
  if (/^\d{4}$/.test(s)) return { precision: 'year', raw: s };
  // 中文日期 2026年6月
  if (/^\d{4}年\d{1,2}月$/.test(s)) return { precision: 'month', raw: s };
  // 中文年份 2026年
  if (/^\d{4}年$/.test(s)) return { precision: 'year', raw: s };
  // 带日的 2026年6月17日
  if (/^\d{4}年\d{1,2}月\d{1,2}日$/.test(s)) return { precision: 'day', raw: s };
  
  return { precision: 'unknown', raw: s };
}

async function main() {
  console.log('📡 获取豆瓣文学新书列表...');
  const html = await fetchUrl(URL);
  console.log(`✅ 获取成功 (${html.length} 字符)\n`);

  const $ = cheerio.load(html);
  const results = [];
  
  $('.article li').each((i, el) => {
    const $el = $(el);
    const titleLink = $el.find('h2 a').first();
    if (!titleLink.length) return;
    
    const title = titleLink.text().trim();
    const abstractText = $el.find('.subject-abstract').text().trim();
    const metaParts = abstractText.split('/').map(s => s.trim());
    
    // 找出版日期
    const datePattern = /^\d{4}(-\d{1,2}(-\d{1,2})?)?$/;
    let dateIdx = -1;
    for (let j = 0; j < metaParts.length; j++) {
      if (datePattern.test(metaParts[j])) { dateIdx = j; break; }
    }
    
    const rawDate = dateIdx >= 0 ? metaParts[dateIdx] : '';
    const classification = classifyDate(rawDate);
    
    results.push({
      title: title.length > 30 ? title.substring(0, 30) + '...' : title,
      rawDate,
      precision: classification.precision,
    });
  });

  // 统计
  const counts = { day: 0, month: 0, year: 0, unknown: 0 };
  results.forEach(r => counts[r.precision]++);
  const total = results.length;

  console.log('='.repeat(55));
  console.log('  豆瓣文学新书 - 出版时间精度分析');
  console.log('='.repeat(55));
  console.log(`  总书籍数: ${total}\n`);
  
  console.log('  📊 精度分布:');
  console.log(`    日维度 (YYYY-MM-DD):  ${String(counts.day).padStart(3)} 本  (${(counts.day/total*100).toFixed(1)}%)`);
  console.log(`    月维度 (YYYY-MM):     ${String(counts.month).padStart(3)} 本  (${(counts.month/total*100).toFixed(1)}%)`);
  console.log(`    年维度 (YYYY):        ${String(counts.year).padStart(3)} 本  (${(counts.year/total*100).toFixed(1)}%)`);
  if (counts.unknown > 0) {
    console.log(`    未知格式:             ${String(counts.unknown).padStart(3)} 本  (${(counts.unknown/total*100).toFixed(1)}%)`);
  }
  
  // 列出年维度书籍
  if (counts.year > 0) {
    console.log(`\n  📋 仅精确到年的书籍 (${counts.year} 本):`);
    results.filter(r => r.precision === 'year').forEach((r, i) => {
      console.log(`    ${i+1}.《${r.title}》 → ${r.rawDate}`);
    });
  }
  
  // 列出未知格式
  if (counts.unknown > 0) {
    console.log(`\n  ❓ 未知格式 (${counts.unknown} 本):`);
    results.filter(r => r.precision === 'unknown').forEach((r, i) => {
      console.log(`    ${i+1}.《${r.title}》 → "${r.rawDate}"`);
    });
  }

  // 详细列表
  console.log(`\n  📋 全部明细:`);
  results.forEach((r, i) => {
    const label = { day: '日', month: '月', year: '年', unknown: '?' }[r.precision];
    console.log(`    ${String(i+1).padStart(2)}. [${label}] ${r.rawDate || '(空)'}  《${r.title}》`);
  });

  console.log('\n' + '='.repeat(55));
}

main().catch(e => { console.error('❌ 失败:', e.message); process.exit(1); });
