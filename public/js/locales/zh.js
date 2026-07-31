/** Chinese (Simplified). Missing keys fall back to English (see lib/i18n.js). */
export const zh = {
  nav: { vault: '收藏库', catalog: '目录', scan: '扫描', minifigs: '人仔', me: '我的', badges: '徽章' },
  common: {
    cancel: '取消', save: '保存', close: '关闭', retry: '重试',
    delete: '删除', edit: '编辑', done: '完成', undo: '撤销',
    loading: '加载中…', search: '搜索', all: '全部', none: '无',
    yes: '是', no: '否', error: '出错了', offline: '你已离线',
    seeAll: '查看全部', share: '分享',
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
  },
  catalog: {
    title: '目录', searchPlaceholder: '查找套装', results: '{count} 个套装',
    noResults: '未找到套装', filters: '筛选', sort: '排序', clearFilters: '清除筛选',
  },
  vault: {
    title: '收藏库', empty: '你的收藏库是空的', emptyDesc: '添加一个套装即可开始追踪其价值。',
    setsOwned: '拥有套装', totalValue: '总价值', invested: '投入', gain: '收益', addSet: '添加套装',
  },
  wishlist: {
    title: '心愿单', empty: '你的心愿单是空的', targetPrice: '目标价格',
    priceDropAlert: '降价时提醒我', remove: '移出心愿单',
  },
};
export default zh;
