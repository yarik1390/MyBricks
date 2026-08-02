/** Dutch. Missing keys fall back to English (see lib/i18n.js). */
export const nl = {
  nav: { vault: 'Kluis', catalog: 'Catalogus', scan: 'Scannen', minifigs: 'Minifiguren', me: 'Ik', badges: 'Badges' },
  common: {
    cancel: 'Annuleren', save: 'Opslaan', close: 'Sluiten', retry: 'Opnieuw',
    delete: 'Verwijderen', edit: 'Bewerken', done: 'Klaar', undo: 'Ongedaan maken',
    loading: 'Laden…', search: 'Zoeken', all: 'Alle', none: 'Geen',
    yes: 'Ja', no: 'Nee', error: 'Er ging iets mis', offline: 'Je bent offline',
    seeAll: 'Alles bekijken', share: 'Delen',
    and: 'en',
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
    addToVaultPrice: 'Aan kluis toevoegen · {price}', priceHistoryDays: 'Prijsgeschiedenis · {days} dagen', priceHistoryShort: 'Prijsgeschiedenis · {days} d', fromSources: 'Uit {n} marktbronnen', fromSourcesOne: 'Uit 1 marktbron', typicalRange: ' · doorgaans {low}–{high}',
  },
  counts: {
    results: '{n} resultaten', resultsOne: '1 resultaat', collected: '{owned}/{total} verzameld', owned: '{n} in bezit', ofFigs: 'van {total} figuren', figs: '{n} figuren', figsOne: '1 figuur',
  },
  market: {
    sellNowLabel: 'Nu verkopen',
    fastSaleAfterFees: 'snelle verkoop na kosten',
    pctOfValue: '{pct}% van de waarde',
    pctOfFairValue: '{pct}% van de reële waarde',
    confidentlyPriced: '{pct}% betrouwbaar geprijsd',
    families: '{n} onafhankelijke marktbronnen',
    familyOne: '1 onafhankelijke marktbron',
    sales: '{n} geverifieerde verkopen',
    saleOne: '1 geverifieerde verkoop',
    estimateUnlocks: 'De schatting voor {list} komt beschikbaar bij meer verkoopdata.',
    estimatesUnlock: 'De schattingen voor {list} komen beschikbaar bij meer verkoopdata.',
  },
  time: {
    unknown: 'onbekend', today: 'Vandaag', yesterday: 'Gisteren', daysAgo: '{n} dagen geleden',
  },
  me: {
    trophyShelf: 'Trofeeplank ({n}/6)',
  },
  kids: {
    xp: '{n} XP', xpToLevel: '{n} XP tot niveau {level}', maxLevel: 'Max niveau!', pcs: '{n} onderdelen', earned: '{n} van {total} verdiend', setsToGo: 'Nog {n} sets', setsToGoOne: 'Nog 1 set!',
  },
  fees: {
    marketplace: 'Marktplaatskosten ({pct}%)', payment: 'Betaalkosten ({pct}% + vast)',
  },
  alerts: {
    priceDrop: 'Prijsdaling · {days} d geleden', targetWas: '— je doel was {price}.',
  },
  game: {
    roundOf: 'Ronde {n} van {total}', pctOff: 'Je zat er {pct}% naast', streakLine: '{day} · reeks {streak} · beste {best}',
  },
  build: {
    needParts: 'Nog {n} onderdelen nodig', ofOwnedSets: 'van {n} sets in bezit', indexing: '{n} extra set(s) worden op de achtergrond geïndexeerd…',
  },
  catalog: {
    title: 'Catalogus', searchPlaceholder: 'Zoek een set', results: '{count} sets',
    noResults: 'Geen sets gevonden', filters: 'Filters', sort: 'Sorteren', clearFilters: 'Filters wissen',
  },
  vault: {
    title: 'Kluis', empty: 'Je kluis is leeg', emptyDesc: 'Voeg een set toe om de waarde te volgen.',
    setsOwned: 'Sets in bezit', totalValue: 'Totale waarde', invested: 'Geïnvesteerd', gain: 'Winst', addSet: 'Set toevoegen',
    investedAmount: 'Geïnvesteerd {amount}',
  },
  wishlist: {
    title: 'Verlanglijst', empty: 'Je verlanglijst is leeg', targetPrice: 'Streefprijs',
    priceDropAlert: 'Waarschuw me bij prijsdaling', remove: 'Van verlanglijst verwijderen',
    setsCount: '{n} sets', setsCountOne: '1 set', alertsCount: '{n} meldingen', alertsCountOne: '1 melding', nowPrice: 'Nu {price}',
  },
};
export default nl;
