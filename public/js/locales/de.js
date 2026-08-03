/** German. Missing keys fall back to English (see lib/i18n.js). */
export const de = {
  nav: { vault: 'Tresor', catalog: 'Katalog', scan: 'Scannen', minifigs: 'Minifiguren', me: 'Ich', badges: 'Abzeichen' },
  common: {
    cancel: 'Abbrechen', save: 'Speichern', close: 'Schließen', retry: 'Erneut versuchen',
    delete: 'Löschen', edit: 'Bearbeiten', done: 'Fertig', undo: 'Rückgängig',
    loading: 'Wird geladen…', search: 'Suchen', all: 'Alle', none: 'Keine',
    yes: 'Ja', no: 'Nein', error: 'Etwas ist schiefgelaufen', offline: 'Du bist offline',
    seeAll: 'Alle ansehen', share: 'Teilen',
    and: 'und',
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
    addToVaultPrice: 'In den Tresor · {price}', priceHistoryDays: 'Preisverlauf · {days} Tage', priceHistoryShort: 'Preisverlauf · {days} T.', fromSources: 'Aus {n} Marktquellen', fromSourcesOne: 'Aus 1 Marktquelle', typicalRange: ' · typisch {low}–{high}', likelyRange: ' · wahrscheinlich {low}-{high}', reviews: '{n} Rezensionen', reviewsOne: '1 Rezension', up: 'Plus {pct}%', down: 'Minus {pct}%',
  },
  counts: {
    results: '{n} Ergebnisse', resultsOne: '1 Ergebnis', collected: '{owned}/{total} gesammelt', owned: '{n} im Besitz', ofFigs: 'von {total} Figuren', figs: '{n} Figuren', figsOne: '1 Figur',
  },
  market: {
    sellNowLabel: 'Jetzt verkaufen',
    fastSaleAfterFees: 'Schnellverkauf nach Gebühren',
    pctOfValue: '{pct}% des Werts',
    pctOfFairValue: '{pct}% des fairen Werts',
    confidentlyPriced: '{pct}% sicher bewertet',
    families: '{n} unabhängige Marktquellen',
    familyOne: '1 unabhängige Marktquelle',
    sales: '{n} bestätigte Verkäufe',
    saleOne: '1 bestätigter Verkauf',
    estimateUnlocks: 'Schätzung für {list} wird verfügbar, sobald mehr Verkaufsdaten vorliegen.',
    estimatesUnlock: 'Schätzungen für {list} werden verfügbar, sobald mehr Verkaufsdaten vorliegen.',
  },
  card: {
    pieces: '{n} TLE',
    perPiece: '{price}/Teil',
    lots: '{n} Lose',
    deal: 'DEAL {pct}',
    strongBuy: 'TOP-KAUF {pct}',
    forecast2y: '{price} 2 J.',
    gamePieces: '{n} Teile',
    gameRetail: 'UVP {price}',
  },
  time: {
    unknown: 'unbekannt', today: 'Heute', yesterday: 'Gestern', daysAgo: 'vor {n} Tagen',
  },
  me: {
    trophyShelf: 'Pokalregal ({n}/6)',
  },
  kids: {
    xp: '{n} XP', xpToLevel: '{n} XP bis Level {level}', maxLevel: 'Max. Level!', pcs: '{n} Teile', earned: '{n} von {total} verdient', setsToGo: 'Noch {n} Sets', setsToGoOne: 'Noch 1 Set!',
  },
  fees: {
    marketplace: 'Marktplatzgebühr ({pct}%)', payment: 'Zahlungsgebühr ({pct}% + fest)',
  },
  alerts: {
    priceDrop: 'Preissenkung · vor {days} T.', targetWas: '— dein Ziel war {price}.',
  },
  game: {
    roundOf: 'Runde {n} von {total}', pctOff: 'Du lagst {pct}% daneben', streakLine: '{day} · Serie {streak} · Bestwert {best}',
  },
  build: {
    needParts: 'Noch {n} Teile nötig', ofOwnedSets: 'von {n} Sets im Besitz', indexing: 'Indexiere {n} weitere Set(s) im Hintergrund…',
  },
  catalog: {
    title: 'Katalog', searchPlaceholder: 'Set suchen', results: '{count} Sets',
    noResults: 'Keine Sets gefunden', filters: 'Filter', sort: 'Sortieren', clearFilters: 'Filter zurücksetzen',
  },
  vault: {
    title: 'Tresor', empty: 'Dein Tresor ist leer', emptyDesc: 'Füge ein Set hinzu, um seinen Wert zu verfolgen.',
    setsOwned: 'Sets im Besitz', totalValue: 'Gesamtwert', invested: 'Investiert', gain: 'Gewinn', addSet: 'Set hinzufügen',
    investedAmount: 'Investiert {amount}',
  },
  wishlist: {
    title: 'Wunschliste', empty: 'Deine Wunschliste ist leer', targetPrice: 'Zielpreis',
    priceDropAlert: 'Bei Preissenkung benachrichtigen', remove: 'Von der Wunschliste entfernen',
    setsCount: '{n} Sets', setsCountOne: '1 Set', alertsCount: '{n} Hinweise', alertsCountOne: '1 Hinweis', nowPrice: 'Jetzt {price}',
  },
};
export default de;
