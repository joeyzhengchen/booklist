/**
 * 本地 HTTP 服务器
 * 端口 3456, 提供 HTML 报告 + 爱心点击 API
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3456;
const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// 获取最新的 HTML 报告
function getLatestReport() {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const files = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.html'))
    .sort()
    .reverse();
  return files.length > 0 ? files[0] : null;
}

// 读取偏好
function readPreferences() {
  const prefPath = path.join(DATA_DIR, 'preferences.json');
  if (!fs.existsSync(prefPath)) return { liked: [] };
  try {
    return JSON.parse(fs.readFileSync(prefPath, 'utf-8'));
  } catch (e) {
    return { liked: [] };
  }
}

// 保存偏好
function savePreferences(data) {
  const prefPath = path.join(DATA_DIR, 'preferences.json');
  fs.writeFileSync(prefPath, JSON.stringify(data, null, 2), 'utf-8');
}

// 读取书库
function readBookPool() {
  const poolPath = path.join(DATA_DIR, 'book_pool.json');
  if (!fs.existsSync(poolPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(poolPath, 'utf-8'));
  } catch (e) {
    return [];
  }
}

// MIME 类型
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const server = http.createServer((req, res) => {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: 获取偏好
  if (req.method === 'GET' && req.url === '/api/preferences') {
    const prefs = readPreferences();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(prefs));
    return;
  }

  // API: 点赞/取消点赞
  if (req.method === 'POST' && req.url === '/api/heart') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { bookId, title, author, genres, tags, liked } = JSON.parse(body);
        const prefs = readPreferences();

        if (liked) {
          // 添加偏好
          const book = { bookId, title, author, genres: genres || [], tags: tags || [], likedAt: new Date().toISOString() };
          // 去重
          prefs.liked = prefs.liked.filter(b => b.bookId !== bookId);
          prefs.liked.push(book);
        } else {
          // 取消偏好
          prefs.liked = prefs.liked.filter(b => b.bookId !== bookId);
        }

        savePreferences(prefs);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, likedCount: prefs.liked.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // API: 获取书库信息
  if (req.method === 'GET' && req.url === '/api/bookpool') {
    const pool = readBookPool();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pool));
    return;
  }

  // 默认：提供 HTML 报告
  let filePath;
  if (req.url === '/' || req.url === '/index.html') {
    const report = getLatestReport();
    if (!report) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>暂无报告</h2><p>请先运行采集脚本。</p></body></html>');
      return;
    }
    filePath = path.join(REPORTS_DIR, report);
  } else {
    // 尝试作为报告文件提供
    filePath = path.join(REPORTS_DIR, req.url.replace(/^\//, ''));
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`📡 推荐服务器已启动: http://localhost:${PORT}`);
});

// 防止未捕获异常导致服务器崩溃
process.on('uncaughtException', (err) => {
  console.error('服务器错误:', err.message);
});
