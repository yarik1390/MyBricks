/** Dutch. Missing keys fall back to English (see lib/i18n.js). */
export const nl = {
  nav: { vault: 'Kluis', catalog: 'Catalogus', scan: 'Scannen', minifigs: 'Minifiguren', me: 'Ik', badges: 'Badges' },
  common: {
    cancel: 'Annuleren', save: 'Opslaan', close: 'Sluiten', retry: 'Opnieuw',
    loading: 'Laden…', search: 'Zoeken', all: 'Alle', none: 'Geen',
    error: 'Er ging iets mis',
  },
  settings: {
    title: 'Instellingen',
    language: 'Taal', languageDesc: 'Volgt je apparaat tenzij je er een kiest.',
    languageAuto: 'Automatisch ({name})',
    currency: 'Valuta', currencyDesc: 'Toon waarden in je eigen valuta.',
    market: 'Markt', marketDesc: 'Welke winkelprijzen worden getoond.',
  },
  detail: {
    value: 'Waarde', retired: 'Uit productie', comingSoon: 'Binnenkort', retiringSoon: 'Bijna uit productie',
    pieces: 'onderdelen', minifigs: 'minifiguren', retail: 'Adviesprijs',
    addToVault: 'In de kluis', inVault: 'In de kluis',
    tabInfo: 'Info', tabForecast: 'Prognose', tabCommunity: 'Community',
    reliablePrice: 'Betrouwbare prijs', pricingDetails: 'Prijsdetails', priceHistory: 'Prijsgeschiedenis',
  },
  catalog: { title: 'Catalogus', searchPlaceholder: 'Zoek een set', results: '{count} sets', noResults: 'Geen sets gevonden' },
};
export default nl;
