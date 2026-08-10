/**
 * 每日人文社科新书采集器 v4
 * - 覆盖文学、历史、哲学、社科、文化、艺术、传记 7 大类
 * - 排除教辅书和工具书
 * - 仅保留"本月新书"栏目，标记"本日新增"
 * - 新增"当日推荐"栏目（5本，含交互爱心按钮）
 * - 生成 HTML 报告（可交互）+ MD 报告（小程序推送）
 * - 启动本地服务器处理爱心点击（端口 3456）
 */

const https = require('https');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { generateRecommendations } = require('./recommendation');

// ============ 配置 ============
const CONFIG = {
  // 覆盖 7 大人文社科分类（排除教辅、工具书、科技、经管等）
  DOUBAN_SUBCATS: ['文学', '历史', '哲学', '社科', '文化', '艺术', '传记'],
  DOUBAN_API_FICTION: 'https://m.douban.com/rexxar/api/v2/subject_collection/new_book_fiction/items',
  DOUBAN_BASE_URL: 'https://book.douban.com',
  OUTPUT_DIR: path.join(__dirname, '..', 'reports'),
  DATA_DIR: path.join(__dirname, '..', 'data'),
  MAX_BOOKS: 150,
  REQUEST_DELAY: 500,
  SUBCAT_DELAY: 800,  // 分类间间隔（对豆瓣友好）
  REQUEST_TIMEOUT: 15000,
  SERVER_PORT: 3456,
};

// 教辅/工具书排除关键词
const EXCLUDE_KEYWORDS = [
  '教辅', '教材', '课本', '练习册', '习题', '试卷', '真题',
  '模拟题', '考试', '备考', '应试', '高考', '中考', '考研',
  '考级', '四六级', '托福', '雅思', 'GRE', '工具书',
  '字帖', '描红', '临摹', '练字', '硬笔', '毛笔',
  '速查', '手册', '大全', '宝典', '指南',
];

// ============ 日期工具 ============
function getToday() {
  const now = new Date();
  return {
    year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(),
    dateStr: now.toISOString().split('T')[0],
    fetchTime: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  };
}

function getYesterdayStr(today) {
  // 用本地年月日拼接，避免 toISOString() 转 UTC 导致时区偏差（在 GMT+8 下会提前一天）
  const d = new Date(today.year, today.month - 1, today.day - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parsePubDate(dateStr) {
  if (!dateStr) return null;
  const fullMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (fullMatch) return { year: +fullMatch[1], month: +fullMatch[2], day: +fullMatch[3], precision: 'day', raw: dateStr };
  const monthMatch = dateStr.match(/^(\d{4})-(\d{1,2})$/);
  if (monthMatch) return { year: +monthMatch[1], month: +monthMatch[2], day: null, precision: 'month', raw: dateStr };
  return null;
}

function classifyByDate(parsedDate, today) {
  if (!parsedDate || parsedDate.year !== today.year || parsedDate.month !== today.month) return 'exclude';
  return 'this_month';
}

function isTextbookOrReference(book) {
  const text = [book.title, book.author, book.publisher, book.description, ...(book.categories || [])].join(' ').toLowerCase();
  return EXCLUDE_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

// ============ 网络请求 ============
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeout: CONFIG.REQUEST_TIMEOUT,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => res.statusCode === 200 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}`)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fetchUrl(url); }
    catch (e) { if (i === retries - 1) throw e; await sleep(CONFIG.REQUEST_DELAY * (i + 1)); }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ 解析函数 ============
function parseBookList(html) {
  const $ = cheerio.load(html);
  const books = [];
  $('.article li').each((i, el) => {
    try {
      const $el = $(el);
      const titleLink = $el.find('h2 a.fleft, h2 a').first();
      if (!titleLink.length) return;
      const title = titleLink.text().trim();
      const url = titleLink.attr('href') || '';
      if (!title || !url) return;
      const cover = $el.find('.media__img img').attr('src') || '';
      const abstractText = $el.find('.subject-abstract').text().trim();
      const metaParts = abstractText.split('/').map(s => s.trim());
      const datePattern = /^\d{4}-\d{1,2}(-\d{1,2})?$/;
      let dateIdx = -1;
      for (let j = 0; j < metaParts.length; j++) { if (datePattern.test(metaParts[j])) { dateIdx = j; break; } }
      let author, pubDateRaw, publisher, price, binding;
      if (dateIdx >= 0) {
        author = metaParts.slice(0, dateIdx).join(' / ') || '';
        pubDateRaw = metaParts[dateIdx] || '';
        publisher = metaParts[dateIdx + 1] || '';
        price = metaParts[dateIdx + 2] || '';
        binding = metaParts[dateIdx + 3] || '';
      } else {
        author = metaParts[0] || ''; pubDateRaw = metaParts[1] || '';
        publisher = metaParts[2] || ''; price = metaParts[3] || ''; binding = metaParts[4] || '';
      }
      const rating = $el.find('.font-small').text().trim() || '';
      const ratingText = $el.find('.subject-rating span.color-gray').text().trim().replace(/[()]/g, '') || '';
      const subjectIdMatch = url.match(/\/subject\/(\d+)/);
      books.push({
        title, url: url.startsWith('http') ? url : CONFIG.DOUBAN_BASE_URL + url,
        subjectId: subjectIdMatch ? subjectIdMatch[1] : '', cover,
        author, pubDate: pubDateRaw,
        pubDateParsed: parsePubDate(pubDateRaw),
        publisher, price, binding, rating, ratingText, description: '', categories: [],
      });
    } catch (e) { /* skip malformed */ }
  });
  return books;
}

function parseBookDetail(html) {
  const $ = cheerio.load(html);
  let description = '';

  // 先移除 link-report 中的 style 标签和 CSS 代码
  $('#link-report style').remove();

  const linkReport = $('#link-report');
  if (linkReport.length) {
    const shortSpan = linkReport.find('span.short');
    const el = shortSpan.length ? shortSpan : linkReport;
    let raw = el.text()
      // 移除 CSS 代码块（.xxx{...}）
      .replace(/\.\S+\s*\{[^}]*\}/g, '')
      // 移除隐藏的 div 样式内容
      .replace(/\.intro\s+[a-z-]+\s*\{[^}]*\}/gi, '')
      // 移除多余的空白
      .replace(/[\t\n\r]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const introIdx = raw.indexOf('内容简介');
    if (introIdx >= 0) {
      raw = raw.substring(introIdx).replace(/^内容简介\s*[·\s]+/, '');
    }

    // 找到结束位置
    let endIdx = raw.length;
    for (const kw of ['作者简介', '目录', '丛书信息', '【编辑推荐】', '+++']) {
      const idx = raw.indexOf(kw);
      if (idx > 0 && idx < endIdx) endIdx = idx;
    }
    description = raw.substring(0, endIdx).trim().replace(/^[·\s]+/, '');
  }

  // 如果简介太短，尝试 meta description
  if (!description || description.length < 20) {
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc) {
      const c = metaDesc.replace(/^图书\S*\s+/, '').replace(/豆瓣.*$/, '').trim();
      if (c.length > description.length) description = c;
    }
  }

  // 最终清理
  description = description
    .replace(/\(展开全部\)|\(收起\)/g, '')
    .replace(/【编辑推荐】.*$/s, '')  // 移除编辑推荐部分
    .replace(/\s+/g, ' ')
    .trim();

  if (description.length > 600) {
    description = description.substring(0, 600) + '...';
  }
  // 分类标签
  const categories = [];
  $('#info .pl').each((i, el) => {
    const label = $(el).text().trim();
    if (label.includes('丛书') || label.includes('系列')) {
      const v = $(el).parent().text().trim().replace(label, '').trim();
      if (v && v.length > 1 && v.length < 30) categories.push(v);
    }
  });
  $('a[href*="/tag/"]').each((i, el) => { const t = $(el).text().trim(); if (t && t.length > 1 && t.length < 15) categories.push(t); });
  // 详情页日期
  let detailPubDate = null;
  $('#info .pl').each((i, el) => {
    const label = $(el).text().trim();
    if (label.includes('出版')) { const v = $(el).parent().text().trim().replace(label, '').replace(/[：:]/g, '').trim(); const p = parsePubDate(v); if (p) detailPubDate = p; }
  });
  return { description, categories: [...new Set(categories)], detailPubDate };
}

// ============ API 数据源（新书速递 new_book_fiction）============
async function fetchApiJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://m.douban.com/',
      },
      timeout: CONFIG.REQUEST_TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON parse error')); }
        } else { reject(new Error(`HTTP ${res.statusCode}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseApiInfo(infoStr) {
  // info 格式: "作者/出版社/日期" e.g. "杨怡芬/浙江文艺出版社/2026-4"
  if (!infoStr) return { author: '', publisher: '', pubDate: '' };
  const parts = infoStr.split('/').map(s => s.trim());
  // 从后往前找日期
  let dateIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d{4}(-\d{1,2}(-\d{1,2})?)?$/.test(parts[i])) { dateIdx = i; break; }
  }
  if (dateIdx < 0) return { author: parts[0] || '', publisher: parts[1] || '', pubDate: '' };
  const author = parts.slice(0, dateIdx - 1).join(' / ') || parts[0] || '';
  const publisher = dateIdx > 0 ? parts[dateIdx - 1] || '' : '';
  const pubDate = parts[dateIdx] || '';
  return { author, publisher, pubDate };
}

async function fetchAllApiBooks() {
  // 先获取第一页，拿到 total
  const firstPage = await fetchApiJson(`${CONFIG.DOUBAN_API_FICTION}?start=0&count=50`);
  const total = firstPage.total || 0;
  const allItems = [...(firstPage.items || [])];
  
  console.log(`      API total: ${total} 本`);
  
  // 分页获取剩余
  let start = allItems.length;
  while (start < total) {
    try {
      const page = await fetchApiJson(`${CONFIG.DOUBAN_API_FICTION}?start=${start}&count=50`);
      if (!page.items || page.items.length === 0) break;
      allItems.push(...page.items);
      start += page.items.length;
      if (page.items.length < 50) break;
    } catch (e) {
      console.log(`      ⚠️ 分页 ${start} 失败: ${e.message}`);
      break;
    }
  }
  
  // 转换为统一 book 格式
  const books = allItems.map(item => {
    const info = parseApiInfo(item.info);
    const subjectId = item.id || '';
    return {
      title: item.title || '',
      url: subjectId ? `${CONFIG.DOUBAN_BASE_URL}/subject/${subjectId}/` : '',
      subjectId,
      cover: (item.cover && item.cover.url) ? item.cover.url : '',
      author: info.author,
      pubDate: info.pubDate,
      pubDateParsed: parsePubDate(info.pubDate),
      publisher: info.publisher,
      price: '',
      binding: '',
      rating: item.rating && item.rating.value ? String(item.rating.value) : '',
      ratingText: item.rating && item.rating.count ? `(${item.rating.count}人)` : '',
      description: '',
      categories: [],
      source: 'api',
    };
  });

  return books;
}

function mergeBooks(htmlBooks, apiBooks) {
  const seen = new Map(); // subjectId → book
  
  // 先放 HTML 源（信息更丰富）
  for (const b of htmlBooks) {
    if (b.subjectId) seen.set(b.subjectId, b);
  }
  
  // 再放 API 源（不覆盖已存在的）
  let apiAdded = 0;
  for (const b of apiBooks) {
    if (!b.subjectId) continue;
    if (seen.has(b.subjectId)) continue; // 去重
    seen.set(b.subjectId, b);
    apiAdded++;
  }
  
  const merged = [...seen.values()];
  console.log(`      合并结果: HTML ${htmlBooks.length} + API ${apiBooks.length} → ${merged.length} (去重 ${htmlBooks.length + apiBooks.length - merged.length}, API新增 ${apiAdded})`);
  return merged;
}
/**
 * 加载昨日书单 subjectId 集合（从累积存储中按日期查找）
 * 数据结构: { "books": { "2026-06-17": ["id1","id2"], ... } }
 * 兼容旧格式: { "date": "2026-06-18", "subjectIds": [...] }
 * 回溯逻辑: 如果昨天没数据，往前找最近一天有数据的（仅限当月）
 */
function loadYesterdayBooks(yesterdayStr) {
  const p = path.join(CONFIG.DATA_DIR, 'yesterday_books.json');
  if (!fs.existsSync(p)) return new Set();
  // 当月前缀，避免跨月回溯
  const currentMonthPrefix = yesterdayStr.substring(0, 7);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const books = data.books || {};

    // 优先精确匹配
    if (books[yesterdayStr] && Array.isArray(books[yesterdayStr])) {
      return new Set(books[yesterdayStr]);
    }

    // 回溯：找昨天之前最近一天有数据的（仅限当月）
    const yesterdayDate = new Date(yesterdayStr + 'T00:00:00');
    let bestMatch = null;
    for (const [dateStr, ids] of Object.entries(books)) {
      if (!Array.isArray(ids) || ids.length === 0) continue;
      if (dateStr === yesterdayStr) continue; // 已经检查过了
      if (!dateStr.startsWith(currentMonthPrefix)) continue; // 不跨月回溯
      const d = new Date(dateStr + 'T00:00:00');
      if (d < yesterdayDate) {
        if (!bestMatch || d > new Date(bestMatch + 'T00:00:00')) {
          bestMatch = dateStr;
        }
      }
    }
    if (bestMatch) {
      console.log(`      ⚠️ ${yesterdayStr} 无数据，回溯使用 ${bestMatch} 的书单`);
      return new Set(books[bestMatch]);
    }

    // 兼容旧格式：顶层 subjectIds（老脚本写的）
    if (data.subjectIds && Array.isArray(data.subjectIds) && data.date === yesterdayStr) {
      console.log(`      ⚠️ 使用旧格式 subjectIds（${data.date}）`);
      return new Set(data.subjectIds);
    }
  } catch (e) {}
  return new Set();
}

/**
 * 加载今日之前所有历史日期的完整书单对象（用于缺失书籍继承展示）
 * 读取每个早于今日的 reports/YYYY-MM-DD.json 中的 monthBooks
 * 按 subjectId 去重，保留最近一天的数据
 * 注意：只回溯当月数据，不跨月继承（月初时继承列表为空）
 */
function loadAllPriorMonthBooks(dateStr) {
  const p = path.join(CONFIG.DATA_DIR, 'yesterday_books.json');
  if (!fs.existsSync(p)) return [];
  // 当月前缀（如 "2026-07"），只继承同月数据
  const currentMonthPrefix = dateStr.substring(0, 7);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const books = data.books || {};
    const priorMap = new Map(); // subjectId -> { book, date }
    for (const [d, ids] of Object.entries(books)) {
      if (d >= dateStr) continue;
      if (!d.startsWith(currentMonthPrefix)) continue; // 跨月数据不继承
      if (!Array.isArray(ids) || ids.length === 0) continue;
      const reportPath = path.join(CONFIG.OUTPUT_DIR, `${d}.json`);
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

/**
 * 加载今日之前所有历史日期的 subjectId 集合（用于判断"本月新增中第一次出现"）
 * 一本书只要在本月任意早于今日的日期出现过，今天就不算"本日新增"。
 * 注意：只统计当月数据，不跨月（月初时所有书都是新增）
 */
function loadAllPriorBooks(dateStr) {
  const p = path.join(CONFIG.DATA_DIR, 'yesterday_books.json');
  if (!fs.existsSync(p)) return new Set();
  // 当月前缀（如 "2026-07"），只统计同月历史
  const currentMonthPrefix = dateStr.substring(0, 7);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const books = data.books || {};
    const priorSet = new Set();
    for (const [d, ids] of Object.entries(books)) {
      if (d >= dateStr) continue; // 只取早于今日的日期
      if (!d.startsWith(currentMonthPrefix)) continue; // 跨月数据不计入
      if (!Array.isArray(ids)) continue;
      for (const id of ids) if (id) priorSet.add(id);
    }
    return priorSet;
  } catch (e) {}
  return new Set();
}

/**
 * 保存今日书单到累积存储（追加/更新当天数据，不覆盖历史）
 */
function saveTodayBooks(dateStr, monthBooks) {
  const p = path.join(CONFIG.DATA_DIR, 'yesterday_books.json');
  let data = { books: {} };
  if (fs.existsSync(p)) {
    try { data = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) {}
  }
  if (!data.books) data.books = {};
  data.books[dateStr] = monthBooks.map(b => b.subjectId).filter(Boolean);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

// 格式化日期
function formatDateLabel(pd) {
  if (!pd) return '未知';
  return pd.precision === 'day'
    ? `${pd.year}-${String(pd.month).padStart(2, '0')}-${String(pd.day).padStart(2, '0')}`
    : `${pd.year}-${String(pd.month).padStart(2, '0')}（仅精确到月）`;
}

// ============ HTML 报告生成 ============
function generateHTML(today, monthBooks, recommendations, yesterdayBooksSet) {
  const { preferenceBased, random } = recommendations;
  const allRecs = [...preferenceBased, ...random];
  const total = monthBooks.length;
  const newCount = monthBooks.filter(b => b.isNewToday).length;

  // Escape HTML
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
.heart-btn:active .heart-icon{transform:scale(0.9)}
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
<h1>📚 每日人文社科新书速递 <span style="font-size:15px;font-weight:400;opacity:0.75;margin-left:14px">${today.dateStr}</span></h1>
<div class="meta">数据来源: <a href="https://book.douban.com/latest" target="_blank" style="color:#f0d78c">豆瓣新书速递</a> · <a href="https://joeyzhengchen.github.io/booklist/" style="color:#f0d78c">← 书单首页</a> · ${today.fetchTime}</div>
<div class="stats">
<span>📆 本月 ${total} 本</span>
<span>🆕 新增 ${newCount} 本</span>
<span>🌟 推荐 ${allRecs.length} 本</span>
</div>
</div>

<div class="section">
<div class="section-title">📆 本月新书 <span class="count">（${total} 本）</span></div>
<div class="section-desc">${today.year}年${today.month}月出版的人文社科类新书（已排除教辅、工具书）</div>`;

  // 本月新书
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

  if (monthBooks.length === 0) {
    html += '<div class="book-card"><div class="info" style="text-align:center;padding:20px;color:#999">暂未发现本月出版的人文社科类新书</div></div>';
  }

  html += `</div>
<div class="section">
<div class="section-title">🌟 当日推荐 <span class="count">（${allRecs.length} 本）</span></div>
<div class="section-desc">每天5本精选好书，2本根据你的喜好推荐，3本随机探索</div>`;

  // 推荐书籍
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
<a href="https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(rec.title + ' ' + rec.author)}" target="_blank" style="display:inline-block;font-size:13px;color:#6b5e4e;text-decoration:none;margin-bottom:10px">📖 书籍详情</a>
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
const API = 'http://localhost:${CONFIG.SERVER_PORT}';

// 加载已点赞的偏好
async function loadLiked() {
  try { const r = await fetch(API + '/api/preferences'); const d = await r.json();
    d.liked.forEach(b => {
      const btn = document.querySelector('.heart-btn[data-book-id="' + b.bookId + '"]');
      if (btn) { btn.classList.add('liked'); btn.querySelector('.heart-icon').textContent = '♥'; }
    });
  } catch(e){}
}

async function toggleHeart(btn) {
  const bookId = btn.dataset.bookId;
  const title = btn.dataset.title;
  const author = btn.dataset.author;
  const genres = JSON.parse(btn.dataset.genres || '[]');
  const tags = JSON.parse(btn.dataset.tags || '[]');
  const liked = !btn.classList.contains('liked');
  
  try {
    await fetch(API + '/api/heart', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({bookId, title, author, genres, tags, liked})
    });
    if (liked) {
      btn.classList.add('liked');
      btn.querySelector('.heart-icon').textContent = '♥';
    } else {
      btn.classList.remove('liked');
      btn.querySelector('.heart-icon').textContent = '♡';
    }
  } catch(e) {
    // 离线降级：仅用本地状态
    if (liked) {
      btn.classList.add('liked');
      btn.querySelector('.heart-icon').textContent = '♥';
    } else {
      btn.classList.remove('liked');
      btn.querySelector('.heart-icon').textContent = '♡';
    }
  }
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
</script>
</body>
</html>`;

  return html;
}

// ============ Markdown 报告生成 ============
function generateMarkdown(today, monthBooks, recommendations, yesterdayBooksSet) {
  const { preferenceBased, random } = recommendations;
  const allRecs = [...preferenceBased, ...random];
  const lines = [];

  lines.push('# 每日人文社科新书速递');
  lines.push('');
  lines.push(`**日期**: ${today.dateStr}`);
  lines.push(`**数据来源**: [豆瓣 新书速递 + 最新](https://book.douban.com/latest)`);
  lines.push(`**采集时间**: ${today.fetchTime}`);
  lines.push(`**本月新书**: ${monthBooks.length} 本 · **当日推荐**: ${allRecs.length} 本`);
  lines.push('');
  lines.push('---');

  // 本月新书
  lines.push('');
  lines.push(`## 📆 本月新书（${monthBooks.length} 本）`);
  lines.push('');
  if (monthBooks.length === 0) {
    lines.push('> 暂未发现本月出版的人文社科类新书。');
  } else {
    monthBooks.forEach((book, i) => {
      const isNew = book.isNewToday;
      lines.push(`### ${i + 1}. ${book.title}${isNew ? ' 🆕本日新增' : ''}`);
      lines.push('');
      lines.push('| 属性 | 内容 |');
      lines.push('|------|------|');
      lines.push(`| **作者** | ${book.author || '未知'} |`);
      lines.push(`| **出版社** | ${book.publisher || '未知'} |`);
      lines.push(`| **出版日期** | ${formatDateLabel(book.pubDateParsed)} |`);
      lines.push(`| **定价** | ${book.price || '未知'} |`);
      if (book.binding) lines.push(`| **装帧** | ${book.binding} |`);
      if (book.rating) lines.push(`| **豆瓣评分** | ${book.rating} ${book.ratingText ? '(' + book.ratingText + ')' : ''} |`);
      lines.push(`| **豆瓣链接** | [查看详情](${book.url}) |`);
      lines.push('');
      if (book.description) { lines.push(`**简介**:`); lines.push(''); lines.push(`> ${book.description}`); lines.push(''); }
      if (book.cover && !book.cover.includes('default')) { lines.push(`![封面](${book.cover})`); lines.push(''); }
      lines.push('---');
      lines.push('');
    });
  }

  // 当日推荐
  lines.push(`## 🌟 当日推荐（${allRecs.length} 本）`);
  lines.push('');
  allRecs.forEach((rec, i) => {
    const recType = i < preferenceBased.length ? '【偏好推荐】' : '【随机发现】';
    lines.push(`### ${i + 1}. ${rec.title} ${recType}`);
    lines.push('');
    lines.push(`**作者**: ${rec.author}`);
    if (rec.authorBio) lines.push(`**作者简介**: ${rec.authorBio}`);
    lines.push(`**内容简介**: ${rec.description || '暂无'}`);
    lines.push(`**出版日期**: ${rec.pubDate || '未知'}`);
    lines.push(`**出版社**: ${rec.publisher || '未知'}`);
    lines.push('');
    lines.push(`> 💡 **推荐理由**: ${rec.reason || '暂无'}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  lines.push('');
  lines.push('---');
  lines.push('*本报告由每日人文社科新书采集器 v4 自动生成 | 数据来源: 豆瓣网*');
  lines.push('*交互版请在 PC 浏览器打开 http://localhost:3456*');
  lines.push('');

  return lines.join('\n');
}

// ============ 服务器管理 ============
function killOldServer() {
  try {
    if (process.platform === 'win32') {
      execSync(`netstat -ano | findstr :${CONFIG.SERVER_PORT}`, { encoding: 'utf-8' });
      try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${CONFIG.SERVER_PORT}') do taskkill /F /PID %a`, { shell: 'cmd.exe' }); } catch {}
    } else {
      try { execSync(`lsof -ti:${CONFIG.SERVER_PORT} | xargs kill -9`); } catch {}
    }
  } catch {}
}

function startServer() {
  const serverPath = path.join(__dirname, 'server.js');
  const child = spawn('node', [serverPath], {
    cwd: path.join(__dirname, '..'),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log(`📡 服务器已在后台启动 (端口 ${CONFIG.SERVER_PORT})`);
}

// ============ 微信推送文本生成 ============
function generateWechatText(today, monthBooks, recommendations, yesterdayBooksSet) {
  const { preferenceBased, random } = recommendations;
  const allRecs = [...preferenceBased, ...random];
  const newCount = monthBooks.filter(b => b.isNewToday).length;
  const lines = [];

  lines.push('📚 每日人文社科新书速递');
  lines.push(`📅 ${today.dateStr}`);
  lines.push(`📆 本月新书 ${monthBooks.length} 本 | 🆕 新增 ${newCount} 本 | 🌟 推荐 ${allRecs.length} 本`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('📆 本月新书');
  lines.push('━━━━━━━━━━━━━━━━━━');

  if (monthBooks.length === 0) {
    lines.push('  暂未发现本月出版的人文社科类新书');
  } else {
    monthBooks.forEach((book, i) => {
      const isNew = book.isNewToday;
      const tag = isNew ? ' 🏷️本日新增' : '';
      lines.push(`  ${i + 1}.《${book.title}》${tag}`);
      lines.push(`     作者：${book.author || '未知'}`);
      lines.push(`     出版：${book.publisher || '未知'} | ${formatDateLabel(book.pubDateParsed)}`);
      if (book.description) {
        const shortDesc = book.description.length > 120 ? book.description.substring(0, 120) + '...' : book.description;
        lines.push(`     简介：${shortDesc}`);
      }
      lines.push('');
    });
  }

  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('🌟 当日推荐');
  lines.push('━━━━━━━━━━━━━━━━━━');

  allRecs.forEach((rec, i) => {
    const recType = i < preferenceBased.length ? '【偏好推荐】' : '【随机发现】';
    lines.push(`  ${i + 1}.《${rec.title}》${recType}`);
    lines.push(`     作者：${rec.author}`);
    if (rec.authorBio) {
      const shortBio = rec.authorBio.length > 80 ? rec.authorBio.substring(0, 80) + '...' : rec.authorBio;
      lines.push(`     作者简介：${shortBio}`);
    }
    if (rec.description) {
      const shortDesc = rec.description.length > 150 ? rec.description.substring(0, 150) + '...' : rec.description;
      lines.push(`     内容简介：${shortDesc}`);
    }
    lines.push(`     出版：${rec.pubDate || '未知'} | ${rec.publisher || '未知'}`);
    lines.push(`     💡 ${rec.reason || '值得一读'}`);
    lines.push('');
  });

  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('💝 点击下方链接查看完整交互版（含封面、爱心按钮）：');
  lines.push(`   http://localhost:${CONFIG.SERVER_PORT}`);
  lines.push('');
  lines.push('📖 数据来源：豆瓣新书速递');
  lines.push('⏰ 每日22:15自动推送');

  return lines.join('\n');
}

// ============ 主流程 ============
async function main() {
  const startTime = Date.now();
  const today = getToday();
  const yesterdayStr = getYesterdayStr(today);

  console.log('='.repeat(50));
  console.log('  📚 每日人文社科新书采集器 v4');
  console.log('='.repeat(50));
  console.log(`  日期: ${today.dateStr} | 时间: ${today.fetchTime}`);

  // 确保目录存在
  [CONFIG.OUTPUT_DIR, CONFIG.DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

  // Step 1: 抓取多分类 HTML + API 双数据源
  console.log('\n📡 [1/5] 获取数据...');

  // 1a: HTML "最新" 页面（多分类）
  console.log(`      📄 HTML源 (${CONFIG.DOUBAN_SUBCATS.join('、')})...`);
  let allHtmlBooks = [];
  for (const subcat of CONFIG.DOUBAN_SUBCATS) {
    const url = `https://book.douban.com/latest?subcat=${encodeURIComponent(subcat)}`;
    try {
      const html = await fetchWithRetry(url);
      const books = parseBookList(html);
      books.forEach(b => b.subcat = subcat);
      allHtmlBooks.push(...books);
      console.log(`         ✅ ${subcat}: ${books.length} 本`);
    } catch (e) {
      console.log(`         ⚠️ ${subcat}: ${e.message}`);
    }
    await sleep(CONFIG.SUBCAT_DELAY);
  }
  console.log(`         📦 HTML合计: ${allHtmlBooks.length} 本`);

  // 1b: API "新书速递"（小说/文学专项补充）
  console.log('      🔌 API源 (new_book_fiction)...');
  let apiBooks = [];
  try {
    apiBooks = await fetchAllApiBooks();
    console.log(`         ✅ ${apiBooks.length} 本`);
  } catch (e) { console.log(`         ⚠️  API失败: ${e.message}`); }

  // Step 2: 解析 + 合并
  console.log('🔍 [2/5] 合并数据源...');
  console.log(`      HTML: ${allHtmlBooks.length} 本`);
  const allBooks = mergeBooks(allHtmlBooks, apiBooks);
  if (allBooks.length === 0) { console.log('      ❌ 无数据，退出'); process.exit(0); }
  const processBooks = allBooks.slice(0, CONFIG.MAX_BOOKS);

  // Step 3: 详情（优化：跳过明显非当月的 API 源书籍）
  console.log('📖 [3/5] 获取详细信息...');
  let ok = 0, fail = 0, skip = 0;
  for (let i = 0; i < processBooks.length; i++) {
    const b = processBooks[i];
    
    // 跳过明确非当月的 API 源书籍（已有评分等基本信息）
    if (b.source === 'api' && classifyByDate(b.pubDateParsed, today) === 'exclude') {
      skip++;
      continue;
    }
    
    const disp = b.title.length > 30 ? b.title.substring(0, 30) + '...' : b.title;
    process.stdout.write(`      [${String(i + 1).padStart(2)}/${processBooks.length}] ${disp} `);
    try {
      await sleep(CONFIG.REQUEST_DELAY);
      const d = await fetchWithRetry(b.url);
      const detail = parseBookDetail(d);
      b.description = detail.description;
      b.categories = detail.categories;
      if (detail.detailPubDate) { b.pubDateParsed = detail.detailPubDate; b.pubDate = detail.detailPubDate.raw; }
      console.log('✅');
      ok++;
    } catch (e) { console.log('⚠️'); fail++; }
  }
  console.log(`      结果: ${ok} 成功, ${fail} 失败, ${skip} 跳过`);

  // Step 4: 分类 & 推荐
  console.log('🏷️  [4/5] 分类 + 推荐引擎...');
  const monthBooks = [];
  for (const b of processBooks) {
    if (classifyByDate(b.pubDateParsed, today) === 'exclude') continue;
    if (isTextbookOrReference(b)) continue;
    monthBooks.push(b);
  }
  // Step 4a: 加载昨日书单（用于缺失书籍继承展示）
  const yesterdayBooksSet = loadYesterdayBooks(yesterdayStr);
  // 加载本月所有早于今日的已记录书籍，用于判断"本月新增中第一次出现"
  const allPriorBooksSet = loadAllPriorBooks(today.dateStr);

  // Step 4b: 缺失书籍继承 —— 本月任意早于今日书单中出现过的书，今天数据源没出现，仍展示但不标"本日新增"
  const allPriorMonthBooks = loadAllPriorMonthBooks(today.dateStr);
  const todaySubjectIds = new Set(monthBooks.map(b => b.subjectId));
  let carryOverCount = 0;
  for (const pb of allPriorMonthBooks) {
    if (!todaySubjectIds.has(pb.subjectId) && pb.title) {
      pb.isCarryOver = true;
      monthBooks.push(pb);
      carryOverCount++;
    }
  }

  // 为每本书标记 isNewToday：只要在本月任意早于今日的日期出现过，就不是今日新增
  monthBooks.forEach(b => { b.isNewToday = !allPriorBooksSet.has(b.subjectId) && !b.isCarryOver; });
  monthBooks.sort((a, b) => {
    if (a.isNewToday !== b.isNewToday) return a.isNewToday ? -1 : 1;
    if (a.isCarryOver !== b.isCarryOver) return a.isCarryOver ? 1 : -1;
    return 0;
  });

  const newCount = monthBooks.filter(b => b.isNewToday).length;

  console.log(`      📚 本月新书: ${monthBooks.length} 本 (🆕新增 ${newCount} 本${carryOverCount > 0 ? `, 📎继承昨日 ${carryOverCount} 本` : ''})`);

  // 推荐引擎（传入本月新书作为推荐池）
  const recommendations = generateRecommendations(today.dateStr, monthBooks);
  const totalRecs = recommendations.preferenceBased.length + recommendations.random.length;
  console.log(`      🌟 当日推荐: ${totalRecs} 本 (偏好 ${recommendations.preferenceBased.length} + 随机 ${recommendations.random.length})`);

  // Step 5: 生成报告 + 启动服务器
  console.log('📝 [5/5] 生成报告...');

  // HTML
  const html = generateHTML(today, monthBooks, recommendations, yesterdayBooksSet);
  const htmlPath = path.join(CONFIG.OUTPUT_DIR, `${today.dateStr}.html`);
  fs.writeFileSync(htmlPath, html, 'utf-8');

  // MD
  const md = generateMarkdown(today, monthBooks, recommendations, yesterdayBooksSet);
  const mdPath = path.join(CONFIG.OUTPUT_DIR, `${today.dateStr}.md`);
  fs.writeFileSync(mdPath, md, 'utf-8');

  // 微信文本
  const wxText = generateWechatText(today, monthBooks, recommendations, yesterdayBooksSet);
  const wxPath = path.join(CONFIG.OUTPUT_DIR, `${today.dateStr}.wx.txt`);
  fs.writeFileSync(wxPath, wxText, 'utf-8');

  // JSON
  const jsonData = {
    date: today.dateStr, fetchTime: today.fetchTime,
    monthBooks: monthBooks.map(b => ({
      title: b.title, author: b.author, publisher: b.publisher,
      pubDate: b.pubDate, pubDateParsed: b.pubDateParsed,
      price: b.price, binding: b.binding, rating: b.rating, ratingText: b.ratingText,
      categories: b.categories, description: b.description,
      url: b.url, cover: b.cover, subjectId: b.subjectId,
      isNewToday: b.isNewToday,
      ...(b.isCarryOver ? { isCarryOver: true } : {}),
    })),
    recommendations: {
      preferenceBased: recommendations.preferenceBased,
      random: recommendations.random,
    },
  };
  const jsonPath = path.join(CONFIG.OUTPUT_DIR, `${today.dateStr}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');

  // 保存今日书单供明日对比
  saveTodayBooks(today.dateStr, monthBooks);

  // 启动/重启服务器
  killOldServer();
  startServer();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('='.repeat(50));
  console.log('  ✅ 采集完成!');
  console.log(`  📂 分类: ${CONFIG.DOUBAN_SUBCATS.join('、')}`);
  console.log(`  耗时: ${elapsed} 秒`);
  console.log(`  HTML 报告: reports/${today.dateStr}.html`);
  console.log(`  MD 报告: reports/${today.dateStr}.md`);
  console.log(`  微信文本: reports/${today.dateStr}.wx.txt`);
  console.log(`  本月新书: ${monthBooks.length} 本 | 🆕新增: ${newCount} 本`);
  console.log(`  🌟 推荐: ${totalRecs} 本`);
  console.log(`  📡 服务器: http://localhost:${CONFIG.SERVER_PORT}`);
  console.log('='.repeat(50));
}

main().catch(e => { console.error('❌ 运行失败:', e.message); process.exit(1); });
