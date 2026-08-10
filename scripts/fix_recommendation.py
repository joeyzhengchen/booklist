import re

fpath = r"C:\Users\争哥\WorkBuddy\2026-06-17-task-8\scripts\recommendation.js"
with open(fpath, 'r', encoding='utf-8') as f:
    content = f.read()

# 替换 generateRecommendations 函数开头部分
old = """function generateRecommendations(dateStr, monthBooks = []) {
  const pool = loadJSON('book_pool.json');
  if (!pool || pool.length === 0) {
    return { preferenceBased: [], random: [] };
  }"""

new = """function generateRecommendations(dateStr, monthBooks = []) {
  // 构建推荐池：优先使用当月新书，fallback 到 book_pool.json
  let pool = [];

  if (monthBooks && monthBooks.length > 0) {
    // 字段映射：subjectId→id, categories→genres
    pool = monthBooks.map(b => ({
      id: b.subjectId || '',
      title: b.title || '',
      author: b.author || '',
      publisher: b.publisher || '',
      pubDate: b.pubDate || '',
      description: b.description || '',
      genres: b.categories || [],
      tags: [],
      rating: b.rating || '',
    })).filter(b => b.id && b.title);
  } else {
    pool = loadJSON('book_pool.json') || [];
  }

  if (!pool || pool.length === 0) {
    return { preferenceBased: [], random: [] };
  }"""

if old in content:
    content = content.replace(old, new)
    print("✅ 替换成功")
else:
    print("❌ 未找到匹配字符串")
    # 调试：打印周围内容
    idx = content.find('function generateRecommendations')
    if idx >= 0:
        print("找到函数位置，周围内容：")
        print(repr(content[idx:idx+300]))

with open(fpath, 'w', encoding='utf-8') as f:
    f.write(content)
