/** Hindi. Missing keys fall back to English (see lib/i18n.js). */
export const hi = {
  nav: { vault: 'संग्रह', catalog: 'कैटलॉग', scan: 'स्कैन', minifigs: 'मिनीफ़िगर', me: 'मैं', badges: 'बैज' },
  common: {
    cancel: 'रद्द करें', save: 'सहेजें', close: 'बंद करें', retry: 'फिर कोशिश करें',
    delete: 'हटाएँ', edit: 'संपादित करें', done: 'हो गया', undo: 'पूर्ववत करें',
    loading: 'लोड हो रहा है…', search: 'खोजें', all: 'सभी', none: 'कोई नहीं',
    yes: 'हाँ', no: 'नहीं', error: 'कुछ गड़बड़ हो गई', offline: 'आप ऑफ़लाइन हैं',
    seeAll: 'सभी देखें', share: 'साझा करें',
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
  },
  counts: {
    results: '{n} परिणाम', resultsOne: '1 परिणाम', collected: '{owned}/{total} एकत्रित', owned: '{n} स्वामित्व में', ofFigs: '{total} में से', figs: '{n} मिनीफ़िगर', figsOne: '1 मिनीफ़िगर',
  },
  catalog: {
    title: 'कैटलॉग', searchPlaceholder: 'सेट खोजें', results: '{count} सेट',
    noResults: 'कोई सेट नहीं मिला', filters: 'फ़िल्टर', sort: 'क्रमबद्ध करें', clearFilters: 'फ़िल्टर हटाएँ',
  },
  vault: {
    title: 'संग्रह', empty: 'आपका संग्रह खाली है', emptyDesc: 'मूल्य ट्रैक करने के लिए एक सेट जोड़ें।',
    setsOwned: 'स्वामित्व वाले सेट', totalValue: 'कुल मूल्य', invested: 'निवेशित', gain: 'लाभ', addSet: 'सेट जोड़ें',
  },
  wishlist: {
    title: 'इच्छा-सूची', empty: 'आपकी इच्छा-सूची खाली है', targetPrice: 'लक्ष्य मूल्य',
    priceDropAlert: 'कीमत घटने पर सूचित करें', remove: 'इच्छा-सूची से हटाएँ',
  },
};
export default hi;
