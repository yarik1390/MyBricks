/** German. Missing keys fall back to English (see lib/i18n.js). */
export const de = {
  nav: { vault: 'Tresor', catalog: 'Katalog', scan: 'Scannen', minifigs: 'Minifiguren', me: 'Ich', badges: 'Abzeichen' },
  common: {
    cancel: 'Abbrechen', save: 'Speichern', close: 'Schließen', retry: 'Erneut versuchen',
    delete: 'Löschen', edit: 'Bearbeiten', done: 'Fertig', undo: 'Rückgängig',
    loading: 'Wird geladen…', search: 'Suchen', all: 'Alle', none: 'Keine',
    yes: 'Ja', no: 'Nein', error: 'Etwas ist schiefgelaufen', offline: 'Du bist offline',
    seeAll: 'Alle ansehen', share: 'Teilen',
  },
  settings: {
    title: 'Einstellungen', language: 'Sprache',
    languageDesc: 'Folgt deinem Gerät, sofern du nichts auswählst.', languageAuto: 'Automatisch ({name})',
    currency: 'Währung', currencyDesc: 'Werte in deiner Landeswährung anzeigen.',
    market: 'Markt', marketDesc: 'Lokaler Markt für Ladenpreise. Wiederverkaufswerte bleiben in USD.',
    appearance: 'Darstellung', notifications: 'Benachrichtigungen', signOut: 'Abmelden',
  },
  detail: {
    value: 'Wert', retired: 'Eingestellt', comingSoon: 'Demnächst', retiringSoon: 'Wird eingestellt',
    pieces: 'Teile', minifigs: 'Minifiguren', retail: 'UVP',
    addToVault: 'Zum Tresor', inVault: 'Im Tresor', removeFromVault: 'Aus dem Tresor entfernen',
    tabInfo: 'Info', tabForecast: 'Prognose', tabCommunity: 'Community',
    reliablePrice: 'Verlässlicher Preis', pricingDetails: 'Preisdetails', priceHistory: 'Preisverlauf',
    details: 'Details', estimated: 'Geschätzt', year: 'Jahr', theme: 'Thema',
    addToWishlist: 'Zur Wunschliste', inWishlist: 'Auf deiner Wunschliste',
  },
  catalog: {
    title: 'Katalog', searchPlaceholder: 'Set suchen', results: '{count} Sets',
    noResults: 'Keine Sets gefunden', filters: 'Filter', sort: 'Sortieren', clearFilters: 'Filter zurücksetzen',
  },
  vault: {
    title: 'Tresor', empty: 'Dein Tresor ist leer', emptyDesc: 'Füge ein Set hinzu, um seinen Wert zu verfolgen.',
    setsOwned: 'Sets im Besitz', totalValue: 'Gesamtwert', invested: 'Investiert', gain: 'Gewinn', addSet: 'Set hinzufügen',
  },
  wishlist: {
    title: 'Wunschliste', empty: 'Deine Wunschliste ist leer', targetPrice: 'Zielpreis',
    priceDropAlert: 'Bei Preissenkung benachrichtigen', remove: 'Von der Wunschliste entfernen',
  },
};
export default de;
