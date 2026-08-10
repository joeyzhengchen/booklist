/**
 * 推荐引擎 v4 - 当日推荐模块
 * 2本基于用户偏好推荐 + 3本加权随机推荐
 *
 * 推荐池 = book_pool.json（精选书库，不含当月新增）
 * 每本推荐书必须包含 reason 字段（来自 book_pool.json）
 *
 * 改进（v4）：
 * - 推荐池仅使用 book_pool.json，不再混入当月新书（避免推荐效果局限）
 * - 书库从 50 本扩大到 200+ 本
 * - 加权随机：参考评分但引入随机性，避免只推荐名著名家
 * - 多样性保护：确保作者、题材、时代分布均匀
 * - 冷门好书：降低高知名度书籍权重，给冷门好书更多曝光
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function loadJSON(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function saveJSON(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ========== 推荐历史 ==========

function loadRecommendHistory() {
  return loadJSON('recommend_history.json') || { recommended: [] };
}

function saveRecommendHistory(bookIds, dateStr) {
  const history = loadRecommendHistory();
  const cutoff = new Date(dateStr);
  cutoff.setDate(cutoff.getDate() - 14); // 14天不重复
  const cutoffStr = cutoff.toISOString().split('T')[0];
  history.recommended = history.recommended.filter(r => r.date >= cutoffStr);

  for (const id of bookIds) {
    history.recommended.push({ bookId: id, date: dateStr });
  }
  saveJSON('recommend_history.json', history);
}

function getRecentlyRecommended(dateStr) {
  const history = loadRecommendHistory();
  const cutoff = new Date(dateStr);
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  return new Set(
    history.recommended
      .filter(r => r.date >= cutoffStr)
      .map(r => r.bookId)
  );
}

// ========== 用户偏好 ==========

function loadPreferences() {
  return loadJSON('preferences.json') || { liked: [] };
}

// ========== 加权随机选择 ==========

/**
 * 加权随机选择（Fisher-Yates 变体）
 * 权重 = 基础权重 × 随机因子
 * 基础权重根据书籍"热度"反向调整 —— 太热门的书降低权重
 */
function weightedRandomSelect(pool, n, { excludeSet = new Set(), diversityBoost = true } = {}) {
  const candidates = pool.filter(b => !excludeSet.has(b.id));
  if (candidates.length === 0) return [];

  // 计算权重
  const scored = candidates.map(book => {
    let weight = 1.0;

    // 1. 知名度/热门度反向加权（模拟"评分×评价人数"的热度）
    //    太热门的书降低权重，让冷门好书有更多机会
    const popularityScore = getPopularityScore(book);
    // 热度越高 → 权重越低（但不低于 0.3）
    weight *= Math.max(0.3, 1.5 - popularityScore);

    // 2. 评分正向加权（但不过度依赖）
    //    有评分且评分越高，稍微加分
    const ratingBonus = getRatingBonus(book);
    weight *= (1.0 + ratingBonus * 0.3);

    // 3. 随机因子（核心：确保每次推荐不同）
    weight *= (0.5 + Math.random());

    return { book, weight };
  });

  // 加权采样
  const selected = [];
  const selectedIds = new Set();

  for (let i = 0; i < n && scored.length > 0; i++) {
    // 多样性调整：如果已选的书和候选书同作者，降低权重
    const adjusted = scored.map(s => {
      let w = s.weight;
      if (diversityBoost && selected.length > 0) {
        // 同作者降权
        if (selected.some(sel => sel.author === s.book.author)) {
          w *= 0.2;
        }
        // 同类型降权
        if (selected.some(sel =>
          sel.genres && s.book.genres &&
          sel.genres.some(g => s.book.genres.includes(g))
        )) {
          w *= 0.5;
        }
      }
      return { ...s, weight: Math.max(0.01, w) };
    });

    // 加权随机选择
    const totalWeight = adjusted.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight <= 0) break;

    let rand = Math.random() * totalWeight;
    let picked = null;
    for (const s of adjusted) {
      rand -= s.weight;
      if (rand <= 0) {
        picked = s.book;
        break;
      }
    }
    if (!picked) picked = adjusted[adjusted.length - 1].book;

    selected.push(picked);
    selectedIds.add(picked.id);

    // 从候选池移除
    const idx = scored.findIndex(s => s.book.id === picked.id);
    if (idx >= 0) scored.splice(idx, 1);
  }

  return selected;
}

/**
 * 计算书籍热度分数 (0-1)
 * 基于是否为经典名著的启发式判断
 */
function getPopularityScore(book) {
  // 超经典名著列表 - 这些在推荐中应该偶尔出现而非每次都出现
  const megaClassics = [
    '百年孤独', '红楼梦', '活着', '围城', '1984', '三体',
    '局外人', '了不起的盖茨比', '挪威的森林', '追风筝的人',
    '小王子', '傲慢与偏见', '老人与海', '飘', '杀死一只知更鸟',
    '变形记', '罪与罚', '骆驼祥子', '阿Q正传', '平凡的世界',
    '月亮和六便士', '不能承受的生命之轻', '霍乱时期的爱情',
  ];

  if (megaClassics.includes(book.title)) return 0.9;

  // 一般经典
  const classics = [
    '鼠疫', '边城', '繁花', '白鹿原', '呼兰河传', '黄金时代',
    '雪国', '悉达多', '情人', '肖申克的救赎', '海边的卡夫卡',
    '追忆似水年华', '刀锋', '长日将尽', '小径分岔的花园',
    '看不见的城市', '城堡', '使女的故事', '一个人的村庄',
    '额尔古纳河右岸', '苏东坡传', '我们仨', '倾城之恋',
    '纳尔齐斯与歌尔德蒙', '夏日走过山间', '巴黎评论·作家访谈',
  ];
  if (classics.includes(book.title)) return 0.6;

  return 0.3; // 普通书籍 - 基础热度低
}

/**
 * 获取评分加权 (0-1)
 */
function getRatingBonus(book) {
  if (!book.rating) return 0.5; // 无评分给中等权重
  const r = parseFloat(book.rating);
  if (isNaN(r)) return 0.5;
  // 评分 7-10 映射到 0.3-1.0
  return Math.min(1.0, Math.max(0.3, (r - 7) / 3));
}

// ========== 主推荐函数 ==========

function generateRecommendations(dateStr, monthBooks = []) {
  // 推荐池：仅使用 book_pool.json（精选书库），不再混入当月新书
  // 这样推荐质量更稳定，且每本书都有预设的推荐理由
  const pool = loadJSON('book_pool.json') || [];

  if (!pool || pool.length === 0) {
    return { preferenceBased: [], random: [] };
  }

  const preferences = loadPreferences();
  const recentlyRecommended = getRecentlyRecommended(dateStr);

  // 可用书池：排除近期已推荐的
  let availablePool = pool.filter(b => !recentlyRecommended.has(b.id));

  // 如果用户有点赞偏好，生成 2 本关联推荐
  let preferenceBased = [];
  if (preferences.liked.length > 0) {
    preferenceBased = generatePreferenceBased(
      preferences.liked,
      availablePool,
      recentlyRecommended
    );
  }

  const usedIds = new Set(preferenceBased.map(b => b.id));

  // 构建随机池（排除已使用的）
  const randomPool = availablePool.filter(b => !usedIds.has(b.id));

  // 3 本加权随机推荐（含多样性保护）
  let random = weightedRandomSelect(randomPool, 3, {
    excludeSet: usedIds,
    diversityBoost: true,
  });

  // 如果偏好推荐不足 2 本，用随机补足
  if (preferenceBased.length < 2) {
    const needMore = 2 - preferenceBased.length;
    const remaining = randomPool.filter(
      b => !usedIds.has(b.id) && !random.some(r => r.id === b.id)
    );
    const supplements = weightedRandomSelect(remaining, needMore, {
      excludeSet: new Set([...usedIds, ...random.map(r => r.id)]),
      diversityBoost: true,
    });
    preferenceBased.push(...supplements);
    supplements.forEach(b => usedIds.add(b.id));
  }

  // 确保总数 5 本
  while (preferenceBased.length + random.length < 5) {
    const allUsed = new Set([
      ...preferenceBased.map(b => b.id),
      ...random.map(b => b.id),
    ]);
    const extra = availablePool.filter(b => !allUsed.has(b.id));
    if (extra.length === 0) break;
    const pick = extra[Math.floor(Math.random() * extra.length)];
    random.push(pick);
  }

  // 记录推荐历史
  const allRecommended = [...preferenceBased, ...random]
    .slice(0, 5)
    .map(b => b.id);
  saveRecommendHistory(allRecommended, dateStr);

  return { preferenceBased: preferenceBased.slice(0, 2), random: random.slice(0, 3) };
}

/**
 * 基于用户偏好生成关联推荐
 * 策略优先级：同作者 > 同题材 > 同标签
 * 每层策略内部加入随机性
 */
function generatePreferenceBased(likedBooks, availablePool, excludeSet) {
  const results = [];
  const usedIds = new Set();

  const sorted = [...likedBooks].sort(
    (a, b) => new Date(b.likedAt) - new Date(a.likedAt)
  );

  for (const liked of sorted) {
    if (results.length >= 2) break;

    // 策略 1：同作者
    if (liked.author) {
      const sameAuthor = availablePool.filter(
        b =>
          b.author === liked.author &&
          !usedIds.has(b.id) &&
          !excludeSet.has(b.id)
      );
      if (sameAuthor.length > 0) {
        // 随机选一本（而非总是选第一个）
        const pick = sameAuthor[Math.floor(Math.random() * sameAuthor.length)];
        results.push(pick);
        usedIds.add(pick.id);
        continue;
      }
    }

    // 策略 2：同类型/题材（匹配度越高越好，但 top 3 中随机选）
    if (liked.genres && liked.genres.length > 0) {
      const matchingGenre = availablePool
        .filter(b => {
          if (usedIds.has(b.id) || excludeSet.has(b.id)) return false;
          if (!b.genres || b.genres.length === 0) return false;
          return b.genres.some(g => liked.genres.includes(g));
        })
        .map(b => ({
          book: b,
          matchCount: b.genres.filter(g => liked.genres.includes(g)).length,
        }))
        .sort((a, b) => b.matchCount - a.matchCount);

      if (matchingGenre.length > 0) {
        // Top 3 中随机选一个（增加多样性）
        const topN = matchingGenre.slice(0, Math.min(3, matchingGenre.length));
        const pick = topN[Math.floor(Math.random() * topN.length)].book;
        results.push(pick);
        usedIds.add(pick.id);
        continue;
      }
    }

    // 策略 3：同标签（随机选择）
    if (liked.tags && liked.tags.length > 0) {
      const matchingTags = availablePool.filter(b => {
        if (usedIds.has(b.id) || excludeSet.has(b.id)) return false;
        if (!b.tags || b.tags.length === 0) return false;
        return b.tags.some(t => liked.tags.includes(t));
      });
      if (matchingTags.length > 0) {
        const pick =
          matchingTags[Math.floor(Math.random() * matchingTags.length)];
        results.push(pick);
        usedIds.add(pick.id);
      }
    }
  }

  return results;
}

module.exports = {
  generateRecommendations,
  loadPreferences,
  loadRecommendHistory,
  DATA_DIR,
};
