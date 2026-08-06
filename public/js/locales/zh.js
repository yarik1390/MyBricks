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
Object.assign(zh.catalog, { filtersWithCount: '筛选 · {n}' });
zh.community = { pendingSubmissionOne: '⏳ 你有 {n} 项投稿等待审核。', pendingSubmissionFew: '⏳ 你有 {n} 项投稿等待审核。', pendingSubmissionMany: '⏳ 你有 {n} 项投稿等待审核。', pendingSubmissionOther: '⏳ 你有 {n} 项投稿等待审核。' };
zh.contributions = { approvedOne: '{n} 项已批准的贡献', approvedFew: '{n} 项已批准的贡献', approvedMany: '{n} 项已批准的贡献', approvedOther: '{n} 项已批准的贡献', contributorBadge: ' · ⭐ 贡献者' };
zh.admin = { uploadingFile: '正在上传 {file}…', importedMinifigs: '已导入 {parsed} 个迷你人偶中的 {inserted} 个。评估时会将它们与价格对应。', uploadFailed: '失败：{error}', lastRun: '上次运行 {when}{duration}' };
zh.downloads = { interrupted: '下载在 {pct}% 时中断 — 点击“继续”以继续。', resume: '继续（{pct}）', scanProgress: '正在识别 {total} 个中的第 {current} 个…' };
Object.assign(zh.detail, { acquired: '购入于 {date}{source}' });
Object.assign(zh.wishlist, { targetPriceCurrency: '目标价格（{symbol}）', suggestedPrice: '建议：{price}' });
zh.minifigs = { appearsInSetsOne: '出现于 {n} 个套装', appearsInSetsFew: '出现于 {n} 个套装', appearsInSetsMany: '出现于 {n} 个套装', appearsInSetsOther: '出现于 {n} 个套装' };
Object.assign(zh.admin, { syncJobRunning: '{label}：正在运行…', syncJobSkipped: '已跳过 — {n}', syncJobSummary: '已处理 {processed}，已更新 {updated}，已拒绝 {rejected}', syncJobResult: '{label}：{summary}', syncJobFailed: '{label} 失败：{error}', uploadSuccessToast: 'BrickLink 人仔目录：已导入 {inserted}', uploadErrorToast: '目录上传失败：{error}', countRunning: '{n} 个正在运行', countHealthy: '{n} 个正常', countFailed: '{n} 个失败', countNotRun: '{n} 个尚未运行', completedSlices: '已完成 {n} 个安全步骤', jobId: '任务 #{id}', filled: '已填充 {n}', processed: '已处理 {n}', figures: '{n} 个人仔', noItemsProcessed: '未处理任何项目' });
Object.assign(zh.admin, { jobStarted: '任务 #{id} 已启动', jobFailed: '任务失败：{error}', maintenanceComplete: '{label} 已完成', maintenanceFailed: '{label} 失败：{error}', lastSeen: '上次发现于 {when}' });
Object.assign(zh.admin, { tools: { sets: '导入套装', figs: '导入人仔', upc: '补全条码', populate: '补全覆盖范围', revalue: '重新估价', everything: '补全所有安全来源', pricechartingBulk: '刷新 PriceCharting（LEGO 批量）', pricechartingVerify: '验证 PriceCharting 映射', pricesapi: '立即运行 pricesAPI', ebaySold: '运行 eBay 已售搜索' }, maintenanceTools: { expire: '使估值过期', repair: '修复搜索索引' }, countRunningOne: '{n} 个正在运行', countRunningFew: '{n} 个正在运行', countRunningMany: '{n} 个正在运行', countRunningOther: '{n} 个正在运行', countHealthyOne: '{n} 个正常', countHealthyFew: '{n} 个正常', countHealthyMany: '{n} 个正常', countHealthyOther: '{n} 个正常', countFailedOne: '{n} 个失败', countFailedFew: '{n} 个失败', countFailedMany: '{n} 个失败', countFailedOther: '{n} 个失败', countNotRunOne: '{n} 个尚未运行', countNotRunFew: '{n} 个尚未运行', countNotRunMany: '{n} 个尚未运行', countNotRunOther: '{n} 个尚未运行', completedSlicesOne: '已完成 {n} 个安全步骤', completedSlicesFew: '已完成 {n} 个安全步骤', completedSlicesMany: '已完成 {n} 个安全步骤', completedSlicesOther: '已完成 {n} 个安全步骤', filledOne: '已填充 {n}', filledFew: '已填充 {n}', filledMany: '已填充 {n}', filledOther: '已填充 {n}', processedOne: '已处理 {n}', processedFew: '已处理 {n}', processedMany: '已处理 {n}', processedOther: '已处理 {n}', figuresOne: '{n} 个人仔', figuresFew: '{n} 个人仔', figuresMany: '{n} 个人仔', figuresOther: '{n} 个人仔' });
Object.assign(zh.detail, { uploadFailed: '上传失败：{error}', removeFailed: '删除失败：{error}', forecastUpside: '预测还有约 {pct} 的上涨空间' }); zh.data = { reportFailed: '报告生成失败：{error}', restoreFailed: '恢复失败：{error}', retryFailed: '重试失败：{error}', exportFailed: '导出失败：{error}', importFailed: '导入失败：{error}', bricklinkImportFailed: 'BrickLink 导入失败：{error}' }; zh.integrations = { bricksetSyncFailed: 'Brickset 同步失败：{error}' }; zh.scanner = { timedOut: '耗时太长，请重试。', timedOutShort: '已超时', scanFailed: '错误：{error}' };
Object.assign(zh.common, { errorWithDetails: '错误：{error}' }); Object.assign(zh.integrations, { bricksetSyncResult: '已导入 {added} 个套装（{skipped} 个不在目录中，Brickset 共 {total} 个）。', bricksetSyncSuccess: 'Brickset 同步：已添加 {added} 个套装' }); Object.assign(zh.scanner, { bulkPartial: '已添加 {added}/{total}，{failed} 个失败，请重试', addSetsFailed: '添加套装失败：{error}' }); zh.portfolio = { collectionLoadFailed: '无法加载收藏：{error}', bulkRemovePartial: '已移除 {removed}/{total}，{failed} 个失败，请重试', restoredCount: '已恢复 {restored}/{total}' };
Object.assign(zh.settings, { currencyUpdated: '货币已更新为 {currency}' });
Object.assign(zh.common, { offlineActionsSynced: '已同步 {count} 个离线操作', offlineActionsDiscarded: '{count} 个离线操作无法同步，已丢弃', localItemsSynced: '已同步 {count} 个本地项目', kidsXp: '+{xp} XP! {level} {badge}', copied: '已复制{label}' }); Object.assign(zh.admin, { serviceTestResult: '{head} — {detail}（{ms}ms）', providerStatus: '{provider}: {status}', serviceTestFailed: '失败：{error}', providerTestFailed: '{provider} 测试失败', featureFlagStatus: '{flag}: {status}{suffix}', featureFlagUpdateFailed: '无法更新 {flag}：{error}', providerSaved: '已保存 {provider}。', providerSaveFailed: '保存 {provider} 时出错：{error}', pricingConfigLoadFailed: '无法加载价格配置：{error}', resetFailed: '重置失败：{error}', contributionAction: '{action} — {applied}', enabled: '已启用', disabled: '已禁用', approved: '已通过', rejected: '已拒绝' }); Object.assign(zh.minifigs, { ownedCount: '拥有 {count}' }); Object.assign(zh.data, { restoredFromBackup: '已从 {date} 恢复 {count} 个套装', migrationStillFailing: '仍有 {count} 个项目失败：{error}', migrationComplete: '完成 — 已同步 {count} 个项目。', importResult: '✓ 已导入 {imported} 个，跳过 {skipped} 个，错误 {errors} 个', setsImported: '已导入 {count} 个套装', bricklinkImportResult: '✓ 已添加 {added} 个套装，跳过 {skipped} 个。{errors}', bricklinkSetsImported: '已从 BrickLink 订单导入 {count} 个套装' }); Object.assign(zh.integrations, { keyRemoved: '已移除 {label} 密钥', keyVerified: '已验证并保存 {label} 密钥' }); Object.assign(zh.scanner, { setNotFound: '目录中未找到套装 {setNum}。', localAiOfflineFailed: '设备端 AI 失败且你当前离线：{error}', addItemFailed: '无法添加 {name}：{error}', minifig: '人仔', itemsAdded: '已将 {count} 个项目加入收藏库', itemsSavedOffline: '已离线保存 {count} 个项目 — 将自动同步', setsSavedOffline: '已离线保存 {count} 个套装 — 连接后将同步' }); Object.assign(zh.portfolio, { soldFor: '以 {price} 售出 — 已从收藏库移除' });
Object.assign(zh.common, { offlineActionsSyncedOne: '已同步 {count} 个离线操作', offlineActionsSyncedOther: '已同步 {count} 个离线操作', offlineActionsDiscardedOne: '{count} 个离线操作无法同步，已丢弃', offlineActionsDiscardedOther: '{count} 个离线操作无法同步，已丢弃', localItemsSyncedOne: '已同步 {count} 个本地项目', localItemsSyncedOther: '已同步 {count} 个本地项目', kidsXp: '+{xp} XP!{details}', kidsXpLevel: ' 升至 {level} 级！', kidsXpBadge: ' · 获得徽章：{badge}！🎉' }); Object.assign(zh.scanner, { itemsAddedOne: '已将 {count} 个项目加入收藏库', itemsAddedOther: '已将 {count} 个项目加入收藏库', itemsSavedOfflineOne: '已离线保存 {count} 个项目 — 将自动同步', itemsSavedOfflineOther: '已离线保存 {count} 个项目 — 将自动同步', setsSavedOfflineOne: '已离线保存 {count} 个套装 — 连接后将同步', setsSavedOfflineOther: '已离线保存 {count} 个套装 — 连接后将同步' }); Object.assign(zh.portfolio, { wishlistAlertsTooltip: '心愿单提醒（{spikes} 次上涨，{drops} 次降价）', bulkLocationPartial: '已更新 {updated}/{total} — {failed} 个失败，请重试' });
Object.assign(zh.data, { restoredFromBackupOne: '已从 {date} 恢复 {count} 个套装', restoredFromBackupOther: '已从 {date} 恢复 {count} 个套装' }); Object.assign(zh.integrations, { bricksetSyncResultOne: '已导入 {count} 个套装（{skipped} 个不在目录中，Brickset 共 {total} 个）。', bricksetSyncResultOther: '已导入 {count} 个套装（{skipped} 个不在目录中，Brickset 共 {total} 个）。', bricksetSyncSuccessOne: 'Brickset 同步：已添加 {count} 个套装', bricksetSyncSuccessOther: 'Brickset 同步：已添加 {count} 个套装' }); Object.assign(zh.wishlist, { unreadAlertsOne: '{count} 条未读提醒', unreadAlertsOther: '{count} 条未读提醒' }); Object.assign(zh.portfolio, { wishlistAlertsTooltip: '心愿单提醒（{spikes}，{drops}）', wishlistAlertSpikesOne: '{count} 次上涨', wishlistAlertSpikesOther: '{count} 次上涨', wishlistAlertDropsOne: '{count} 次降价', wishlistAlertDropsOther: '{count} 次降价', insightSignal: '转售 {direction}{pct}% 对比{basis}{quantity}', insightMarket: '市场', insightValue: '价值', insightQuantity: ' · ×{count}' });
Object.assign(zh.kids, { badgeCelebration: '获得新徽章：{badge}！🎉', badgeQuip: '你是拼搭小明星！🌟', levelCelebration: '达到 {level} 级！🎉', levelQuip: '继续拼搭吧！🧱', badgeFirstBrick: '第一块积木！', badgeJuniorBuilder: '初级拼搭师', badgeArchitect: '建筑师', badgeMaster: '大师拼搭师', badgeGrandMaster: '宗师', badgeLegend: '传奇！' });
Object.assign(zh.data, { csvImportConfirmTitleOne: '导入 1 个套装？', csvImportConfirmTitleOther: '导入 {count} 个套装？', csvImportMore: '，另有 {count} 个', csvImportConfirmMessage: '从以下开始：{sample}{more}。现有套装会保留。', importConfirm: '导入' });
Object.assign(zh.scanner, { setNumberMatched: '套装编号与目录匹配。' });
Object.assign(zh.portfolio, { insightHeadlineOne: '现在售出 1 个套装约有 {value} 上涨空间', insightHeadlineOther: '现在售出 {count} 个套装约有 {value} 上涨空间' });
Object.assign(zh.market, { goodTimeToSell: '适合出售', goodTimeToBuy: '适合购买', onlyForSale: '目前仅有 {count} 件在售', askingHighHint: '卖家要价较高——想快速出售可接近近期成交价上架', askingLowHint: '挂牌价低于近期成交价——适合购买', askingSummary: '目前在售 {count} 件 · 要价 {asking}', askingSummaryWithSold: '目前在售 {count} 件 · 要价 {asking}，近期成交 {sold}' });
Object.assign(zh.game, { marketGenius: '{score}/5 — market genius! 🎯', streakQuipOne: 'Streak: {count} day.', streakQuipOther: 'Streak: {count} days.' }); zh.market = Object.assign(zh.market || {}, { sellingAbove: 'Selling about {pct} above this value', sellingBelow: 'Selling about {pct} below this value' }); Object.assign(zh.scanner, { findingSet: 'Finding set...', lookingUpSet: 'Looking up {setNum} in the catalog.' });
Object.assign(zh.game, { marketGenius: '{score}/5 — 市场高手！🎯', streakQuipOne: '连续：{count} 天。', streakQuipOther: '连续：{count} 天。' });
Object.assign(zh.market, { sellingAbove: '成交价约高于此价值 {pct}', sellingBelow: '成交价约低于此价值 {pct}' }); Object.assign(zh.scanner, { findingSet: '正在查找套装…', lookingUpSet: '正在目录中查找 {setNum}。', bulkMatched: '{total} 个中匹配 {matched} 个' }); Object.assign(zh.game, { revealCorrect: '🎯 猜对了！— 是 {value}', revealIncorrect: '差一点 — 是 {value}' }); Object.assign(zh.catalog, { activeFiltersOne: '1 个已启用', activeFiltersOther: '{count} 个已启用' }); Object.assign(zh.portfolio, { anniversaryGain: '以 {paid} 购入 — 至今上涨 {gain}。', anniversaryNoGain: '以 {paid} 购入。有些套装为热爱，不为盈利。', anniversaryQuip: '拼搭时光飞逝。', anniversaryCelebrationOne: '与 {set} 相伴 1 年！🎂', anniversaryCelebrationOther: '与 {set} 相伴 {count} 年！🎂' });
Object.assign(zh.market, { partsCoverage: '零件覆盖率 {pct}%', forecastScenarios: '看跌 {bear} · 基准 {base} · 看涨 {bull}', salesSuffix: ' / {count} 笔成交', newSold: '全新已售', usedSold: '二手已售', viewOnBrickLink: '在 BrickLink 查看' }); Object.assign(zh.catalog, { loadFailedDetail: '{error}。请检查网络连接后重试。' }); Object.assign(zh.portfolio, { moreThemesOne: '+1 个更多主题', moreThemesOther: '+{count} 个更多主题', sealedParts: '全新未拆 {sealed} · {approximate}零件 {parts}' }); zh.advisor = Object.assign(zh.advisor || {}, { moreThemesOne: '你的收藏库中还有 1 个主题', moreThemesOther: '你的收藏库中还有 {count} 个主题' });
Object.assign(zh.game, { loadFailed: '无法加载今天的游戏：{error}' }); Object.assign(zh.contributions, { loadFailed: '无法加载：{error}' }); Object.assign(zh.me, { wrappedLoadFailed: '无法加载你的年度回顾：{error}', wrappedValueChange: '收藏库今年{direction} {value}', wrappedUp: '上涨', wrappedDown: '下跌' });
Object.assign(zh.catalog, { filterSummaryNone: '没有启用的筛选条件', filterSummaryActiveOne: '{count} 个筛选条件：{items}', filterSummaryActiveOther: '{count} 个筛选条件：{items}', filterSummarySearch: '搜索“{value}”', filterSummaryStatusRetired: '仅已停产', filterSummaryStatusActive: '仅在售', filterSummaryStatusRetiring: '即将停产', filterSummaryDeal: '仅优惠', filterSummaryRangeYear: '年份', filterSummaryRangePieces: '零件数', filterSummaryRangeValue: '价值', filterSummaryRangeBetween: '{label} {min}–{max}', filterSummaryRangeMin: '{label} ≥ {value}', filterSummaryRangeMax: '{label} ≤ {value}', filterSummaryPiecesValue: '{value} 件', filterSummaryValueAmount: 'US${value}' });
Object.assign(zh.minifigs, { filterSummaryNone: '没有启用的筛选条件', filterSummaryActiveOne: '{count} 个筛选条件：{items}', filterSummaryActiveOther: '{count} 个筛选条件：{items}', filterSummarySearch: '搜索“{value}”', filterSummaryRarity: '稀有度：{rarity}', filterSummaryRarityCommon: '普通', filterSummaryRarityUncommon: '不常见', filterSummaryRarityRare: '稀有', filterSummaryRarityLegendary: '传奇', filterSummaryOwned: '仅已拥有', filterSummaryUnowned: '仅未拥有' });
Object.assign(zh.catalog, { emptySearchResults: '没有与“{query}”匹配的套装。请尝试其他搜索或清除筛选条件。', emptyFilteredResults: '没有套装符合这些筛选条件。请尝试其他搜索或清除筛选条件。' });
Object.assign(zh.advisor, { retiredSetsOfTotalOne: '{total} 套中有 {retired} 套已停产', retiredSetsOfTotalOther: '{total} 套中有 {retired} 套已停产' });
Object.assign(zh.scanner, { duplicateConfirmTitle: '已拥有', duplicateConfirmMessage: '你的收藏库中已有 {names}。要再添加一份吗？', duplicateConfirmAction: '仍要添加' });
Object.assign(zh.scanner, { minifigWithSeries: '{series} 系列的{minifig}', minifigWithRarity: '{rarity}{minifig}', rarityUnknown: '未知' });
Object.assign(zh.admin, { jobAccepted: '已接受 {label}，很快会显示在活动中', pricechartingBulkAccepted: '已开始 PriceCharting 批量下载，结果很快会显示在活动中', pricechartingVerifyAccepted: '已开始 PriceCharting 验证，请在活动中查看已提升的映射', pricesapiAccepted: '已开始 pricesAPI 刷新，请在活动中查看结果' });
Object.assign(zh.scanner, { setsFoundOne: '找到 {count} 个套装', setsFoundOther: '找到 {count} 个套装', minifigsFoundOne: '找到 {count} 个小人仔', minifigsFoundOther: '找到 {count} 个小人仔', mixedResultsFoundOne: '找到 {count} 个结果（套装和小人仔）', mixedResultsFoundOther: '找到 {count} 个结果（套装和小人仔）', confidenceHigh: '高置信度', confidenceMedium: '中等置信度', confidenceLow: '低置信度', confidenceUnknown: '匹配置信度不可用', matchHigh: '高匹配度', matchMedium: '中等匹配度', matchLow: '低匹配度', match: '匹配' });
Object.assign(zh.detail, { sellReasonGainSincePurchase: '自购买以来上涨 {roi}', sellReasonTrendDown: '价格趋势已转向下行', sellReasonClimbFlattened: '价格涨势已趋平', sellReasonLittleUpside: '预测仅剩 {upside} 上涨空间', sellReasonSellsFast: '{volume} 笔近期成交表明它卖得很快', sellReasonWatchClosely: '密切关注市场', sellReasonStillClimbing: '价格仍在上涨', sellReasonForecastUpside: '预测显示还有 {upside} 上涨空间', sellReasonNotRetired: '尚未停产', sellReasonNoSellTrigger: '尚无明确的出售信号' });
Object.assign(zh.data, { migrationStillFailingOne: '仍有 {count} 个项目失败：{error}', migrationStillFailingOther: '仍有 {count} 个项目失败：{error}', migrationCompleteOne: '完成 — 已同步 {count} 个项目。', migrationCompleteOther: '完成 — 已同步 {count} 个项目。', setsImportedOne: '已导入 {count} 个套装', setsImportedOther: '已导入 {count} 个套装', bricklinkSetsImportedOne: '已从 BrickLink 订单导入 {count} 个套装', bricklinkSetsImportedOther: '已从 BrickLink 订单导入 {count} 个套装' });
Object.assign(zh.detail, { sellReasonSellsFastOne: '{volume} 笔近期成交表明它卖得很快', sellReasonSellsFastOther: '{volume} 笔近期成交表明它卖得很快' });
Object.assign(zh.minifigs, { setExclusive: '套装独占', inSetsOne: '出现于 {count} 个套装', inSetsOther: '出现于 {count} 个套装', partsOne: '{count} 个零件', partsOther: '{count} 个零件' });
Object.assign(zh.minifigs, { emptySearchResults: '没有与“{query}”匹配的人仔。', emptyFilteredResults: '没有人仔符合这些筛选条件。' });
Object.assign(zh.detail, { partsComplete: '完整', partsMissingOne: '缺少 {count} 个零件', partsMissingOther: '缺少 {count} 个零件', allPartsPresent: '所有零件齐全' });
Object.assign(zh.build, { needPartsOne: '还需要 {n} 个零件', needPartsOther: '还需要 {n} 个零件' });
Object.assign(zh.card, { lotsOne: '{n} 个批次', lotsOther: '{n} 个批次' });
Object.assign(zh.market, { salesSuffixOne: ' / {count} 笔成交', salesSuffixOther: ' / {count} 笔成交' });
Object.assign(zh.data, { importedCountOne: '已导入 {n} 个套装', importedCountOther: '已导入 {n} 个套装', skippedCountOne: '已跳过 {n} 个套装', skippedCountOther: '已跳过 {n} 个套装', errorsCountOne: '{n} 个错误', errorsCountOther: '{n} 个错误', setsAddedCountOne: '已添加 {n} 个套装', setsAddedCountOther: '已添加 {n} 个套装', importResult: '✓ {imported}、{skipped}、{errors}', bricklinkImportResult: '✓ {added}、{skipped}。{errors}' });
Object.assign(zh.admin, { minifigsImportedOne: '{n} 个小人仔', minifigsImportedOther: '{n} 个小人仔', minifigsParsedOne: '{n} 个小人仔', minifigsParsedOther: '{n} 个小人仔', importedMinifigs: '已导入 {inserted} / {parsed}。估值时会关联价格。' });
Object.assign(zh.time, {"daysAgoOne":"{n} 天前","daysAgoOther":"{n} 天前"});
Object.assign(zh.scanner, {"bulkPartialOne":"已添加 {added}/{total}，{failed} 个失败，请重试","bulkPartialOther":"已添加 {added}/{total}，{failed} 个失败，请重试"});
Object.assign(zh.kids, {"setsToGoOne":"还差 {n} 个套装","setsToGoOther":"还差 {n} 个套装","earnedOne":"已获得 {n} / {total}","earnedOther":"已获得 {n} / {total}"});
Object.assign(zh.market, {"familiesOne":"{n} 个独立市场来源","familiesOther":"{n} 个独立市场来源","salesOne":"{n} 笔已验证成交","salesOther":"{n} 笔已验证成交","onlyForSaleOne":"目前仅有 {count} 件在售","onlyForSaleOther":"目前仅有 {count} 件在售","askingSummaryOne":"目前在售 {count} 件 · 要价 {asking}","askingSummaryOther":"目前在售 {count} 件 · 要价 {asking}","askingSummaryWithSoldOne":"目前在售 {count} 件 · 要价 {asking}，近期成交 {sold}","askingSummaryWithSoldOther":"目前在售 {count} 件 · 要价 {asking}，近期成交 {sold}"});
Object.assign(zh.detail, {"fromSourcesOne":"来自 {n} 个市场来源","fromSourcesOther":"来自 {n} 个市场来源","reviewsOne":"{n} 条评价","reviewsOther":"{n} 条评价","priceHistoryDaysOne":"价格历史 · {n} 天","priceHistoryDaysOther":"价格历史 · {n} 天","priceHistoryShortOne":"价格历史 · {n}天","priceHistoryShortOther":"价格历史 · {n}天"});
Object.assign(zh.alerts, {"priceDropOne":"降价 · {n} 天前","priceDropOther":"降价 · {n} 天前"});
Object.assign(zh.portfolio, {"bulkLocationPartialOne":"已更新 {updated}/{total} — {failed} 个失败，请重试","bulkLocationPartialOther":"已更新 {updated}/{total} — {failed} 个失败，请重试","bulkRemovePartialOne":"已移除 {removed}/{total}，{failed} 个失败，请重试","bulkRemovePartialOther":"已移除 {removed}/{total}，{failed} 个失败，请重试","restoredCountOne":"已恢复 {restored}/{total}","restoredCountOther":"已恢复 {restored}/{total}"});
Object.assign(zh.wishlist, {"setsCountOne":"{n} 个套装","setsCountOther":"{n} 个套装","alertsCountOne":"{n} 条提醒","alertsCountOther":"{n} 条提醒"});
Object.assign(zh.admin, {"syncJobSkippedOne":"已跳过 — {n}","syncJobSkippedOther":"已跳过 — {n}","syncJobSummaryOne":"已处理 {processed}，已更新 {updated}，已拒绝 {rejected}","syncJobSummaryOther":"已处理 {processed}，已更新 {updated}，已拒绝 {rejected}","uploadSuccessToastOne":"BrickLink 人仔目录：已导入 {n}","uploadSuccessToastOther":"BrickLink 人仔目录：已导入 {n}","contributionActionOne":"{action} — {n}","contributionActionOther":"{action} — {n}"});
Object.assign(zh.data, {"csvImportMoreOne":"，另有 {n} 个","csvImportMoreOther":"，另有 {n} 个","csvImportConfirmMessageOne":"从以下开始：{sample}{more}。现有套装会保留。","csvImportConfirmMessageOther":"从以下开始：{sample}{more}。现有套装会保留。"});
Object.assign(zh.me, {"trophyShelfOne":"展示架（{n}/6）","trophyShelfOther":"展示架（{n}/6）"});
Object.assign(zh.build, {"ofOwnedSetsOne":"共 {n} 个已拥有的套装","ofOwnedSetsOther":"共 {n} 个已拥有的套装","indexingOne":"正在后台索引另外 {n} 个套装…","indexingOther":"正在后台索引另外 {n} 个套装…"});
Object.assign(zh.counts, {"collectedOne":"已收集 {owned}/{total}","collectedOther":"已收集 {owned}/{total}","ownedOne":"拥有 {n}","ownedOther":"拥有 {n}","ofFigsOne":"共 {total} 个人仔","ofFigsOther":"共 {total} 个人仔","resultsOne":"{n} 个结果","resultsOther":"{n} 个结果","figsOne":"{n} 个人仔","figsOther":"{n} 个人仔"});
Object.assign(zh.minifigs, {"ownedCountOne":"拥有 {n}","ownedCountOther":"拥有 {n}"});
Object.assign(zh.catalog, {"filtersWithCountOne":"筛选 · {n}","filtersWithCountOther":"筛选 · {n}"});
Object.assign(zh.scanner, {"bulkMatchedOne":"{total} 个中匹配 {matched} 个","bulkMatchedOther":"{total} 个中匹配 {matched} 个"});
Object.assign(zh.kids, {"pcsOne":"{n} 个零件","pcsOther":"{n} 个零件"});
Object.assign(zh.card, {"gamePiecesOne":"{n} 颗粒","gamePiecesOther":"{n} 颗粒","piecesOne":"{n} 颗粒","piecesOther":"{n} 颗粒"});
Object.assign(zh.scanner, { bulkMatchedOne: '{total} 个中匹配 {n} 个', bulkMatchedOther: '{total} 个中匹配 {n} 个' });
Object.assign(zh.kids, { pcsOne: '{n} 个零件', pcsOther: '{n} 个零件' });
Object.assign(zh.card, { gamePiecesOne: '{n} 颗粒', gamePiecesOther: '{n} 颗粒', piecesOne: '{n} 个零件', piecesOther: '{n} 个零件' });
Object.assign(zh.share ??= {}, {"gameTitle":"Price It!","gameText":"🧱 Price It! {day}\\n{tiles} {score}/5 · streak {streak}\\nGuess LEGO market prices on BricksVault","setText":"Check out {name} ({setNum}) on BricksVault!","setDialogTitle":"Share {name}","portfolioTitle":"My LEGO BricksVault","portfolioText":"Check out my LEGO collection on BricksVault!","portfolioDialogTitle":"Share my BricksVault","wrappedTitle":"Brick Wrapped {year}","wrappedBest":"Best performer: {name}{roi}","wrappedTracked":"Tracked with BricksVault","wrappedSetsAdded":"sets added","wrappedPiecesAdded":"pieces","wrappedValueChange":"vault value change","wrappedTagline":"BRICKSVAULT · STACK SOMETHING BEAUTIFUL"});
Object.assign(zh.share, { gameTitle: '猜价格！', gameText: '🧱 猜价格！{day}\n{tiles} {score}/5 · 连胜 {streak}\n在 BricksVault 猜猜 LEGO 市场价格', setText: '在 BricksVault 查看 {name}（{setNum}）！', setDialogTitle: '分享 {name}', portfolioTitle: '我的 LEGO BricksVault', portfolioText: '来看看我在 BricksVault 上的 LEGO 收藏！', portfolioDialogTitle: '分享我的 BricksVault', wrappedTitle: '积木年度回顾 {year}', wrappedBest: '最佳表现：{name}{roi}', wrappedTracked: '通过 BricksVault 跟踪', wrappedValueChange: '收藏库价值变化', wrappedTagline: 'BRICKSVAULT · 拼出美好', wrappedHeading: '积木年度回顾', wrappedDescription: '用数字回顾你的收藏年 — 分享它。', wrappedLoading: '正在清点你的积木…', wrappedSummaryTitle: '🧱 我的积木年度回顾 {year}', wrappedSetsAddedOne: '新增 {count} 套', wrappedSetsAddedOther: '新增 {count} 套', wrappedPiecesAddedOne: '{count} 块零件', wrappedPiecesAddedOther: '{count} 块零件', wrappedMinifigsOne: '{count} 个小人仔', wrappedMinifigsOther: '{count} 个小人仔', wrappedInvested: '已投入', wrappedSoldOne: '售出 {count} 套', wrappedSoldOther: '售出 {count} 套', wrappedSoldLabel: '已售出', wrappedBestLabel: '最佳表现', wrappedBestCanvas: '最佳表现', wrappedBestCanvasWithRoi: '最佳表现 · {roi}', wrappedLongestHeld: '持有最久：{name}（自 {year} 年）', wrappedClose: '关闭', wrappedShareYear: '分享我的年度' });
Object.assign(zh.data, { reportPreparing: '正在准备报告…', insuranceReportTitle: 'BricksVault 保险报告', reportSharedReady: '报告已就绪 — 打开并打印为 PDF。', reportDownloadedReady: '报告已下载 — 打开并打印为 PDF。', noSnapshotsYet: '还没有快照 — 第一份将在下周日创建。', backupsUnavailable: '备份目前不可用。', retryingSync: '正在重试同步…', guestVaultSynced: '访客收藏库已同步', exportPreparing: '正在准备导出…', collectionExportTitle: '分享 BricksVault 收藏库', guestExportShared: '你的本地访客导出已可分享或保存。', guestExportDownloaded: '已从本地访客数据下载导出。', syncedExportShared: '你的同步导出已可分享或保存。', syncedExportDownloaded: '已从你的同步收藏库下载导出。' });
export default zh;
