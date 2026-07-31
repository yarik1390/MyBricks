/**
 * English — the SOURCE catalogue and the fallback for every other language.
 *
 * Every key that exists anywhere must exist here, because t() falls back to
 * English before falling back to the key itself. Adding a string to a
 * translation without adding it here means English users see the raw key.
 *
 * Keys are dotted and grouped by surface. Placeholders are {braced}.
 */
export const en = {
  nav: {
    vault: 'Vault',
    catalog: 'Catalog',
    scan: 'Scan',
    minifigs: 'Minifigs',
    me: 'Me',
    badges: 'Badges',
  },
  common: {
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    retry: 'Retry',
    loading: 'Loading…',
    search: 'Search',
    all: 'All',
    none: 'None',
    error: 'Something went wrong',
  },
  settings: {
    title: 'Settings',
    language: 'Language',
    languageDesc: 'Follows your device unless you pick one.',
    languageAuto: 'Automatic ({name})',
    currency: 'Currency',
    currencyDesc: 'Display values in your local currency.',
    market: 'Retail market',
    marketDesc: 'Which store prices to show.',
  },
  detail: {
    value: 'Value',
    retired: 'Retired',
    comingSoon: 'Coming soon',
    retiringSoon: 'Retiring soon',
    pieces: 'pieces',
    minifigs: 'minifigs',
    retail: 'Retail',
    addToVault: 'Add to vault',
    inVault: 'In vault',
    tabInfo: 'Info',
    tabForecast: 'Forecast',
    tabCommunity: 'Community',
    reliablePrice: 'Reliable price',
    pricingDetails: 'Pricing details',
    priceHistory: 'Price history',
  },
  catalog: {
    title: 'Catalog',
    searchPlaceholder: 'Find a set',
    results: '{count} sets',
    noResults: 'No sets found',
  },
};

export default en;
