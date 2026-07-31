/** Ukrainian. Missing keys fall back to English (see lib/i18n.js). */
export const uk = {
  nav: { vault: 'Сховище', catalog: 'Каталог', scan: 'Сканувати', minifigs: 'Мініфігурки', me: 'Я', badges: 'Значки' },
  common: {
    cancel: 'Скасувати', save: 'Зберегти', close: 'Закрити', retry: 'Спробувати ще',
    delete: 'Видалити', edit: 'Редагувати', done: 'Готово', undo: 'Повернути',
    loading: 'Завантаження…', search: 'Пошук', all: 'Усі', none: 'Немає',
    yes: 'Так', no: 'Ні', error: 'Щось пішло не так', offline: 'Ви офлайн',
    seeAll: 'Показати все', share: 'Поділитися',
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
  },
  catalog: {
    title: 'Каталог', searchPlaceholder: 'Знайти набір', results: '{count} наборів',
    noResults: 'Наборів не знайдено', filters: 'Фільтри', sort: 'Сортувати', clearFilters: 'Скинути фільтри',
  },
  vault: {
    title: 'Сховище', empty: 'Ваше сховище порожнє', emptyDesc: 'Додайте набір, щоб стежити за його вартістю.',
    setsOwned: 'Наборів у власності', totalValue: 'Загальна вартість', invested: 'Вкладено', gain: 'Прибуток', addSet: 'Додати набір',
  },
  wishlist: {
    title: 'Список бажань', empty: 'Ваш список бажань порожній', targetPrice: 'Бажана ціна',
    priceDropAlert: 'Сповістити про зниження ціни', remove: 'Прибрати зі списку бажань',
  },
};
export default uk;
