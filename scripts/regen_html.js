/**
 * 从已有 JSON 数据重新生成 HTML 和 wx.txt（修正 isNewToday 标记后使用）
 */
const fs = require('fs');
const path = require('path');

const date = process.argv[2] || '2026-06-22';
const jsonPath = path.join(__dirname, '..', 'reports', date + '.json');
const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * 加载 date 之前所有历史日期的 subjectId 集合（用于判断"本月新增中第一次出现"）
 * 只统计当月数据，不跨月
 */
function loadAllPriorBooks(dateStr) {
  const p = path.join(DATA_DIR, 'yesterday_books.json');
  if (!fs.existsSync(p)) return new Set();
  const currentMonthPrefix = dateStr.substring(0, 7);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const books = data.books || {};
    const priorSet = new Set();
    for (const [d, ids] of Object.entries(books)) {
      if (d >= dateStr) continue;
      if (!d.startsWith(currentMonthPrefix)) continue; // 不跨月
      if (!Array.isArray(ids)) continue;
      for (const id of ids) if (id) priorSet.add(id);
    }
    return priorSet;
  } catch (e) {}
  return new Set();
}

const allPriorBooksSet = loadAllPriorBooks(date);

// 加载所有早于当日的历史书单，补全当日缺失的继承书籍（仅限当月）
function loadAllPriorMonthBooks(dateStr) {
  const p = path.join(DATA_DIR, 'yesterday_books.json');
  if (!fs.existsSync(p)) return [];
  const currentMonthPrefix = dateStr.substring(0, 7);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const books = data.books || {};
    const priorMap = new Map(); // subjectId -> { book, date }
    for (const [d, ids] of Object.entries(books)) {
      if (d >= dateStr) continue;
      if (!d.startsWith(currentMonthPrefix)) continue; // 不跨月继承
      if (!Array.isArray(ids) || ids.length === 0) continue;
      const reportPath = path.join(__dirname, '..', 'reports', `${d}.json`);
      if (!fs.existsSync(reportPath)) continue;
      const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      const monthBooks = reportData.monthBooks || [];
      for (const b of monthBooks) {
        if (!b.subjectId || !b.title) continue;
        const existing = priorMap.get(b.subjectId);
        if (!existing || d > existing.date) {
          priorMap.set(b.subjectId, { book: b, date: d });
        }
      }
    }
    return [...priorMap.values()].map(v => v.book);
  } catch (e) {}
  return [];
}

const monthBooks = jsonData.monthBooks;
// 补全当月历史中出现、但今日 JSON 中缺失的继承书籍
const allPriorMonthBooks = loadAllPriorMonthBooks(date);
const todaySubjectIds = new Set(monthBooks.map(b => b.subjectId));
let carryOverAdded = 0;
for (const pb of allPriorMonthBooks) {
  if (!todaySubjectIds.has(pb.subjectId) && pb.title) {
    pb.isCarryOver = true;
    monthBooks.push(pb);
    todaySubjectIds.add(pb.subjectId);
    carryOverAdded++;
  }
}

// 重新计算 isNewToday / isCarryOver（以全月历史为准）
monthBooks.forEach(b => {
  if (b.isCarryOver) {
    b.isNewToday = false;
  } else {
    b.isNewToday = !allPriorBooksSet.has(b.subjectId);
  }
});
// 排序：本日新增置顶，其次非继承书籍，继承置底
monthBooks.sort((a, b) => {
  if (a.isNewToday !== b.isNewToday) return a.isNewToday ? -1 : 1;
  if (a.isCarryOver !== b.isCarryOver) return a.isCarryOver ? 1 : -1;
  return 0;
});

// 保存修正后的 JSON
fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
console.log('✅ JSON 已更新，继承补全:', carryOverAdded, '本');
const recommendations = jsonData.recommendations;
const { preferenceBased, random } = recommendations;
const allRecs = [...preferenceBased, ...random];
const today = { dateStr: date, year: +date.split('-')[0], month: +date.split('-')[1], fetchTime: jsonData.fetchTime };
const newCount = monthBooks.filter(b => b.isNewToday).length;
const SERVER_PORT = 3456;
const SUBCATS = ['文学', '历史', '哲学', '社科', '文化', '艺术', '传记'];

function formatDateLabel(pd) {
  if (!pd) return '未知';
  return pd.precision === 'day' ? pd.raw : pd.raw + '（仅精确到月）';
}
const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- HTML ----
let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>每日人文社科新书速递 - ${today.dateStr}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:#f5f0eb;color:#2c2c2c;line-height:1.8;padding:20px}
.container{max-width:800px;margin:0 auto}
.header{background:linear-gradient(135deg,#2c3e50,#34495e);color:#fff;padding:30px;border-radius:12px;margin-bottom:24px;text-align:center}
.header h1{font-size:26px;margin-bottom:8px}
.header .meta{font-size:13px;opacity:0.85}
.header .stats{margin-top:12px;font-size:14px;display:flex;justify-content:center;gap:16px;flex-wrap:wrap}
.header .stats span{background:rgba(255,255,255,0.15);padding:4px 12px;border-radius:20px}
.section{margin-bottom:24px}
.section-title{font-size:20px;font-weight:700;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #c9a96e;display:flex;align-items:center;gap:8px}
.section-title .count{font-size:14px;color:#888;font-weight:400}
.book-card{background:#fff;border-radius:10px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06);display:flex;gap:16px;align-items:flex-start}
.book-card .cover{width:100px;height:140px;border-radius:4px;object-fit:cover;flex-shrink:0;background:#eee}
.book-card .info{flex:1;min-width:0}
.book-card .info h3{font-size:17px;margin-bottom:6px;display:flex;align-items:center;gap:8px}
.book-card .info h3 .tag-new{font-size:11px;background:#e74c3c;color:#fff;padding:2px 8px;border-radius:10px;font-weight:500}
.book-card .meta-row{font-size:13px;color:#666;margin-bottom:6px}
.book-card .meta-row span{margin-right:12px}
.book-card .desc{font-size:13px;color:#444;margin-top:8px;line-height:1.7;border-left:3px solid #c9a96e;padding-left:10px}
.rec-card{background:#fff;border-radius:10px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06)}
.rec-card h3{font-size:17px;margin-bottom:4px}
.rec-card .rec-author{font-size:14px;color:#555;margin-bottom:4px}
.rec-card .rec-author-bio{font-size:12px;color:#999;margin-bottom:8px;line-height:1.6}
.rec-card .rec-desc{font-size:13px;color:#444;margin-bottom:8px;line-height:1.7}
.rec-card .rec-meta{font-size:12px;color:#999;margin-bottom:8px}
.rec-card .rec-reason{font-size:13px;color:#8b6914;background:#fef9e7;padding:8px 12px;border-radius:6px;margin-bottom:12px;line-height:1.6}
.rec-card .rec-reason::before{content:'💡 推荐理由：';font-weight:600}
.heart-btn{display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:8px 18px;border:1.5px solid #e0d0d0;border-radius:24px;font-size:14px;color:#888;background:#fff;transition:all 0.3s ease;user-select:none}
.heart-btn:hover{border-color:#e74c3c;color:#e74c3c}
.heart-btn.liked{border-color:#e74c3c;color:#e74c3c;background:#fef5f5}
.heart-btn .heart-icon{font-size:18px;transition:transform 0.3s ease}
.heart-btn.liked .heart-icon{transform:scale(1.2)}
.footer{text-align:center;color:#aaa;font-size:12px;margin-top:32px;padding:16px;border-top:1px solid #e8e0d8}
.type-tag{font-size:11px;background:#f0e6d2;color:#8b6914;padding:2px 8px;border-radius:10px;margin-left:8px}
.section-desc{font-size:13px;color:#888;margin-bottom:12px}
a{color:#2c3e50;text-decoration:none}
a:hover{text-decoration:underline}
#back-to-top{position:fixed;right:24px;bottom:24px;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#2c3e50,#34495e);color:#fff;border:none;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.2);font-size:22px;display:flex;align-items:center;justify-content:center;opacity:0;visibility:hidden;transition:opacity 0.3s ease,visibility 0.3s ease,transform 0.3s ease;z-index:999}
#back-to-top.visible{opacity:1;visibility:visible}
#back-to-top:hover{transform:translateY(-3px);box-shadow:0 6px 16px rgba(0,0,0,0.3)}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>📚 每日人文社科新书速递</h1>
<div class="meta">${today.dateStr} · 数据来源: <a href="https://book.douban.com/latest" target="_blank" style="color:#f0d78c">豆瓣 新书速递 + 最新（${SUBCATS.join('、')}）</a> · ${today.fetchTime}</div>
<div class="stats">
<span>📆 本月 ${monthBooks.length} 本</span>
<span>🆕 新增 ${newCount} 本</span>
<span>🌟 推荐 ${allRecs.length} 本</span>
</div>
</div>
<div class="section">
<div class="section-title">📆 本月新书 <span class="count">（${monthBooks.length} 本）</span></div>
<div class="section-desc">${today.year}年${today.month}月出版的人文社科类新书（已排除教辅、工具书）</div>`;

monthBooks.forEach((book, i) => {
  const isNew = book.isNewToday;
  html += `
<div class="book-card">
${book.cover && !book.cover.includes('default') ? `<img class="cover" src="${esc(book.cover)}" alt="封面">` : '<div class="cover" style="display:flex;align-items:center;justify-content:center;color:#ccc;font-size:12px">暂无封面</div>'}
<div class="info">
<h3>${i + 1}. ${esc(book.title)}${isNew ? '<span class="tag-new">本日新增</span>' : ''}</h3>
<div class="meta-row"><span>✍ ${esc(book.author || '未知')}</span><span>🏠 ${esc(book.publisher || '未知')}</span></div>
<div class="meta-row"><span>📅 ${formatDateLabel(book.pubDateParsed)}</span><span>💰 ${esc(book.price || '未知')}</span>${book.binding ? `<span>📖 ${esc(book.binding)}</span>` : ''}</div>
${book.rating ? `<div class="meta-row">⭐ ${esc(book.rating)} ${book.ratingText ? `(${esc(book.ratingText)})` : ''}</div>` : ''}
${book.description ? `<div class="desc">${esc(book.description)}</div>` : ''}
<div class="meta-row" style="margin-top:8px"><a href="${esc(book.url)}" target="_blank">🔗 豆瓣详情 →</a></div>
</div>
</div>`;
});

html += `</div>
<div class="section">
<div class="section-title">🌟 当日推荐 <span class="count">（${allRecs.length} 本）</span></div>
<div class="section-desc">每天5本精选好书，2本根据你的喜好推荐，3本随机探索</div>`;

allRecs.forEach((rec, i) => {
  const recType = i < preferenceBased.length ? '偏好推荐' : '随机发现';
  html += `
<div class="rec-card">
<h3>${i + 1}. ${esc(rec.title)} <span class="type-tag">${recType}</span></h3>
<div class="rec-author">✍ ${esc(rec.author)}</div>
<div class="rec-author-bio">${esc(rec.authorBio || '')}</div>
<div class="rec-desc">${esc(rec.description || '')}</div>
<div class="rec-meta">📅 出版日期: ${esc(rec.pubDate || '未知')} · 🏠 ${esc(rec.publisher || '未知')}</div>
<div class="rec-reason">${esc(rec.reason || '')}</div>
<button class="heart-btn" data-book-id="${esc(rec.id)}" data-title="${esc(rec.title)}" data-author="${esc(rec.author)}" data-genres="${esc(JSON.stringify(rec.genres || []))}" data-tags="${esc(JSON.stringify(rec.tags || []))}" onclick="toggleHeart(this)">
<span class="heart-icon">♡</span> 感兴趣
</button>
</div>`;
});

html += `</div>
<div class="footer">
<p>本报告由每日人文社科新书采集器自动生成 · 数据来源: 豆瓣网</p>
<p style="margin-top:4px">点击"感兴趣"按钮后，明天的推荐会为你精准匹配同作者、同题材的好书 ❤️</p>
</div>
</div>
<button id="back-to-top" title="返回顶部">&#8593;</button>
<script>
const API = 'http://localhost:${SERVER_PORT}';
async function loadLiked() {
  try { const r = await fetch(API + '/api/preferences'); const d = await r.json();
    d.liked.forEach(b => {
      const btn = document.querySelector('.heart-btn[data-book-id="' + b.bookId + '"]');
      if (btn) { btn.classList.add('liked'); btn.querySelector('.heart-icon').textContent = '♥'; }
    });
  } catch(e){}
}
async function toggleHeart(btn) {
  const bookId = btn.dataset.bookId, title = btn.dataset.title, author = btn.dataset.author;
  const genres = JSON.parse(btn.dataset.genres || '[]'), tags = JSON.parse(btn.dataset.tags || '[]');
  const liked = !btn.classList.contains('liked');
  try {
    await fetch(API + '/api/heart', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({bookId, title, author, genres, tags, liked}) });
  } catch(e){}
  if (liked) { btn.classList.add('liked'); btn.querySelector('.heart-icon').textContent = '♥'; }
  else { btn.classList.remove('liked'); btn.querySelector('.heart-icon').textContent = '♡'; }
}
loadLiked();
const backToTop = document.getElementById('back-to-top');
if (backToTop) {
  backToTop.addEventListener('click', () => window.scrollTo({top:0,behavior:'smooth'}));
  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) backToTop.classList.add('visible');
    else backToTop.classList.remove('visible');
  });
}
<\/script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, '..', 'reports', date + '.html'), html, 'utf-8');
console.log('✅ HTML 已重新生成，新增标记:', newCount, '本');

// ---- wx.txt ----
const wxLines = [];
wxLines.push('📚 每日人文社科新书速递');
wxLines.push('📅 ' + today.dateStr);
wxLines.push('📆 本月新书 ' + monthBooks.length + ' 本 | 🆕 新增 ' + newCount + ' 本 | 🌟 推荐 ' + allRecs.length + ' 本');
wxLines.push('');
wxLines.push('━━━━━━━━━━━━━━━━━━');
wxLines.push('📆 本月新书');
wxLines.push('━━━━━━━━━━━━━━━━━━');
monthBooks.forEach((book, i) => {
  const tag = book.isNewToday ? ' 🏷️本日新增' : '';
  wxLines.push('  ' + (i + 1) + '.《' + book.title + '》' + tag);
  wxLines.push('     作者：' + (book.author || '未知'));
  wxLines.push('     出版：' + (book.publisher || '未知') + ' | ' + formatDateLabel(book.pubDateParsed));
  if (book.description) {
    const s = book.description.length > 120 ? book.description.substring(0, 120) + '...' : book.description;
    wxLines.push('     简介：' + s);
  }
  wxLines.push('');
});
wxLines.push('━━━━━━━━━━━━━━━━━━');
wxLines.push('🌟 当日推荐');
wxLines.push('━━━━━━━━━━━━━━━━━━');
allRecs.forEach((rec, i) => {
  const recType = i < preferenceBased.length ? '【偏好推荐】' : '【随机发现】';
  wxLines.push('  ' + (i + 1) + '.《' + rec.title + '》' + recType);
  wxLines.push('     作者：' + rec.author);
  if (rec.authorBio) { const s = rec.authorBio.length > 80 ? rec.authorBio.substring(0, 80) + '...' : rec.authorBio; wxLines.push('     作者简介：' + s); }
  if (rec.description) { const s = rec.description.length > 150 ? rec.description.substring(0, 150) + '...' : rec.description; wxLines.push('     内容简介：' + s); }
  wxLines.push('     出版：' + (rec.pubDate || '未知') + ' | ' + (rec.publisher || '未知'));
  wxLines.push('     💡 ' + (rec.reason || '值得一读'));
  wxLines.push('');
});
wxLines.push('━━━━━━━━━━━━━━━━━━');
wxLines.push('💝 点击下方链接查看完整交互版（含封面、爱心按钮）：');
wxLines.push('   http://localhost:' + SERVER_PORT);
wxLines.push('');
wxLines.push('📖 数据来源：豆瓣 新书速递 + 最新（文学/历史/哲学/社科/文化/艺术/传记）');
wxLines.push('⏰ 每日22:15自动推送');
fs.writeFileSync(path.join(__dirname, '..', 'reports', date + '.wx.txt'), wxLines.join('\n'), 'utf-8');
console.log('✅ wx.txt 已重新生成');
