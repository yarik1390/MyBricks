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
    addToVaultPrice: 'वॉल्ट में जोड़ें · {price}', priceHistoryDays: 'कीमत इतिहास · {days} दिन', priceHistoryShort: 'कीमत इतिहास · {days} दि', fromSources: '{n} बाज़ार स्रोतों से', fromSourcesOne: '1 बाज़ार स्रोत से', typicalRange: ' · आमतौर पर {low}–{high}', likelyRange: ' · संभवतः {low}-{high}', tagsMore: '+{n} और', reviews: '{n} समीक्षाएँ', reviewsOne: '1 समीक्षा', up: '{pct}% ऊपर', down: '{pct}% नीचे',
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
    soldEvidenceHeadline: '{markets} से {sales} पर आधारित।',
    soldEvidenceFallback: 'हाल की सत्यापित बिक्री नहीं है — अनुमान मांगी गई कीमतों या बाजार गाइड पर आधारित है।',
    soldEvidenceTitle: 'बिक्री प्रमाण',
    soldEvidenceNewSealed: 'नया और सीलबंद',
    soldEvidenceUsedComplete: 'इस्तेमाल किया हुआ और पूरा',
    soldEvidenceFresh: 'हाल का',
    soldEvidenceOlder: 'पुराना',
    soldEvidenceSalesOne: '1 सत्यापित बिक्री',
    soldEvidenceSalesOther: '{n} सत्यापित बिक्री',
    soldEvidenceMarketplacesOne: '1 मार्केटप्लेस',
    soldEvidenceMarketplacesOther: '{n} मार्केटप्लेस',
    partOutVerdictPartout: 'पुर्जों में बेचने पर अधिक मिलेगा',
    partOutVerdictSealed: 'सीलबंद बेचें',
    partOutVerdictSame: 'लगभग समान',
    partOutSellSealed: 'सीलबंद बेचें',
    partOutSellParts: 'पुर्जों में बेचें',
    partOutDeltaPartout: 'सीलबंद मूल्य से {pct} अधिक',
    partOutDeltaSealed: 'सीलबंद मूल्य {pct} अधिक है',
    partOutClose: 'मूल्य लगभग समान हैं',
    partOutCoverage: '{pct} पुर्जों की कीमत उपलब्ध',
    sellingAbove: 'इस मूल्य से लगभग {pct} ऊपर बिक रहा है',
    sellingBelow: 'इस मूल्य से लगभग {pct} नीचे बिक रहा है',
  },
  card: {
    pieces: '{n} पीस',
    perPiece: '{price}/पीस',
    lots: '{n} लॉट',
    deal: 'डील {pct}',
    strongBuy: 'बढ़िया सौदा {pct}',
    forecast2y: '{price} 2 वर्ष',
    gamePieces: '{n} पीस',
    gameRetail: 'खुदरा {price}',
  },
  deal: {
    buyRetail: 'खुदरा में बाज़ार मूल्य से लगभग {pct}% कम पर उपलब्ध।',
    buyResale: 'बाज़ार मूल्य से लगभग {pct}% कम पर बिक रहा है।',
    retiring: 'जल्द बंद हो रहा है — खरीद का सीमित अवसर।',
    premiumRetail: 'फ़िलहाल बाज़ार मूल्य से ऊपर।',
    premiumResale: 'माँगी गई कीमतें बाज़ार मूल्य से ऊपर हैं।',
    fair: 'बाज़ार मूल्य के अनुरूप।',
    labelBuy: 'खरीदें',
    labelStrongBuy: 'बढ़िया सौदा',
    labelFair: 'उचित कीमत',
    labelPremium: 'मूल्य से ऊपर',
    labelPct: '{label} · {pct}%',
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
    sortValue: 'मूल्य', sortGrowth: 'वृद्धि', sortNewest: 'नवीनतम', sortTrending: 'ट्रेंडिंग',
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
Object.assign(hi.catalog, { filtersWithCount: 'फ़िल्टर · {n}' });
hi.community = { pendingSubmissionOne: '⏳ आपका {n} योगदान अनुमोदन की प्रतीक्षा में है।', pendingSubmissionFew: '⏳ आपके {n} योगदान अनुमोदन की प्रतीक्षा में हैं।', pendingSubmissionMany: '⏳ आपके {n} योगदान अनुमोदन की प्रतीक्षा में हैं।', pendingSubmissionOther: '⏳ आपके {n} योगदान अनुमोदन की प्रतीक्षा में हैं।' };
hi.contributions = { approvedOne: '{n} स्वीकृत योगदान', approvedFew: '{n} स्वीकृत योगदान', approvedMany: '{n} स्वीकृत योगदान', approvedOther: '{n} स्वीकृत योगदान', contributorBadge: ' · ⭐ योगदानकर्ता' };
hi.admin = { uploadingFile: '{file} अपलोड हो रही है…', importedMinifigs: '{parsed} में से {inserted} मिनीफिगर आयात किए गए। मूल्यांकन के समय उन्हें कीमतों से जोड़ा जाएगा।', uploadFailed: 'विफल: {error}', lastRun: 'पिछला रन {when}{duration}' };
hi.downloads = { interrupted: 'डाउनलोड {pct}% पर बाधित हुआ — जारी रखने के लिए “रिज़्यूम करें” दबाएँ।', resume: 'रिज़्यूम करें ({pct})', scanProgress: '{total} में से {current} की पहचान की जा रही है…' };
Object.assign(hi.detail, { acquired: '{date} को प्राप्त{source}' });
Object.assign(hi.wishlist, { targetPriceCurrency: 'लक्ष्य मूल्य ({symbol})', suggestedPrice: 'सुझाव: {price}' });
Object.assign(hi.wishlist, { ackAlert: 'लक्ष्य मूल्य अलर्ट बंद करें', alertAcked: 'अलर्ट बंद कर दिया गया' });
hi.minifigs = { appearsInSetsOne: '{n} सेट में है', appearsInSetsFew: '{n} सेटों में है', appearsInSetsMany: '{n} सेटों में है', appearsInSetsOther: '{n} सेटों में है' };
Object.assign(hi.admin, { syncJobRunning: '{label}: चल रहा है…', syncJobSkipped: 'छोड़ा गया — {n}', syncJobSummary: '{processed} संसाधित, {updated} अपडेट, {rejected} अस्वीकृत', syncJobResult: '{label}: {summary}', syncJobFailed: '{label} विफल: {error}', uploadSuccessToast: 'BrickLink मिनीफिगर कैटलॉग: {inserted} आयात किए गए', uploadErrorToast: 'कैटलॉग अपलोड विफल: {error}', countRunning: '{n} चल रहे हैं', countHealthy: '{n} ठीक हैं', countFailed: '{n} विफल', countNotRun: '{n} अभी तक नहीं चला', completedSlices: '{n} सुरक्षित चरण पूरे', jobId: 'जॉब #{id}', filled: '{n} भरे गए', processed: '{n} संसाधित', figures: '{n} मिनीफिगर', noItemsProcessed: 'कोई आइटम संसाधित नहीं', anomalyResolved: 'विसंगति हल की गई।', anomalyIgnored: 'विसंगति अनदेखी की गई।', anomalyResolveFailed: 'विसंगति अपडेट नहीं हो सकी।', });
Object.assign(hi.admin, { jobStarted: 'जॉब #{id} शुरू हुआ', jobFailed: 'जॉब विफल: {error}', maintenanceComplete: '{label} पूरा हुआ', maintenanceFailed: '{label} विफल: {error}', lastSeen: 'अंतिम बार देखा गया: {when}' });
Object.assign(hi.detail, { uploadFailed: 'अपलोड विफल: {error}', removeFailed: 'हटाना विफल: {error}', forecastUpside: 'पूर्वानुमान में ~{pct} अधिक बढ़त है' }); hi.data = { reportFailed: 'रिपोर्ट विफल: {error}', restoreFailed: 'पुनर्स्थापना विफल: {error}', retryFailed: 'पुनः प्रयास विफल: {error}', exportFailed: 'निर्यात विफल: {error}', importFailed: 'आयात विफल: {error}', bricklinkImportFailed: 'BrickLink आयात विफल: {error}' }; hi.integrations = { bricksetSyncFailed: 'Brickset सिंक विफल: {error}' }; hi.scanner = { timedOut: 'बहुत समय लगा — फिर कोशिश करें।', timedOutShort: 'समय समाप्त', scanFailed: 'त्रुटि: {error}' };
Object.assign(hi.common, { errorWithDetails: 'त्रुटि: {error}' }); Object.assign(hi.integrations, { bricksetSyncResult: '{added} सेट आयात हुए ({skipped} कैटलॉग में नहीं, Brickset पर कुल {total})।', bricksetSyncSuccess: 'Brickset सिंक: {added} सेट जोड़े गए' }); Object.assign(hi.scanner, { bulkPartial: '{total} में से {added} जोड़े गए — {failed} विफल, फिर कोशिश करें', addSetsFailed: 'सेट जोड़ना विफल: {error}' }); hi.portfolio = { collectionLoadFailed: 'कलेक्शन लोड नहीं हुआ: {error}', bulkRemovePartial: '{total} में से {removed} हटे — {failed} विफल, फिर कोशिश करें', restoredCount: '{total} में से {restored} पुनर्स्थापित' };
Object.assign(hi.settings, { currencyUpdated: 'मुद्रा {currency} में बदली गई' });
Object.assign(hi.common, { offlineActionsSynced: '{count} ऑफ़लाइन कार्रवाइयाँ सिंक हुईं', offlineActionsDiscarded: '{count} ऑफ़लाइन कार्रवाइयाँ सिंक नहीं हो सकीं और हटा दी गईं', localItemsSynced: '{count} स्थानीय आइटम सिंक हुए', kidsXp: '+{xp} XP! {level} {badge}', copied: '{label} कॉपी किया गया' }); Object.assign(hi.admin, { serviceTestResult: '{head} — {detail} ({ms}ms)', providerStatus: '{provider}: {status}', serviceTestFailed: 'विफल: {error}', providerTestFailed: '{provider} परीक्षण विफल', featureFlagStatus: '{flag}: {status}{suffix}', featureFlagUpdateFailed: '{flag} अपडेट नहीं हो सका: {error}', providerSaved: '{provider} सहेजा गया।', providerSaveFailed: '{provider} सहेजने में त्रुटि: {error}', pricingConfigLoadFailed: 'कीमत कॉन्फ़िगरेशन लोड नहीं हो सका: {error}', resetFailed: 'रीसेट विफल: {error}', contributionAction: '{action} — {applied}', enabled: 'सक्षम', disabled: 'अक्षम', approved: 'स्वीकृत', rejected: 'अस्वीकृत' }); Object.assign(hi.minifigs, { ownedCount: '{count} स्वामित्व में' }); Object.assign(hi.data, { restoredFromBackup: '{date} से {count} सेट पुनर्स्थापित हुए', migrationStillFailing: '{count} आइटम अभी भी विफल हैं: {error}', migrationComplete: 'पूर्ण — {count} आइटम सिंक हुए।', importResult: '✓ {imported} आयातित, {skipped} छोड़े गए, {errors} त्रुटियाँ', setsImported: '{count} सेट आयातित', bricklinkImportResult: '✓ {added} सेट जोड़े गए, {skipped} छोड़े गए। {errors}', bricklinkSetsImported: 'BrickLink ऑर्डर से {count} सेट आयातित' }); Object.assign(hi.integrations, { keyRemoved: '{label} कुंजी हटाई गई', keyVerified: '{label} कुंजी सत्यापित और सहेजी गई' }); Object.assign(hi.scanner, { setNotFound: 'सेट {setNum} कैटलॉग में नहीं मिला।', localAiOfflineFailed: 'डिवाइस AI विफल हुआ और आप ऑफ़लाइन हैं: {error}', addItemFailed: '{name} जोड़ा नहीं जा सका: {error}', minifig: 'मिनिफ़िग', itemsAdded: '{count} आइटम वॉल्ट में जोड़े गए', itemsSavedOffline: '{count} ऑफ़लाइन सहेजे गए — सिंक होंगे', setsSavedOffline: '{count} सेट ऑफ़लाइन सहेजे गए — कनेक्ट होने पर सिंक होंगे' }); Object.assign(hi.portfolio, { soldFor: '{price} में बेचा — वॉल्ट से हटाया गया' });
Object.assign(hi.common, { offlineActionsSyncedOne: '{count} ऑफ़लाइन कार्रवाई सिंक हुई', offlineActionsSyncedOther: '{count} ऑफ़लाइन कार्रवाइयाँ सिंक हुईं', offlineActionsDiscardedOne: '{count} ऑफ़लाइन कार्रवाई सिंक नहीं हुई और हटा दी गई', offlineActionsDiscardedOther: '{count} ऑफ़लाइन कार्रवाइयाँ सिंक नहीं हुईं और हटा दी गईं', localItemsSyncedOne: '{count} स्थानीय आइटम सिंक हुआ', localItemsSyncedOther: '{count} स्थानीय आइटम सिंक हुए', kidsXp: '+{xp} XP!{details}', kidsXpLevel: ' स्तर {level}!', kidsXpBadge: ' · बैज: {badge}! 🎉' }); Object.assign(hi.scanner, { itemsAddedOne: '{count} आइटम वॉल्ट में जोड़ा गया', itemsAddedOther: '{count} आइटम वॉल्ट में जोड़े गए', itemsSavedOfflineOne: '{count} आइटम ऑफ़लाइन सहेजा गया — सिंक होगा', itemsSavedOfflineOther: '{count} आइटम ऑफ़लाइन सहेजे गए — सिंक होंगे', setsSavedOfflineOne: '{count} सेट ऑफ़लाइन सहेजा गया — कनेक्ट होने पर सिंक होगा', setsSavedOfflineOther: '{count} सेट ऑफ़लाइन सहेजे गए — कनेक्ट होने पर सिंक होंगे' }); Object.assign(hi.portfolio, { wishlistAlertsTooltip: 'इच्छा-सूची अलर्ट ({spikes} उछाल, {drops} कीमत में कमी)', bulkLocationPartial: '{total} में से {updated} अपडेट हुए — {failed} विफल, फिर प्रयास करें' });
Object.assign(hi.data, { restoredFromBackupOne: '{count} सेट {date} से पुनर्स्थापित', restoredFromBackupOther: '{count} सेट {date} से पुनर्स्थापित' }); Object.assign(hi.integrations, { bricksetSyncResultOne: '{count} सेट आयातित ({skipped} कैटलॉग में नहीं, Brickset पर {total}).', bricksetSyncResultOther: '{count} सेट आयातित ({skipped} कैटलॉग में नहीं, Brickset पर {total}).', bricksetSyncSuccessOne: 'Brickset सिंक: {count} सेट जोड़ा', bricksetSyncSuccessOther: 'Brickset सिंक: {count} सेट जोड़े' }); Object.assign(hi.wishlist, { unreadAlertsOne: '{count} अपठित अलर्ट', unreadAlertsOther: '{count} अपठित अलर्ट' }); Object.assign(hi.portfolio, { wishlistAlertsTooltip: 'इच्छा-सूची अलर्ट ({spikes}, {drops})', wishlistAlertSpikesOne: '{count} उछाल', wishlistAlertSpikesOther: '{count} उछाल', wishlistAlertDropsOne: '{count} कीमत में कमी', wishlistAlertDropsOther: '{count} कीमत में कमी', insightSignal: 'पुनर्विक्रय {direction}{pct}% बनाम {basis}{quantity}', insightMarket: 'बाज़ार', insightValue: 'मूल्य', insightQuantity: ' · ×{count}' });
Object.assign(hi.kids, { badgeCelebration: 'नया बैज: {badge}! 🎉', badgeQuip: 'तुम निर्माण के सुपरस्टार हो! 🌟', levelCelebration: 'लेवल {level} पूरा हुआ! 🎉', levelQuip: 'बनाते रहो! 🧱', badgeFirstBrick: 'पहली ईंट!', badgeJuniorBuilder: 'नन्हा निर्माता', badgeArchitect: 'वास्तुकार', badgeMaster: 'मास्टर बिल्डर', badgeGrandMaster: 'महान गुरु', badgeLegend: 'महानायक!' });
Object.assign(hi.data, { csvImportConfirmTitleOne: '1 सेट आयात करें?', csvImportConfirmTitleOther: '{count} सेट आयात करें?', csvImportMore: ' और {count} और', csvImportConfirmMessage: 'शुरू करें: {sample}{more}। मौजूदा सेट रखे जाएंगे।', importConfirm: 'आयात करें' });
Object.assign(hi.scanner, { setNumberMatched: 'सेट नंबर कैटलॉग में मिल गया।' });
Object.assign(hi.portfolio, { insightHeadlineOne: 'अभी बेचने पर 1 सेट में लगभग {value} की बढ़त', insightHeadlineOther: 'अभी बेचने पर {count} सेटों में लगभग {value} की बढ़त' });
Object.assign(hi.market, { goodTimeToSell: 'बेचने का अच्छा समय', goodTimeToBuy: 'खरीदने का अच्छा समय', onlyForSale: 'अभी केवल {count} बिक्री पर हैं', askingHighHint: 'विक्रेता ऊंची मांग कर रहे हैं — जल्दी बेचने के लिए हाल के बिके दाम के पास सूचीबद्ध करें', askingLowHint: 'हाल के बिके दाम से कम सूचीबद्ध — खरीदने का अच्छा समय', askingSummary: 'अभी {count} बिक्री पर · मांग {asking}', askingSummaryWithSold: 'अभी {count} बिक्री पर · मांग {asking}, हाल में बिका {sold}' });
Object.assign(hi.game, { marketGenius: '{score}/5 — market genius! 🎯', streakQuipOne: 'Streak: {count} day.', streakQuipOther: 'Streak: {count} days.' }); hi.market = Object.assign(hi.market || {}, { sellingAbove: 'Selling about {pct} above this value', sellingBelow: 'Selling about {pct} below this value' }); Object.assign(hi.scanner, { findingSet: 'Finding set...', lookingUpSet: 'Looking up {setNum} in the catalog.' });
Object.assign(hi.game, { marketGenius: '{score}/5 — बाज़ार के उस्ताद! 🎯', streakQuipOne: 'लगातार: {count} दिन।', streakQuipOther: 'लगातार: {count} दिन।' });
Object.assign(hi.market, { sellingAbove: 'इस मूल्य से लगभग {pct} अधिक पर बिक रहा है', sellingBelow: 'इस मूल्य से लगभग {pct} कम पर बिक रहा है' }); Object.assign(hi.scanner, { findingSet: 'सेट खोजा जा रहा है…', lookingUpSet: 'कैटलॉग में {setNum} खोज रहे हैं।', bulkMatched: '{total} में से {matched} मिले' }); Object.assign(hi.game, { revealCorrect: '🎯 बिलकुल सही! — यह {value} है', revealIncorrect: 'करीब थे — यह {value} है' }); Object.assign(hi.catalog, { activeFiltersOne: '1 सक्रिय', activeFiltersOther: '{count} सक्रिय' }); Object.assign(hi.portfolio, { anniversaryGain: '{paid} में खरीदा — तब से {gain} बढ़ा।', anniversaryNoGain: '{paid} में खरीदा। कुछ सेट प्यार के लिए होते हैं, लाभ के लिए नहीं।', anniversaryQuip: 'बनाते समय समय उड़ जाता है।', anniversaryCelebrationOne: '{set} के साथ 1 साल! 🎂', anniversaryCelebrationOther: '{set} के साथ {count} साल! 🎂' });
Object.assign(hi.market, { partsCoverage: '{pct}% पुर्ज़ों का कवरेज', forecastScenarios: 'कमज़ोर {bear} · आधार {base} · तेज़ {bull}', salesSuffix: ' / {count} बिक्री', newSold: 'नया बिका', usedSold: 'पुराना बिका', viewOnBrickLink: 'BrickLink पर देखें' }); Object.assign(hi.catalog, { loadFailedDetail: '{error}। अपना कनेक्शन जांचें और फिर कोशिश करें।' }); Object.assign(hi.portfolio, { moreThemesOne: '+1 और थीम', moreThemesOther: '+{count} और थीम', sealedParts: 'सीलबंद {sealed} · {approximate}पुर्ज़े {parts}' }); hi.advisor = Object.assign(hi.advisor || {}, { moreThemesOne: 'आपके वॉल्ट में +1 और थीम', moreThemesOther: 'आपके वॉल्ट में +{count} और थीम' });
Object.assign(hi.game, { loadFailed: 'आज का खेल लोड नहीं हुआ: {error}' }); Object.assign(hi.contributions, { loadFailed: 'लोड नहीं हो सका: {error}' }); Object.assign(hi.me, { wrappedLoadFailed: 'आपका साल लोड नहीं हुआ: {error}', wrappedValueChange: 'वॉल्ट इस साल {direction} {value}', wrappedUp: 'बढ़ा', wrappedDown: 'गिरा' });
Object.assign(hi.catalog, { filterSummaryNone: 'कोई फ़िल्टर सक्रिय नहीं है', filterSummaryActiveOne: '{count} सक्रिय: {items}', filterSummaryActiveOther: '{count} सक्रिय: {items}', filterSummarySearch: 'खोज “{value}”', filterSummaryStatusRetired: 'केवल रिटायर्ड', filterSummaryStatusActive: 'केवल सक्रिय', filterSummaryStatusRetiring: 'जल्द रिटायर होने वाले', filterSummaryDeal: 'केवल सौदे', filterSummaryRangeYear: 'वर्ष', filterSummaryRangePieces: 'पीस', filterSummaryRangeValue: 'मूल्य', filterSummaryRangeBetween: '{label} {min}–{max}', filterSummaryRangeMin: '{label} ≥ {value}', filterSummaryRangeMax: '{label} ≤ {value}', filterSummaryPiecesValue: '{value} पीस', filterSummaryValueAmount: 'US${value}' });
Object.assign(hi.minifigs, { filterSummaryNone: 'कोई फ़िल्टर सक्रिय नहीं है', filterSummaryActiveOne: '{count} सक्रिय: {items}', filterSummaryActiveOther: '{count} सक्रिय: {items}', filterSummarySearch: 'खोज “{value}”', filterSummaryRarity: 'दुर्लभता: {rarity}', filterSummaryRarityCommon: 'सामान्य', filterSummaryRarityUncommon: 'असामान्य', filterSummaryRarityRare: 'दुर्लभ', filterSummaryRarityLegendary: 'पौराणिक', filterSummaryOwned: 'केवल स्वामित्व वाले', filterSummaryUnowned: 'केवल बिना स्वामित्व वाले' });
Object.assign(hi.catalog, { emptySearchResults: '“{query}” से कुछ नहीं मिला। दूसरी खोज आज़माएँ या फ़िल्टर हटाएँ।', emptyFilteredResults: 'कोई सेट इन फ़िल्टरों से मेल नहीं खाता। दूसरी खोज आज़माएँ या फ़िल्टर हटाएँ।' });
Object.assign(hi.advisor, { retiredSetsOfTotalOne: '{total} में से {retired} रिटायर्ड सेट', retiredSetsOfTotalOther: '{total} में से {retired} रिटायर्ड सेट' });
Object.assign(hi.scanner, { duplicateConfirmTitle: 'पहले से स्वामित्व में', duplicateConfirmMessage: 'आपके वॉल्ट में {names} पहले से है। एक और कॉपी जोड़ें?', duplicateConfirmAction: 'फिर भी जोड़ें' });
Object.assign(hi.scanner, { minifigWithSeries: '{series} श्रृंखला की {minifig}', minifigWithRarity: '{rarity} {minifig}', rarityUnknown: 'अज्ञात' });
Object.assign(hi.scanner, { setsFoundOne: '{count} सेट मिला', setsFoundOther: '{count} सेट मिले', minifigsFoundOne: '{count} मिनीफ़िगर मिला', minifigsFoundOther: '{count} मिनीफ़िगर मिले', mixedResultsFoundOne: '{count} परिणाम मिला (सेट और मिनीफ़िगर)', mixedResultsFoundOther: '{count} परिणाम मिले (सेट और मिनीफ़िगर)', confidenceHigh: 'उच्च विश्वास', confidenceMedium: 'मध्यम विश्वास', confidenceLow: 'कम विश्वास', confidenceUnknown: 'मिलान विश्वास उपलब्ध नहीं', matchHigh: 'उच्च मिलान', matchMedium: 'मध्यम मिलान', matchLow: 'कम मिलान', match: 'मिलान' });
Object.assign(hi.detail, { sellReasonGainSincePurchase: 'खरीद के बाद से {roi} ऊपर', sellReasonTrendDown: 'कीमत का रुझान नीचे मुड़ गया है', sellReasonClimbFlattened: 'कीमत की चढ़ाई सपाट हो गई है', sellReasonLittleUpside: 'केवल {upside} अनुमानित बढ़त बाकी है', sellReasonSellsFast: '{volume} हालिया बिक्री तेज़ बिक्री का संकेत देती हैं', sellReasonWatchClosely: 'बाज़ार पर कड़ी नज़र रखें', sellReasonStillClimbing: 'कीमत अभी भी बढ़ रही है', sellReasonForecastUpside: 'अनुमान में {upside} और बढ़त है', sellReasonNotRetired: 'अभी रिटायर नहीं हुआ है', sellReasonNoSellTrigger: 'अभी कोई स्पष्ट बेचने का संकेत नहीं है' });
Object.assign(hi.data, { migrationStillFailingOne: 'अभी भी {count} आइटम विफल है: {error}', migrationStillFailingOther: 'अभी भी {count} आइटम विफल हैं: {error}', migrationCompleteOne: 'पूरा हुआ — {count} आइटम सिंक हुआ।', migrationCompleteOther: 'पूरा हुआ — {count} आइटम सिंक हुए।', setsImportedOne: '{count} सेट आयात हुआ', setsImportedOther: '{count} सेट आयात हुए', bricklinkSetsImportedOne: 'BrickLink ऑर्डर से {count} सेट आयात हुआ', bricklinkSetsImportedOther: 'BrickLink ऑर्डर से {count} सेट आयात हुए' });
Object.assign(hi.detail, { sellReasonSellsFastOne: '{volume} हालिया बिक्री तेज़ बिक्री का संकेत देती है', sellReasonSellsFastOther: '{volume} हालिया बिक्री तेज़ बिक्री का संकेत देती हैं' });
Object.assign(hi.minifigs, { setExclusive: 'सेट-विशेष', inSetsOne: '{count} सेट में', inSetsOther: '{count} सेटों में', partsOne: '{count} भाग', partsOther: '{count} भाग' });
Object.assign(hi.minifigs, { emptySearchResults: '“{query}” से कुछ नहीं मिला।', emptyFilteredResults: 'कोई मिनीफ़िगर इन फ़िल्टरों से मेल नहीं खाता।' });
Object.assign(hi.detail, { partsComplete: 'पूर्ण', partsMissingOne: '{count} भाग गायब', partsMissingOther: '{count} भाग गायब', allPartsPresent: 'सभी भाग मौजूद हैं' });
Object.assign(hi.build, { needPartsOne: '{n} और पुर्जा चाहिए', needPartsOther: '{n} और पुर्जे चाहिए' });
Object.assign(hi.card, { lotsOne: '{n} लॉट', lotsOther: '{n} लॉट' });
Object.assign(hi.market, { salesSuffixOne: ' / {count} बिक्री', salesSuffixOther: ' / {count} बिक्री' });
Object.assign(hi.data, { importedCountOne: '{n} सेट आयात हुआ', importedCountOther: '{n} सेट आयात हुए', skippedCountOne: '{n} सेट छोड़ा गया', skippedCountOther: '{n} सेट छोड़े गए', errorsCountOne: '{n} त्रुटि', errorsCountOther: '{n} त्रुटियाँ', setsAddedCountOne: '{n} सेट जोड़ा गया', setsAddedCountOther: '{n} सेट जोड़े गए', importResult: '✓ {imported} · {skipped} · {errors}', bricklinkImportResult: '✓ {added} · {skipped}। {errors}' });
Object.assign(hi.admin, { minifigsImportedOne: '{n} मिनीफिग', minifigsImportedOther: '{n} मिनीफिग', minifigsParsedOne: '{n} मिनीफिग', minifigsParsedOther: '{n} मिनीफिग', importedMinifigs: '{parsed} में से {inserted} आयात हुए। मूल्यांकन होने पर कीमतें जुड़ेंगी।' });
Object.assign(hi.time, {"daysAgoOne":"{n} दिन पहले","daysAgoOther":"{n} दिन पहले"});
Object.assign(hi.scanner, {"bulkPartialOne":"{added} में से {total} जोड़े गए — {failed} विफल, फिर कोशिश करें","bulkPartialOther":"{added} में से {total} जोड़े गए — {failed} विफल, फिर कोशिश करें"});
Object.assign(hi.kids, {"setsToGoOne":"{n} सेट बाकी","setsToGoOther":"{n} सेट बाकी","earnedOne":"{n} में से {total} अर्जित","earnedOther":"{n} में से {total} अर्जित"});
Object.assign(hi.market, {"familiesOne":"{n} स्वतंत्र बाज़ार स्रोत","familiesOther":"{n} स्वतंत्र बाज़ार स्रोत","salesOne":"{n} सत्यापित बिक्रियाँ","salesOther":"{n} सत्यापित बिक्रियाँ","onlyForSaleOne":"अभी केवल {count} बिक्री पर हैं","onlyForSaleOther":"अभी केवल {count} बिक्री पर हैं","askingSummaryOne":"अभी {count} बिक्री पर · मांग {asking}","askingSummaryOther":"अभी {count} बिक्री पर · मांग {asking}","askingSummaryWithSoldOne":"अभी {count} बिक्री पर · मांग {asking}, हाल में बिका {sold}","askingSummaryWithSoldOther":"अभी {count} बिक्री पर · मांग {asking}, हाल में बिका {sold}"});
Object.assign(hi.detail, {"fromSourcesOne":"{n} बाज़ार स्रोतों से","fromSourcesOther":"{n} बाज़ार स्रोतों से","reviewsOne":"{n} समीक्षाएँ","reviewsOther":"{n} समीक्षाएँ","priceHistoryDaysOne":"कीमत इतिहास · {n} दिन","priceHistoryDaysOther":"कीमत इतिहास · {n} दिन","priceHistoryShortOne":"कीमत इतिहास · {n} दि","priceHistoryShortOther":"कीमत इतिहास · {n} दि"});
Object.assign(hi.alerts, {"priceDropOne":"कीमत में गिरावट · {n} दिन पहले","priceDropOther":"कीमत में गिरावट · {n} दिन पहले"});
Object.assign(hi.portfolio, {"bulkLocationPartialOne":"{updated} में से {total} अपडेट हुए — {failed} विफल, फिर प्रयास करें","bulkLocationPartialOther":"{updated} में से {total} अपडेट हुए — {failed} विफल, फिर प्रयास करें","bulkRemovePartialOne":"{removed} में से {total} हटे — {failed} विफल, फिर कोशिश करें","bulkRemovePartialOther":"{removed} में से {total} हटे — {failed} विफल, फिर कोशिश करें","restoredCountOne":"{restored} में से {total} पुनर्स्थापित","restoredCountOther":"{restored} में से {total} पुनर्स्थापित"});
Object.assign(hi.wishlist, {"setsCountOne":"{n} सेट","setsCountOther":"{n} सेट","alertsCountOne":"{n} अलर्ट","alertsCountOther":"{n} अलर्ट"});
Object.assign(hi.admin, {"syncJobSkippedOne":"छोड़ा गया — {n}","syncJobSkippedOther":"छोड़ा गया — {n}","syncJobSummaryOne":"{processed} संसाधित, {updated} अपडेट, {rejected} अस्वीकृत","syncJobSummaryOther":"{processed} संसाधित, {updated} अपडेट, {rejected} अस्वीकृत","uploadSuccessToastOne":"BrickLink मिनीफिगर कैटलॉग: {n} आयात किए गए","uploadSuccessToastOther":"BrickLink मिनीफिगर कैटलॉग: {n} आयात किए गए","contributionActionOne":"{action} — {n}","contributionActionOther":"{action} — {n}"});
Object.assign(hi.data, {"csvImportMoreOne":" और {n} और","csvImportMoreOther":" और {n} और","csvImportConfirmMessageOne":"शुरू करें: {sample}{more}। मौजूदा सेट रखे जाएंगे।","csvImportConfirmMessageOther":"शुरू करें: {sample}{more}। मौजूदा सेट रखे जाएंगे।"});
Object.assign(hi.me, {"trophyShelfOne":"ट्रॉफी शेल्फ ({n}/6)","trophyShelfOther":"ट्रॉफी शेल्फ ({n}/6)"});
Object.assign(hi.build, {"ofOwnedSetsOne":"{n} स्वामित्व वाले सेट में से","ofOwnedSetsOther":"{n} स्वामित्व वाले सेट में से","indexingOne":"पृष्ठभूमि में {n} और सेट अनुक्रमित हो रहे हैं…","indexingOther":"पृष्ठभूमि में {n} और सेट अनुक्रमित हो रहे हैं…"});
Object.assign(hi.counts, {"collectedOne":"{owned}/{total} एकत्रित","collectedOther":"{owned}/{total} एकत्रित","ownedOne":"{n} स्वामित्व में","ownedOther":"{n} स्वामित्व में","ofFigsOne":"{total} में से","ofFigsOther":"{total} में से","resultsOne":"{n} परिणाम","resultsOther":"{n} परिणाम","figsOne":"{n} मिनीफ़िगर","figsOther":"{n} मिनीफ़िगर"});
Object.assign(hi.minifigs, {"ownedCountOne":"{n} स्वामित्व में","ownedCountOther":"{n} स्वामित्व में"});
Object.assign(hi.catalog, {"filtersWithCountOne":"फ़िल्टर · {n}","filtersWithCountOther":"फ़िल्टर · {n}"});
Object.assign(hi.scanner, {"bulkMatchedOne":"{total} में से {matched} मिले","bulkMatchedOther":"{total} में से {matched} मिले"});
Object.assign(hi.kids, {"pcsOne":"{n} पुर्जे","pcsOther":"{n} पुर्जे"});
Object.assign(hi.card, {"gamePiecesOne":"{n} पीस","gamePiecesOther":"{n} पीस","piecesOne":"{n} पीस","piecesOther":"{n} पीस"});
Object.assign(hi.scanner, { bulkMatchedOne: '{n} / {total} मिले', bulkMatchedOther: '{n} / {total} मिले' });
Object.assign(hi.kids, { pcsOne: '{n} पुर्जा', pcsOther: '{n} पुर्जे' });
Object.assign(hi.card, { gamePiecesOne: '{n} पीस', gamePiecesOther: '{n} पीस', piecesOne: '{n} पुर्जा', piecesOther: '{n} पुर्जे' });
Object.assign(hi.share ??= {}, {"gameTitle":"Price It!","gameText":"🧱 Price It! {day}\\n{tiles} {score}/5 · streak {streak}\\nGuess LEGO market prices on BricksVault","setText":"Check out {name} ({setNum}) on BricksVault!","setDialogTitle":"Share {name}","portfolioTitle":"My LEGO BricksVault","portfolioText":"Check out my LEGO collection on BricksVault!","portfolioDialogTitle":"Share my BricksVault","wrappedTitle":"Brick Wrapped {year}","wrappedBest":"Best performer: {name}{roi}","wrappedTracked":"Tracked with BricksVault","wrappedSetsAdded":"sets added","wrappedPiecesAdded":"pieces","wrappedValueChange":"vault value change","wrappedTagline":"BRICKSVAULT · STACK SOMETHING BEAUTIFUL"});
Object.assign(hi.share, { gameTitle: 'कीमत लगाएँ!', gameText: '🧱 कीमत लगाएँ! {day}\n{tiles} {score}/5 · लगातार {streak}\nBricksVault पर LEGO बाज़ार कीमतों का अनुमान लगाएँ', setText: 'BricksVault पर {name} ({setNum}) देखें!', setDialogTitle: '{name} साझा करें', portfolioTitle: 'मेरा LEGO BricksVault', portfolioText: 'BricksVault पर मेरा LEGO संग्रह देखें!', portfolioDialogTitle: 'मेरा BricksVault साझा करें', wrappedTitle: 'Brick वर्ष-सार {year}', wrappedBest: 'सर्वश्रेष्ठ प्रदर्शन: {name}{roi}', wrappedTracked: 'BricksVault के साथ ट्रैक किया गया', wrappedValueChange: 'वॉल्ट मूल्य परिवर्तन', wrappedTagline: 'BRICKSVAULT · कुछ सुंदर बनाएँ', wrappedHeading: 'Brick वर्ष-सार', wrappedDescription: 'अंकों में आपका कलेक्टर वर्ष — इसे साझा करें।', wrappedLoading: 'आपकी ईंटें गिनी जा रही हैं…', wrappedSummaryTitle: '🧱 मेरा Brick वर्ष-सार {year}', wrappedSetsAddedOne: '{count} सेट जोड़ा गया', wrappedSetsAddedOther: '{count} सेट जोड़े गए', wrappedPiecesAddedOne: '{count} पीस', wrappedPiecesAddedOther: '{count} पीस', wrappedMinifigsOne: '{count} मिनीफ़िग', wrappedMinifigsOther: '{count} मिनीफ़िग', wrappedInvested: 'निवेशित', wrappedSoldOne: '{count} सेट बेचा गया', wrappedSoldOther: '{count} सेट बेचे गए', wrappedSoldLabel: 'बेचा गया', wrappedBestLabel: 'सर्वश्रेष्ठ प्रदर्शन', wrappedBestCanvas: 'सर्वश्रेष्ठ प्रदर्शन', wrappedBestCanvasWithRoi: 'सर्वश्रेष्ठ प्रदर्शन · {roi}', wrappedLongestHeld: 'सबसे लंबे समय तक रखा: {name} ({year} से)', wrappedClose: 'बंद करें', wrappedShareYear: 'मेरा वर्ष साझा करें' });
Object.assign(hi.data, { reportPreparing: 'रिपोर्ट तैयार हो रही है…', insuranceReportTitle: 'BricksVault बीमा रिपोर्ट', reportSharedReady: 'रिपोर्ट तैयार है — खोलें और PDF में प्रिंट करें।', reportDownloadedReady: 'रिपोर्ट डाउनलोड हुई — खोलें और PDF में प्रिंट करें।', noSnapshotsYet: 'अभी कोई स्नैपशॉट नहीं — पहला अगले रविवार लिखा जाएगा।', backupsUnavailable: 'बैकअप अभी उपलब्ध नहीं हैं।', retryingSync: 'सिंक फिर से आज़माया जा रहा है…', guestVaultSynced: 'गेस्ट वॉल्ट सिंक हो गया', exportPreparing: 'निर्यात तैयार हो रहा है…', collectionExportTitle: 'BricksVault संग्रह साझा करें', guestExportShared: 'आपका स्थानीय गेस्ट निर्यात साझा या सहेजने के लिए तैयार है।', guestExportDownloaded: 'स्थानीय गेस्ट डेटा से निर्यात डाउनलोड हुआ।', syncedExportShared: 'आपका सिंक किया गया निर्यात साझा या सहेजने के लिए तैयार है।', syncedExportDownloaded: 'आपके सिंक किए गए वॉल्ट से निर्यात डाउनलोड हुआ।' });
// en.js declares `market` twice as an object literal, so the later one wins and
// keys added to the earlier block are silently dropped. Assigning after the fact
// lands on whichever object survived.
Object.assign(hi.market, { comps: '{n} तुलनीय बिक्रियाँ', slashComps: ' / {n} तुलनीय बिक्रियाँ', usedValue: 'इस्तेमाल किया हुआ: {price}', updated: '{date} को अपडेट किया गया', compsAboveMsrp: 'नए की बिक्री MSRP से {amount} ({pct}) ऊपर है।', compsBelowMsrp: 'नए की बिक्री MSRP से {amount} ({pct}) नीचे है।' });

Object.assign(hi.detail, { tagsMoreOne: '+{n} और', tagsMoreOther: '+{n} और' });
Object.assign(hi.market, { compsOne: '{n} तुलनीय बिक्री', compsOther: '{n} तुलनीय बिक्रियाँ', slashCompsOne: ' / {n} तुलनीय बिक्री', slashCompsOther: ' / {n} तुलनीय बिक्रियाँ' });

Object.assign(hi.settings, { appLockUnchanged: 'ऐप लॉक में बदलाव नहीं हुआ: {error}' });
Object.assign(hi.game, { checkGuessFailed: 'अनुमान जाँचा नहीं जा सका: {error}' });
Object.assign(hi.alerts, { sellOpportunityOne: 'बेचने का मौका · {n} दिन पहले', sellOpportunityOther: 'बेचने का मौका · {n} दिन पहले' });
Object.assign(hi.detail, { minifigsCountOne: '{n} मिनीफिगर', minifigsCountOther: '{n} मिनीफिगर' });
Object.assign(hi.market, { listingsOne: '{n} लिस्टिंग', listingsOther: '{n} लिस्टिंग', slashListingsOne: ' / {n} लिस्टिंग', slashListingsOther: ' / {n} लिस्टिंग', slashSamplesOne: ' / {n} नमूना', slashSamplesOther: ' / {n} नमूने' });
Object.assign(hi.scanner, { estimatedValue: '(~अनुमानित मूल्य)', marketGrabThreshold: 'बाज़ार {market} — {price} से कम पर शानदार सौदा{estimated}', underMarket: 'बाज़ार से {amount} कम{estimated}', withinMarket: 'बाज़ार के {pct}% के भीतर{estimated}', overMarket: 'बाज़ार से {amount} अधिक{estimated}' });

Object.assign(hi.admin, { llmUnavailable: 'LLM रूटिंग उपलब्ध नहीं', llmMergeBalance: 'इस माह शेष Merge क्रेडिट', llmMeteredNote: 'हर कॉल पर Merge द्वारा बताई गई लागत से गणना — आधिकारिक आँकड़ा उसका डैशबोर्ड है।', llmEffective: 'अभी चलता है', llmEffectiveNone: 'कोई कॉन्फ़िगर प्रदाता नहीं', llmLivePool: 'लाइव मुफ़्त पूल (स्वतः)', llmNoKey: 'कोई कुंजी नहीं', llmNoKeyHint: 'इस प्रदाता की कोई API कुंजी सेट नहीं है, इसलिए यह चरण रनटाइम पर छोड़ा जाता है।', llmMoveUp: 'चरण पहले ले जाएँ', llmMoveDown: 'चरण बाद में ले जाएँ', llmOn: 'चालू', llmOff: 'बंद', llmReset: 'डिफ़ॉल्ट पर लौटाएँ', llmSave: 'रूटिंग सहेजें', llmSaved: 'LLM रूटिंग सहेजी गई', llmSaveFailed: 'LLM रूटिंग सहेजी नहीं जा सकी', llmRefreshModels: 'Merge मॉडल ताज़ा करें', llmModelsRefreshedOne: '{n} Merge मॉडल ताज़ा किया', llmModelsRefreshedOther: '{n} Merge मॉडल ताज़ा किए', llmModelsFailed: 'Merge मॉडल कैटलॉग ताज़ा नहीं हो सका' });

Object.assign(hi.admin, { llmModelPlaceholder: "प्रदाता/मॉडल, जैसे openai/gpt-5.6-luna" });

Object.assign(hi.admin, { llmReload: "फिर से लोड करें", llmChooseModel: "मॉडल चुनें", llmCustomModel: "कस्टम मॉडल ID…", llmSpentOf: "{budget} में से {spent} खर्च", llmLivePoolShort: "मुफ़्त पूल", llmUnsaved: "असहेजे बदलाव", llmModelsOther: "अन्य", llmWorkload_scan: "फ़ोटो स्कैन", llmWorkload_advisor: "AI सलाहकार", llmWorkload_valuation: "मूल्यांकन", llmWorkload_listing: "लिस्टिंग ड्राफ़्ट" });

Object.assign(hi.admin, { llmLivePoolHint: "OpenRouter से रोज़ स्वतः अपडेट" });

Object.assign(hi.admin, { jobAccepted: '{label} स्वीकार किया गया; जल्द ही गतिविधि में दिखेगा', pricechartingBulkAccepted: 'PriceCharting बल्क डाउनलोड शुरू हो गया; परिणाम जल्द ही गतिविधि में दिखेंगे', pricechartingVerifyAccepted: 'PriceCharting सत्यापन शुरू हो गया; प्रोत्साहित मैपिंग के लिए गतिविधि देखें' });
Object.assign(hi.admin, { tools: { sets: 'सेट आयात करें', figs: 'मिनीफिगर आयात करें', upc: 'बारकोड भरें', populate: 'कवरेज भरें', revalue: 'कीमतों का पुनर्मूल्यांकन करें', everything: 'सभी सुरक्षित स्रोत भरें', pricechartingBulk: 'PriceCharting रीफ़्रेश करें (LEGO बल्क)', pricechartingVerify: 'PriceCharting मैपिंग सत्यापित करें', ebaySold: 'eBay बिक्री खोज चलाएँ' }, maintenanceTools: { expire: 'मूल्यांकन समाप्त करें', repair: 'खोज इंडेक्स सुधारें' }, countRunningOne: '{n} चल रहा है', countRunningFew: '{n} चल रहे हैं', countRunningMany: '{n} चल रहे हैं', countRunningOther: '{n} चल रहे हैं', countHealthyOne: '{n} ठीक है', countHealthyFew: '{n} ठीक हैं', countHealthyMany: '{n} ठीक हैं', countHealthyOther: '{n} ठीक हैं', countFailedOne: '{n} विफल', countFailedFew: '{n} विफल', countFailedMany: '{n} विफल', countFailedOther: '{n} विफल', countNotRunOne: '{n} अभी तक नहीं चला', countNotRunFew: '{n} अभी तक नहीं चले', countNotRunMany: '{n} अभी तक नहीं चले', countNotRunOther: '{n} अभी तक नहीं चले', completedSlicesOne: '{n} सुरक्षित चरण पूरा', completedSlicesFew: '{n} सुरक्षित चरण पूरे', completedSlicesMany: '{n} सुरक्षित चरण पूरे', completedSlicesOther: '{n} सुरक्षित चरण पूरे', filledOne: '{n} भरा गया', filledFew: '{n} भरे गए', filledMany: '{n} भरे गए', filledOther: '{n} भरे गए', processedOne: '{n} संसाधित', processedFew: '{n} संसाधित', processedMany: '{n} संसाधित', processedOther: '{n} संसाधित', figuresOne: '{n} मिनीफिगर', figuresFew: '{n} मिनीफिगर', figuresMany: '{n} मिनीफिगर', figuresOther: '{n} मिनीफिगर' });

Object.assign(hi.portfolio, { exploreBrick3d: '3D में देखें', exploreBrick3dLabel: 'BricksVault ब्रिक को 3D में देखें', loadingBrick3d: '3D लोड हो रहा है…' });

Object.assign(hi.portfolio, { stackVault: 'वॉल्ट सजाएँ', stackVaultLabel: '3D में वॉल्ट सजाएँ खेलें', stackVaultInstructions: 'ईंट सीध में आने पर टैप, क्लिक या स्पेस दबाएँ। 15 सेकंड में 6 ईंटें सजाएँ।', stackVaultProgress: '{target} में से {placed} ईंटें सजीं। {seconds} सेकंड बाकी।', stackVaultMiss: 'चूक गए — अगली ईंट को सीध में लाकर फिर कोशिश करें।', stackVaultWon: 'वॉल्ट सज गया! इसे असली बनाने के लिए अपना पहला सेट जोड़ें।', stackVaultLost: 'समय खत्म। अपना पहला सेट जोड़ें और असली वॉल्ट शुरू करें।' });

export default hi;
Object.assign(hi.detail, { movementUp: 'Up {pct}% over {days} days', movementDown: 'Down {pct}% over {days} days', movementResaleUp: ' · resale comps also rose', movementResaleDown: ' · resale comps also fell', movementMarketUp: ' · market guide also rose', movementMarketDown: ' · market guide also fell' });

