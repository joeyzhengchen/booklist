"""
从豆瓣书单 JSON 渲染为手机长图 (PNG)
微信可直接打开查看 — 无 emoji，纯文本+图形绘制

用法:
  # 自动使用当天日期
  python render_booklist_image.py

  # 指定日期
  python render_booklist_image.py --date 2026-06-17

  # 指定 JSON 路径和输出路径
  python render_booklist_image.py --json "C:/path/to/2026-06-18.json" --output "F:/path/to/output.png"
"""
import json, os, re, time, sys, argparse
from datetime import datetime
from io import BytesIO
import requests
from PIL import Image, ImageDraw, ImageFont

# ============ 参数解析 ============
parser = argparse.ArgumentParser(description="渲染豆瓣书单 JSON 为手机长图 PNG")
parser.add_argument("--date", "-d", default=None, help="日期 (YYYY-MM-DD)，默认当天")
parser.add_argument("--json", default=None, help="JSON 文件路径（覆盖默认路径）")
parser.add_argument("--output", "-o", default=None, help="输出 PNG 路径（覆盖默认路径）")
args = parser.parse_args()

# ============ 配置 ============
TODAY = datetime.now().strftime("%Y-%m-%d")
DATE = args.date or TODAY

REPORTS_DIR = os.environ.get("BOOKLIST_REPORTS_DIR") or r"C:\Users\争哥\WorkBuddy\2026-06-17-task-8\reports"
JSON_PATH = args.json or os.path.join(REPORTS_DIR, f"{DATE}.json")
OUTPUT_PATH = args.output or os.path.join(os.environ.get("BOOKLIST_OUTPUT_DIR") or r"F:\workbuddy\results\Claw", f"mobile_booklist_{DATE}.png")

W = 750           # 画布宽 (2x)
PAD = 32          # 内边距
CARD_PAD = 20     # 卡片间距
RADIUS = 16       # 圆角
COVER_W = 140     # 封面宽
COVER_H = 196     # 封面高
REC_COVER_W = 100 # 推荐封面略小
REC_COVER_H = 140

# 配色
C_BG = (248, 245, 240)
C_CARD = (255, 255, 255)
C_TEXT = (44, 36, 22)
C_TEXT2 = (107, 94, 78)
C_TEXT3 = (155, 140, 122)
C_ACCENT = (201, 169, 110)
C_ACCENT2 = (139, 105, 20)
C_NEW_BG = (212, 68, 68)
C_HERO_START = (44, 62, 80)
C_HERO_END = (74, 106, 122)
C_HERO_TEXT = (255, 255, 255)
C_BORDER = (232, 224, 210)
C_TAG_BG = (240, 230, 210)
C_REASON_BG = (254, 249, 231)
C_HEART_OFF = (224, 208, 208)
C_PLACEHOLDER = (240, 236, 230)

# ============ 字体 ============
FONT_DIRS = [r"C:\Windows\Fonts"]
# 云端 Linux 字体路径
for _cloud_dir in ["/usr/share/fonts", "/usr/local/share/fonts"]:
    if os.path.isdir(_cloud_dir):
        FONT_DIRS.insert(0, _cloud_dir)

def find_font(name_pattern, size):
    for fd in FONT_DIRS:
        if not os.path.isdir(fd): continue
        for fn in os.listdir(fd):
            fl = fn.lower()
            if name_pattern.lower() in fl and fl.endswith(('.ttf', '.otf', '.ttc')):
                try: return ImageFont.truetype(os.path.join(fd, fn), size)
                except: continue
    for fd in FONT_DIRS:
        if not os.path.isdir(fd): continue
        for fn in os.listdir(fd):
            if fn.lower().endswith(('.ttf', '.otf', '.ttc')):
                try: return ImageFont.truetype(os.path.join(fd, fn), size)
                except: continue
    return ImageFont.load_default()

FONT_HUGE  = find_font("msyhbd", 44) or find_font("simhei", 44)
FONT_TITLE = find_font("msyhbd", 32) or find_font("simhei", 32)
FONT_BOOK  = find_font("msyhbd", 28) or find_font("simhei", 28)
FONT_BODY  = find_font("msyh", 22) or find_font("simhei", 22)
FONT_SMALL = find_font("msyh", 18) or find_font("simhei", 18)
FONT_BADGE = find_font("msyh", 16) or find_font("simhei", 16)
FONT_META  = find_font("msyh", 20) or find_font("simhei", 20)

print("字体加载完成")

def ts(draw, text, font):
    """测量文本尺寸"""
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0], bbox[3] - bbox[1]
    except AttributeError:
        return draw.textsize(text, font=font)

def wrap_text(text, font, max_width, draw):
    lines = []
    cur = ""
    for ch in text:
        w, _ = ts(draw, cur + ch, font)
        if w > max_width:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur: lines.append(cur)
    return lines

def draw_rrect(draw, xy, radius, fill=None, outline=None, width=1):
    x1, y1, x2, y2 = xy
    try:
        kw = {"radius": radius}
        if fill is not None: kw["fill"] = fill
        if outline is not None:
            kw["outline"] = outline; kw["width"] = width
        draw.rounded_rectangle([x1, y1, x2, y2], **kw)
    except TypeError:
        if outline is not None:
            draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, fill=outline)
            draw.rounded_rectangle(
                [x1+width, y1+width, x2-width, y2-width],
                radius=max(0, radius-width),
                fill=fill if fill is not None else C_CARD)
        else:
            draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, fill=fill)

def draw_circle(draw, cx, cy, r, fill):
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=fill)

# ============ 封面获取 ============
def fetch_image(url, w, h):
    """下载并缩放图片"""
    try:
        resp = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0", "Referer": "https://book.douban.com/"})
        if resp.status_code == 200:
            img = Image.open(BytesIO(resp.content)).convert("RGB")
            return img.resize((w, h), Image.LANCZOS)
    except: pass
    return None

def search_douban_cover(title, author=""):
    """在豆瓣搜索书籍封面"""
    query = title
    if author and author not in title:
        query = f"{title} {author.split('/')[0].strip()}"
    for attempt in range(2):
        try:
            url = f"https://book.douban.com/subject_search?search_text={requests.utils.quote(query)}"
            r = requests.get(url, timeout=10, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
            m = re.search(r'window\.__DATA__\s*=\s*(\{.+?\});\s*\n', r.text, re.DOTALL)
            if m:
                data = json.loads(m.group(1))
                items = data.get("items", [])
                if items:
                    cover = items[0].get("cover_url", "")
                    if cover:
                        return cover.replace("/m/", "/s/")
        except Exception:
            if attempt == 0:
                time.sleep(1)
                query = title  # retry without author
    return None

# ============ 绘制辅助 ============
def draw_label_value(draw, x, y, label, value, font, label_color, value_color, max_w=None):
    """绘制 '标签: 值' 格式文本"""
    lw, _ = ts(draw, label, font)
    draw.text((x, y), label, font=font, fill=label_color)
    vx = x + lw
    if max_w:
        vw, _ = ts(draw, value, font)
        if vw > max_w:
            value = value[:int(max_w / (vw / len(value))) - 2] + ".."
    draw.text((vx, y), value, font=font, fill=value_color)
    return y

def draw_placeholder_cover(draw, x, y, w, h):
    """绘制封面占位图"""
    draw_rrect(draw, (x, y, x+w, y+h), 4, C_PLACEHOLDER)
    t = "暂无封面"
    tw, th = ts(draw, t, FONT_SMALL)
    draw.text((x + (w-tw)//2, y + (h-th)//2), t, font=FONT_SMALL, fill=(180, 175, 165))

# ============ 加载数据 ============
with open(JSON_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

month_books = data.get("monthBooks", [])
# 排序：本日新增置顶，其次非继承书籍，继承昨日置底
month_books.sort(key=lambda b: (0 if b.get("isNewToday") else 1, 0 if not b.get("isCarryOver") else 1))
new_count = sum(1 for b in month_books if b.get("isNewToday"))
recs_data = data.get("recommendations", {})
pref_recs = recs_data.get("preferenceBased", [])
rand_recs = recs_data.get("random", [])
all_recs = pref_recs + rand_recs
CATEGORIES = "文学、历史、哲学、社科、文化、艺术、传记"

print(f"本月新书: {len(month_books)} 本, 新增: {new_count} 本, 推荐: {len(all_recs)} 本")

# ============ 计算显示月份 ============
# 根据本月新书实际出版月份动态计算，优先取最高频月份
from collections import Counter
_month_counts = Counter()
for _b in month_books:
    _pd = _b.get("pubDateParsed", {})
    if _pd.get("year") and _pd.get("month"):
        _month_counts[(_pd["year"], int(_pd["month"]))] += 1
if _month_counts:
    _top_year, _top_month = _month_counts.most_common(1)[0][0]
    DISPLAY_MONTH = f"{_top_month}月出版"
else:
    # 回退：使用 DATE 中的月份
    try:
        _dm = int(DATE.split("-")[1])
        DISPLAY_MONTH = f"{_dm}月出版"
    except Exception:
        DISPLAY_MONTH = "本月出版"

# ============ 预下载推荐封面 ============
rec_covers = {}
if all_recs:
    print("\n搜索推荐书籍封面...")
    for idx, rec in enumerate(all_recs, 1):
        rtitle = rec.get("title", "")
        rauthor = rec.get("author", "")
        print(f"  [{idx}/{len(all_recs)}] {rtitle}...", end=" ")
        cover_url = search_douban_cover(rtitle, rauthor)
        if cover_url:
            img = fetch_image(cover_url, REC_COVER_W, REC_COVER_H)
            if img:
                rec_covers[idx - 1] = img
                print("OK")
                continue
        rec_covers[idx - 1] = None
        print("未找到")
        time.sleep(0.5)

# ============ 预计算高度 ============
temp_img = Image.new("RGB", (W, 100))
temp_draw = ImageDraw.Draw(temp_img)

def calc_book_card(b, draw):
    content_w = W - PAD * 3 - COVER_W - 16
    _badge_extra = (66 + 16) if b.get("isNewToday") else 0
    if _badge_extra:
        content_w -= _badge_extra
    h = PAD * 2
    title = b.get("title", "")
    lines = wrap_text(title, FONT_BOOK, content_w, draw)
    h += len(lines) * 36
    h += 30  # 作者
    h += 26  # 元信息
    if b.get("rating"): h += 26
    desc = b.get("description", "")
    if desc:
        dlines = wrap_text(desc, FONT_SMALL, content_w, draw)
        h += min(len(dlines), 3) * 28 + 10
    h += 30  # 链接
    return max(h, COVER_H + PAD * 2)

def calc_rec_card(rec, draw):
    content_w_no_cover = W - PAD * 3 - 120
    h = PAD * 2
    rt = rec.get("title", "")
    tlines = wrap_text(rt, FONT_BOOK, content_w_no_cover, draw)
    h += len(tlines) * 36
    h += 28   # 作者
    h += 26   # 元信息
    desc = rec.get("description", "")
    if desc:
        dlines = wrap_text(desc, FONT_SMALL, content_w_no_cover, draw)
        h += min(len(dlines), 3) * 28 + 10
    reason = rec.get("reason", "")
    if reason:
        # 后续行从 cx+10 开始，用 content_w_no_cover - 20 计算行数
        rlines = wrap_text(reason, FONT_SMALL, content_w_no_cover - 20, draw)
        h += len(rlines) * 28 + 20
    h += 40  # 按钮
    return max(h, REC_COVER_H + PAD * 2)

card_heights = [calc_book_card(b, temp_draw) for b in month_books]
rec_heights = [calc_rec_card(r, temp_draw) for r in all_recs]

HERO_H = 230
SECTION_H = 70
FOOTER_H = 160

total = HERO_H + SECTION_H + sum(card_heights) + len(month_books) * CARD_PAD
if all_recs:
    total += SECTION_H + sum(rec_heights) + len(all_recs) * CARD_PAD
total += FOOTER_H + 40
total = int(total)
print(f"\n画布: {W}x{total}px")

# ============ 创建画布 ============
img = Image.new("RGB", (W, total), C_BG)
draw = ImageDraw.Draw(img)
y = 0

# ============ 头部梯度 ============
for i in range(HERO_H):
    r = int(C_HERO_START[0] + (C_HERO_END[0] - C_HERO_START[0]) * i / HERO_H)
    g = int(C_HERO_START[1] + (C_HERO_END[1] - C_HERO_START[1]) * i / HERO_H)
    b = int(C_HERO_START[2] + (C_HERO_END[2] - C_HERO_START[2]) * i / HERO_H)
    draw.line([(0, i), (W, i)], fill=(r, g, b))

# Hero 文字
cx, cy = PAD, 28
draw.text((cx, cy), "DAILY BOOKS", font=find_font("msyh", 22) or FONT_BODY, fill=(240, 215, 140)); cy += 28
draw.text((cx, cy), "人文社科新书速递", font=FONT_HUGE, fill=C_HERO_TEXT); cy += 52
draw.text((cx, cy), f"{DATE}  |  豆瓣 {CATEGORIES}", font=FONT_SMALL, fill=(200, 200, 195)); cy += 30

# 统计 - 用点 + 数字
stats = [
    ("本月", str(len(month_books)), "本"),
    ("新增", str(new_count), "本"),
    ("推荐", str(len(all_recs)), "本"),
]
bx = cx; badge_y = cy + 4
for label, num, unit in stats:
    txt = f"{label} {num}{unit}"
    tw, _ = ts(draw, txt, FONT_META)
    draw_rrect(draw, (bx, badge_y, bx + tw + 24, badge_y + 32), 16, (255, 255, 255))
    draw.text((bx + 12, badge_y + 4), f"{label} ", font=FONT_META, fill=(80, 80, 75))
    lw, _ = ts(draw, f"{label} ", FONT_META)
    draw.text((bx + 12 + lw, badge_y + 4), f"{num}{unit}", font=FONT_META, fill=(240, 215, 140))
    bx += tw + 32

y += HERO_H + CARD_PAD

# ============ 分区标题绘制函数 ============
def section_title(draw, y0, icon_label, title_text, count_text):
    """绘制分区标题：左侧 accent 竖条 + 标题 + 右侧计数
    icon 竖条高度匹配 FONT_TITLE(32) 视觉高度，居中对齐文字
    """
    tx, ty = PAD + 8, y0 + 14
    # 画小色块（高度 32，匹配 FONT_TITLE），与文字顶部对齐
    draw_rrect(draw, (PAD, ty, PAD + 6, ty + 32), 3, C_ACCENT)
    draw.text((tx, ty), title_text, font=FONT_TITLE, fill=C_TEXT)
    tw, _ = ts(draw, title_text, FONT_TITLE)
    draw.text((tx + tw + 10, ty + 6), count_text, font=FONT_SMALL, fill=C_TEXT3)

# ============ 本月新书 ============
section_title(draw, y, "", "本月新书", f"{len(month_books)} 本  |  {DISPLAY_MONTH}")
y += SECTION_H

for idx, b in enumerate(month_books, 1):
    ch = card_heights[idx - 1]
    draw_rrect(draw, (PAD, y, W - PAD, y + ch), RADIUS, C_CARD)

    # 封面
    cover_url = b.get("cover", "")
    cover_img = None
    if cover_url and "default" not in cover_url:
        print(f"  [{idx}/{len(month_books)}] {b['title'][:20]}", end=" ", flush=True)
        cover_img = fetch_image(cover_url, COVER_W, COVER_H)
        if cover_img: print("OK")
        else: print("X")

    cx, cy = PAD + PAD, y + PAD
    if cover_img:
        img.paste(cover_img, (cx, cy))
    else:
        draw_placeholder_cover(draw, cx, cy, COVER_W, COVER_H)
    cx += COVER_W + 16
    content_w = W - PAD - cx - PAD
    # 如果是当日新书，需为右侧"本日新"标签预留空间，避免文字与标签重叠
    _badge_extra = (66 + 16) if b.get("isNewToday") else 0
    if _badge_extra:
        content_w -= _badge_extra

    # 书名
    title = b.get("title", "")
    tlines = wrap_text(title, FONT_BOOK, content_w, draw)
    for j, line in enumerate(tlines):
        draw.text((cx, cy), f"{idx}. {line}" if j == 0 else line, font=FONT_BOOK, fill=C_TEXT)
        cy += 36

    # 作者行
    author = b.get("author", "未知")
    draw_label_value(draw, cx, cy + 4, "作者: ", author, FONT_SMALL, C_TEXT3, C_TEXT2, content_w)
    cy += 30

    # 出版信息行
    meta = []
    if b.get("publisher"): meta.append(b["publisher"])
    pd = b.get("pubDateParsed", {})
    if pd:
        m = str(pd.get("month", "")).zfill(2)
        meta.append(f"{pd.get('year', '')}-{m}")
    if b.get("price"): meta.append(b["price"])
    # 元信息标签 + 值
    draw.text((cx, cy + 2), "出版: ", font=FONT_SMALL, fill=C_TEXT3)
    lw, _ = ts(draw, "出版: ", FONT_SMALL)
    draw.text((cx + lw, cy + 2), " | ".join(meta), font=FONT_SMALL, fill=C_TEXT2)
    cy += 26

    # 评分
    rating = b.get("rating", "")
    if rating:
        # 画星号
        draw.text((cx, cy + 2), "评分: ", font=FONT_SMALL, fill=C_TEXT3)
        lw, _ = ts(draw, "评分: ", FONT_SMALL)
        stars = f"* * * * *  ({rating})"
        rt = b.get("ratingText", "")
        if rt: stars += f" {rt}"
        draw.text((cx + lw, cy + 2), stars, font=FONT_SMALL, fill=C_ACCENT2)
        cy += 26

    # 简介
    desc = b.get("description", "")
    if desc:
        dlines = wrap_text(desc, FONT_SMALL, content_w, draw)
        for j, line in enumerate(dlines[:3]):
            draw.text((cx, cy + (4 if j == 0 else 2)), line, font=FONT_SMALL, fill=C_TEXT2)
            cy += 28

    # 链接
    cy += 2
    draw.text((cx, cy), "> 查看豆瓣详情", font=FONT_SMALL, fill=C_ACCENT2)

    # "本日新" 标记
    if b.get("isNewToday"):
        bw, bh = 66, 24
        draw_rrect(draw, (W - PAD - PAD - bw, y + PAD, W - PAD - PAD, y + PAD + bh), 10, C_NEW_BG)
        draw.text((W - PAD - PAD - bw + 10, y + PAD + 3), "本日新", font=FONT_BADGE, fill=(255, 255, 255))

    y += ch + CARD_PAD

# ============ 推荐区 ============
if all_recs:
    y += 4
    section_title(draw, y, "", "当日推荐", f"{len(all_recs)} 本精选")
    y += SECTION_H

    for idx, rec in enumerate(all_recs, 1):
        rh = rec_heights[idx - 1]
        draw_rrect(draw, (PAD, y, W - PAD, y + rh), RADIUS, C_CARD)
        # 左侧 accent
        draw.rectangle([(PAD, y + 10), (PAD + 6, y + rh - 10)], fill=C_ACCENT)

        cx = PAD + PAD + 10
        cy = y + PAD
        content_w = W - PAD - cx - PAD

        # 封面
        cover_img = rec_covers.get(idx - 1)
        if cover_img:
            img.paste(cover_img, (cx, cy))
            cx += REC_COVER_W + 14
            content_w = W - PAD - cx - PAD

        # 类型标签 — 先计算标签宽度，以便书名换行时预留空间
        rtype = "偏好推荐" if idx <= len(pref_recs) else "随机发现"
        tw_tag, _ = ts(draw, rtype, FONT_BADGE)
        tag_box_w = tw_tag + 20  # 标签矩形宽（含左右 padding 各 10px）
        tag_x1 = W - PAD - PAD - tag_box_w  # 标签左边界
        tag_x2 = W - PAD - PAD              # 标签右边界

        # 书名第一行需为标签预留空间（仅第一行）
        rtitle = rec.get("title", "")
        first_line_w = content_w - tag_box_w - 8  # 第一行可用宽（减标签+间距）
        first_line_w = max(80, first_line_w)       # 保底不能太窄
        # 分行：第一行用缩窄宽度，后续行用完整宽度
        title_lines_first = wrap_text(rtitle, FONT_BOOK, first_line_w, draw)
        # 如果第一行分出来了，检查剩余文字用完整 content_w 继续分
        if title_lines_first:
            first_part = title_lines_first[0]
            remaining_title = rtitle[len(first_part):]
            rest_lines = wrap_text(remaining_title, FONT_BOOK, content_w, draw) if remaining_title else []
            tlines = [first_part] + rest_lines
        else:
            tlines = []

        for j, line in enumerate(tlines):
            draw.text((cx, cy), f"{idx}. {line}" if j == 0 else line, font=FONT_BOOK, fill=C_TEXT)
            cy += 36

        # 标签 (右上)，紧贴右侧，与书名第一行垂直居中
        draw_rrect(draw, (tag_x1, y + PAD, tag_x2, y + PAD + 26), 12, C_TAG_BG)
        draw.text((tag_x1 + 10, y + PAD + 4), rtype, font=FONT_BADGE, fill=C_ACCENT2)

        # 作者
        draw_label_value(draw, cx, cy + 2, "作者: ", rec.get("author", ""), FONT_SMALL, C_TEXT3, C_TEXT2, content_w)
        cy += 28

        # 出版信息
        pub = rec.get("pubDate", "")
        pub_house = rec.get("publisher", "")
        pub_str = f"{pub}  {pub_house}".strip()
        if pub_str:
            draw_label_value(draw, cx, cy + 2, "出版: ", pub_str, FONT_SMALL, C_TEXT3, C_TEXT2, content_w)
            cy += 28

        # 简介
        rdesc = rec.get("description", "")
        if rdesc:
            dlines = wrap_text(rdesc, FONT_SMALL, content_w, draw)
            for j, line in enumerate(dlines[:3]):
                draw.text((cx, cy + (2 if j == 0 else 0)), line, font=FONT_SMALL, fill=C_TEXT2)
                cy += 28

        # 推荐理由
        reason = rec.get("reason", "")
        if reason:
            cy += 4
            label = "推荐: "
            label_w = ts(draw, label, FONT_SMALL)[0]
            text_indent = cx + 10 + label_w  # 第一行文字起始 x（标签后）
            inner_w = cx + content_w - text_indent  # 第一行内容可用宽
            inner_w = max(60, inner_w)
            # 第一行（缩进 label 宽度）
            first_rlines = wrap_text(reason, FONT_SMALL, inner_w, draw)
            first_r_text = first_rlines[0] if first_rlines else ""
            rest_reason = reason[len(first_r_text):]
            # 后续行（从 cx+10 开始，用完整宽度）
            rest_rlines = wrap_text(rest_reason, FONT_SMALL, content_w - 20, draw) if rest_reason else []
            all_rlines = ([first_r_text] if first_r_text else []) + rest_rlines
            box_h = len(all_rlines) * 28 + 16
            draw_rrect(draw, (cx, cy, cx + content_w, cy + box_h), 6, C_REASON_BG)
            ry = cy + 8
            # 第一行：画"推荐："标签 + 文字
            draw.text((cx + 10, ry), label, font=FONT_SMALL, fill=C_ACCENT2)
            if first_r_text:
                draw.text((text_indent, ry), first_r_text, font=FONT_SMALL, fill=C_ACCENT2)
            ry += 28
            # 后续行：从 cx+10 开始（与"推荐："标签左对齐）
            for line in rest_rlines:
                draw.text((cx + 10, ry), line, font=FONT_SMALL, fill=C_ACCENT2)
                ry += 28
            cy += box_h + 12

        # 兴趣按钮
        btn_w, btn_h = 120, 36
        draw_rrect(draw, (cx, cy, cx + btn_w, cy + btn_h), 18, outline=C_HEART_OFF, width=2, fill=C_CARD)
        tw, th = ts(draw, "o  感兴趣", FONT_SMALL)
        draw.text((cx + (btn_w - tw)//2, cy + (btn_h - th)//2 - 2), "o  感兴趣", font=FONT_SMALL, fill=C_TEXT3)
        # 画空心圆
        draw_circle(draw, cx + 24, cy + btn_h//2, 5, None)
        # 小圆重绘
        draw.ellipse([cx + 21, cy + btn_h//2 - 3, cx + 27, cy + btn_h//2 + 3], outline=C_HEART_OFF, width=2)

        y += rh + CARD_PAD
        print(f"  [推 {idx}/{len(all_recs)}] {rtitle}")

# ============ 页脚 ============
y += 16
draw.line([(PAD*2, y), (W - PAD*2, y)], fill=C_BORDER, width=1)
y += 24
fts = [
    "本报告由每日人文社科新书采集器 v4 自动生成",
    f"数据来源: 豆瓣网 | {CATEGORIES}",
    '点击"兴趣"记录你的阅读偏好',
]
for ft in fts:
    tw, _ = ts(draw, ft, FONT_SMALL)
    c = C_TEXT3 if "数据来源" in ft else (190, 185, 175)
    draw.text(((W - tw)//2, y), ft, font=FONT_SMALL, fill=c)
    y += 30

# ============ 裁切保存 ============
img = img.crop((0, 0, W, y + 40))
img.save(OUTPUT_PATH, "PNG", optimize=True)
kb = os.path.getsize(OUTPUT_PATH) / 1024
print(f"\nOK: {OUTPUT_PATH}")
print(f"   尺寸: {W}x{y+40}px, {kb:.0f} KB")
