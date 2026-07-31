/** Dutch. Missing keys fall back to English (see lib/i18n.js). */
export const nl = {
  nav: { vault: 'Kluis', catalog: 'Catalogus', scan: 'Scannen', minifigs: 'Minifiguren', me: 'Ik', badges: 'Badges' },
  common: {
    cancel: 'Annuleren', save: 'Opslaan', close: 'Sluiten', retry: 'Opnieuw',
    delete: 'Verwijderen', edit: 'Bewerken', done: 'Klaar', undo: 'Ongedaan maken',
    loading: 'Laden…', search: 'Zoeken', all: 'Alle', none: 'Geen',
    yes: 'Ja', no: 'Nee', error: 'Er ging iets mis', offline: 'Je bent offline',
    seeAll: 'Alles bekijken', share: 'Delen',
  },
  settings: {
    title: 'Instellingen', language: 'Taal',
    languageDesc: 'Volgt je apparaat tenzij je er een kiest.', languageAuto: 'Automatisch ({name})',
    currency: 'Valuta', currencyDesc: 'Toon waarden in je eigen valuta.',
    market: 'Markt', marketDesc: 'Lokale markt voor winkelaanbiedingen. Doorverkoopwaarden blijven in USD.',
    appearance: 'Weergave', notifications: 'Meldingen', signOut: 'Uitloggen',
  },
  detail: {
    value: 'Waarde', retired: 'Uit productie', comingSoon: 'Binnenkort', retiringSoon: 'Bijna uit productie',
    pieces: 'onderdelen', minifigs: 'minifiguren', retail: 'Adviesprijs',
    addToVault: 'In de kluis', inVault: 'In de kluis', removeFromVault: 'Uit de kluis halen',
    tabInfo: 'Info', tabForecast: 'Prognose', tabCommunity: 'Community',
    reliablePrice: 'Betrouwbare prijs', pricingDetails: 'Prijsdetails', priceHistory: 'Prijsgeschiedenis',
    details: 'Details', estimated: 'Geschat', year: 'Jaar', theme: 'Thema',
    addToWishlist: 'Aan verlanglijst', inWishlist: 'Op je verlanglijst',
  },
  catalog: {
    title: 'Catalogus', searchPlaceholder: 'Zoek een set', results: '{count} sets',
    noResults: 'Geen sets gevonden', filters: 'Filters', sort: 'Sorteren', clearFilters: 'Filters wissen',
  },
  vault: {
    title: 'Kluis', empty: 'Je kluis is leeg', emptyDesc: 'Voeg een set toe om de waarde te volgen.',
    setsOwned: 'Sets in bezit', totalValue: 'Totale waarde', invested: 'Geïnvesteerd', gain: 'Winst', addSet: 'Set toevoegen',
  },
  wishlist: {
    title: 'Verlanglijst', empty: 'Je verlanglijst is leeg', targetPrice: 'Streefprijs',
    priceDropAlert: 'Waarschuw me bij prijsdaling', remove: 'Van verlanglijst verwijderen',
  },
};
export default nl;
