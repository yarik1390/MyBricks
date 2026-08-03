/** Chinese (Simplified). Missing keys fall back to English (see lib/i18n.js). */
export const zh = {
  nav: { vault: '收藏库', catalog: '目录', scan: '扫描', minifigs: '人仔', me: '我的', badges: '徽章' },
  common: {
    cancel: '取消', save: '保存', close: '关闭', retry: '重试',
    delete: '删除', edit: '编辑', done: '完成', undo: '撤销',
    loading: '加载中…', search: '搜索', all: '全部', none: '无',
    yes: '是', no: '否', error: '出错了', offline: '你已离线',
    seeAll: '查看全部', share: '分享',
    and: '和',
  },
  settings: {
    title: '设置', language: '语言',
    languageDesc: '默认跟随设备语言，除非你自行选择。', languageAuto: '自动（{name}）',
    currency: '货币', currencyDesc: '以你的本地货币显示金额。',
    market: '零售市场', marketDesc: '门店报价所用的本地市场。转售价值仍以美元计。',
    appearance: '外观', notifications: '通知', signOut: '退出登录',
  },
  detail: {
    value: '价值', retired: '已停产', comingSoon: '即将上市', retiringSoon: '即将停产',
    pieces: '颗粒', minifigs: '人仔', retail: '零售价',
    addToVault: '加入收藏库', inVault: '已在收藏库', removeFromVault: '移出收藏库',
    tabInfo: '信息', tabForecast: '预测', tabCommunity: '社区',
    reliablePrice: '可靠价格', pricingDetails: '价格详情', priceHistory: '价格走势',
    details: '详情', estimated: '估算', year: '年份', theme: '主题',
    addToWishlist: '加入心愿单', inWishlist: '已在心愿单',
    addToVaultPrice: '加入收藏库 · {price}', priceHistoryDays: '价格历史 · {days} 天', priceHistoryShort: '价格历史 · {days}天', fromSources: '来自 {n} 个市场来源', fromSourcesOne: '来自 1 个市场来源', typicalRange: ' · 通常 {low}–{high}', likelyRange: ' · 可能 {low}-{high}', reviews: '{n} 条评价', reviewsOne: '1 条评价', up: '上涨 {pct}%', down: '下跌 {pct}%',
  },
  counts: {
    results: '{n} 个结果', resultsOne: '1 个结果', collected: '已收集 {owned}/{total}', owned: '拥有 {n}', ofFigs: '共 {total} 个人仔', figs: '{n} 个人仔', figsOne: '1 个人仔',
  },
  market: {
    sellNowLabel: '立即卖出',
    fastSaleAfterFees: '扣除费用后的快速出售',
    pctOfValue: '价值的 {pct}%',
    pctOfFairValue: '合理价值的 {pct}%',
    confidentlyPriced: '{pct}% 定价可信',
    families: '{n} 个独立市场来源',
    familyOne: '1 个独立市场来源',
    sales: '{n} 笔已验证成交',
    saleOne: '1 笔已验证成交',
    estimateUnlocks: '{list}估算将在获得更多成交数据后解锁。',
    estimatesUnlock: '{list}估算将在获得更多成交数据后解锁。',
  },
  card: {
    pieces: '{n} 颗粒',
    perPiece: '{price}/颗',
    lots: '{n} 个批次',
    deal: '优惠 {pct}',
    strongBuy: '强力推荐 {pct}',
    forecast2y: '{price} 2年',
    gamePieces: '{n} 颗粒',
    gameRetail: '零售价 {price}',
  },
  time: {
    unknown: '未知', today: '今天', yesterday: '昨天', daysAgo: '{n} 天前',
  },
  me: {
    trophyShelf: '展示架（{n}/6）',
  },
  kids: {
    xp: '{n} XP', xpToLevel: '还需 {n} XP 升到第 {level} 级', maxLevel: '已达最高等级！', pcs: '{n} 个零件', earned: '已获得 {n} / {total}', setsToGo: '还差 {n} 个套装', setsToGoOne: '还差 1 个套装！',
  },
  fees: {
    marketplace: '平台费用（{pct}%）', payment: '支付手续费（{pct}% + 固定）',
  },
  alerts: {
    priceDrop: '降价 · {days} 天前', targetWas: '— 您的目标价为 {price}。',
  },
  game: {
    roundOf: '第 {n} 轮，共 {total} 轮', pctOff: '您猜错了 {pct}%', streakLine: '{day} · 连续 {streak} · 最佳 {best}',
  },
  build: {
    needParts: '还需要 {n} 个零件', ofOwnedSets: '共 {n} 个已拥有的套装', indexing: '正在后台索引另外 {n} 个套装…',
  },
  catalog: {
    title: '目录', searchPlaceholder: '查找套装', results: '{count} 个套装',
    noResults: '未找到套装', filters: '筛选', sort: '排序', clearFilters: '清除筛选',
  },
  vault: {
    title: '收藏库', empty: '你的收藏库是空的', emptyDesc: '添加一个套装即可开始追踪其价值。',
    setsOwned: '拥有套装', totalValue: '总价值', invested: '投入', gain: '收益', addSet: '添加套装',
    investedAmount: '已投入 {amount}',
  },
  wishlist: {
    title: '心愿单', empty: '你的心愿单是空的', targetPrice: '目标价格',
    priceDropAlert: '降价时提醒我', remove: '移出心愿单',
    setsCount: '{n} 个套装', setsCountOne: '1 个套装', alertsCount: '{n} 条提醒', alertsCountOne: '1 条提醒', nowPrice: '现价 {price}',
  },
};
export default zh;
