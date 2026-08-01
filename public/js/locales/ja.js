/** Japanese. Missing keys fall back to English (see lib/i18n.js). */
export const ja = {
  nav: { vault: 'コレクション', catalog: 'カタログ', scan: 'スキャン', minifigs: 'ミニフィグ', me: 'マイページ', badges: 'バッジ' },
  common: {
    cancel: 'キャンセル', save: '保存', close: '閉じる', retry: '再試行',
    delete: '削除', edit: '編集', done: '完了', undo: '元に戻す',
    loading: '読み込み中…', search: '検索', all: 'すべて', none: 'なし',
    yes: 'はい', no: 'いいえ', error: '問題が発生しました', offline: 'オフラインです',
    seeAll: 'すべて表示', share: '共有',
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
    addToVaultPrice: 'ボールトに追加 · {price}', priceHistoryDays: '価格履歴 · {days}日間', priceHistoryShort: '価格履歴 · {days}日', fromSources: '{n} 件の市場ソースから', fromSourcesOne: '1 件の市場ソースから', typicalRange: ' · 通常 {low}–{high}',
  },
  counts: {
    results: '{n} 件', resultsOne: '1 件', collected: '{owned}/{total} 収集済み', owned: '{n} 個所有', ofFigs: '全 {total} 体中', figs: '{n} 体', figsOne: '1 体',
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
    noResults: 'セットが見つかりません', filters: 'フィルター', sort: '並べ替え', clearFilters: 'フィルターを解除',
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
export default ja;
