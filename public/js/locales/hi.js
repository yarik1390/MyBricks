/** Hindi. Missing keys fall back to English (see lib/i18n.js). */
export const hi = {
  nav: { vault: 'संग्रह', catalog: 'कैटलॉग', scan: 'स्कैन', minifigs: 'मिनीफ़िगर', me: 'मैं', badges: 'बैज' },
  common: {
    cancel: 'रद्द करें', save: 'सहेजें', close: 'बंद करें', retry: 'फिर कोशिश करें',
    delete: 'हटाएँ', edit: 'संपादित करें', done: 'हो गया', undo: 'पूर्ववत करें',
    loading: 'लोड हो रहा है…', search: 'खोजें', all: 'सभी', none: 'कोई नहीं',
    yes: 'हाँ', no: 'नहीं', error: 'कुछ गड़बड़ हो गई', offline: 'आप ऑफ़लाइन हैं',
    seeAll: 'सभी देखें', share: 'साझा करें',
    and: 'और',
  },
  settings: {
    title: 'सेटिंग्स', language: 'भाषा',
    languageDesc: 'जब तक आप कोई भाषा न चुनें, यह आपके डिवाइस का अनुसरण करती है।', languageAuto: 'स्वचालित ({name})',
    currency: 'मुद्रा', currencyDesc: 'मूल्य आपकी स्थानीय मुद्रा में दिखाएँ।',
    market: 'खुदरा बाज़ार', marketDesc: 'स्टोर ऑफ़र के लिए स्थानीय बाज़ार। पुनर्विक्रय मूल्य USD में ही रहते हैं।',
    appearance: 'रूप', notifications: 'सूचनाएँ', signOut: 'साइन आउट',
  },
  detail: {
    value: 'मूल्य', retired: 'बंद हो चुका', comingSoon: 'जल्द आ रहा है', retiringSoon: 'जल्द बंद होगा',
    pieces: 'टुकड़े', minifigs: 'मिनीफ़िगर', retail: 'खुदरा मूल्य',
    addToVault: 'संग्रह में जोड़ें', inVault: 'संग्रह में है', removeFromVault: 'संग्रह से हटाएँ',
    tabInfo: 'जानकारी', tabForecast: 'पूर्वानुमान', tabCommunity: 'समुदाय',
    reliablePrice: 'विश्वसनीय मूल्य', pricingDetails: 'मूल्य विवरण', priceHistory: 'मूल्य इतिहास',
    details: 'विवरण', estimated: 'अनुमानित', year: 'वर्ष', theme: 'थीम',
    addToWishlist: 'इच्छा-सूची में जोड़ें', inWishlist: 'इच्छा-सूची में है',
    addToVaultPrice: 'वॉल्ट में जोड़ें · {price}', priceHistoryDays: 'कीमत इतिहास · {days} दिन', priceHistoryShort: 'कीमत इतिहास · {days} दि', fromSources: '{n} बाज़ार स्रोतों से', fromSourcesOne: '1 बाज़ार स्रोत से', typicalRange: ' · आमतौर पर {low}–{high}', likelyRange: ' · संभवतः {low}-{high}',
  },
  counts: {
    results: '{n} परिणाम', resultsOne: '1 परिणाम', collected: '{owned}/{total} एकत्रित', owned: '{n} स्वामित्व में', ofFigs: '{total} में से', figs: '{n} मिनीफ़िगर', figsOne: '1 मिनीफ़िगर',
  },
  market: {
    sellNowLabel: 'अभी बेचें',
    fastSaleAfterFees: 'शुल्क के बाद तेज़ बिक्री',
    pctOfValue: 'मूल्य का {pct}%',
    pctOfFairValue: 'उचित मूल्य का {pct}%',
    confidentlyPriced: '{pct}% भरोसेमंद कीमत',
    families: '{n} स्वतंत्र बाज़ार स्रोत',
    familyOne: '1 स्वतंत्र बाज़ार स्रोत',
    sales: '{n} सत्यापित बिक्रियाँ',
    saleOne: '1 सत्यापित बिक्री',
    estimateUnlocks: '{list} का अनुमान अधिक बिक्री डेटा आने पर उपलब्ध होगा।',
    estimatesUnlock: '{list} के अनुमान अधिक बिक्री डेटा आने पर उपलब्ध होंगे।',
  },
  time: {
    unknown: 'अज्ञात', today: 'आज', yesterday: 'कल', daysAgo: '{n} दिन पहले',
  },
  me: {
    trophyShelf: 'ट्रॉफी शेल्फ ({n}/6)',
  },
  kids: {
    xp: '{n} XP', xpToLevel: 'लेवल {level} तक {n} XP', maxLevel: 'अधिकतम लेवल!', pcs: '{n} पुर्जे', earned: '{total} में से {n} अर्जित', setsToGo: '{n} सेट बाकी', setsToGoOne: '1 सेट बाकी!',
  },
  fees: {
    marketplace: 'मार्केटप्लेस शुल्क ({pct}%)', payment: 'भुगतान शुल्क ({pct}% + निश्चित)',
  },
  alerts: {
    priceDrop: 'कीमत में गिरावट · {days} दिन पहले', targetWas: '— आपका लक्ष्य {price} था।',
  },
  game: {
    roundOf: 'राउंड {n} / {total}', pctOff: 'आप {pct}% चूक गए', streakLine: '{day} · स्ट्रीक {streak} · सर्वश्रेष्ठ {best}',
  },
  build: {
    needParts: '{n} और पुर्जे चाहिए', ofOwnedSets: '{n} स्वामित्व वाले सेट में से', indexing: 'पृष्ठभूमि में {n} और सेट अनुक्रमित हो रहे हैं…',
  },
  catalog: {
    title: 'कैटलॉग', searchPlaceholder: 'सेट खोजें', results: '{count} सेट',
    noResults: 'कोई सेट नहीं मिला', filters: 'फ़िल्टर', sort: 'क्रमबद्ध करें', clearFilters: 'फ़िल्टर हटाएँ',
  },
  vault: {
    title: 'संग्रह', empty: 'आपका संग्रह खाली है', emptyDesc: 'मूल्य ट्रैक करने के लिए एक सेट जोड़ें।',
    setsOwned: 'स्वामित्व वाले सेट', totalValue: 'कुल मूल्य', invested: 'निवेशित', gain: 'लाभ', addSet: 'सेट जोड़ें',
    investedAmount: 'निवेश {amount}',
  },
  wishlist: {
    title: 'इच्छा-सूची', empty: 'आपकी इच्छा-सूची खाली है', targetPrice: 'लक्ष्य मूल्य',
    priceDropAlert: 'कीमत घटने पर सूचित करें', remove: 'इच्छा-सूची से हटाएँ',
    setsCount: '{n} सेट', setsCountOne: '1 सेट', alertsCount: '{n} अलर्ट', alertsCountOne: '1 अलर्ट', nowPrice: 'अभी {price}',
  },
};
export default hi;
