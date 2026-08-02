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
    addToVaultPrice: 'Додати до сховища · {price}', priceHistoryDays: 'Історія цін · {days} днів', priceHistoryShort: 'Історія цін · {days} дн.', fromSources: 'З {n} ринкових джерел', fromSourcesOne: 'З 1 ринкового джерела', typicalRange: ' · зазвичай {low}–{high}',
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
    noResults: 'Наборів не знайдено', filters: 'Фільтри', sort: 'Сортувати', clearFilters: 'Скинути фільтри',
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
export default uk;
