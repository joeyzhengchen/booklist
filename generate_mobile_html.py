"""
从豆瓣书单 JSON 生成手机适配的 HTML 书单报告
支持命令行参数，输出文件按日期命名，可直接推送到 GitHub Pages

用法:
  # 自动使用当天日期，输出到 booklist-site/
  python generate_mobile_html.py

  # 指定日期
  python generate_mobile_html.py --date 2026-06-18

  # 指定 JSON 路径和输出路径
  python generate_mobile_html.py --json "C:/path/to/2026-06-18.json" --output "F:/path/to/output.html"
"""
import json, html as html_mod, os, sys, argparse, urllib.parse, time
from datetime import datetime
import requests

# ============ 参数解析 ============
parser = argparse.ArgumentParser(description="从豆瓣书单 JSON 生成手机适配 HTML 书单")
parser.add_argument("--date", "-d", default=None, help="日期 (YYYY-MM-DD)，默认当天")
parser.add_argument("--json", default=None, help="JSON 文件路径（覆盖默认路径）")
parser.add_argument("--output", "-o", default=None, help="输出 HTML 路径（覆盖默认路径）")
args = parser.parse_args()

# ============ 配置 ============
TODAY = datetime.now().strftime("%Y-%m-%d")
DATE = args.date or TODAY

REPORTS_DIR = os.environ.get("BOOKLIST_REPORTS_DIR") or r"C:\Users\争哥\WorkBuddy\2026-06-17-task-8\reports"
BOOKLIST_SITE_DIR = os.environ.get("BOOKLIST_SITE_DIR") or r"F:\workbuddy\results\Claw\booklist-site"
COVERS_DIR = os.environ.get("BOOKLIST_COVERS_DIR") or os.path.join(BOOKLIST_SITE_DIR, "covers", DATE)  # 封面本地缓存目录

JSON_PATH = args.json or os.path.join(REPORTS_DIR, f"{DATE}.json")
OUTPUT_PATH = args.output or os.path.join(BOOKLIST_SITE_DIR, f"{DATE}.html")

CATEGORIES = "文学、历史、哲学、社科、文化、艺术、传记"

# ============ 加载数据 ============
with open(JSON_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

month_books = data.get("monthBooks", [])
# 排序：本日新增置顶，其次非继承书籍，继承昨日置底
month_books.sort(key=lambda b: (0 if b.get("isNewToday") else 1, 0 if not b.get("isCarryOver") else 1))
recs_data = data.get("recommendations", {})
pref_recs = recs_data.get("preferenceBased", [])
rand_recs = recs_data.get("random", [])
all_recs = pref_recs + rand_recs
new_count = sum(1 for b in month_books if b.get("isNewToday"))

# ============ 计算显示月份 ============
from collections import Counter
_month_counts = Counter()
for _b in month_books:
    _pd = _b.get("pubDateParsed", {})
    if _pd.get("year") and _pd.get("month"):
        _month_counts[(_pd["year"], int(_pd["month"]))] += 1
if _month_counts:
    _top_year, _top_month = _month_counts.most_common(1)[0][0]
    DISPLAY_MONTH_LABEL = f"{_top_month}月出版"
else:
    try:
        _dm = int(DATE.split("-")[1])
        DISPLAY_MONTH_LABEL = f"{_dm}月出版"
    except Exception:
        DISPLAY_MONTH_LABEL = "本月出版"

def esc(s):
    return html_mod.escape(str(s))

def format_date(pd):
    if not pd: return "未知"
    y, m, d = pd.get("year", ""), pd.get("month", ""), pd.get("day")
    if d:
        return f"{y}-{str(m).zfill(2)}-{str(d).zfill(2)}"
    return f"{y}-{str(m).zfill(2)}"

# ============ 封面本地下载 ============
def download_cover(remote_url, subject_id):
    """下载封面到本地，返回本地相对路径；失败返回 None"""
    if not remote_url or "default" in remote_url:
        return None
    if not subject_id:
        # 用 URL 的 md5 当 key
        import hashlib
        subject_id = hashlib.md5(remote_url.encode()).hexdigest()[:12]

    os.makedirs(COVERS_DIR, exist_ok=True)
    local_path = os.path.join(COVERS_DIR, f"{subject_id}.jpg")
    # 若已存在则跳过
    if os.path.exists(local_path) and os.path.getsize(local_path) > 1024:
        return f"covers/{DATE}/{subject_id}.jpg"

    for attempt in range(2):
        try:
            resp = requests.get(
                remote_url,
                timeout=15,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://book.douban.com/",
                },
            )
            if resp.status_code == 200 and len(resp.content) > 1024:
                with open(local_path, "wb") as f:
                    f.write(resp.content)
                return f"covers/{DATE}/{subject_id}.jpg"
        except Exception:
            if attempt == 0:
                time.sleep(0.5)
    return None

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>人文社科新书速递 · {DATE}</title>
<style>
  :root {{
    --bg: #f8f5f0;
    --card: #ffffff;
    --text: #2c2416;
    --text2: #6b5e4e;
    --text3: #9b8c7a;
    --accent: #c9a96e;
    --accent2: #8b6914;
    --new: #d44;
    --border: #e8e0d2;
    --shadow: 0 1px 3px rgba(0,0,0,0.04);
    --radius: 10px;
  }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
    padding: 0;
  }}
  .page {{
    max-width: 850px;
    margin: 0 auto;
    padding: 0 0 40px;
  }}

  /* --- 头部 --- */
  .hero {{
    background: linear-gradient(160deg, #2c3e50 0%, #3d5366 50%, #4a6a7a 100%);
    color: #fff;
    padding: 44px 20px 24px;
    position: relative;
    overflow: hidden;
  }}
  .hero::after {{
    content: '';
    position: absolute;
    top: -40px; right: -30px;
    width: 120px; height: 120px;
    background: rgba(255,255,255,0.04);
    border-radius: 50%;
  }}
  .hero .back-btn {{
    position: absolute;
    top: 16px;
    left: 16px;
    color: rgba(255,255,255,0.7);
    font-size: 20px;
    text-decoration: none;
    line-height: 1;
    z-index: 2;
    transition: color 0.2s;
  }}
  .hero .back-btn:hover {{ color: #fff; }}
  .hero .badge-row {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }}
  .hero .badge {{
    display: inline-block;
    font-size: 11px;
    background: rgba(255,255,255,0.15);
    padding: 3px 10px;
    border-radius: 12px;
    letter-spacing: 1px;
  }}
  .hero .date {{
    font-size: 13px;
    opacity: 0.75;
  }}
  .hero h1 {{
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 4px;
    letter-spacing: -0.3px;
  }}
  .hero .stats-row {{
    display: flex;
    gap: 8px;
    margin-top: 14px;
    flex-wrap: wrap;
  }}
  .hero .stat {{
    font-size: 12px;
    background: rgba(255,255,255,0.12);
    padding: 4px 10px;
    border-radius: 14px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }}
  .hero .stat em {{
    font-style: normal;
    font-weight: 600;
    color: #f0d78c;
  }}

  /* --- 分区 --- */
  .section {{
    padding: 20px 16px 0;
  }}
  .section-head {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }}
  .section-head h3 {{
    font-size: 17px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 6px;
  }}
  .section-head .count {{
    font-size: 12px;
    color: var(--text3);
    font-weight: 400;
  }}

  /* --- 书籍卡片 --- */
  .book-card {{
    background: var(--card);
    border-radius: var(--radius);
    margin-bottom: 10px;
    box-shadow: var(--shadow);
    overflow: hidden;
    display: flex;
    gap: 12px;
    padding: 12px;
    position: relative;
    transition: transform 0.15s ease;
  }}
  .book-card:active {{ transform: scale(0.985); }}
  .book-card .new-badge {{
    position: absolute;
    top: 8px; right: 8px;
    font-size: 10px;
    background: var(--new);
    color: #fff;
    padding: 2px 7px;
    border-radius: 8px;
  }}
  .book-card .cover-wrap {{
    flex-shrink: 0;
    width: 76px; height: 106px;
    border-radius: 4px;
    overflow: hidden;
    background: #f0ece6;
  }}
  .book-card .cover-wrap img {{
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
  }}
  .book-card .no-cover {{
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: #ccc; font-size: 10px;
  }}
  .book-card .info {{ flex: 1; min-width: 0; }}
  .book-card .info .title {{
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
    margin-bottom: 3px;
    color: var(--text);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    padding-right: 70px; /* 避让 "本日新" 徽章 */
  }}
  .book-card .info .author {{
    font-size: 12px;
    color: var(--text2);
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .book-card .info .meta {{
    font-size: 11px;
    color: var(--text3);
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
  }}
  .book-card .info .meta .sep {{ color: #d5cec4; }}
  .book-card .info .rating {{
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: #d4a017;
    font-weight: 500;
  }}
  .book-card .info .desc {{
    font-size: 12px;
    color: var(--text2);
    line-height: 1.55;
    margin-top: 6px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }}
  .book-card .info .link-row {{
    margin-top: 6px;
  }}
  .book-card .info .link-row a {{
    font-size: 11px;
    color: var(--accent2);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }}

  /* --- 推荐卡片 --- */
  .rec-card {{
    background: var(--card);
    border-radius: var(--radius);
    margin-bottom: 10px;
    box-shadow: var(--shadow);
    padding: 14px;
    border-left: 3px solid var(--accent);
  }}
  .rec-card .rec-header {{
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 4px;
  }}
  .rec-card .rec-title {{
    font-size: 15px;
    font-weight: 600;
    flex: 1;
  }}
  .rec-card .rec-tag {{
    font-size: 10px;
    background: #f0e6d2;
    color: var(--accent2);
    padding: 2px 8px;
    border-radius: 10px;
    white-space: nowrap;
    margin-left: 8px;
  }}
  .rec-card .rec-author {{
    font-size: 12px;
    color: var(--text2);
    margin-bottom: 2px;
  }}
  .rec-card .rec-meta {{
    font-size: 11px;
    color: var(--text3);
    margin-bottom: 6px;
  }}
  .rec-card .rec-desc {{
    font-size: 12px;
    color: var(--text2);
    line-height: 1.55;
    margin-bottom: 8px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }}
  .rec-card .rec-reason {{
    font-size: 12px;
    color: var(--accent2);
    background: #fef9e7;
    padding: 8px 10px;
    border-radius: 6px;
    line-height: 1.5;
    margin-bottom: 8px;
  }}
  .rec-card .rec-reason span.label {{
    font-weight: 600;
    margin-right: 4px;
  }}

  /* --- 爱心按钮 --- */
  .heart-btn {{
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 14px;
    border: 1px solid #e0d0d0;
    border-radius: 18px;
    font-size: 13px;
    color: #999;
    background: #fff;
    cursor: pointer;
    transition: all 0.2s;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }}
  .heart-btn:active {{
    border-color: #d44;
    color: #d44;
    background: #fef5f5;
  }}
  .detail-link {{
    display: inline-block;
    font-size: 13px;
    color: #6b5e4e;
    text-decoration: none;
    padding: 4px 0;
    margin-right: 10px;
    transition: color 0.2s;
  }}
  .detail-link:hover {{ color: #2c3e50; text-decoration: underline; }}
  .heart-btn .heart {{ font-size: 16px; }}

  /* --- 页脚 --- */
  .footer {{
    text-align: center;
    color: var(--text3);
    font-size: 11px;
    padding: 24px 16px 8px;
    line-height: 1.6;
  }}

  /* --- 分隔线 --- */
  .divider {{
    margin: 8px 16px;
    height: 1px;
    background: var(--border);
  }}
</style>
</head>
<body>
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-SX9PKL424Z"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', 'G-SX9PKL424Z');
</script>

<div class="page">

<!-- 头部 -->
<div class="hero">
  <a class="back-btn" href="https://joeyzhengchen.github.io/booklist/" title="返回书单首页">←</a>
  <div class="badge-row">
    <span class="badge">DAILY BOOKS</span>
    <span class="date">{DATE}</span>
  </div>
  <h1>人文社科新书速递</h1>
  <div class="stats-row">
    <div class="stat">📚 本月 <em>{len(month_books)}</em> 本</div>
    <div class="stat">🆕 新增 <em>{new_count}</em> 本</div>
    <div class="stat">🌟 推荐 <em>{len(all_recs)}</em> 本</div>
  </div>
</div>

<!-- 本月新书 -->
<div class="section">
  <div class="section-head">
    <h3>📚 本月新书</h3>
    <span class="count">{len(month_books)} 本 · {DISPLAY_MONTH_LABEL}</span>
  </div>
"""

# ============ 本月新书卡片 ============
print("\n下载封面到本地...")
for idx, b in enumerate(month_books, 1):
    cover_html = ""
    if b.get("cover") and "default" not in b.get("cover", ""):
        local_cover = download_cover(b["cover"], b.get("subjectId", ""))
        cover_src = local_cover if local_cover else b["cover"]
        if not local_cover:
            # 下载失败时仍显示封面（保留远程 URL），配合 onerror fallback
            cover_html = (f'<img src="{esc(b["cover"])}" alt="封面" loading="lazy"'
                         f' onerror="this.style.display=\'none\';this.insertAdjacentHTML(\'afterend\','
                         f'\'<div class=&quot;no-cover&quot;>封面加载失败</div>\')">')
        else:
            # 本地路径：仍带 onerror 兜底（文件被删除时）
            cover_html = (f'<img src="{esc(local_cover)}" alt="封面" loading="lazy"'
                         f' onerror="this.style.display=\'none\';this.insertAdjacentHTML(\'afterend\','
                         f'\'<div class=&quot;no-cover&quot;>封面加载失败</div>\')">')
    else:
        cover_html = '<div class="no-cover">暂无封面</div>'

    title = esc(b.get("title", ""))
    author = esc(b.get("author", "未知"))
    publisher = esc(b.get("publisher", ""))
    price = esc(b.get("price", ""))
    binding = esc(b.get("binding", ""))
    rating = b.get("rating", "")
    rating_text = b.get("ratingText", "")
    pub_date = format_date(b.get("pubDateParsed"))
    desc = esc(b.get("description", ""))
    url = esc(b.get("url", ""))
    is_new = b.get("isNewToday", False)

    new_badge = '<div class="new-badge">本日新</div>' if is_new else ""

    meta_parts = []
    if publisher:
        meta_parts.append(f'🏠 {publisher}')
    if pub_date:
        meta_parts.append(f'📅 {pub_date}')
    if price:
        meta_parts.append(f'💰 {price}')
    if binding:
        meta_parts.append(f'📖 {binding}')

    meta_html = '<span class="sep"> · </span>'.join(meta_parts)

    rating_html = ""
    if rating:
        rating_html = f' <span class="rating">★ {rating}</span>'
        if rating_text:
            rating_html += f'<span style="color:#9b8c7a;font-size:10px"> ({rating_text})</span>'

    html += f"""
<div class="book-card">
  <div class="cover-wrap">{cover_html}</div>
  <div class="info">
    <div class="title">{idx}. {title}</div>
    <div class="author">✍ {author}</div>
    <div class="meta">{meta_html}{rating_html}</div>
    {"<div class='desc'>"+desc+"</div>" if desc else ""}
    <div class="link-row"><a href="{url}" target="_blank" rel="noopener">🔗 豆瓣详情 →</a></div>
  </div>
  {new_badge}
</div>"""

# ============ 当日推荐 ============
if all_recs:
    html += f"""
</div>
<div class="divider"></div>
<div class="section">
  <div class="section-head">
    <h3>🌟 当日推荐</h3>
    <span class="count">{len(all_recs)} 本精选</span>
  </div>
"""

    for idx, rec in enumerate(all_recs, 1):
        rtype = "偏好推荐" if idx <= len(pref_recs) else "随机发现"
        rtitle = esc(rec.get("title", ""))
        rauthor = esc(rec.get("author", ""))
        rpub_date = esc(rec.get("pubDate", ""))
        rpublisher = esc(rec.get("publisher", ""))
        rdesc = esc(rec.get("description", ""))
        rreason = esc(rec.get("reason", ""))
        rid = esc(rec.get("id", ""))
        search_query = urllib.parse.quote(f"{rec.get('title', '')} {rec.get('author', '')}")

        html += f"""
<div class="rec-card">
  <div class="rec-header">
    <div class="rec-title">{idx}. {rtitle}</div>
    <div class="rec-tag">{rtype}</div>
  </div>
  <div class="rec-author">✍ {rauthor}</div>
  <div class="rec-meta">📅 {rpub_date} · 🏠 {rpublisher}</div>
  {"<div class='rec-desc'>"+rdesc+"</div>" if rdesc else ""}
  <div class="rec-reason"><span class="label">💡 推荐理由</span>{rreason}</div>
  <a class="detail-link" href="https://search.douban.com/book/subject_search?search_text={search_query}" target="_blank" rel="noopener">📖 书籍详情</a>
  <button class="heart-btn" data-id="{rid}">
    <span class="heart">♡</span> 感兴趣
  </button>
</div>"""

# ============ 页脚 ============
html += f"""
</div>

<div class="footer">
  <p>本报告由每日人文社科新书采集器自动生成</p>
  <p>数据来源：豆瓣网 · {CATEGORIES}</p>
  <p style="margin-top:4px;color:#bbb">📱 公网版：<a href="https://joeyzhengchen.github.io/booklist/" style="color:var(--accent2)">joeyzhengchen.github.io/booklist</a></p>
</div>

</div>

<script>
document.querySelectorAll('.heart-btn').forEach(btn => {{
  btn.addEventListener('click', function() {{
    this.classList.toggle('liked');
    const heart = this.querySelector('.heart');
    if (this.classList.contains('liked')) {{
      heart.textContent = '♥';
      this.style.borderColor = '#d44';
      this.style.color = '#d44';
      this.style.background = '#fef5f5';
    }} else {{
      heart.textContent = '♡';
      this.style.borderColor = '#e0d0d0';
      this.style.color = '#999';
      this.style.background = '#fff';
    }}
  }});
}});
</script>
</body>
</html>"""

# ============ 写入文件 ============
os.makedirs(os.path.dirname(OUTPUT_PATH) if os.path.dirname(OUTPUT_PATH) else ".", exist_ok=True)
with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    f.write(html)

print(f"✅ HTML 书单已生成: {OUTPUT_PATH}")
print(f"   日期: {DATE}")
print(f"   本月新书: {len(month_books)} 本")
print(f"   推荐: {len(all_recs)} 本")
print(f"   文件大小: {len(html.encode('utf-8')) / 1024:.1f} KB")
