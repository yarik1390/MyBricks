/** Ukrainian. Missing keys fall back to English (see lib/i18n.js). */
export const uk = {
  nav: { vault: 'Сховище', catalog: 'Каталог', scan: 'Сканувати', minifigs: 'Мініфігурки', me: 'Я', badges: 'Значки' },
  common: {
    cancel: 'Скасувати', save: 'Зберегти', close: 'Закрити', retry: 'Спробувати ще',
    delete: 'Видалити', edit: 'Редагувати', done: 'Готово', undo: 'Повернути',
    loading: 'Завантаження…', search: 'Пошук', all: 'Усі', none: 'Немає',
    yes: 'Так', no: 'Ні', error: 'Щось пішло не так', offline: 'Ви офлайн',
    seeAll: 'Показати все', share: 'Поділитися',
    and: 'та',
  },
  settings: {
    title: 'Налаштування', language: 'Мова',
    languageDesc: 'Відповідає мові пристрою, доки ви не оберете іншу.', languageAuto: 'Автоматично ({name})',
    currency: 'Валюта', currencyDesc: 'Показувати вартість у вашій валюті.',
    market: 'Ринок', marketDesc: 'Локальний ринок для магазинних цін. Вартість перепродажу лишається в USD.',
    appearance: 'Вигляд', notifications: 'Сповіщення', signOut: 'Вийти',
  },
  detail: {
    value: 'Вартість', retired: 'Знято з виробництва', comingSoon: 'Незабаром', retiringSoon: 'Скоро знімуть з виробництва',
    pieces: 'деталей', minifigs: 'мініфігурок', retail: 'Роздрібна ціна',
    addToVault: 'До сховища', inVault: 'У сховищі', removeFromVault: 'Прибрати зі сховища',
    tabInfo: 'Інфо', tabForecast: 'Прогноз', tabCommunity: 'Спільнота',
    reliablePrice: 'Надійна ціна', pricingDetails: 'Деталі ціни', priceHistory: 'Історія цін',
    details: 'Деталі', estimated: 'Оцінка', year: 'Рік', theme: 'Тема',
    addToWishlist: 'До списку бажань', inWishlist: 'У списку бажань',
    addToVaultPrice: 'Додати до сховища · {price}', priceHistoryDays: 'Історія цін · {days} днів', priceHistoryShort: 'Історія цін · {days} дн.', fromSources: 'З {n} ринкових джерел', fromSourcesOne: 'З 1 ринкового джерела', typicalRange: ' · зазвичай {low}–{high}', likelyRange: ' · імовірно {low}-{high}', tagsMore: '+{n} ще', reviews: '{n} відгуків', reviewsOne: '1 відгук', up: 'Зростання {pct}%', down: 'Падіння {pct}%',
  },
  counts: {
    results: '{n} результатів', resultsOne: '1 результат', collected: '{owned}/{total} зібрано', owned: '{n} у власності', ofFigs: 'з {total} фігурок', figs: '{n} фігурок', figsOne: '1 фігурка',
  },
  market: {
    sellNowLabel: 'Продати зараз',
    fastSaleAfterFees: 'швидкий продаж після комісій',
    pctOfValue: '{pct}% від вартості',
    pctOfFairValue: '{pct}% від справедливої вартості',
    confidentlyPriced: '{pct}% оцінено впевнено',
    families: '{n} незалежних ринкових джерел',
    familyOne: '1 незалежне ринкове джерело',
    sales: '{n} перевірених продажів',
    saleOne: '1 перевірений продаж',
    estimateUnlocks: 'Оцінка «{list}» з’явиться, коли надійде більше даних про продажі.',
    estimatesUnlock: 'Оцінки «{list}» з’являться, коли надійде більше даних про продажі.',
    soldEvidenceHeadline: 'На основі {sales} з {markets}.',
    soldEvidenceFallback: 'Немає нещодавніх перевірених продажів — оцінка спирається на ціни пропозицій або ринкові довідники.',
    soldEvidenceTitle: 'Дані про продажі',
    soldEvidenceNewSealed: 'Новий і запечатаний',
    soldEvidenceUsedComplete: 'Вживаний і повний',
    soldEvidenceFresh: 'Нещодавній',
    soldEvidenceOlder: 'Старіший',
    soldEvidenceSalesOne: '1 перевірений продаж',
    soldEvidenceSalesFew: '{n} перевірені продажі',
    soldEvidenceSalesMany: '{n} перевірених продажів',
    soldEvidenceSalesOther: '{n} перевіреного продажу',
    soldEvidenceMarketplacesOne: '1 маркетплейс',
    soldEvidenceMarketplacesFew: '{n} маркетплейси',
    soldEvidenceMarketplacesMany: '{n} маркетплейсів',
    soldEvidenceMarketplacesOther: '{n} маркетплейсу',
    partOutVerdictPartout: 'Продаж по деталях вигідніший',
    partOutVerdictSealed: 'Продати запечатаним',
    partOutVerdictSame: 'Майже однаково',
    partOutSellSealed: 'Продати запечатаним',
    partOutSellParts: 'Продати по деталях',
    partOutDeltaPartout: 'на {pct} більше за вартість запечатаного набору',
    partOutDeltaSealed: 'вартість запечатаного набору на {pct} вища',
    partOutClose: 'значення майже однакові',
    partOutCoverage: 'оцінено {pct} деталей',
    sellingAbove: 'Продається приблизно на {pct} вище цієї вартості',
    sellingBelow: 'Продається приблизно на {pct} нижче цієї вартості',
  },
  card: {
    pieces: '{n} ДЕТ',
    perPiece: '{price}/дет',
    lots: '{n} лотів',
    deal: 'ЗНИЖКА {pct}',
    strongBuy: 'ВИГІДНО {pct}',
    forecast2y: '{price} 2 р.',
    gamePieces: '{n} деталей',
    gameRetail: 'ціна {price}',
  },
  deal: {
    buyRetail: 'У роздрібу доступний приблизно на {pct}% нижче ринкової вартості.',
    buyResale: 'Продається приблизно на {pct}% нижче ринкової вартості.',
    retiring: 'Скоро знімуть з виробництва — обмежене вікно для купівлі.',
    premiumRetail: 'Наразі оцінений вище ринкової вартості.',
    premiumResale: 'Ціни пропозиції вищі за ринкову вартість.',
    fair: 'Оцінений на рівні ринкової вартості.',
    labelBuy: 'КУПИТИ',
    labelStrongBuy: 'ВИГІДНО',
    labelFair: 'СПРАВЕДЛИВА ЦІНА',
    labelPremium: 'ВИЩЕ ВАРТОСТІ',
    labelPct: '{label} · {pct}%',
  },
  time: {
    unknown: 'невідомо', today: 'Сьогодні', yesterday: 'Учора', daysAgo: '{n} дн. тому',
  },
  me: {
    trophyShelf: 'Полиця трофеїв ({n}/6)',
  },
  kids: {
    xp: '{n} XP', xpToLevel: '{n} XP до рівня {level}', maxLevel: 'Максимальний рівень!', pcs: '{n} деталей', earned: '{n} з {total} отримано', setsToGo: 'Ще {n} наборів', setsToGoOne: 'Ще 1 набір!',
  },
  fees: {
    marketplace: 'Комісія маркетплейсу ({pct}%)', payment: 'Комісія за оплату ({pct}% + фікс.)',
  },
  alerts: {
    priceDrop: 'Зниження ціни · {days} дн. тому', targetWas: '— ваша ціль була {price}.',
  },
  game: {
    roundOf: 'Раунд {n} з {total}', pctOff: 'Ви помилилися на {pct}%', streakLine: '{day} · серія {streak} · рекорд {best}',
  },
  build: {
    needParts: 'Потрібно ще {n} деталей', ofOwnedSets: 'з {n} наборів у власності', indexing: 'Індексуємо ще {n} набір(ів) у фоні…',
  },
  catalog: {
    title: 'Каталог', searchPlaceholder: 'Знайти набір', results: '{count} наборів',
    sortValue: 'Вартість', sortGrowth: 'Зростання', sortNewest: 'Найновіше', sortTrending: 'У тренді',
    noResults: 'Наборів не знайдено', filters: 'Фільтри', filtersWithCount: 'Фільтри · {n}', sort: 'Сортувати', clearFilters: 'Скинути фільтри',
  },
  community: {
    pendingSubmissionOne: '⏳ У вас {n} заявка очікує схвалення.',
    pendingSubmissionMany: '⏳ У вас {n} заявок очікують схвалення.',
  },
  contributions: {
    approvedOne: '{n} схвалений внесок',
    approvedMany: '{n} схвалених внесків',
    contributorBadge: ' · ⭐ Учасник',
  },
  admin: {
    uploadingFile: 'Завантаження {file}…',
    importedMinifigs: 'Імпортовано {inserted} з {parsed} мініфігурок. Їх буде зіставлено з цінами під час оцінювання.',
    uploadFailed: 'Помилка: {error}',
    lastRun: 'останній запуск {when}{duration}',
  },
  downloads: {
    interrupted: 'Завантаження перервано на {pct}% — торкніться «Продовжити», щоб продовжити.',
    resume: 'Продовжити ({pct})',
    scanProgress: 'Розпізнавання {current} з {total}…',
  },
  vault: {
    title: 'Сховище', empty: 'Ваше сховище порожнє', emptyDesc: 'Додайте набір, щоб стежити за його вартістю.',
    setsOwned: 'Наборів у власності', totalValue: 'Загальна вартість', invested: 'Вкладено', gain: 'Прибуток', addSet: 'Додати набір',
    investedAmount: 'Вкладено {amount}',
  },
  wishlist: {
    title: 'Список бажань', empty: 'Ваш список бажань порожній', targetPrice: 'Бажана ціна',
    priceDropAlert: 'Сповістити про зниження ціни', remove: 'Прибрати зі списку бажань',
    setsCount: '{n} наборів', setsCountOne: '1 набір', alertsCount: '{n} сповіщень', alertsCountOne: '1 сповіщення', nowPrice: 'Зараз {price}',
  },
};
Object.assign(uk.catalog, { filtersWithCount: 'Фільтри · {n}' });
uk.community = { pendingSubmissionOne: '⏳ У вас {n} заявка очікує схвалення.', pendingSubmissionFew: '⏳ У вас {n} заявки очікують схвалення.', pendingSubmissionMany: '⏳ У вас {n} заявок очікують схвалення.', pendingSubmissionOther: '⏳ У вас {n} заявки очікують схвалення.' };
uk.contributions = { approvedOne: '{n} схвалений внесок', approvedFew: '{n} схвалені внески', approvedMany: '{n} схвалених внесків', approvedOther: '{n} схвалені внески', contributorBadge: ' · ⭐ Учасник' };
uk.admin = { uploadingFile: 'Завантаження {file}…', importedMinifigs: 'Імпортовано {inserted} з {parsed} мініфігурок. Їх буде зіставлено з цінами під час оцінювання.', uploadFailed: 'Помилка: {error}', lastRun: 'останній запуск {when}{duration}' };
uk.downloads = { interrupted: 'Завантаження перервано на {pct}% — торкніться «Продовжити», щоб продовжити.', resume: 'Продовжити ({pct})', scanProgress: 'Розпізнавання {current} з {total}…' };
Object.assign(uk.detail, { acquired: 'Придбано {date}{source}' });
Object.assign(uk.wishlist, { targetPriceCurrency: 'Цільова ціна ({symbol})', suggestedPrice: 'Рекомендовано: {price}' });
Object.assign(uk.wishlist, { ackAlert: 'Сховати сповіщення про цільову ціну', alertAcked: 'Сповіщення приховано' });
uk.minifigs = { appearsInSetsOne: 'Є в {n} наборі', appearsInSetsFew: 'Є в {n} наборах', appearsInSetsMany: 'Є в {n} наборах', appearsInSetsOther: 'Є в {n} наборі' };
Object.assign(uk.admin, { syncJobRunning: '{label}: виконується…', syncJobSkipped: 'пропущено — {n}', syncJobSummary: 'оброблено {processed}, оновлено {updated}, відхилено {rejected}', syncJobResult: '{label}: {summary}', syncJobFailed: '{label} не вдалося: {error}', uploadSuccessToast: 'Каталог мініфігурок BrickLink: імпортовано {inserted}', uploadErrorToast: 'Не вдалося завантажити каталог: {error}', countRunning: '{n} виконується', countHealthy: '{n} справні', countFailed: '{n} з помилкою', countNotRun: '{n} ще не запускалися', completedSlices: '{n} безпечних етапів завершено', jobId: 'Завдання #{id}', filled: '{n} заповнено', processed: '{n} оброблено', figures: '{n} мініфігурок', noItemsProcessed: 'Нічого не оброблено' });
Object.assign(uk.admin, { jobStarted: 'Завдання #{id} запущено', jobFailed: 'Помилка завдання: {error}', maintenanceComplete: '{label} завершено', maintenanceFailed: '{label} не вдалося: {error}', lastSeen: 'востаннє помічено {when}' });
Object.assign(uk.admin, { tools: { sets: 'Імпортувати набори', figs: 'Імпортувати мініфігурки', upc: 'Доповнити штрихкоди', populate: 'Заповнити покриття', revalue: 'Переоцінити ціни', everything: 'Заповнити всі безпечні джерела', pricechartingBulk: 'Оновити PriceCharting (LEGO гуртом)', pricechartingVerify: 'Перевірити відповідності PriceCharting', pricesapi: 'Запустити pricesAPI зараз', ebaySold: 'Запустити пошук продажів eBay' }, maintenanceTools: { expire: 'Позначити оцінки застарілими', repair: 'Відновити пошуковий індекс' }, countRunningOne: '{n} виконується', countRunningFew: '{n} виконуються', countRunningMany: '{n} виконуються', countRunningOther: '{n} виконуються', countHealthyOne: '{n} справний', countHealthyFew: '{n} справні', countHealthyMany: '{n} справних', countHealthyOther: '{n} справні', countFailedOne: '{n} з помилкою', countFailedFew: '{n} з помилками', countFailedMany: '{n} з помилками', countFailedOther: '{n} з помилками', countNotRunOne: '{n} ще не запускався', countNotRunFew: '{n} ще не запускалися', countNotRunMany: '{n} ще не запускалися', countNotRunOther: '{n} ще не запускалися', completedSlicesOne: '{n} безпечний етап завершено', completedSlicesFew: '{n} безпечні етапи завершено', completedSlicesMany: '{n} безпечних етапів завершено', completedSlicesOther: '{n} безпечного етапу завершено', filledOne: '{n} заповнено', filledFew: '{n} заповнено', filledMany: '{n} заповнено', filledOther: '{n} заповнено', processedOne: '{n} оброблено', processedFew: '{n} оброблено', processedMany: '{n} оброблено', processedOther: '{n} оброблено', figuresOne: '{n} мініфігурка', figuresFew: '{n} мініфігурки', figuresMany: '{n} мініфігурок', figuresOther: '{n} мініфігурки' });
Object.assign(uk.detail, { uploadFailed: 'Не вдалося завантажити: {error}', removeFailed: 'Не вдалося видалити: {error}', forecastUpside: 'прогноз має ще ~{pct} потенціалу зростання' }); uk.data = { reportFailed: 'Не вдалося створити звіт: {error}', restoreFailed: 'Не вдалося відновити: {error}', retryFailed: 'Не вдалося повторити: {error}', exportFailed: 'Не вдалося експортувати: {error}', importFailed: 'Не вдалося імпортувати: {error}', bricklinkImportFailed: 'Не вдалося імпортувати з BrickLink: {error}' }; uk.integrations = { bricksetSyncFailed: 'Не вдалося синхронізувати Brickset: {error}' }; uk.scanner = { timedOut: 'Занадто довго — спробуйте ще раз.', timedOutShort: 'Час вийшов', scanFailed: 'Помилка: {error}' };
Object.assign(uk.common, { errorWithDetails: 'Помилка: {error}' }); Object.assign(uk.integrations, { bricksetSyncResult: 'Імпортовано {added} наборів ({skipped} поза каталогом, усього на Brickset: {total}).', bricksetSyncSuccess: 'Синхронізація Brickset: додано {added} наборів' }); Object.assign(uk.scanner, { bulkPartial: 'Додано {added} з {total} — {failed} з помилкою, спробуйте ще раз', addSetsFailed: 'Не вдалося додати набори: {error}' }); uk.portfolio = { collectionLoadFailed: 'Не вдалося завантажити сховище: {error}', bulkRemovePartial: 'Вилучено {removed} з {total} — {failed} з помилкою, спробуйте ще раз', restoredCount: 'Відновлено {restored} з {total}' };
Object.assign(uk.settings, { currencyUpdated: 'Валюту змінено на {currency}' });
Object.assign(uk.common, { offlineActionsSynced: '{count} офлайн-дій синхронізовано', offlineActionsDiscarded: '{count} офлайн-дій не вдалося синхронізувати, їх видалено', localItemsSynced: 'Синхронізовано локальних елементів: {count}', kidsXp: '+{xp} XP! {level} {badge}', copied: '{label} скопійовано' }); Object.assign(uk.admin, { serviceTestResult: '{head} — {detail} ({ms} мс)', providerStatus: '{provider}: {status}', serviceTestFailed: 'Помилка: {error}', providerTestFailed: 'Тест {provider} не пройдено', featureFlagStatus: '{flag}: {status}{suffix}', featureFlagUpdateFailed: 'Не вдалося оновити {flag}: {error}', providerSaved: '{provider} збережено.', providerSaveFailed: 'Помилка збереження {provider}: {error}', pricingConfigLoadFailed: 'Не вдалося завантажити налаштування цін: {error}', resetFailed: 'Не вдалося скинути: {error}', contributionAction: '{action} — {applied}', enabled: 'увімкнено', disabled: 'вимкнено', approved: 'Схвалено', rejected: 'Відхилено' }); Object.assign(uk.minifigs, { ownedCount: 'У власності: {count}' }); Object.assign(uk.data, { restoredFromBackup: 'Відновлено {count} наборів від {date}', migrationStillFailing: 'Ще {count} елементів не вдалося перенести: {error}', migrationComplete: 'Готово — синхронізовано {count} елементів.', importResult: '✓ імпортовано {imported}, пропущено {skipped}, помилок: {errors}', setsImported: 'Імпортовано {count} наборів', bricklinkImportResult: '✓ додано {added} наборів, пропущено {skipped}. {errors}', bricklinkSetsImported: 'Імпортовано {count} наборів із замовлень BrickLink' }); Object.assign(uk.integrations, { keyRemoved: 'Ключ {label} видалено', keyVerified: 'Ключ {label} перевірено й збережено' }); Object.assign(uk.scanner, { setNotFound: 'Набір {setNum} не знайдено в каталозі.', localAiOfflineFailed: 'Локальний ШІ не спрацював, а ви офлайн: {error}', addItemFailed: 'Не вдалося додати {name}: {error}', minifig: 'мініфігурка', itemsAdded: 'Додано {count} елементів до сховища', itemsSavedOffline: 'Збережено офлайн: {count} — буде синхронізовано', setsSavedOffline: 'Збережено офлайн {count} наборів — буде синхронізовано після підключення' }); Object.assign(uk.portfolio, { soldFor: 'Продано за {price} — вилучено зі сховища' });
Object.assign(uk.common, { offlineActionsSyncedOne: 'Синхронізовано {count} офлайн-дію', offlineActionsSyncedFew: 'Синхронізовано {count} офлайн-дії', offlineActionsSyncedMany: 'Синхронізовано {count} офлайн-дій', offlineActionsSyncedOther: 'Синхронізовано {count} офлайн-дії', offlineActionsDiscardedOne: '{count} офлайн-дію не вдалося синхронізувати, її видалено', offlineActionsDiscardedFew: '{count} офлайн-дії не вдалося синхронізувати, їх видалено', offlineActionsDiscardedMany: '{count} офлайн-дій не вдалося синхронізувати, їх видалено', offlineActionsDiscardedOther: '{count} офлайн-дії не вдалося синхронізувати, їх видалено', localItemsSyncedOne: 'Синхронізовано {count} локальний елемент', localItemsSyncedFew: 'Синхронізовано {count} локальні елементи', localItemsSyncedMany: 'Синхронізовано {count} локальних елементів', localItemsSyncedOther: 'Синхронізовано {count} локальні елементи', kidsXp: '+{xp} XP!{details}', kidsXpLevel: ' Рівень {level}!', kidsXpBadge: ' · Значок: {badge}! 🎉' }); Object.assign(uk.scanner, { itemsAddedOne: 'Додано {count} елемент до сховища', itemsAddedFew: 'Додано {count} елементи до сховища', itemsAddedMany: 'Додано {count} елементів до сховища', itemsAddedOther: 'Додано {count} елементи до сховища', itemsSavedOfflineOne: 'Збережено офлайн {count} елемент — буде синхронізовано', itemsSavedOfflineFew: 'Збережено офлайн {count} елементи — буде синхронізовано', itemsSavedOfflineMany: 'Збережено офлайн {count} елементів — буде синхронізовано', itemsSavedOfflineOther: 'Збережено офлайн {count} елементи — буде синхронізовано', setsSavedOfflineOne: 'Збережено офлайн {count} набір — буде синхронізовано після підключення', setsSavedOfflineFew: 'Збережено офлайн {count} набори — буде синхронізовано після підключення', setsSavedOfflineMany: 'Збережено офлайн {count} наборів — буде синхронізовано після підключення', setsSavedOfflineOther: 'Збережено офлайн {count} набори — буде синхронізовано після підключення' }); Object.assign(uk.portfolio, { wishlistAlertsTooltip: 'Сповіщення списку бажань ({spikes} стрибків, {drops} знижень ціни)', bulkLocationPartial: 'Оновлено {updated} з {total} — {failed} не вдалося, повторіть їх' });
Object.assign(uk.data, { restoredFromBackupOne: 'Відновлено {count} набір від {date}', restoredFromBackupFew: 'Відновлено {count} набори від {date}', restoredFromBackupMany: 'Відновлено {count} наборів від {date}', restoredFromBackupOther: 'Відновлено {count} набори від {date}' }); Object.assign(uk.integrations, { bricksetSyncResultOne: 'Імпортовано {count} набір ({skipped} поза каталогом, у Brickset всього {total}).', bricksetSyncResultFew: 'Імпортовано {count} набори ({skipped} поза каталогом, у Brickset всього {total}).', bricksetSyncResultMany: 'Імпортовано {count} наборів ({skipped} поза каталогом, у Brickset всього {total}).', bricksetSyncResultOther: 'Імпортовано {count} набори ({skipped} поза каталогом, у Brickset всього {total}).', bricksetSyncSuccessOne: 'Синхронізація Brickset: додано {count} набір', bricksetSyncSuccessFew: 'Синхронізація Brickset: додано {count} набори', bricksetSyncSuccessMany: 'Синхронізація Brickset: додано {count} наборів', bricksetSyncSuccessOther: 'Синхронізація Brickset: додано {count} набори' }); Object.assign(uk.wishlist, { unreadAlertsOne: '{count} непрочитане сповіщення', unreadAlertsFew: '{count} непрочитані сповіщення', unreadAlertsMany: '{count} непрочитаних сповіщень', unreadAlertsOther: '{count} непрочитані сповіщення' }); Object.assign(uk.portfolio, { wishlistAlertsTooltip: 'Сповіщення списку бажань ({spikes}, {drops})', wishlistAlertSpikesOne: '{count} стрибок', wishlistAlertSpikesFew: '{count} стрибки', wishlistAlertSpikesMany: '{count} стрибків', wishlistAlertSpikesOther: '{count} стрибки', wishlistAlertDropsOne: '{count} зниження ціни', wishlistAlertDropsFew: '{count} зниження ціни', wishlistAlertDropsMany: '{count} знижень ціни', wishlistAlertDropsOther: '{count} зниження ціни', insightSignal: 'Перепродаж {direction}{pct}% проти {basis}{quantity}', insightMarket: 'ринку', insightValue: 'вартості', insightQuantity: ' · ×{count}' });
Object.assign(uk.kids, { badgeCelebration: 'Нова відзнака: {badge}! 🎉', badgeQuip: 'Ти зірка будівництва! 🌟', levelCelebration: 'Досягнуто рівня {level}! 🎉', levelQuip: 'Продовжуй будувати! 🧱', badgeFirstBrick: 'Перша цеглинка!', badgeJuniorBuilder: 'Юний будівельник', badgeArchitect: 'Архітектор', badgeMaster: 'Майстер-будівельник', badgeGrandMaster: 'Гранд-майстер', badgeLegend: 'Легендарний!' });
Object.assign(uk.data, { csvImportConfirmTitleOne: 'Імпортувати 1 набір?', csvImportConfirmTitleOther: 'Імпортувати {count} наборів?', csvImportMore: ' і ще {count}', csvImportConfirmMessage: 'Починаючи з: {sample}{more}. Наявні набори буде збережено.', importConfirm: 'Імпортувати' });
Object.assign(uk.scanner, { setNumberMatched: 'Номер набору знайдено в каталозі.' });
Object.assign(uk.portfolio, { insightHeadlineOne: '≈ {value} потенціалу від продажу 1 набору зараз', insightHeadlineOther: '≈ {value} потенціалу від продажу {count} наборів зараз' });
Object.assign(uk.market, { goodTimeToSell: 'Вдалий час продавати', goodTimeToBuy: 'Вдалий час купувати', onlyForSale: 'Зараз у продажу лише {count}', askingHighHint: 'Продавці просять високу ціну — виставляйте близько до останньої ціни продажу для швидкого продажу', askingLowHint: 'Виставлено нижче за останні ціни продажу — вдалий час купувати', askingSummary: 'У продажу {count} · ціна {asking}', askingSummaryWithSold: 'У продажу {count} · ціна {asking}, нещодавно продано за {sold}' });
Object.assign(uk.game, { marketGenius: '{score}/5 — market genius! 🎯', streakQuipOne: 'Streak: {count} day.', streakQuipOther: 'Streak: {count} days.' }); uk.market = Object.assign(uk.market || {}, { sellingAbove: 'Selling about {pct} above this value', sellingBelow: 'Selling about {pct} below this value' }); Object.assign(uk.scanner, { findingSet: 'Finding set...', lookingUpSet: 'Looking up {setNum} in the catalog.' });
Object.assign(uk.game, { marketGenius: '{score}/5 — геній ринку! 🎯', streakQuipOne: 'Серія: {count} день.', streakQuipOther: 'Серія: {count} днів.' });
Object.assign(uk.market, { sellingAbove: 'Продається приблизно на {pct} дорожче за цю вартість', sellingBelow: 'Продається приблизно на {pct} дешевше за цю вартість' }); Object.assign(uk.scanner, { findingSet: 'Шукаємо набір…', lookingUpSet: 'Шукаємо {setNum} у каталозі.', bulkMatched: 'Збігів: {matched} з {total}' }); Object.assign(uk.game, { revealCorrect: '🎯 Влучно! — це {value}', revealIncorrect: 'Майже — це {value}' }); Object.assign(uk.catalog, { activeFiltersOne: '1 активний', activeFiltersOther: '{count} активних' }); Object.assign(uk.portfolio, { anniversaryGain: 'Куплено за {paid} — відтоді зросло на {gain}.', anniversaryNoGain: 'Куплено за {paid}. Деякі набори — для душі, а не для прибутку.', anniversaryQuip: 'За будуванням час летить.', anniversaryCelebrationOne: '1 рік з {set}! 🎂', anniversaryCelebrationOther: '{count} років з {set}! 🎂' });
Object.assign(uk.market, { partsCoverage: 'Покриття деталей: {pct}%', forecastScenarios: 'Песимістично {bear} · База {base} · Оптимістично {bull}', salesSuffix: ' / {count} продажів', newSold: 'Новий продано', usedSold: 'Вживаний продано', viewOnBrickLink: 'Переглянути на BrickLink' }); Object.assign(uk.catalog, { loadFailedDetail: '{error}. Перевірте з’єднання та спробуйте ще раз.' }); Object.assign(uk.portfolio, { moreThemesOne: '+1 тема', moreThemesOther: '+{count} тем', sealedParts: 'Запечатаний {sealed} · {approximate}Деталі {parts}' }); uk.advisor = Object.assign(uk.advisor || {}, { moreThemesOne: '+1 інша тема у вашому сховищі', moreThemesOther: '+{count} інших тем у вашому сховищі' });
Object.assign(uk.game, { loadFailed: 'Не вдалося завантажити сьогоднішню гру: {error}' }); Object.assign(uk.contributions, { loadFailed: 'Не вдалося завантажити: {error}' }); Object.assign(uk.me, { wrappedLoadFailed: 'Не вдалося завантажити ваш рік: {error}', wrappedValueChange: 'Сховище цього року {direction} на {value}', wrappedUp: 'зросло', wrappedDown: 'знизилося' });
Object.assign(uk.catalog, { filterSummaryNone: 'Немає активних фільтрів', filterSummaryActiveOne: '{count} активний: {items}', filterSummaryActiveFew: '{count} активні: {items}', filterSummaryActiveMany: '{count} активних: {items}', filterSummaryActiveOther: '{count} активних: {items}', filterSummarySearch: 'Пошук «{value}»', filterSummaryStatusRetired: 'Лише зняті з виробництва', filterSummaryStatusActive: 'Лише активні', filterSummaryStatusRetiring: 'Скоро знімуть з виробництва', filterSummaryDeal: 'Лише вигідні пропозиції', filterSummaryRangeYear: 'Рік', filterSummaryRangePieces: 'Деталі', filterSummaryRangeValue: 'Вартість', filterSummaryRangeBetween: '{label} {min}–{max}', filterSummaryRangeMin: '{label} ≥ {value}', filterSummaryRangeMax: '{label} ≤ {value}', filterSummaryPiecesValue: '{value} деталей', filterSummaryValueAmount: '{value} US$' });
Object.assign(uk.minifigs, { filterSummaryNone: 'Немає активних фільтрів', filterSummaryActiveOne: '{count} активний: {items}', filterSummaryActiveFew: '{count} активні: {items}', filterSummaryActiveMany: '{count} активних: {items}', filterSummaryActiveOther: '{count} активних: {items}', filterSummarySearch: 'Пошук «{value}»', filterSummaryRarity: 'Рідкісність: {rarity}', filterSummaryRarityCommon: 'Звичайна', filterSummaryRarityUncommon: 'Незвичайна', filterSummaryRarityRare: 'Рідкісна', filterSummaryRarityLegendary: 'Легендарна', filterSummaryOwned: 'Лише у власності', filterSummaryUnowned: 'Лише не у власності', appearsInSetsOne: 'Є в {n} наборі', appearsInSetsFew: 'Є в {n} наборах', appearsInSetsMany: 'Є в {n} наборах', appearsInSetsOther: 'Є в {n} наборі' });
Object.assign(uk.catalog, { activeFiltersOne: '1 активний', activeFiltersFew: '{count} активні', activeFiltersMany: '{count} активних', activeFiltersOther: '{count} активних' });
Object.assign(uk.advisor, { moreThemesOne: '+1 інша тема у вашому сховищі', moreThemesFew: '+{count} інші теми у вашому сховищі', moreThemesMany: '+{count} інших тем у вашому сховищі', moreThemesOther: '+{count} інших тем у вашому сховищі' });
Object.assign(uk.game, { streakQuipOne: 'Серія: {count} день.', streakQuipFew: 'Серія: {count} дні.', streakQuipMany: 'Серія: {count} днів.', streakQuipOther: 'Серія: {count} дня.' });
Object.assign(uk.data, { csvImportConfirmTitleOne: 'Імпортувати 1 набір?', csvImportConfirmTitleFew: 'Імпортувати {count} набори?', csvImportConfirmTitleMany: 'Імпортувати {count} наборів?', csvImportConfirmTitleOther: 'Імпортувати {count} набору?' });
Object.assign(uk.contributions, { approvedOne: '{n} схвалений внесок', approvedFew: '{n} схвалені внески', approvedMany: '{n} схвалених внесків', approvedOther: '{n} схвалених внесків' });
Object.assign(uk.community, { pendingSubmissionOne: '⏳ У вас {n} заявка очікує схвалення.', pendingSubmissionFew: '⏳ У вас {n} заявки очікують схвалення.', pendingSubmissionMany: '⏳ У вас {n} заявок очікують схвалення.', pendingSubmissionOther: '⏳ У вас {n} заявок очікують схвалення.' });
Object.assign(uk.portfolio, { anniversaryCelebrationOne: '1 рік з {set}! 🎂', anniversaryCelebrationFew: '{count} роки з {set}! 🎂', anniversaryCelebrationMany: '{count} років з {set}! 🎂', anniversaryCelebrationOther: '{count} року з {set}! 🎂', insightHeadlineOne: '≈ {value} потенціалу від продажу 1 набору зараз', insightHeadlineFew: '≈ {value} потенціалу від продажу {count} наборів зараз', insightHeadlineMany: '≈ {value} потенціалу від продажу {count} наборів зараз', insightHeadlineOther: '≈ {value} потенціалу від продажу {count} набору зараз', moreThemesOne: '+1 тема', moreThemesFew: '+{count} теми', moreThemesMany: '+{count} тем', moreThemesOther: '+{count} тем' });
Object.assign(uk.catalog, { emptySearchResults: 'Нічого не знайдено за запитом «{query}». Спробуйте інший запит або очистьте фільтри.', emptyFilteredResults: 'Жоден набір не відповідає цим фільтрам. Спробуйте інший запит або очистьте фільтри.' });
Object.assign(uk.advisor, { retiredSetsOfTotalOne: '{retired} з {total} набору знято з виробництва', retiredSetsOfTotalFew: '{retired} з {total} наборів знято з виробництва', retiredSetsOfTotalMany: '{retired} з {total} наборів знято з виробництва', retiredSetsOfTotalOther: '{retired} з {total} набору знято з виробництва' });
Object.assign(uk.scanner, { duplicateConfirmTitle: 'Уже у власності', duplicateConfirmMessage: 'У вашому сховищі вже є {names}. Додати ще один екземпляр?', duplicateConfirmAction: 'Усе одно додати' });
Object.assign(uk.scanner, { minifigWithSeries: '{minifig} · серія {series}', minifigWithRarity: '{minifig} — рідкісність: {rarity}', rarityUnknown: 'Невідома' });
Object.assign(uk.admin, { jobAccepted: '{label} прийнято й незабаром з’явиться в Активності', pricechartingBulkAccepted: 'Гуртове завантаження PriceCharting розпочато — результати незабаром з’являться в Активності', pricechartingVerifyAccepted: 'Перевірку PriceCharting розпочато — підтверджені відповідності дивіться в Активності', pricesapiAccepted: 'Оновлення pricesAPI розпочато — результат дивіться в Активності' });
Object.assign(uk.scanner, { setsFoundOne: 'Знайдено {count} набір', setsFoundFew: 'Знайдено {count} набори', setsFoundMany: 'Знайдено {count} наборів', setsFoundOther: 'Знайдено {count} набору', minifigsFoundOne: 'Знайдено {count} мініфігурку', minifigsFoundFew: 'Знайдено {count} мініфігурки', minifigsFoundMany: 'Знайдено {count} мініфігурок', minifigsFoundOther: 'Знайдено {count} мініфігурки', mixedResultsFoundOne: 'Знайдено {count} результат (набори й мініфігурки)', mixedResultsFoundFew: 'Знайдено {count} результати (набори й мініфігурки)', mixedResultsFoundMany: 'Знайдено {count} результатів (набори й мініфігурки)', mixedResultsFoundOther: 'Знайдено {count} результату (набори й мініфігурки)', confidenceHigh: 'Висока впевненість', confidenceMedium: 'Середня впевненість', confidenceLow: 'Низька впевненість', confidenceUnknown: 'Впевненість у збігу недоступна', matchHigh: 'Високий збіг', matchMedium: 'Середній збіг', matchLow: 'Низький збіг', match: 'Збіг' });
Object.assign(uk.detail, { sellReasonGainSincePurchase: 'Зростання на {roi} від покупки', sellReasonTrendDown: 'Ціновий тренд пішов униз', sellReasonClimbFlattened: 'Зростання ціни сповільнилося', sellReasonLittleUpside: 'Залишилося лише {upside} прогнозованого зростання', sellReasonSellsFast: '{volume} недавніх продажів свідчать про швидкий продаж', sellReasonWatchClosely: 'Уважно стежте за ринком', sellReasonStillClimbing: 'Ціна й далі зростає', sellReasonForecastUpside: 'Прогноз дає ще {upside} потенціалу', sellReasonNotRetired: 'Ще не знято з виробництва', sellReasonNoSellTrigger: 'Поки немає чіткого сигналу для продажу' });
Object.assign(uk.data, { migrationStillFailingOne: 'Ще {count} елемент не вдалося перенести: {error}', migrationStillFailingFew: 'Ще {count} елементи не вдалося перенести: {error}', migrationStillFailingMany: 'Ще {count} елементів не вдалося перенести: {error}', migrationStillFailingOther: 'Ще {count} елемента не вдалося перенести: {error}', migrationCompleteOne: 'Готово — синхронізовано {count} елемент.', migrationCompleteFew: 'Готово — синхронізовано {count} елементи.', migrationCompleteMany: 'Готово — синхронізовано {count} елементів.', migrationCompleteOther: 'Готово — синхронізовано {count} елемента.', setsImportedOne: 'Імпортовано {count} набір', setsImportedFew: 'Імпортовано {count} набори', setsImportedMany: 'Імпортовано {count} наборів', setsImportedOther: 'Імпортовано {count} набору', bricklinkSetsImportedOne: 'Імпортовано {count} набір із замовлень BrickLink', bricklinkSetsImportedFew: 'Імпортовано {count} набори із замовлень BrickLink', bricklinkSetsImportedMany: 'Імпортовано {count} наборів із замовлень BrickLink', bricklinkSetsImportedOther: 'Імпортовано {count} набору із замовлень BrickLink' });
Object.assign(uk.detail, { sellReasonSellsFastOne: '{volume} недавній продаж свідчить про швидкий продаж', sellReasonSellsFastFew: '{volume} недавні продажі свідчать про швидкий продаж', sellReasonSellsFastMany: '{volume} недавніх продажів свідчать про швидкий продаж', sellReasonSellsFastOther: '{volume} недавнього продажу свідчать про швидкий продаж' });
Object.assign(uk.minifigs, { setExclusive: 'Лише в цьому наборі', inSetsOne: 'У {count} наборі', inSetsFew: 'У {count} наборах', inSetsMany: 'У {count} наборах', inSetsOther: 'У {count} наборі', partsOne: '{count} деталь', partsFew: '{count} деталі', partsMany: '{count} деталей', partsOther: '{count} деталі' });
Object.assign(uk.minifigs, { emptySearchResults: 'Нічого не знайдено за запитом «{query}».', emptyFilteredResults: 'Жодна мініфігурка не відповідає цим фільтрам.' });
Object.assign(uk.detail, { partsComplete: 'Повний', partsMissingOne: 'Не вистачає {count} деталі', partsMissingFew: 'Не вистачає {count} деталей', partsMissingMany: 'Не вистачає {count} деталей', partsMissingOther: 'Не вистачає {count} деталі', allPartsPresent: 'усі деталі наявні' });
Object.assign(uk.build, { needPartsOne: 'Потрібна ще {n} деталь', needPartsFew: 'Потрібні ще {n} деталі', needPartsMany: 'Потрібно ще {n} деталей', needPartsOther: 'Потрібно ще {n} деталі' });
Object.assign(uk.card, { lotsOne: '{n} лот', lotsFew: '{n} лоти', lotsMany: '{n} лотів', lotsOther: '{n} лота' });
Object.assign(uk.market, { salesSuffixOne: ' / {count} продаж', salesSuffixFew: ' / {count} продажі', salesSuffixMany: ' / {count} продажів', salesSuffixOther: ' / {count} продажу' });
Object.assign(uk.data, { importedCountOne: 'Імпортовано {n} набір', importedCountFew: 'Імпортовано {n} набори', importedCountMany: 'Імпортовано {n} наборів', importedCountOther: 'Імпортовано {n} набору', skippedCountOne: 'Пропущено {n} набір', skippedCountFew: 'Пропущено {n} набори', skippedCountMany: 'Пропущено {n} наборів', skippedCountOther: 'Пропущено {n} набору', errorsCountOne: '{n} помилка', errorsCountFew: '{n} помилки', errorsCountMany: '{n} помилок', errorsCountOther: '{n} помилки', setsAddedCountOne: 'Додано {n} набір', setsAddedCountFew: 'Додано {n} набори', setsAddedCountMany: 'Додано {n} наборів', setsAddedCountOther: 'Додано {n} набору', importResult: '✓ {imported} · {skipped} · {errors}', bricklinkImportResult: '✓ {added} · {skipped}. {errors}' });
Object.assign(uk.admin, { minifigsImportedOne: '{n} мініфігурку', minifigsImportedFew: '{n} мініфігурки', minifigsImportedMany: '{n} мініфігурок', minifigsImportedOther: '{n} мініфігурки', minifigsParsedOne: '{n} мініфігурки', minifigsParsedFew: '{n} мініфігурок', minifigsParsedMany: '{n} мініфігурок', minifigsParsedOther: '{n} мініфігурки', importedMinifigs: 'Імпортовано {inserted} з {parsed}. Їх буде зіставлено з цінами під час оцінювання.' });
Object.assign(uk.time, { daysAgoOne: '{n} день тому', daysAgoFew: '{n} дні тому', daysAgoMany: '{n} днів тому', daysAgoOther: '{n} дня тому' });
Object.assign(uk.scanner, { bulkPartialOne: 'Додано {added} з {total} — {failed} не вдалося, повторіть', bulkPartialFew: 'Додано {added} з {total} — {failed} не вдалося, повторіть', bulkPartialMany: 'Додано {added} з {total} — {failed} не вдалося, повторіть', bulkPartialOther: 'Додано {added} з {total} — {failed} не вдалося, повторіть' });
Object.assign(uk.kids, { setsToGoOne: 'Залишився {n} набір', setsToGoFew: 'Залишилося {n} набори', setsToGoMany: 'Залишилося {n} наборів', setsToGoOther: 'Залишилося {n} набору', earnedOne: 'Отримано {n} з {total}', earnedFew: 'Отримано {n} з {total}', earnedMany: 'Отримано {n} з {total}', earnedOther: 'Отримано {n} з {total}' });
Object.assign(uk.market, { familiesOne: '{n} незалежне ринкове джерело', familiesFew: '{n} незалежні ринкові джерела', familiesMany: '{n} незалежних ринкових джерел', familiesOther: '{n} незалежного ринкового джерела', salesOne: '{n} перевірений продаж', salesFew: '{n} перевірені продажі', salesMany: '{n} перевірених продажів', salesOther: '{n} перевіреного продажу', onlyForSaleOne: 'Лише {count} пропозиція зараз', onlyForSaleFew: 'Лише {count} пропозиції зараз', onlyForSaleMany: 'Лише {count} пропозицій зараз', onlyForSaleOther: 'Лише {count} пропозиції зараз', askingSummaryOne: '{count} пропозиція зараз · ціна {asking}', askingSummaryFew: '{count} пропозиції зараз · ціна {asking}', askingSummaryMany: '{count} пропозицій зараз · ціна {asking}', askingSummaryOther: '{count} пропозиції зараз · ціна {asking}', askingSummaryWithSoldOne: '{count} пропозиція зараз · ціна {asking} проти {sold} нещодавно продано', askingSummaryWithSoldFew: '{count} пропозиції зараз · ціна {asking} проти {sold} нещодавно продано', askingSummaryWithSoldMany: '{count} пропозицій зараз · ціна {asking} проти {sold} нещодавно продано', askingSummaryWithSoldOther: '{count} пропозиції зараз · ціна {asking} проти {sold} нещодавно продано' });
Object.assign(uk.detail, { fromSourcesOne: 'З {n} ринкового джерела', fromSourcesFew: 'З {n} ринкових джерел', fromSourcesMany: 'З {n} ринкових джерел', fromSourcesOther: 'З {n} ринкового джерела', reviewsOne: '{n} відгук', reviewsFew: '{n} відгуки', reviewsMany: '{n} відгуків', reviewsOther: '{n} відгуку', priceHistoryDaysOne: 'Історія цін · {n} день', priceHistoryDaysFew: 'Історія цін · {n} дні', priceHistoryDaysMany: 'Історія цін · {n} днів', priceHistoryDaysOther: 'Історія цін · {n} дня', priceHistoryShortOne: 'Історія цін · {n} д.', priceHistoryShortFew: 'Історія цін · {n} д.', priceHistoryShortMany: 'Історія цін · {n} д.', priceHistoryShortOther: 'Історія цін · {n} д.' });
Object.assign(uk.alerts, { priceDropOne: 'Падіння ціни · {n} д. тому', priceDropFew: 'Падіння ціни · {n} д. тому', priceDropMany: 'Падіння ціни · {n} д. тому', priceDropOther: 'Падіння ціни · {n} д. тому' });
Object.assign(uk.portfolio, { bulkLocationPartialOne: 'Оновлено {updated} з {total} — {failed} не вдалося, повторіть', bulkLocationPartialFew: 'Оновлено {updated} з {total} — {failed} не вдалося, повторіть', bulkLocationPartialMany: 'Оновлено {updated} з {total} — {failed} не вдалося, повторіть', bulkLocationPartialOther: 'Оновлено {updated} з {total} — {failed} не вдалося, повторіть', bulkRemovePartialOne: 'Видалено {removed} з {total} — {failed} не вдалося, повторіть', bulkRemovePartialFew: 'Видалено {removed} з {total} — {failed} не вдалося, повторіть', bulkRemovePartialMany: 'Видалено {removed} з {total} — {failed} не вдалося, повторіть', bulkRemovePartialOther: 'Видалено {removed} з {total} — {failed} не вдалося, повторіть', restoredCountOne: 'Відновлено {restored} з {total}', restoredCountFew: 'Відновлено {restored} з {total}', restoredCountMany: 'Відновлено {restored} з {total}', restoredCountOther: 'Відновлено {restored} з {total}' });
Object.assign(uk.wishlist, { setsCountOne: '{n} набір', setsCountFew: '{n} набори', setsCountMany: '{n} наборів', setsCountOther: '{n} набору', alertsCountOne: '{n} сповіщення', alertsCountFew: '{n} сповіщення', alertsCountMany: '{n} сповіщень', alertsCountOther: '{n} сповіщення' });
Object.assign(uk.admin, { syncJobSkippedOne: 'пропущено — {n}', syncJobSkippedFew: 'пропущено — {n}', syncJobSkippedMany: 'пропущено — {n}', syncJobSkippedOther: 'пропущено — {n}', syncJobSummaryOne: 'оброблено {processed}, оновлено {updated}, відхилено {rejected}', syncJobSummaryFew: 'оброблено {processed}, оновлено {updated}, відхилено {rejected}', syncJobSummaryMany: 'оброблено {processed}, оновлено {updated}, відхилено {rejected}', syncJobSummaryOther: 'оброблено {processed}, оновлено {updated}, відхилено {rejected}', uploadSuccessToastOne: 'Каталог мініфігурок BrickLink: імпортовано {n}', uploadSuccessToastFew: 'Каталог мініфігурок BrickLink: імпортовано {n}', uploadSuccessToastMany: 'Каталог мініфігурок BrickLink: імпортовано {n}', uploadSuccessToastOther: 'Каталог мініфігурок BrickLink: імпортовано {n}', contributionActionOne: '{action} — застосовано {n}', contributionActionFew: '{action} — застосовано {n}', contributionActionMany: '{action} — застосовано {n}', contributionActionOther: '{action} — застосовано {n}' });
Object.assign(uk.data, { csvImportMoreOne: ' і ще {n}', csvImportMoreFew: ' і ще {n}', csvImportMoreMany: ' і ще {n}', csvImportMoreOther: ' і ще {n}', csvImportConfirmMessageOne: 'Починаємо з: {sample}{more}. Наявні набори збережено.', csvImportConfirmMessageFew: 'Починаємо з: {sample}{more}. Наявні набори збережено.', csvImportConfirmMessageMany: 'Починаємо з: {sample}{more}. Наявні набори збережено.', csvImportConfirmMessageOther: 'Починаємо з: {sample}{more}. Наявні набори збережено.' });
Object.assign(uk.me, { trophyShelfOne: 'Полиця трофеїв ({n}/6)', trophyShelfFew: 'Полиця трофеїв ({n}/6)', trophyShelfMany: 'Полиця трофеїв ({n}/6)', trophyShelfOther: 'Полиця трофеїв ({n}/6)' });
Object.assign(uk.build, { ofOwnedSetsOne: 'з {n} набору у власності', ofOwnedSetsFew: 'з {n} наборів у власності', ofOwnedSetsMany: 'з {n} наборів у власності', ofOwnedSetsOther: 'з {n} набору у власності', indexingOne: 'У фоні індексується ще {n} набір…', indexingFew: 'У фоні індексуються ще {n} набори…', indexingMany: 'У фоні індексуються ще {n} наборів…', indexingOther: 'У фоні індексуються ще {n} набору…' });
Object.assign(uk.counts, { collectedOne: 'Зібрано {owned}/{total}', collectedFew: 'Зібрано {owned}/{total}', collectedMany: 'Зібрано {owned}/{total}', collectedOther: 'Зібрано {owned}/{total}', ownedOne: '{n} у власності', ownedFew: '{n} у власності', ownedMany: '{n} у власності', ownedOther: '{n} у власності', ofFigsOne: 'з {total} мініфігурки', ofFigsFew: 'з {total} мініфігурок', ofFigsMany: 'з {total} мініфігурок', ofFigsOther: 'з {total} мініфігурки', resultsOne: '{n} результат', resultsFew: '{n} результати', resultsMany: '{n} результатів', resultsOther: '{n} результату', figsOne: '{n} мініфігурка', figsFew: '{n} мініфігурки', figsMany: '{n} мініфігурок', figsOther: '{n} мініфігурки' });
Object.assign(uk.minifigs, { ownedCountOne: '{n} у власності', ownedCountFew: '{n} у власності', ownedCountMany: '{n} у власності', ownedCountOther: '{n} у власності' });
Object.assign(uk.catalog, { filtersWithCountOne: 'Фільтр · {n}', filtersWithCountFew: 'Фільтри · {n}', filtersWithCountMany: 'Фільтрів · {n}', filtersWithCountOther: 'Фільтра · {n}' });
Object.assign(uk.scanner, {"bulkMatchedOne":"Збігів: {matched} з {total}","bulkMatchedOther":"Збігів: {matched} з {total}"});
Object.assign(uk.kids, {"pcsOne":"{n} деталей","pcsOther":"{n} деталей"});
Object.assign(uk.card, {"gamePiecesOne":"{n} деталей","gamePiecesOther":"{n} деталей","piecesOne":"{n} ДЕТ","piecesOther":"{n} ДЕТ"});
Object.assign(uk.scanner, { bulkMatchedOne: '{n} збіг із {total}', bulkMatchedFew: '{n} збіги з {total}', bulkMatchedMany: '{n} збігів із {total}', bulkMatchedOther: '{n} збігу з {total}' });
Object.assign(uk.kids, { pcsOne: '{n} деталь', pcsFew: '{n} деталі', pcsMany: '{n} деталей', pcsOther: '{n} деталі' });
Object.assign(uk.card, { gamePiecesOne: '{n} деталь', gamePiecesFew: '{n} деталі', gamePiecesMany: '{n} деталей', gamePiecesOther: '{n} деталі', piecesOne: '{n} деталь', piecesFew: '{n} деталі', piecesMany: '{n} деталей', piecesOther: '{n} деталі' });
Object.assign(uk.share ??= {}, {"gameTitle":"Price It!","gameText":"🧱 Price It! {day}\\n{tiles} {score}/5 · streak {streak}\\nGuess LEGO market prices on BricksVault","setText":"Check out {name} ({setNum}) on BricksVault!","setDialogTitle":"Share {name}","portfolioTitle":"My LEGO BricksVault","portfolioText":"Check out my LEGO collection on BricksVault!","portfolioDialogTitle":"Share my BricksVault","wrappedTitle":"Brick Wrapped {year}","wrappedBest":"Best performer: {name}{roi}","wrappedTracked":"Tracked with BricksVault","wrappedSetsAdded":"sets added","wrappedPiecesAdded":"pieces","wrappedValueChange":"vault value change","wrappedTagline":"BRICKSVAULT · STACK SOMETHING BEAUTIFUL"});
Object.assign(uk.share, { gameTitle: 'Вгадай ціну!', gameText: '🧱 Вгадай ціну! {day}\n{tiles} {score}/5 · серія {streak}\nВгадуйте ринкові ціни LEGO у BricksVault', setText: 'Перегляньте {name} ({setNum}) у BricksVault!', setDialogTitle: 'Поділитися {name}', portfolioTitle: 'Мій LEGO BricksVault', portfolioText: 'Перегляньте мою колекцію LEGO у BricksVault!', portfolioDialogTitle: 'Поділитися моїм BricksVault', wrappedTitle: 'Підсумки Brick {year}', wrappedBest: 'Найкращий результат: {name}{roi}', wrappedTracked: 'Відстежено у BricksVault', wrappedValueChange: 'зміна вартості сховища', wrappedTagline: 'BRICKSVAULT · СТВОРЮЙТЕ ЩОСЬ ГАРНЕ', wrappedHeading: 'Підсумки Brick', wrappedDescription: 'Ваш рік колекціонера в цифрах — поділіться ним.', wrappedLoading: 'Рахуємо ваші цеглинки…', wrappedSummaryTitle: '🧱 Мої підсумки Brick {year}', wrappedSetsAddedOne: '{count} набір додано', wrappedSetsAddedFew: '{count} набори додано', wrappedSetsAddedMany: '{count} наборів додано', wrappedSetsAddedOther: '{count} набору додано', wrappedPiecesAddedOne: '{count} деталь', wrappedPiecesAddedFew: '{count} деталі', wrappedPiecesAddedMany: '{count} деталей', wrappedPiecesAddedOther: '{count} деталі', wrappedMinifigsOne: '{count} мініфігурка', wrappedMinifigsFew: '{count} мініфігурки', wrappedMinifigsMany: '{count} мініфігурок', wrappedMinifigsOther: '{count} мініфігурки', wrappedInvested: 'інвестовано', wrappedSoldOne: '{count} набір продано', wrappedSoldFew: '{count} набори продано', wrappedSoldMany: '{count} наборів продано', wrappedSoldOther: '{count} набору продано', wrappedSoldLabel: 'продано', wrappedBestLabel: 'Найкращий результат', wrappedBestCanvas: 'Найкращий результат', wrappedBestCanvasWithRoi: 'Найкращий результат · {roi}', wrappedLongestHeld: 'Найдовше у колекції: {name} (з {year})', wrappedClose: 'Закрити', wrappedShareYear: 'Поділитися моїм роком' });
Object.assign(uk.data, { reportPreparing: 'Готуємо звіт…', insuranceReportTitle: 'Страховий звіт BricksVault', reportSharedReady: 'Звіт готовий — відкрийте та роздрукуйте його у PDF.', reportDownloadedReady: 'Звіт завантажено — відкрийте та роздрукуйте його у PDF.', noSnapshotsYet: 'Знімків ще немає — перший буде створено наступної неділі.', backupsUnavailable: 'Резервні копії зараз недоступні.', retryingSync: 'Повторна спроба синхронізації…', guestVaultSynced: 'Гостьове сховище синхронізовано', exportPreparing: 'Готуємо експорт…', collectionExportTitle: 'Поділитися колекцією BricksVault', guestExportShared: 'Локальний гостьовий експорт готовий до поширення або збереження.', guestExportDownloaded: 'Експорт завантажено з локальних гостьових даних.', syncedExportShared: 'Синхронізований експорт готовий до поширення або збереження.', syncedExportDownloaded: 'Експорт завантажено з вашого синхронізованого сховища.' });
// en.js declares `market` twice as an object literal, so the later one wins and
// keys added to the earlier block are silently dropped. Assigning after the fact
// lands on whichever object survived.
Object.assign(uk.market, { comps: '{n} порівнянь', slashComps: ' / {n} порівнянь', usedValue: 'Вживаний: {price}', updated: 'Оновлено {date}', compsAboveMsrp: 'Продажі нових на {amount} ({pct}) вище рекомендованої ціни.', compsBelowMsrp: 'Продажі нових на {amount} ({pct}) нижче рекомендованої ціни.' });

Object.assign(uk.detail, { tagsMoreOne: '+{n} ще', tagsMoreFew: '+{n} ще', tagsMoreMany: '+{n} ще', tagsMoreOther: '+{n} ще' });
Object.assign(uk.market, { compsOne: '{n} порівняння', compsFew: '{n} порівняння', compsMany: '{n} порівнянь', compsOther: '{n} порівняння', slashCompsOne: ' / {n} порівняння', slashCompsFew: ' / {n} порівняння', slashCompsMany: ' / {n} порівнянь', slashCompsOther: ' / {n} порівняння' });

Object.assign(uk.settings, { appLockUnchanged: 'Блокування застосунку не змінено: {error}' });
Object.assign(uk.game, { checkGuessFailed: 'Не вдалося перевірити оцінку: {error}' });
Object.assign(uk.alerts, { sellOpportunityOne: 'Нагода продати · {n} день тому', sellOpportunityFew: 'Нагода продати · {n} дні тому', sellOpportunityMany: 'Нагода продати · {n} днів тому', sellOpportunityOther: 'Нагода продати · {n} дня тому' });
Object.assign(uk.detail, { minifigsCountOne: '{n} мініфігурка', minifigsCountFew: '{n} мініфігурки', minifigsCountMany: '{n} мініфігурок', minifigsCountOther: '{n} мініфігурки' });
Object.assign(uk.market, { listingsOne: '{n} оголошення', listingsFew: '{n} оголошення', listingsMany: '{n} оголошень', listingsOther: '{n} оголошення', slashListingsOne: ' / {n} оголошення', slashListingsFew: ' / {n} оголошення', slashListingsMany: ' / {n} оголошень', slashListingsOther: ' / {n} оголошення', slashSamplesOne: ' / {n} зразок', slashSamplesFew: ' / {n} зразки', slashSamplesMany: ' / {n} зразків', slashSamplesOther: ' / {n} зразка' });
Object.assign(uk.scanner, { estimatedValue: '(~орієнтовна вартість)', marketGrabThreshold: 'Ринок {market} — нижче {price} це вигідна покупка{estimated}', underMarket: 'на {amount} нижче ринку{estimated}', withinMarket: 'у межах {pct}% від ринку{estimated}', overMarket: 'на {amount} вище ринку{estimated}' });

Object.assign(uk.admin, { llmUnavailable: 'Маршрутизація LLM недоступна', llmMergeBalance: 'Залишок кредиту Merge цього місяця', llmMeteredNote: 'Обчислено з вартості, яку Merge повертає на кожен виклик — авторитетним є його дашборд.', llmEffective: 'Виконується зараз', llmEffectiveNone: 'немає налаштованого провайдера', llmLivePool: 'Живий безкоштовний пул (автоматично)', llmNoKey: 'немає ключа', llmNoKeyHint: 'Для цього провайдера не задано ключ API, тож крок пропускається під час виконання.', llmMoveUp: 'Перемістити крок вище', llmMoveDown: 'Перемістити крок нижче', llmOn: 'Увімк.', llmOff: 'Вимк.', llmReset: 'Скинути до типових', llmSave: 'Зберегти маршрут', llmSaved: 'Маршрутизацію LLM збережено', llmSaveFailed: 'Не вдалося зберегти маршрутизацію LLM', llmRefreshModels: 'Оновити моделі Merge', llmModelsRefreshedOne: 'Оновлено {n} модель Merge', llmModelsRefreshedFew: 'Оновлено {n} моделі Merge', llmModelsRefreshedMany: 'Оновлено {n} моделей Merge', llmModelsRefreshedOther: 'Оновлено {n} моделі Merge', llmModelsFailed: 'Не вдалося оновити каталог моделей Merge' });

Object.assign(uk.admin, { llmModelPlaceholder: "провайдер/модель, напр. openai/gpt-5.6-luna" });

Object.assign(uk.admin, { llmReload: "Перезавантажити", llmChooseModel: "Оберіть модель", llmCustomModel: "Власний ID моделі…", llmSpentOf: "Витрачено {spent} із {budget}", llmLivePoolShort: "безкоштовний пул", llmUnsaved: "Незбережені зміни", llmModelsOther: "Інші", llmWorkload_scan: "Сканування фото", llmWorkload_advisor: "ШІ-радник", llmWorkload_valuation: "Оцінка", llmWorkload_listing: "Чернетки оголошень" });

Object.assign(uk.admin, { llmLivePoolHint: "Щодня оновлюється з OpenRouter" });

export default uk;
Object.assign(uk.detail, { movementUp: 'Up {pct}% over {days} days', movementDown: 'Down {pct}% over {days} days', movementResaleUp: ' · resale comps also rose', movementResaleDown: ' · resale comps also fell', movementMarketUp: ' · market guide also rose', movementMarketDown: ' · market guide also fell' });
