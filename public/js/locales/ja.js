/** Japanese. Missing keys fall back to English (see lib/i18n.js). */
export const ja = {
  nav: { vault: 'コレクション', catalog: 'カタログ', scan: 'スキャン', minifigs: 'ミニフィグ', me: 'マイページ', badges: 'バッジ' },
  common: {
    cancel: 'キャンセル', save: '保存', close: '閉じる', retry: '再試行',
    delete: '削除', edit: '編集', done: '完了', undo: '元に戻す',
    loading: '読み込み中…', search: '検索', all: 'すべて', none: 'なし',
    yes: 'はい', no: 'いいえ', error: '問題が発生しました', offline: 'オフラインです',
    seeAll: 'すべて表示', share: '共有',
    and: 'と',
  },
  settings: {
    title: '設定', language: '言語',
    languageDesc: '選択しない限り、端末の言語に従います。', languageAuto: '自動（{name}）',
    currency: '通貨', currencyDesc: '金額を現地通貨で表示します。',
    market: '販売地域', marketDesc: '店頭価格の対象地域。再販価値は USD のままです。',
    appearance: '外観', notifications: '通知', signOut: 'サインアウト',
  },
  detail: {
    value: '価値', retired: '生産終了', comingSoon: '近日発売', retiringSoon: 'まもなく生産終了',
    pieces: 'ピース', minifigs: 'ミニフィグ', retail: '定価',
    addToVault: 'コレクションに追加', inVault: 'コレクション済み', removeFromVault: 'コレクションから削除',
    tabInfo: '情報', tabForecast: '予測', tabCommunity: 'コミュニティ',
    reliablePrice: '信頼できる価格', pricingDetails: '価格の詳細', priceHistory: '価格推移',
    details: '詳細', estimated: '推定', year: '年', theme: 'テーマ',
    addToWishlist: 'ウィッシュリストに追加', inWishlist: 'ウィッシュリストに登録済み',
    addToVaultPrice: 'ボールトに追加 · {price}', priceHistoryDays: '価格履歴 · {days}日間', priceHistoryShort: '価格履歴 · {days}日', fromSources: '{n} 件の市場ソースから', fromSourcesOne: '1 件の市場ソースから', typicalRange: ' · 通常 {low}–{high}', likelyRange: ' · 想定 {low}-{high}', tagsMore: '他 {n} 件', reviews: 'レビュー{n}件', reviewsOne: 'レビュー1件', up: '{pct}% 上昇', down: '{pct}% 下落',
  },
  counts: {
    results: '{n} 件', resultsOne: '1 件', collected: '{owned}/{total} 収集済み', owned: '{n} 個所有', ofFigs: '全 {total} 体中', figs: '{n} 体', figsOne: '1 体',
  },
  market: {
    sellNowLabel: '今すぐ売る',
    fastSaleAfterFees: '手数料差引後の即売価格',
    pctOfValue: '価値の {pct}%',
    pctOfFairValue: '適正価値の {pct}%',
    confidentlyPriced: '{pct}% が高信頼価格',
    families: '{n} 件の独立した市場ソース',
    familyOne: '1 件の独立した市場ソース',
    sales: '{n} 件の検証済み成約',
    saleOne: '1 件の検証済み成約',
    estimateUnlocks: '{list}の推定値は成約データが増えると表示されます。',
    estimatesUnlock: '{list}の推定値は成約データが増えると表示されます。',
    soldEvidenceHeadline: '{markets} の {sales} に基づきます。',
    soldEvidenceFallback: '最近の確認済み成約はありません。推定値は出品価格または市場ガイドに基づきます。',
    soldEvidenceTitle: '成約根拠',
    soldEvidenceNewSealed: '新品・未開封',
    soldEvidenceUsedComplete: '中古・完品',
    soldEvidenceFresh: '最近',
    soldEvidenceOlder: '以前',
    soldEvidenceSalesOne: '確認済みの成約 1 件',
    soldEvidenceSalesOther: '確認済みの成約 {n} 件',
    soldEvidenceMarketplacesOne: '1 マーケット',
    soldEvidenceMarketplacesOther: '{n} マーケット',
    partOutVerdictPartout: 'パーツ売りの方が高値',
    partOutVerdictSealed: '未開封で売る',
    partOutVerdictSame: 'ほぼ同じ',
    partOutSellSealed: '未開封で売る',
    partOutSellParts: 'パーツで売る',
    partOutDeltaPartout: '未開封価値より {pct} 高い',
    partOutDeltaSealed: '未開封価値の方が {pct} 高い',
    partOutClose: '価値はほぼ同じ',
    partOutCoverage: 'パーツの {pct} を価格算定済み',
    sellingAbove: 'この価値より約 {pct} 高く売れています',
    sellingBelow: 'この価値より約 {pct} 安く売れています',
  },
  card: {
    pieces: '{n}ピース',
    perPiece: '{price}/個',
    lots: '{n} ロット',
    deal: 'お得 {pct}',
    strongBuy: '買い推奨 {pct}',
    forecast2y: '{price} 2年',
    gamePieces: '{n}ピース',
    gameRetail: '定価 {price}',
  },
  deal: {
    buyRetail: '小売で市場価値より約 {pct}% 安く入手できます。',
    buyResale: '市場価値より約 {pct}% 安く売れています。',
    retiring: 'まもなく生産終了 — 購入できる期間は限られます。',
    premiumRetail: '現在は市場価値より高い価格です。',
    premiumResale: '出品価格が市場価値を上回っています。',
    fair: '市場価値どおりの価格です。',
    labelBuy: '買い',
    labelStrongBuy: '買い推奨',
    labelFair: '適正価格',
    labelPremium: '価値超過',
    labelPct: '{label} · {pct}%',
  },
  time: {
    unknown: '不明', today: '今日', yesterday: '昨日', daysAgo: '{n}日前',
  },
  me: {
    trophyShelf: 'トロフィー棚（{n}/6）',
  },
  kids: {
    xp: '{n} XP', xpToLevel: 'レベル {level} まであと {n} XP', maxLevel: '最高レベル！', pcs: '{n} ピース', earned: '{total} 個中 {n} 個獲得', setsToGo: 'あと {n} セット', setsToGoOne: 'あと 1 セット！',
  },
  fees: {
    marketplace: 'マーケットプレイス手数料（{pct}%）', payment: '決済手数料（{pct}% + 固定）',
  },
  alerts: {
    priceDrop: '値下がり · {days}日前', targetWas: '— 目標価格は {price} でした。',
  },
  game: {
    roundOf: 'ラウンド {n} / {total}', pctOff: '{pct}% ずれていました', streakLine: '{day} · 連続 {streak} · 最高 {best}',
  },
  build: {
    needParts: 'あと {n} 個のパーツが必要', ofOwnedSets: '所有セット {n} 件中', indexing: 'バックグラウンドでさらに {n} セットをインデックス中…',
  },
  catalog: {
    title: 'カタログ', searchPlaceholder: 'セットを探す', results: '{count} セット',
    sortValue: '価格', sortGrowth: '成長', sortNewest: '最新', sortTrending: 'トレンド',
    noResults: 'セットが見つかりません', filters: 'フィルター', sort: '並べ替え', clearFilters: 'フィルターを解除',
  },
  community: {
    pendingSubmissionOne: '⏳ 承認待ちの投稿が {n} 件あります。',
    pendingSubmissionFew: '⏳ 承認待ちの投稿が {n} 件あります。',
    pendingSubmissionMany: '⏳ 承認待ちの投稿が {n} 件あります。',
    pendingSubmissionOther: '⏳ 承認待ちの投稿が {n} 件あります。',
  },
  vault: {
    title: 'コレクション', empty: 'コレクションは空です', emptyDesc: 'セットを追加すると価値の追跡を開始できます。',
    setsOwned: '所有セット数', totalValue: '合計価値', invested: '投資額', gain: '損益', addSet: 'セットを追加',
    investedAmount: '投資額 {amount}',
  },
  wishlist: {
    title: 'ウィッシュリスト', empty: 'ウィッシュリストは空です', targetPrice: '目標価格',
    priceDropAlert: '値下がり時に通知', remove: 'ウィッシュリストから削除',
    setsCount: '{n} セット', setsCountOne: '1 セット', alertsCount: '{n} 件の通知', alertsCountOne: '1 件の通知', nowPrice: '現在 {price}',
  },
};
Object.assign(ja.catalog, { filtersWithCount: 'フィルター · {n}' });
ja.contributions = { approvedOne: '承認済みの投稿 {n} 件', approvedFew: '承認済みの投稿 {n} 件', approvedMany: '承認済みの投稿 {n} 件', approvedOther: '承認済みの投稿 {n} 件', contributorBadge: ' · ⭐ 投稿者' };
ja.admin = { uploadingFile: '{file} をアップロード中…', importedMinifigs: '{parsed} 件中 {inserted} 件のミニフィグをインポートしました。評価時に価格へ対応付けられます。', uploadFailed: '失敗: {error}', lastRun: '前回の実行 {when}{duration}' };
ja.downloads = { interrupted: 'ダウンロードは {pct}% で中断されました。続けるには「再開」をタップしてください。', resume: '再開（{pct}）', scanProgress: '{total} 件中 {current} 件を識別中…' };
Object.assign(ja.detail, { acquired: '{date} に取得{source}' });
Object.assign(ja.wishlist, { targetPriceCurrency: '目標価格（{symbol}）', suggestedPrice: '提案: {price}' });
Object.assign(ja.wishlist, { ackAlert: '目標価格アラートを閉じる', alertAcked: 'アラートを閉じました' });
ja.minifigs = { appearsInSetsOne: '{n} セットに登場', appearsInSetsFew: '{n} セットに登場', appearsInSetsMany: '{n} セットに登場', appearsInSetsOther: '{n} セットに登場' };
Object.assign(ja.admin, { syncJobRunning: '{label}: 実行中…', syncJobSkipped: 'スキップ — {n}', syncJobSummary: '{processed} 件処理、{updated} 件更新、{rejected} 件拒否', syncJobResult: '{label}: {summary}', syncJobFailed: '{label} に失敗: {error}', uploadSuccessToast: 'BrickLink ミニフィグカタログ: {inserted} 件をインポート', uploadErrorToast: 'カタログのアップロードに失敗: {error}', countRunning: '{n} 件実行中', countHealthy: '{n} 件正常', countFailed: '{n} 件失敗', countNotRun: '{n} 件未実行', completedSlices: '{n} 件の安全な処理を完了', jobId: 'ジョブ #{id}', filled: '{n} 件入力済み', processed: '{n} 件処理済み', figures: '{n} ミニフィグ', noItemsProcessed: '処理済みの項目はありません' });
Object.assign(ja.admin, { jobStarted: 'ジョブ #{id} を開始', jobFailed: 'ジョブ失敗: {error}', maintenanceComplete: '{label} 完了', maintenanceFailed: '{label} に失敗: {error}', lastSeen: '最終確認: {when}' });
Object.assign(ja.admin, { tools: { sets: 'セットをインポート', figs: 'ミニフィグをインポート', upc: 'バーコードを補完', populate: '対象範囲を補完', revalue: '価格を再評価', everything: '安全な全ソースを補完', pricechartingBulk: 'PriceCharting を更新（LEGO 一括）', pricechartingVerify: 'PriceCharting の対応を検証', pricesapi: 'pricesAPI を今すぐ実行', ebaySold: 'eBay の売却検索を実行' }, maintenanceTools: { expire: '評価を期限切れにする', repair: '検索インデックスを修復' }, countRunningOne: '{n} 件実行中', countRunningFew: '{n} 件実行中', countRunningMany: '{n} 件実行中', countRunningOther: '{n} 件実行中', countHealthyOne: '{n} 件正常', countHealthyFew: '{n} 件正常', countHealthyMany: '{n} 件正常', countHealthyOther: '{n} 件正常', countFailedOne: '{n} 件失敗', countFailedFew: '{n} 件失敗', countFailedMany: '{n} 件失敗', countFailedOther: '{n} 件失敗', countNotRunOne: '{n} 件未実行', countNotRunFew: '{n} 件未実行', countNotRunMany: '{n} 件未実行', countNotRunOther: '{n} 件未実行', completedSlicesOne: '安全な処理を {n} 件完了', completedSlicesFew: '安全な処理を {n} 件完了', completedSlicesMany: '安全な処理を {n} 件完了', completedSlicesOther: '安全な処理を {n} 件完了', filledOne: '{n} 件入力済み', filledFew: '{n} 件入力済み', filledMany: '{n} 件入力済み', filledOther: '{n} 件入力済み', processedOne: '{n} 件処理済み', processedFew: '{n} 件処理済み', processedMany: '{n} 件処理済み', processedOther: '{n} 件処理済み', figuresOne: '{n} ミニフィグ', figuresFew: '{n} ミニフィグ', figuresMany: '{n} ミニフィグ', figuresOther: '{n} ミニフィグ' });
Object.assign(ja.detail, { uploadFailed: 'アップロードに失敗: {error}', removeFailed: '削除に失敗: {error}', forecastUpside: '予測にはさらに約 {pct} の上昇余地があります' }); ja.data = { reportFailed: 'レポートに失敗: {error}', restoreFailed: '復元に失敗: {error}', retryFailed: '再試行に失敗: {error}', exportFailed: 'エクスポートに失敗: {error}', importFailed: 'インポートに失敗: {error}', bricklinkImportFailed: 'BrickLink のインポートに失敗: {error}' }; ja.integrations = { bricksetSyncFailed: 'Brickset 同期に失敗: {error}' }; ja.scanner = { timedOut: '時間がかかりすぎました。もう一度お試しください。', timedOutShort: 'タイムアウト', scanFailed: 'エラー: {error}' };
Object.assign(ja.common, { errorWithDetails: 'エラー: {error}' }); Object.assign(ja.integrations, { bricksetSyncResult: '{added} セットをインポート（カタログ外 {skipped}、Brickset 合計 {total}）。', bricksetSyncSuccess: 'Brickset 同期: {added} セットを追加' }); Object.assign(ja.scanner, { bulkPartial: '{total} 件中 {added} 件を追加 — {failed} 件失敗、再試行してください', addSetsFailed: 'セットを追加できませんでした: {error}' }); ja.portfolio = { collectionLoadFailed: 'コレクションを読み込めませんでした: {error}', bulkRemovePartial: '{total} 件中 {removed} 件を削除 — {failed} 件失敗、再試行してください', restoredCount: '{total} 件中 {restored} 件を復元' };
Object.assign(ja.settings, { currencyUpdated: '通貨を {currency} に更新しました' });
Object.assign(ja.common, { offlineActionsSynced: 'オフライン操作を{count}件同期しました', offlineActionsDiscarded: 'オフライン操作{count}件を同期できず破棄しました', localItemsSynced: 'ローカル項目を{count}件同期しました', kidsXp: '+{xp} XP! {level} {badge}', copied: '{label}をコピーしました' }); Object.assign(ja.admin, { serviceTestResult: '{head} — {detail}（{ms}ms）', providerStatus: '{provider}: {status}', serviceTestFailed: '失敗: {error}', providerTestFailed: '{provider}のテストに失敗しました', featureFlagStatus: '{flag}: {status}{suffix}', featureFlagUpdateFailed: '{flag}を更新できませんでした: {error}', providerSaved: '{provider}を保存しました。', providerSaveFailed: '{provider}の保存エラー: {error}', pricingConfigLoadFailed: '価格設定を読み込めませんでした: {error}', resetFailed: 'リセットに失敗しました: {error}', contributionAction: '{action} — {applied}', enabled: '有効', disabled: '無効', approved: '承認済み', rejected: '却下済み' }); Object.assign(ja.minifigs, { ownedCount: '所有 {count}' }); Object.assign(ja.data, { restoredFromBackup: '{date}から{count}セットを復元しました', migrationStillFailing: 'まだ{count}件の項目が失敗しています: {error}', migrationComplete: '完了 — {count}件を同期しました。', importResult: '✓ {imported}件をインポート、{skipped}件をスキップ、エラー{errors}件', setsImported: '{count}セットをインポートしました', bricklinkImportResult: '✓ {added}セットを追加、{skipped}件をスキップ。{errors}', bricklinkSetsImported: 'BrickLink注文から{count}セットをインポートしました' }); Object.assign(ja.integrations, { keyRemoved: '{label}キーを削除しました', keyVerified: '{label}キーを確認して保存しました' }); Object.assign(ja.scanner, { setNotFound: 'セット{setNum}はカタログにありません。', localAiOfflineFailed: '端末上のAIが失敗し、オフラインです: {error}', addItemFailed: '{name}を追加できませんでした: {error}', minifig: 'ミニフィグ', itemsAdded: '{count}件を保管庫に追加しました', itemsSavedOffline: '{count}件をオフラインで保存しました — 同期予定です', setsSavedOffline: '{count}セットをオフラインで保存しました — 接続時に同期します' }); Object.assign(ja.portfolio, { soldFor: '{price}で売却 — 保管庫から削除しました' });
Object.assign(ja.common, { offlineActionsSyncedOne: 'オフライン操作を{count}件同期しました', offlineActionsSyncedOther: 'オフライン操作を{count}件同期しました', offlineActionsDiscardedOne: 'オフライン操作{count}件を同期できず破棄しました', offlineActionsDiscardedOther: 'オフライン操作{count}件を同期できず破棄しました', localItemsSyncedOne: 'ローカル項目を{count}件同期しました', localItemsSyncedOther: 'ローカル項目を{count}件同期しました', kidsXp: '+{xp} XP!{details}', kidsXpLevel: ' レベル{level}！', kidsXpBadge: ' · バッジ: {badge}! 🎉' }); Object.assign(ja.scanner, { itemsAddedOne: '{count}件を保管庫に追加しました', itemsAddedOther: '{count}件を保管庫に追加しました', itemsSavedOfflineOne: '{count}件をオフラインで保存しました — 同期予定です', itemsSavedOfflineOther: '{count}件をオフラインで保存しました — 同期予定です', setsSavedOfflineOne: '{count}セットをオフラインで保存しました — 接続時に同期します', setsSavedOfflineOther: '{count}セットをオフラインで保存しました — 接続時に同期します' }); Object.assign(ja.portfolio, { wishlistAlertsTooltip: 'ほしい物リストの通知（急騰 {spikes} 件、値下がり {drops} 件）', bulkLocationPartial: '{total}件中{updated}件を更新 — {failed}件失敗しました。もう一度お試しください' });
Object.assign(ja.data, { restoredFromBackupOne: '{date}から{count}セットを復元しました', restoredFromBackupOther: '{date}から{count}セットを復元しました' }); Object.assign(ja.integrations, { bricksetSyncResultOne: '{count}セットをインポート（カタログ外 {skipped}、Brickset 合計 {total}）。', bricksetSyncResultOther: '{count}セットをインポート（カタログ外 {skipped}、Brickset 合計 {total}）。', bricksetSyncSuccessOne: 'Brickset同期: {count}セット追加', bricksetSyncSuccessOther: 'Brickset同期: {count}セット追加' }); Object.assign(ja.wishlist, { unreadAlertsOne: '未読の通知 {count}件', unreadAlertsOther: '未読の通知 {count}件' }); Object.assign(ja.portfolio, { wishlistAlertsTooltip: 'ほしい物リストの通知（{spikes}、{drops}）', wishlistAlertSpikesOne: '急騰 {count}件', wishlistAlertSpikesOther: '急騰 {count}件', wishlistAlertDropsOne: '値下がり {count}件', wishlistAlertDropsOther: '値下がり {count}件', insightSignal: '再販 {direction}{pct}%（{basis} 比）{quantity}', insightMarket: '市場', insightValue: '価値', insightQuantity: ' · ×{count}' });
Object.assign(ja.kids, { badgeCelebration: '新しいバッジ：{badge}！🎉', badgeQuip: 'きみは組み立てのスーパースター！🌟', levelCelebration: 'レベル{level}に到達！🎉', levelQuip: 'どんどん組み立てよう！🧱', badgeFirstBrick: 'はじめのブロック！', badgeJuniorBuilder: 'ジュニアビルダー', badgeArchitect: '建築家', badgeMaster: 'マスタービルダー', badgeGrandMaster: 'グランドマスター', badgeLegend: 'レジェンド！' });
Object.assign(ja.data, { csvImportConfirmTitleOne: '1セットをインポートしますか？', csvImportConfirmTitleOther: '{count}セットをインポートしますか？', csvImportMore: '、ほか{count}件', csvImportConfirmMessage: '先頭：{sample}{more}。既存のセットは保持されます。', importConfirm: 'インポート' });
Object.assign(ja.scanner, { setNumberMatched: 'セット番号がカタログに一致しました。' });
Object.assign(ja.portfolio, { insightHeadlineOne: '今売ると1セットで約{value}の上振れ', insightHeadlineOther: '今売ると{count}セットで約{value}の上振れ' });
Object.assign(ja.market, { goodTimeToSell: '売り時です', goodTimeToBuy: '買い時です', onlyForSale: '現在販売中は{count}件のみ', askingHighHint: '売り手の希望額が高めです。早く売るなら直近の売却価格に近づけましょう', askingLowHint: '直近の売却価格より低く出品中です。買い時です', askingSummary: '販売中 {count}件 · 希望価格 {asking}', askingSummaryWithSold: '販売中 {count}件 · 希望価格 {asking}、直近売却 {sold}' });
Object.assign(ja.game, { marketGenius: '{score}/5 — market genius! 🎯', streakQuipOne: 'Streak: {count} day.', streakQuipOther: 'Streak: {count} days.' }); ja.market = Object.assign(ja.market || {}, { sellingAbove: 'Selling about {pct} above this value', sellingBelow: 'Selling about {pct} below this value' }); Object.assign(ja.scanner, { findingSet: 'Finding set...', lookingUpSet: 'Looking up {setNum} in the catalog.' });
Object.assign(ja.game, { marketGenius: '{score}/5 — 相場の達人！🎯', streakQuipOne: '連続記録：{count}日。', streakQuipOther: '連続記録：{count}日。' });
Object.assign(ja.market, { sellingAbove: 'この価値より約{pct}高く売れています', sellingBelow: 'この価値より約{pct}安く売れています' }); Object.assign(ja.scanner, { findingSet: 'セットを検索中…', lookingUpSet: 'カタログで{setNum}を検索中です。', bulkMatched: '{total}件中{matched}件一致' }); Object.assign(ja.game, { revealCorrect: '🎯 正解！— {value}です', revealIncorrect: '惜しい！— {value}です' }); Object.assign(ja.catalog, { activeFiltersOne: '1件適用中', activeFiltersOther: '{count}件適用中' }); Object.assign(ja.portfolio, { anniversaryGain: '{paid}で購入 — それから{gain}上昇。', anniversaryNoGain: '{paid}で購入。利益より好きで集めるセットもあります。', anniversaryQuip: '組み立てていると時間はあっという間です。', anniversaryCelebrationOne: '{set}と1周年！🎂', anniversaryCelebrationOther: '{set}と{count}周年！🎂' });
Object.assign(ja.market, { partsCoverage: 'パーツ網羅率 {pct}%', forecastScenarios: '弱気 {bear} · 基準 {base} · 強気 {bull}', salesSuffix: ' / {count}件の販売', newSold: '新品の売却', usedSold: '中古の売却', viewOnBrickLink: 'BrickLinkで見る' }); Object.assign(ja.catalog, { loadFailedDetail: '{error}。接続を確認してもう一度お試しください。' }); Object.assign(ja.portfolio, { moreThemesOne: '+1件のテーマ', moreThemesOther: '+{count}件のテーマ', sealedParts: '未開封 {sealed} · {approximate}パーツ {parts}' }); ja.advisor = Object.assign(ja.advisor || {}, { moreThemesOne: '保管庫にテーマがあと1件', moreThemesOther: '保管庫にテーマがあと{count}件' });
Object.assign(ja.game, { loadFailed: '今日のゲームを読み込めませんでした：{error}' }); Object.assign(ja.contributions, { loadFailed: '読み込めませんでした：{error}' }); Object.assign(ja.me, { wrappedLoadFailed: '今年の内容を読み込めませんでした：{error}', wrappedValueChange: '保管庫は今年{direction} {value}', wrappedUp: '上昇', wrappedDown: '下落' });
Object.assign(ja.catalog, { filterSummaryNone: '有効なフィルターはありません', filterSummaryActiveOne: '{count}件のフィルター: {items}', filterSummaryActiveOther: '{count}件のフィルター: {items}', filterSummarySearch: '検索「{value}」', filterSummaryStatusRetired: '生産終了のみ', filterSummaryStatusActive: '販売中のみ', filterSummaryStatusRetiring: 'まもなく生産終了', filterSummaryDeal: 'お買い得のみ', filterSummaryRangeYear: '年', filterSummaryRangePieces: 'ピース', filterSummaryRangeValue: '価値', filterSummaryRangeBetween: '{label} {min}～{max}', filterSummaryRangeMin: '{label} {value}以上', filterSummaryRangeMax: '{label} {value}以下', filterSummaryPiecesValue: '{value}ピース', filterSummaryValueAmount: 'US${value}' });
Object.assign(ja.minifigs, { filterSummaryNone: '有効なフィルターはありません', filterSummaryActiveOne: '{count}件のフィルター: {items}', filterSummaryActiveOther: '{count}件のフィルター: {items}', filterSummarySearch: '検索「{value}」', filterSummaryRarity: '希少性: {rarity}', filterSummaryRarityCommon: '一般的', filterSummaryRarityUncommon: 'やや珍しい', filterSummaryRarityRare: 'レア', filterSummaryRarityLegendary: 'レジェンダリー', filterSummaryOwned: '所有済みのみ', filterSummaryUnowned: '未所有のみ' });
Object.assign(ja.catalog, { emptySearchResults: '「{query}」に一致するセットはありません。検索条件を変えるか、フィルターを解除してください。', emptyFilteredResults: 'これらのフィルターに一致するセットはありません。検索条件を変えるか、フィルターを解除してください。' });
Object.assign(ja.advisor, { retiredSetsOfTotalOne: '{total}セット中、廃番は{retired}セット', retiredSetsOfTotalOther: '{total}セット中、廃番は{retired}セット' });
Object.assign(ja.scanner, { duplicateConfirmTitle: 'すでに所有済み', duplicateConfirmMessage: '{names}はすでにコレクションにあります。もう1つ追加しますか？', duplicateConfirmAction: 'そのまま追加' });
Object.assign(ja.scanner, { minifigWithSeries: '{series}シリーズの{minifig}', minifigWithRarity: '{rarity}の{minifig}', rarityUnknown: '不明' });
Object.assign(ja.admin, { jobAccepted: '{label}を受け付けました。まもなくアクティビティに表示されます', pricechartingBulkAccepted: 'PriceChartingの一括ダウンロードを開始しました。結果はまもなくアクティビティに表示されます', pricechartingVerifyAccepted: 'PriceChartingの検証を開始しました。昇格した対応はアクティビティで確認できます', pricesapiAccepted: 'pricesAPIの更新を開始しました。結果はアクティビティで確認できます' });
Object.assign(ja.scanner, { setsFoundOne: '{count}件のセットを検出', setsFoundOther: '{count}件のセットを検出', minifigsFoundOne: '{count}体のミニフィグを検出', minifigsFoundOther: '{count}体のミニフィグを検出', mixedResultsFoundOne: '{count}件の結果を検出（セットとミニフィグ）', mixedResultsFoundOther: '{count}件の結果を検出（セットとミニフィグ）', confidenceHigh: '高信頼度', confidenceMedium: '中信頼度', confidenceLow: '低信頼度', confidenceUnknown: '一致の信頼度は不明', matchHigh: '高い一致', matchMedium: '中程度の一致', matchLow: '低い一致', match: '一致' });
Object.assign(ja.detail, { sellReasonGainSincePurchase: '購入時から{roi}上昇', sellReasonTrendDown: '価格トレンドが下向きに転じました', sellReasonClimbFlattened: '価格上昇が横ばいになりました', sellReasonLittleUpside: '予測上昇余地はあと{upside}', sellReasonSellsFast: '直近{volume}件の販売から早く売れそうです', sellReasonWatchClosely: '相場を注意深く見守りましょう', sellReasonStillClimbing: '価格はまだ上昇中です', sellReasonForecastUpside: '予測ではあと{upside}の上昇余地があります', sellReasonNotRetired: 'まだ廃番ではありません', sellReasonNoSellTrigger: 'まだ明確な売り時ではありません' });
Object.assign(ja.data, { migrationStillFailingOne: 'まだ{count}件の移行に失敗しています: {error}', migrationStillFailingOther: 'まだ{count}件の移行に失敗しています: {error}', migrationCompleteOne: '完了 — {count}件を同期しました。', migrationCompleteOther: '完了 — {count}件を同期しました。', setsImportedOne: '{count}セットをインポートしました', setsImportedOther: '{count}セットをインポートしました', bricklinkSetsImportedOne: 'BrickLinkの注文から{count}セットをインポートしました', bricklinkSetsImportedOther: 'BrickLinkの注文から{count}セットをインポートしました' });
Object.assign(ja.detail, { sellReasonSellsFastOne: '直近{volume}件の販売から早く売れそうです', sellReasonSellsFastOther: '直近{volume}件の販売から早く売れそうです' });
Object.assign(ja.minifigs, { setExclusive: 'セット限定', inSetsOne: '{count}セットに含まれる', inSetsOther: '{count}セットに含まれる', partsOne: '{count}パーツ', partsOther: '{count}パーツ' });
Object.assign(ja.minifigs, { emptySearchResults: '「{query}」に一致するミニフィグはありません。', emptyFilteredResults: 'これらのフィルターに一致するミニフィグはありません。' });
Object.assign(ja.detail, { partsComplete: '完成', partsMissingOne: '{count}個のパーツが不足', partsMissingOther: '{count}個のパーツが不足', allPartsPresent: 'すべてのパーツあり' });
Object.assign(ja.build, { needPartsOne: 'あと {n} 個のパーツが必要', needPartsOther: 'あと {n} 個のパーツが必要' });
Object.assign(ja.card, { lotsOne: '{n} ロット', lotsOther: '{n} ロット' });
Object.assign(ja.market, { salesSuffixOne: ' / {count} 件の販売', salesSuffixOther: ' / {count} 件の販売' });
Object.assign(ja.data, { importedCountOne: '{n} セットをインポート', importedCountOther: '{n} セットをインポート', skippedCountOne: '{n} セットをスキップ', skippedCountOther: '{n} セットをスキップ', errorsCountOne: '{n} 件のエラー', errorsCountOther: '{n} 件のエラー', setsAddedCountOne: '{n} セットを追加', setsAddedCountOther: '{n} セットを追加', importResult: '✓ {imported}、{skipped}、{errors}', bricklinkImportResult: '✓ {added}、{skipped}。{errors}' });
Object.assign(ja.admin, { minifigsImportedOne: '{n} 体のミニフィグ', minifigsImportedOther: '{n} 体のミニフィグ', minifigsParsedOne: '{n} 体のミニフィグ', minifigsParsedOther: '{n} 体のミニフィグ', importedMinifigs: '{parsed} 中 {inserted} をインポートしました。評価時に価格へ紐付けられます。' });
Object.assign(ja.time, {"daysAgoOne":"{n}日前","daysAgoOther":"{n}日前"});
Object.assign(ja.scanner, {"bulkPartialOne":"{added} 件中 {total} 件を追加 — {failed} 件失敗、再試行してください","bulkPartialOther":"{added} 件中 {total} 件を追加 — {failed} 件失敗、再試行してください"});
Object.assign(ja.kids, {"setsToGoOne":"あと {n} セット","setsToGoOther":"あと {n} セット","earnedOne":"{n} 個中 {total} 個獲得","earnedOther":"{n} 個中 {total} 個獲得"});
Object.assign(ja.market, {"familiesOne":"{n} 件の独立した市場ソース","familiesOther":"{n} 件の独立した市場ソース","salesOne":"{n} 件の検証済み成約","salesOther":"{n} 件の検証済み成約","onlyForSaleOne":"現在販売中は{count}件のみ","onlyForSaleOther":"現在販売中は{count}件のみ","askingSummaryOne":"販売中 {count}件 · 希望価格 {asking}","askingSummaryOther":"販売中 {count}件 · 希望価格 {asking}","askingSummaryWithSoldOne":"販売中 {count}件 · 希望価格 {asking}、直近売却 {sold}","askingSummaryWithSoldOther":"販売中 {count}件 · 希望価格 {asking}、直近売却 {sold}"});
Object.assign(ja.detail, {"fromSourcesOne":"{n} 件の市場ソースから","fromSourcesOther":"{n} 件の市場ソースから","reviewsOne":"レビュー{n}件","reviewsOther":"レビュー{n}件","priceHistoryDaysOne":"価格履歴 · {n}日間","priceHistoryDaysOther":"価格履歴 · {n}日間","priceHistoryShortOne":"価格履歴 · {n}日","priceHistoryShortOther":"価格履歴 · {n}日"});
Object.assign(ja.alerts, {"priceDropOne":"値下がり · {n}日前","priceDropOther":"値下がり · {n}日前"});
Object.assign(ja.portfolio, {"bulkLocationPartialOne":"{updated}件中{total}件を更新 — {failed}件失敗しました。もう一度お試しください","bulkLocationPartialOther":"{updated}件中{total}件を更新 — {failed}件失敗しました。もう一度お試しください","bulkRemovePartialOne":"{removed} 件中 {total} 件を削除 — {failed} 件失敗、再試行してください","bulkRemovePartialOther":"{removed} 件中 {total} 件を削除 — {failed} 件失敗、再試行してください","restoredCountOne":"{restored} 件中 {total} 件を復元","restoredCountOther":"{restored} 件中 {total} 件を復元"});
Object.assign(ja.wishlist, {"setsCountOne":"{n} セット","setsCountOther":"{n} セット","alertsCountOne":"{n} 件の通知","alertsCountOther":"{n} 件の通知"});
Object.assign(ja.admin, {"syncJobSkippedOne":"スキップ — {n}","syncJobSkippedOther":"スキップ — {n}","syncJobSummaryOne":"{processed} 件処理、{updated} 件更新、{rejected} 件拒否","syncJobSummaryOther":"{processed} 件処理、{updated} 件更新、{rejected} 件拒否","uploadSuccessToastOne":"BrickLink ミニフィグカタログ: {n} 件をインポート","uploadSuccessToastOther":"BrickLink ミニフィグカタログ: {n} 件をインポート","contributionActionOne":"{action} — {n}","contributionActionOther":"{action} — {n}"});
Object.assign(ja.data, {"csvImportMoreOne":"、ほか{n}件","csvImportMoreOther":"、ほか{n}件","csvImportConfirmMessageOne":"先頭：{sample}{more}。既存のセットは保持されます。","csvImportConfirmMessageOther":"先頭：{sample}{more}。既存のセットは保持されます。"});
Object.assign(ja.me, {"trophyShelfOne":"トロフィー棚（{n}/6）","trophyShelfOther":"トロフィー棚（{n}/6）"});
Object.assign(ja.build, {"ofOwnedSetsOne":"所有セット {n} 件中","ofOwnedSetsOther":"所有セット {n} 件中","indexingOne":"バックグラウンドでさらに {n} セットをインデックス中…","indexingOther":"バックグラウンドでさらに {n} セットをインデックス中…"});
Object.assign(ja.counts, {"collectedOne":"{owned}/{total} 収集済み","collectedOther":"{owned}/{total} 収集済み","ownedOne":"{n} 個所有","ownedOther":"{n} 個所有","ofFigsOne":"全 {total} 体中","ofFigsOther":"全 {total} 体中","resultsOne":"{n} 件","resultsOther":"{n} 件","figsOne":"{n} 体","figsOther":"{n} 体"});
Object.assign(ja.minifigs, {"ownedCountOne":"所有 {n}","ownedCountOther":"所有 {n}"});
Object.assign(ja.catalog, {"filtersWithCountOne":"フィルター · {n}","filtersWithCountOther":"フィルター · {n}"});
Object.assign(ja.scanner, {"bulkMatchedOne":"{total}件中{matched}件一致","bulkMatchedOther":"{total}件中{matched}件一致"});
Object.assign(ja.kids, {"pcsOne":"{n} ピース","pcsOther":"{n} ピース"});
Object.assign(ja.card, {"gamePiecesOne":"{n}ピース","gamePiecesOther":"{n}ピース","piecesOne":"{n}ピース","piecesOther":"{n}ピース"});
Object.assign(ja.scanner, { bulkMatchedOne: '{total}件中{n}件一致', bulkMatchedOther: '{total}件中{n}件一致' });
Object.assign(ja.kids, { pcsOne: '{n} ピース', pcsOther: '{n} ピース' });
Object.assign(ja.card, { gamePiecesOne: '{n}ピース', gamePiecesOther: '{n}ピース', piecesOne: '{n} ピース', piecesOther: '{n} ピース' });
Object.assign(ja.share ??= {}, {"gameTitle":"Price It!","gameText":"🧱 Price It! {day}\\n{tiles} {score}/5 · streak {streak}\\nGuess LEGO market prices on BricksVault","setText":"Check out {name} ({setNum}) on BricksVault!","setDialogTitle":"Share {name}","portfolioTitle":"My LEGO BricksVault","portfolioText":"Check out my LEGO collection on BricksVault!","portfolioDialogTitle":"Share my BricksVault","wrappedTitle":"Brick Wrapped {year}","wrappedBest":"Best performer: {name}{roi}","wrappedTracked":"Tracked with BricksVault","wrappedSetsAdded":"sets added","wrappedPiecesAdded":"pieces","wrappedValueChange":"vault value change","wrappedTagline":"BRICKSVAULT · STACK SOMETHING BEAUTIFUL"});
Object.assign(ja.share, { gameTitle: 'プライス・イット！', gameText: '🧱 プライス・イット！ {day}\n{tiles} {score}/5 · 連続 {streak}\nBricksVaultでLEGOの市場価格を当てよう', setText: 'BricksVaultで{name}（{setNum}）をチェック！', setDialogTitle: '{name}を共有', portfolioTitle: 'マイ LEGO BricksVault', portfolioText: 'BricksVaultで私のLEGOコレクションをチェック！', portfolioDialogTitle: 'マイBricksVaultを共有', wrappedTitle: 'ブリック年間まとめ {year}', wrappedBest: '最高の成果：{name}{roi}', wrappedTracked: 'BricksVaultで記録', wrappedValueChange: '保管庫の価値変動', wrappedTagline: 'BRICKSVAULT · 美しいものを組み立てよう', wrappedHeading: 'ブリック年間まとめ', wrappedDescription: '数字で振り返るあなたのコレクター年 — シェアしよう。', wrappedLoading: 'ブリックを数えています…', wrappedSummaryTitle: '🧱 私のブリック年間まとめ {year}', wrappedSetsAddedOne: '{count}セット追加', wrappedSetsAddedOther: '{count}セット追加', wrappedPiecesAddedOne: '{count}ピース', wrappedPiecesAddedOther: '{count}ピース', wrappedMinifigsOne: '{count}ミニフィグ', wrappedMinifigsOther: '{count}ミニフィグ', wrappedInvested: '投資額', wrappedSoldOne: '{count}セット売却', wrappedSoldOther: '{count}セット売却', wrappedSoldLabel: '売却', wrappedBestLabel: '最高の成果', wrappedBestCanvas: '最高の成果', wrappedBestCanvasWithRoi: '最高の成果 · {roi}', wrappedLongestHeld: '最も長く所有：{name}（{year}から）', wrappedClose: '閉じる', wrappedShareYear: '今年を共有' });
Object.assign(ja.data, { reportPreparing: 'レポートを準備中…', insuranceReportTitle: 'BricksVault保険レポート', reportSharedReady: 'レポートの準備ができました。開いてPDFに印刷してください。', reportDownloadedReady: 'レポートをダウンロードしました。開いてPDFに印刷してください。', noSnapshotsYet: 'スナップショットはまだありません。最初のものは次の日曜日に作成されます。', backupsUnavailable: '現在バックアップを利用できません。', retryingSync: '同期を再試行中…', guestVaultSynced: 'ゲスト保管庫を同期しました', exportPreparing: 'エクスポートを準備中…', collectionExportTitle: 'BricksVaultコレクションを共有', guestExportShared: 'ローカルのゲストエクスポートを共有または保存できます。', guestExportDownloaded: 'ローカルのゲストデータからエクスポートをダウンロードしました。', syncedExportShared: '同期済みのエクスポートを共有または保存できます。', syncedExportDownloaded: '同期済みの保管庫からエクスポートをダウンロードしました。' });
// en.js declares `market` twice as an object literal, so the later one wins and
// keys added to the earlier block are silently dropped. Assigning after the fact
// lands on whichever object survived.
Object.assign(ja.market, { comps: '比較成約 {n} 件', slashComps: ' / 比較成約 {n} 件', usedValue: '中古: {price}', updated: '{date} 更新', compsAboveMsrp: '新品の成約は希望小売価格より {amount}（{pct}）高いです。', compsBelowMsrp: '新品の成約は希望小売価格より {amount}（{pct}）安いです。' });

Object.assign(ja.detail, { tagsMoreOne: '他 {n} 件', tagsMoreOther: '他 {n} 件' });
Object.assign(ja.market, { compsOne: '比較成約 {n} 件', compsOther: '比較成約 {n} 件', slashCompsOne: ' / 比較成約 {n} 件', slashCompsOther: ' / 比較成約 {n} 件' });

Object.assign(ja.settings, { appLockUnchanged: 'アプリロックは変更されませんでした: {error}' });
Object.assign(ja.game, { checkGuessFailed: '予想を確認できませんでした: {error}' });
Object.assign(ja.alerts, { sellOpportunityOne: '売却チャンス · {n}日前', sellOpportunityOther: '売却チャンス · {n}日前' });
Object.assign(ja.detail, { minifigsCountOne: 'ミニフィグ{n}体', minifigsCountOther: 'ミニフィグ{n}体' });
Object.assign(ja.market, { listingsOne: '{n}件の出品', listingsOther: '{n}件の出品', slashListingsOne: ' / {n}件の出品', slashListingsOther: ' / {n}件の出品', slashSamplesOne: ' / {n}件のサンプル', slashSamplesOther: ' / {n}件のサンプル' });
Object.assign(ja.scanner, { estimatedValue: '(~推定価格)', marketGrabThreshold: '市場価格 {market} — {price}未満ならお買い得{estimated}', underMarket: '市場より{amount}安い{estimated}', withinMarket: '市場価格の{pct}%以内{estimated}', overMarket: '市場より{amount}高い{estimated}' });

Object.assign(ja.admin, { llmUnavailable: 'LLM ルーティングを利用できません', llmMergeBalance: '今月の Merge 残高', llmMeteredNote: 'Merge が各呼び出しで返すコストから算出しています。正式な数値は Merge のダッシュボードです。', llmEffective: '現在の実行順', llmEffectiveNone: '設定済みプロバイダなし', llmLivePool: '最新の無料プール（自動更新）', llmNoKey: 'キーなし', llmNoKeyHint: 'このプロバイダは API キーが未設定のため、実行時にスキップされます。', llmMoveUp: 'ステップを前へ', llmMoveDown: 'ステップを後ろへ', llmOn: 'オン', llmOff: 'オフ', llmReset: '既定値に戻す', llmSave: 'ルーティングを保存', llmSaved: 'LLM ルーティングを保存しました', llmSaveFailed: 'LLM ルーティングを保存できませんでした', llmRefreshModels: 'Merge モデルを更新', llmModelsRefreshedOne: 'Merge モデルを {n} 件更新しました', llmModelsRefreshedOther: 'Merge モデルを {n} 件更新しました', llmModelsFailed: 'Merge モデルカタログを更新できませんでした' });

export default ja;
Object.assign(ja.detail, { movementUp: 'Up {pct}% over {days} days', movementDown: 'Down {pct}% over {days} days', movementResaleUp: ' · resale comps also rose', movementResaleDown: ' · resale comps also fell', movementMarketUp: ' · market guide also rose', movementMarketDown: ' · market guide also fell' });
