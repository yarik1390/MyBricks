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
    addToVaultPrice: 'In den Tresor · {price}', priceHistoryDays: 'Preisverlauf · {days} Tage', priceHistoryShort: 'Preisverlauf · {days} T.', fromSources: 'Aus {n} Marktquellen', fromSourcesOne: 'Aus 1 Marktquelle', typicalRange: ' · typisch {low}–{high}', likelyRange: ' · wahrscheinlich {low}-{high}', tagsMore: '+{n} weitere', reviews: '{n} Rezensionen', reviewsOne: '1 Rezension', up: 'Plus {pct}%', down: 'Minus {pct}%',
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
    soldEvidenceHeadline: 'Basierend auf {sales} von {markets}.',
    soldEvidenceFallback: 'Keine aktuellen bestätigten Verkäufe — die Schätzung nutzt Angebotspreise oder Marktführer.',
    soldEvidenceTitle: 'Verkaufsnachweise',
    soldEvidenceNewSealed: 'Neu & versiegelt',
    soldEvidenceUsedComplete: 'Gebraucht & vollständig',
    soldEvidenceFresh: 'Aktuell',
    soldEvidenceOlder: 'Älter',
    soldEvidenceSalesOne: '1 bestätigter Verkauf',
    soldEvidenceSalesOther: '{n} bestätigte Verkäufe',
    soldEvidenceMarketplacesOne: '1 Marktplatz',
    soldEvidenceMarketplacesOther: '{n} Marktplätze',
    sellingAbove: 'Verkauft etwa {pct} über diesem Wert',
    sellingBelow: 'Verkauft etwa {pct} unter diesem Wert',
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
  deal: {
    buyRetail: 'Im Handel etwa {pct}% unter dem Marktwert erhältlich.',
    buyResale: 'Verkauft etwa {pct}% unter dem Marktwert.',
    retiring: 'Wird bald eingestellt — begrenztes Kaufzeitfenster.',
    premiumRetail: 'Derzeit über dem Marktwert bepreist.',
    premiumResale: 'Die Forderungen liegen über dem Marktwert.',
    fair: 'Auf Höhe des Marktwerts bepreist.',
    labelBuy: 'KAUFEN',
    labelStrongBuy: 'TOP-KAUF',
    labelFair: 'FAIRER PREIS',
    labelPremium: 'ÜBER WERT',
    labelPct: '{label} · {pct}%',
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
    sortValue: 'Wert', sortGrowth: 'Wachstum', sortNewest: 'Neueste', sortTrending: 'Im Trend',
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
Object.assign(de.catalog, { filtersWithCount: 'Filter · {n}' });
de.community = { pendingSubmissionOne: '⏳ Du hast {n} Beitrag, der auf Freigabe wartet.', pendingSubmissionFew: '⏳ Du hast {n} Beiträge, die auf Freigabe warten.', pendingSubmissionMany: '⏳ Du hast {n} Beiträge, die auf Freigabe warten.', pendingSubmissionOther: '⏳ Du hast {n} Beiträge, die auf Freigabe warten.' };
de.contributions = { approvedOne: '{n} genehmigter Beitrag', approvedFew: '{n} genehmigte Beiträge', approvedMany: '{n} genehmigte Beiträge', approvedOther: '{n} genehmigte Beiträge', contributorBadge: ' · ⭐ Mitwirkende:r' };
de.admin = { uploadingFile: 'Lade {file} hoch…', importedMinifigs: '{inserted} von {parsed} Minifiguren importiert. Sie werden bei der Bewertung Preisen zugeordnet.', uploadFailed: 'Fehlgeschlagen: {error}', lastRun: 'letzter Lauf {when}{duration}' };
de.downloads = { interrupted: 'Download bei {pct}% unterbrochen — tippe auf „Fortsetzen“, um weiterzumachen.', resume: 'Fortsetzen ({pct})', scanProgress: 'Identifiziere {current} von {total}…' };
Object.assign(de.detail, { acquired: 'Erworben am {date}{source}' });
Object.assign(de.wishlist, { targetPriceCurrency: 'Zielpreis ({symbol})', suggestedPrice: 'Vorschlag: {price}' });
de.minifigs = { appearsInSetsOne: 'Erscheint in {n} Set', appearsInSetsFew: 'Erscheint in {n} Sets', appearsInSetsMany: 'Erscheint in {n} Sets', appearsInSetsOther: 'Erscheint in {n} Sets' };
Object.assign(de.admin, { syncJobRunning: '{label}: läuft…', syncJobSkipped: 'übersprungen — {n}', syncJobSummary: '{processed} verarbeitet, {updated} aktualisiert, {rejected} abgelehnt', syncJobResult: '{label}: {summary}', syncJobFailed: '{label} fehlgeschlagen: {error}', uploadSuccessToast: 'BrickLink-Minifigurenkatalog: {inserted} importiert', uploadErrorToast: 'Katalog-Upload fehlgeschlagen: {error}', countRunning: '{n} läuft', countHealthy: '{n} gesund', countFailed: '{n} fehlgeschlagen', countNotRun: '{n} noch nicht ausgeführt', completedSlices: '{n} sichere Abschnitte abgeschlossen', jobId: 'Auftrag #{id}', filled: '{n} gefüllt', processed: '{n} verarbeitet', figures: '{n} Minifiguren', noItemsProcessed: 'Keine Elemente verarbeitet' });
Object.assign(de.admin, { jobStarted: 'Auftrag #{id} gestartet', jobFailed: 'Auftrag fehlgeschlagen: {error}', maintenanceComplete: '{label} abgeschlossen', maintenanceFailed: '{label} fehlgeschlagen: {error}', lastSeen: 'zuletzt gesehen: {when}' });
Object.assign(de.admin, { tools: { sets: 'Sets importieren', figs: 'Minifiguren importieren', upc: 'Barcodes ergänzen', populate: 'Abdeckung füllen', revalue: 'Preise neu bewerten', everything: 'Alle sicheren Quellen füllen', pricechartingBulk: 'PriceCharting aktualisieren (LEGO-Menge)', pricechartingVerify: 'PriceCharting-Zuordnungen prüfen', pricesapi: 'pricesAPI jetzt ausführen', ebaySold: 'eBay-Verkaufssuche ausführen' }, maintenanceTools: { expire: 'Bewertungen ablaufen lassen', repair: 'Suchindex reparieren' }, countRunningOne: '{n} läuft', countRunningFew: '{n} laufen', countRunningMany: '{n} laufen', countRunningOther: '{n} laufen', countHealthyOne: '{n} gesund', countHealthyFew: '{n} gesund', countHealthyMany: '{n} gesund', countHealthyOther: '{n} gesund', countFailedOne: '{n} fehlgeschlagen', countFailedFew: '{n} fehlgeschlagen', countFailedMany: '{n} fehlgeschlagen', countFailedOther: '{n} fehlgeschlagen', countNotRunOne: '{n} noch nicht ausgeführt', countNotRunFew: '{n} noch nicht ausgeführt', countNotRunMany: '{n} noch nicht ausgeführt', countNotRunOther: '{n} noch nicht ausgeführt', completedSlicesOne: '{n} sicherer Abschnitt abgeschlossen', completedSlicesFew: '{n} sichere Abschnitte abgeschlossen', completedSlicesMany: '{n} sichere Abschnitte abgeschlossen', completedSlicesOther: '{n} sichere Abschnitte abgeschlossen', filledOne: '{n} gefüllt', filledFew: '{n} gefüllt', filledMany: '{n} gefüllt', filledOther: '{n} gefüllt', processedOne: '{n} verarbeitet', processedFew: '{n} verarbeitet', processedMany: '{n} verarbeitet', processedOther: '{n} verarbeitet', figuresOne: '{n} Minifigur', figuresFew: '{n} Minifiguren', figuresMany: '{n} Minifiguren', figuresOther: '{n} Minifiguren' });
Object.assign(de.detail, { uploadFailed: 'Upload fehlgeschlagen: {error}', removeFailed: 'Entfernen fehlgeschlagen: {error}', forecastUpside: 'Prognose hat noch ~{pct} Potenzial' }); de.data = { reportFailed: 'Bericht fehlgeschlagen: {error}', restoreFailed: 'Wiederherstellung fehlgeschlagen: {error}', retryFailed: 'Wiederholung fehlgeschlagen: {error}', exportFailed: 'Export fehlgeschlagen: {error}', importFailed: 'Import fehlgeschlagen: {error}', bricklinkImportFailed: 'BrickLink-Import fehlgeschlagen: {error}' }; de.integrations = { bricksetSyncFailed: 'Brickset-Synchronisierung fehlgeschlagen: {error}' }; de.scanner = { timedOut: 'Hat zu lange gedauert — bitte erneut versuchen.', timedOutShort: 'Zeitüberschreitung', scanFailed: 'Fehler: {error}' };
Object.assign(de.common, { errorWithDetails: 'Fehler: {error}' }); Object.assign(de.integrations, { bricksetSyncResult: '{added} Sets importiert ({skipped} nicht im Katalog, {total} insgesamt bei Brickset).', bricksetSyncSuccess: 'Brickset-Synchronisierung: {added} Sets hinzugefügt' }); Object.assign(de.scanner, { bulkPartial: '{added} von {total} hinzugefügt — {failed} fehlgeschlagen, bitte erneut versuchen', addSetsFailed: 'Sets konnten nicht hinzugefügt werden: {error}' }); de.portfolio = { collectionLoadFailed: 'Sammlung konnte nicht geladen werden: {error}', bulkRemovePartial: '{removed} von {total} entfernt — {failed} fehlgeschlagen, bitte erneut versuchen', restoredCount: '{restored} von {total} wiederhergestellt' };
Object.assign(de.settings, { currencyUpdated: 'Währung auf {currency} geändert' });
Object.assign(de.common, { offlineActionsSynced: '{count} Offline-Aktionen synchronisiert', offlineActionsDiscarded: '{count} Offline-Aktionen konnten nicht synchronisiert und wurden verworfen', localItemsSynced: '{count} lokale Elemente synchronisiert', kidsXp: '+{xp} EP! {level} {badge}', copied: '{label} kopiert' });
Object.assign(de.admin, { serviceTestResult: '{head} — {detail} ({ms} ms)', providerStatus: '{provider}: {status}', serviceTestFailed: 'Fehlgeschlagen: {error}', providerTestFailed: '{provider}-Test fehlgeschlagen', featureFlagStatus: '{flag}: {status}{suffix}', featureFlagUpdateFailed: '{flag} konnte nicht aktualisiert werden: {error}', providerSaved: '{provider} gespeichert.', providerSaveFailed: 'Fehler beim Speichern von {provider}: {error}', pricingConfigLoadFailed: 'Preiskonfiguration konnte nicht geladen werden: {error}', resetFailed: 'Zurücksetzen fehlgeschlagen: {error}', contributionAction: '{action} — {applied}', enabled: 'aktiviert', disabled: 'deaktiviert', approved: 'Genehmigt', rejected: 'Abgelehnt' });
Object.assign(de.minifigs, { ownedCount: '{count} im Besitz' });
Object.assign(de.data, { restoredFromBackup: '{count} Sets von {date} wiederhergestellt', migrationStillFailing: '{count} Elemente schlagen noch fehl: {error}', migrationComplete: 'Fertig — {count} Elemente synchronisiert.', importResult: '✓ {imported} importiert, {skipped} übersprungen, {errors} Fehler', setsImported: '{count} Sets importiert', bricklinkImportResult: '✓ {added} Sets hinzugefügt, {skipped} übersprungen. {errors}', bricklinkSetsImported: '{count} Sets aus BrickLink-Bestellungen importiert' });
Object.assign(de.integrations, { keyRemoved: '{label}-Schlüssel entfernt', keyVerified: '{label}-Schlüssel geprüft und gespeichert' });
Object.assign(de.scanner, { setNotFound: 'Set {setNum} wurde im Katalog nicht gefunden.', localAiOfflineFailed: 'Lokale KI fehlgeschlagen und du bist offline: {error}', addItemFailed: '{name} konnte nicht hinzugefügt werden: {error}', minifig: 'Minifigur', itemsAdded: '{count} Elemente zum Tresor hinzugefügt', itemsSavedOffline: '{count} offline gespeichert — wird synchronisiert', setsSavedOffline: '{count} Sets offline gespeichert — werden bei Verbindung synchronisiert' });
Object.assign(de.portfolio, { soldFor: 'Für {price} verkauft — aus dem Tresor entfernt' });
Object.assign(de.common, { offlineActionsSyncedOne: '{count} Offline-Aktion synchronisiert', offlineActionsSyncedOther: '{count} Offline-Aktionen synchronisiert', offlineActionsDiscardedOne: '{count} Offline-Aktion konnte nicht synchronisiert werden und wurde verworfen', offlineActionsDiscardedOther: '{count} Offline-Aktionen konnten nicht synchronisiert werden und wurden verworfen', localItemsSyncedOne: '{count} lokales Element synchronisiert', localItemsSyncedOther: '{count} lokale Elemente synchronisiert', kidsXp: '+{xp} EP!{details}', kidsXpLevel: ' Stufe {level}!', kidsXpBadge: ' · Abzeichen: {badge}! 🎉' }); Object.assign(de.scanner, { itemsAddedOne: '{count} Element zum Tresor hinzugefügt', itemsAddedOther: '{count} Elemente zum Tresor hinzugefügt', itemsSavedOfflineOne: '{count} Element offline gespeichert — wird synchronisiert', itemsSavedOfflineOther: '{count} Elemente offline gespeichert — werden synchronisiert', setsSavedOfflineOne: '{count} Set offline gespeichert — wird bei Verbindung synchronisiert', setsSavedOfflineOther: '{count} Sets offline gespeichert — werden bei Verbindung synchronisiert' }); Object.assign(de.portfolio, { wishlistAlertsTooltip: 'Wunschlisten-Alarme ({spikes} Spitzen, {drops} Preisrückgänge)', bulkLocationPartial: '{updated} von {total} aktualisiert — {failed} fehlgeschlagen, bitte erneut versuchen' });
Object.assign(de.data, { restoredFromBackupOne: '{count} Set von {date} wiederhergestellt', restoredFromBackupOther: '{count} Sets von {date} wiederhergestellt' }); Object.assign(de.integrations, { bricksetSyncResultOne: '{count} Set importiert ({skipped} nicht im Katalog, {total} insgesamt bei Brickset).', bricksetSyncResultOther: '{count} Sets importiert ({skipped} nicht im Katalog, {total} insgesamt bei Brickset).', bricksetSyncSuccessOne: 'Brickset-Sync: {count} Set hinzugefügt', bricksetSyncSuccessOther: 'Brickset-Sync: {count} Sets hinzugefügt' }); Object.assign(de.wishlist, { unreadAlertsOne: '{count} ungelesener Alarm', unreadAlertsOther: '{count} ungelesene Alarme' }); Object.assign(de.portfolio, { wishlistAlertsTooltip: 'Wunschlisten-Alarme ({spikes}, {drops})', wishlistAlertSpikesOne: '{count} Spitze', wishlistAlertSpikesOther: '{count} Spitzen', wishlistAlertDropsOne: '{count} Preisrückgang', wishlistAlertDropsOther: '{count} Preisrückgänge', insightSignal: 'Wiederverkauf {direction}{pct}% gegenüber {basis}{quantity}', insightMarket: 'Markt', insightValue: 'Wert', insightQuantity: ' · ×{count}' });
Object.assign(de.kids, { badgeCelebration: 'Neues Abzeichen: {badge}! 🎉', badgeQuip: 'Du bist ein Bau-Superstar! 🌟', levelCelebration: 'Stufe {level} erreicht! 🎉', levelQuip: 'Weiterbauen! 🧱', badgeFirstBrick: 'Erster Stein!', badgeJuniorBuilder: 'Nachwuchs-Baumeister', badgeArchitect: 'Architekt', badgeMaster: 'Meisterbauer', badgeGrandMaster: 'Großmeister', badgeLegend: 'Legendär!' });
Object.assign(de.data, { csvImportConfirmTitleOne: '1 Set importieren?', csvImportConfirmTitleOther: '{count} Sets importieren?', csvImportMore: ' und {count} weitere', csvImportConfirmMessage: 'Beginnend mit: {sample}{more}. Vorhandene Sets bleiben erhalten.', importConfirm: 'Importieren' });
Object.assign(de.scanner, { setNumberMatched: 'Setnummer im Katalog gefunden.' });
Object.assign(de.portfolio, { insightHeadlineOne: '≈ {value} Potenzial bei Verkauf von 1 Set jetzt', insightHeadlineOther: '≈ {value} Potenzial bei Verkauf von {count} Sets jetzt' });
Object.assign(de.market, { goodTimeToSell: 'Guter Zeitpunkt zum Verkaufen', goodTimeToBuy: 'Guter Zeitpunkt zum Kaufen', onlyForSale: 'Nur {count} gerade im Angebot', askingHighHint: 'Verkäufer verlangen viel — für einen schnellen Verkauf nahe dem letzten Verkaufspreis anbieten', askingLowHint: 'Unter den letzten Verkaufspreisen gelistet — guter Zeitpunkt zum Kaufen', askingSummary: '{count} im Angebot · Preis {asking}', askingSummaryWithSold: '{count} im Angebot · Preis {asking} gegenüber zuletzt verkauft für {sold}' });
Object.assign(de.game, { marketGenius: '{score}/5 — market genius! 🎯', streakQuipOne: 'Streak: {count} day.', streakQuipOther: 'Streak: {count} days.' }); de.market = Object.assign(de.market || {}, { sellingAbove: 'Selling about {pct} above this value', sellingBelow: 'Selling about {pct} below this value' }); Object.assign(de.scanner, { findingSet: 'Finding set...', lookingUpSet: 'Looking up {setNum} in the catalog.' });
Object.assign(de.game, { marketGenius: '{score}/5 — Marktgenie! 🎯', streakQuipOne: 'Serie: {count} Tag.', streakQuipOther: 'Serie: {count} Tage.' });
Object.assign(de.market, { sellingAbove: 'Verkauft etwa {pct} über diesem Wert', sellingBelow: 'Verkauft etwa {pct} unter diesem Wert' }); Object.assign(de.scanner, { findingSet: 'Set wird gesucht…', lookingUpSet: 'Suche {setNum} im Katalog.', bulkMatched: '{matched} von {total} gefunden' }); Object.assign(de.game, { revealCorrect: '🎯 Volltreffer! — es sind {value}', revealIncorrect: 'Nicht ganz — es sind {value}' }); Object.assign(de.catalog, { activeFiltersOne: '1 aktiv', activeFiltersOther: '{count} aktiv' }); Object.assign(de.portfolio, { anniversaryGain: 'Für {paid} gekauft — seitdem {gain} im Plus.', anniversaryNoGain: 'Für {paid} gekauft. Manche Sets sind Liebe, kein Gewinn.', anniversaryQuip: 'Beim Bauen vergeht die Zeit wie im Flug.', anniversaryCelebrationOne: '1 Jahr mit {set}! 🎂', anniversaryCelebrationOther: '{count} Jahre mit {set}! 🎂' });
Object.assign(de.market, { partsCoverage: '{pct}% Teileabdeckung', forecastScenarios: 'Bär {bear} · Basis {base} · Bulle {bull}', salesSuffix: ' / {count} Verkäufe', newSold: 'Neu verkauft', usedSold: 'Gebraucht verkauft', viewOnBrickLink: 'Auf BrickLink ansehen' }); Object.assign(de.catalog, { loadFailedDetail: '{error}. Prüfe deine Verbindung und versuche es erneut.' }); Object.assign(de.portfolio, { moreThemesOne: '+1 weiteres Thema', moreThemesOther: '+{count} weitere Themen', sealedParts: 'Versiegelt {sealed} · {approximate}Teile {parts}' }); de.advisor = Object.assign(de.advisor || {}, { moreThemesOne: '+1 weiteres Thema in deinem Tresor', moreThemesOther: '+{count} weitere Themen in deinem Tresor' });
Object.assign(de.game, { loadFailed: 'Heutiges Spiel konnte nicht geladen werden: {error}' }); Object.assign(de.contributions, { loadFailed: 'Konnte nicht laden: {error}' }); Object.assign(de.me, { wrappedLoadFailed: 'Dein Jahr konnte nicht geladen werden: {error}', wrappedValueChange: 'Tresor {direction} {value} dieses Jahr', wrappedUp: 'gestiegen', wrappedDown: 'gefallen' });
Object.assign(de.catalog, { filterSummaryNone: 'Keine Filter aktiv', filterSummaryActiveOne: '{count} aktiv: {items}', filterSummaryActiveOther: '{count} aktiv: {items}', filterSummarySearch: 'Suche „{value}“', filterSummaryStatusRetired: 'Nur eingestellt', filterSummaryStatusActive: 'Nur aktiv', filterSummaryStatusRetiring: 'Bald eingestellt', filterSummaryDeal: 'Nur Angebote', filterSummaryRangeYear: 'Jahr', filterSummaryRangePieces: 'Teile', filterSummaryRangeValue: 'Wert', filterSummaryRangeBetween: '{label} {min}–{max}', filterSummaryRangeMin: '{label} ≥ {value}', filterSummaryRangeMax: '{label} ≤ {value}', filterSummaryPiecesValue: '{value} Teile', filterSummaryValueAmount: '{value} $' });
Object.assign(de.minifigs, { filterSummaryNone: 'Keine Filter aktiv', filterSummaryActiveOne: '{count} aktiv: {items}', filterSummaryActiveOther: '{count} aktiv: {items}', filterSummarySearch: 'Suche „{value}“', filterSummaryRarity: 'Seltenheit: {rarity}', filterSummaryRarityCommon: 'Gewöhnlich', filterSummaryRarityUncommon: 'Ungewöhnlich', filterSummaryRarityRare: 'Selten', filterSummaryRarityLegendary: 'Legendär', filterSummaryOwned: 'Nur im Besitz', filterSummaryUnowned: 'Nur nicht im Besitz' });
Object.assign(de.catalog, { emptySearchResults: 'Für „{query}“ gibt es keine Treffer. Versuche eine andere Suche oder lösche die Filter.', emptyFilteredResults: 'Keine Sets entsprechen diesen Filtern. Versuche eine andere Suche oder lösche die Filter.' });
Object.assign(de.advisor, { retiredSetsOfTotalOne: '{retired} von {total} Set', retiredSetsOfTotalOther: '{retired} von {total} Sets' });
Object.assign(de.scanner, { duplicateConfirmTitle: 'Bereits im Besitz', duplicateConfirmMessage: 'Du hast {names} bereits in deinem Tresor. Noch ein Exemplar hinzufügen?', duplicateConfirmAction: 'Trotzdem hinzufügen' });
Object.assign(de.scanner, { minifigWithSeries: '{minifig} – Serie {series}', minifigWithRarity: '{minifig} – Seltenheit: {rarity}', rarityUnknown: 'Unbekannt' });
Object.assign(de.admin, { jobAccepted: '{label} angenommen und bald in Aktivität sichtbar', pricechartingBulkAccepted: 'PriceCharting-Sammelabruf gestartet — Ergebnisse erscheinen bald in Aktivität', pricechartingVerifyAccepted: 'PriceCharting-Prüfung gestartet — sieh in Aktivität nach bestätigten Zuordnungen', pricesapiAccepted: 'pricesAPI-Aktualisierung gestartet — Ergebnis erscheint in Aktivität' });
Object.assign(de.scanner, { setsFoundOne: '{count} Set gefunden', setsFoundOther: '{count} Sets gefunden', minifigsFoundOne: '{count} Minifigur gefunden', minifigsFoundOther: '{count} Minifiguren gefunden', mixedResultsFoundOne: '{count} Ergebnis gefunden (Sets und Minifiguren)', mixedResultsFoundOther: '{count} Ergebnisse gefunden (Sets und Minifiguren)', confidenceHigh: 'Hohe Zuverlässigkeit', confidenceMedium: 'Mittlere Zuverlässigkeit', confidenceLow: 'Niedrige Zuverlässigkeit', confidenceUnknown: 'Trefferzuverlässigkeit nicht verfügbar', matchHigh: 'Hohe Übereinstimmung', matchMedium: 'Mittlere Übereinstimmung', matchLow: 'Niedrige Übereinstimmung', match: 'Übereinstimmung' });
Object.assign(de.detail, { sellReasonGainSincePurchase: 'Seit dem Kauf um {roi} gestiegen', sellReasonTrendDown: 'Der Preistrend dreht nach unten', sellReasonClimbFlattened: 'Der Preisanstieg flacht ab', sellReasonLittleUpside: 'Nur noch {upside} Prognosepotenzial', sellReasonSellsFast: '{volume} jüngste Verkäufe sprechen für schnelle Verkäufe', sellReasonWatchClosely: 'Den Markt genau beobachten', sellReasonStillClimbing: 'Der Preis steigt weiter', sellReasonForecastUpside: 'Die Prognose zeigt noch {upside} Potenzial', sellReasonNotRetired: 'Noch nicht aus dem Sortiment', sellReasonNoSellTrigger: 'Noch kein klares Verkaufssignal' });
Object.assign(de.data, { migrationStillFailingOne: '{count} Element schlägt noch fehl: {error}', migrationStillFailingOther: '{count} Elemente schlagen noch fehl: {error}', migrationCompleteOne: 'Fertig — {count} Element synchronisiert.', migrationCompleteOther: 'Fertig — {count} Elemente synchronisiert.', setsImportedOne: '{count} Set importiert', setsImportedOther: '{count} Sets importiert', bricklinkSetsImportedOne: '{count} Set aus BrickLink-Bestellungen importiert', bricklinkSetsImportedOther: '{count} Sets aus BrickLink-Bestellungen importiert' });
Object.assign(de.detail, { sellReasonSellsFastOne: '{volume} jüngster Verkauf spricht für einen schnellen Verkauf', sellReasonSellsFastOther: '{volume} jüngste Verkäufe sprechen für schnelle Verkäufe' });
Object.assign(de.minifigs, { setExclusive: 'Set-exklusiv', inSetsOne: 'In {count} Set', inSetsOther: 'In {count} Sets', partsOne: '{count} Teil', partsOther: '{count} Teile' });
Object.assign(de.minifigs, { emptySearchResults: 'Für „{query}“ gibt es keine Treffer.', emptyFilteredResults: 'Keine Minifiguren entsprechen diesen Filtern.' });
Object.assign(de.detail, { partsComplete: 'Vollständig', partsMissingOne: '{count} Teil fehlt', partsMissingOther: '{count} Teile fehlen', allPartsPresent: 'alle Teile vorhanden' });
Object.assign(de.build, { needPartsOne: 'Noch {n} Teil nötig', needPartsOther: 'Noch {n} Teile nötig' });
Object.assign(de.card, { lotsOne: '{n} Los', lotsOther: '{n} Lose' });
Object.assign(de.market, { salesSuffixOne: ' / {count} Verkauf', salesSuffixOther: ' / {count} Verkäufe' });
Object.assign(de.data, { importedCountOne: '{n} Set importiert', importedCountOther: '{n} Sets importiert', skippedCountOne: '{n} Set übersprungen', skippedCountOther: '{n} Sets übersprungen', errorsCountOne: '{n} Fehler', errorsCountOther: '{n} Fehler', setsAddedCountOne: '{n} Set hinzugefügt', setsAddedCountOther: '{n} Sets hinzugefügt', importResult: '✓ {imported}; {skipped}; {errors}', bricklinkImportResult: '✓ {added}; {skipped}. {errors}' });
Object.assign(de.admin, { minifigsImportedOne: '{n} Minifigur', minifigsImportedOther: '{n} Minifiguren', minifigsParsedOne: '{n} Minifigur', minifigsParsedOther: '{n} Minifiguren', importedMinifigs: '{inserted} von {parsed} importiert. Die Preise werden beim Bewerten zugeordnet.' });
Object.assign(de.time, {"daysAgoOne":"vor {n} Tagen","daysAgoOther":"vor {n} Tagen"});
Object.assign(de.scanner, {"bulkPartialOne":"{added} von {total} hinzugefügt — {failed} fehlgeschlagen, bitte erneut versuchen","bulkPartialOther":"{added} von {total} hinzugefügt — {failed} fehlgeschlagen, bitte erneut versuchen"});
Object.assign(de.kids, {"setsToGoOne":"Noch {n} Sets","setsToGoOther":"Noch {n} Sets","earnedOne":"{n} von {total} verdient","earnedOther":"{n} von {total} verdient"});
Object.assign(de.market, {"familiesOne":"{n} unabhängige Marktquellen","familiesOther":"{n} unabhängige Marktquellen","salesOne":"{n} bestätigte Verkäufe","salesOther":"{n} bestätigte Verkäufe","onlyForSaleOne":"Nur {count} gerade im Angebot","onlyForSaleOther":"Nur {count} gerade im Angebot","askingSummaryOne":"{count} im Angebot · Preis {asking}","askingSummaryOther":"{count} im Angebot · Preis {asking}","askingSummaryWithSoldOne":"{count} im Angebot · Preis {asking} gegenüber zuletzt verkauft für {sold}","askingSummaryWithSoldOther":"{count} im Angebot · Preis {asking} gegenüber zuletzt verkauft für {sold}"});
Object.assign(de.detail, {"fromSourcesOne":"Aus {n} Marktquellen","fromSourcesOther":"Aus {n} Marktquellen","reviewsOne":"{n} Rezensionen","reviewsOther":"{n} Rezensionen","priceHistoryDaysOne":"Preisverlauf · {n} Tage","priceHistoryDaysOther":"Preisverlauf · {n} Tage","priceHistoryShortOne":"Preisverlauf · {n} T.","priceHistoryShortOther":"Preisverlauf · {n} T."});
Object.assign(de.alerts, {"priceDropOne":"Preissenkung · vor {n} T.","priceDropOther":"Preissenkung · vor {n} T."});
Object.assign(de.portfolio, {"bulkLocationPartialOne":"{updated} von {total} aktualisiert — {failed} fehlgeschlagen, bitte erneut versuchen","bulkLocationPartialOther":"{updated} von {total} aktualisiert — {failed} fehlgeschlagen, bitte erneut versuchen","bulkRemovePartialOne":"{removed} von {total} entfernt — {failed} fehlgeschlagen, bitte erneut versuchen","bulkRemovePartialOther":"{removed} von {total} entfernt — {failed} fehlgeschlagen, bitte erneut versuchen","restoredCountOne":"{restored} von {total} wiederhergestellt","restoredCountOther":"{restored} von {total} wiederhergestellt"});
Object.assign(de.wishlist, {"setsCountOne":"{n} Sets","setsCountOther":"{n} Sets","alertsCountOne":"{n} Hinweise","alertsCountOther":"{n} Hinweise"});
Object.assign(de.admin, {"syncJobSkippedOne":"übersprungen — {n}","syncJobSkippedOther":"übersprungen — {n}","syncJobSummaryOne":"{processed} verarbeitet, {updated} aktualisiert, {rejected} abgelehnt","syncJobSummaryOther":"{processed} verarbeitet, {updated} aktualisiert, {rejected} abgelehnt","uploadSuccessToastOne":"BrickLink-Minifigurenkatalog: {n} importiert","uploadSuccessToastOther":"BrickLink-Minifigurenkatalog: {n} importiert","contributionActionOne":"{action} — {n}","contributionActionOther":"{action} — {n}"});
Object.assign(de.data, {"csvImportMoreOne":" und {n} weitere","csvImportMoreOther":" und {n} weitere","csvImportConfirmMessageOne":"Beginnend mit: {sample}{more}. Vorhandene Sets bleiben erhalten.","csvImportConfirmMessageOther":"Beginnend mit: {sample}{more}. Vorhandene Sets bleiben erhalten."});
Object.assign(de.me, {"trophyShelfOne":"Pokalregal ({n}/6)","trophyShelfOther":"Pokalregal ({n}/6)"});
Object.assign(de.build, {"ofOwnedSetsOne":"von {n} Sets im Besitz","ofOwnedSetsOther":"von {n} Sets im Besitz","indexingOne":"Indexiere {n} weitere Set(s) im Hintergrund…","indexingOther":"Indexiere {n} weitere Set(s) im Hintergrund…"});
Object.assign(de.counts, {"collectedOne":"{owned}/{total} gesammelt","collectedOther":"{owned}/{total} gesammelt","ownedOne":"{n} im Besitz","ownedOther":"{n} im Besitz","ofFigsOne":"von {total} Figuren","ofFigsOther":"von {total} Figuren","resultsOne":"{n} Ergebnisse","resultsOther":"{n} Ergebnisse","figsOne":"{n} Figuren","figsOther":"{n} Figuren"});
Object.assign(de.minifigs, {"ownedCountOne":"{n} im Besitz","ownedCountOther":"{n} im Besitz"});
Object.assign(de.catalog, {"filtersWithCountOne":"Filter · {n}","filtersWithCountOther":"Filter · {n}"});
Object.assign(de.scanner, {"bulkMatchedOne":"{matched} von {total} gefunden","bulkMatchedOther":"{matched} von {total} gefunden"});
Object.assign(de.kids, {"pcsOne":"{n} Teile","pcsOther":"{n} Teile"});
Object.assign(de.card, {"gamePiecesOne":"{n} Teile","gamePiecesOther":"{n} Teile","piecesOne":"{n} TLE","piecesOther":"{n} TLE"});
Object.assign(de.scanner, { bulkMatchedOne: '{n} von {total} gefunden', bulkMatchedOther: '{n} von {total} gefunden' });
Object.assign(de.kids, { pcsOne: '{n} Teil', pcsOther: '{n} Teile' });
Object.assign(de.card, { gamePiecesOne: '{n} Teil', gamePiecesOther: '{n} Teile', piecesOne: '{n} Teil', piecesOther: '{n} Teile' });
Object.assign(de.share ??= {}, {"gameTitle":"Price It!","gameText":"🧱 Price It! {day}\\n{tiles} {score}/5 · streak {streak}\\nGuess LEGO market prices on BricksVault","setText":"Check out {name} ({setNum}) on BricksVault!","setDialogTitle":"Share {name}","portfolioTitle":"My LEGO BricksVault","portfolioText":"Check out my LEGO collection on BricksVault!","portfolioDialogTitle":"Share my BricksVault","wrappedTitle":"Brick Wrapped {year}","wrappedBest":"Best performer: {name}{roi}","wrappedTracked":"Tracked with BricksVault","wrappedSetsAdded":"sets added","wrappedPiecesAdded":"pieces","wrappedValueChange":"vault value change","wrappedTagline":"BRICKSVAULT · STACK SOMETHING BEAUTIFUL"});
Object.assign(de.share, { gameTitle: 'Preis raten!', gameText: '🧱 Preis raten! {day}\n{tiles} {score}/5 · Serie {streak}\nSchätze LEGO-Marktpreise auf BricksVault', setText: 'Sieh dir {name} ({setNum}) auf BricksVault an!', setDialogTitle: 'Teile {name}', portfolioTitle: 'Mein LEGO-BricksVault', portfolioText: 'Sieh dir meine LEGO-Sammlung auf BricksVault an!', portfolioDialogTitle: 'Meinen BricksVault teilen', wrappedTitle: 'Brick-Jahresrückblick {year}', wrappedBest: 'Beste Wertentwicklung: {name}{roi}', wrappedTracked: 'Mit BricksVault verfolgt', wrappedValueChange: 'Wertänderung des Tresors', wrappedTagline: 'BRICKSVAULT · BAUE ETWAS SCHÖNES', wrappedHeading: 'Brick-Jahresrückblick', wrappedDescription: 'Dein Sammlerjahr in Zahlen — teile es.', wrappedLoading: 'Deine Steine werden gezählt…', wrappedSummaryTitle: '🧱 Mein Brick-Jahresrückblick {year}', wrappedSetsAddedOne: '{count} Set hinzugefügt', wrappedSetsAddedOther: '{count} Sets hinzugefügt', wrappedPiecesAddedOne: '{count} Teil', wrappedPiecesAddedOther: '{count} Teile', wrappedMinifigsOne: '{count} Minifigur', wrappedMinifigsOther: '{count} Minifiguren', wrappedInvested: 'investiert', wrappedSoldOne: '{count} Set verkauft', wrappedSoldOther: '{count} Sets verkauft', wrappedSoldLabel: 'verkauft', wrappedBestLabel: 'Beste Wertentwicklung', wrappedBestCanvas: 'Beste Wertentwicklung', wrappedBestCanvasWithRoi: 'Beste Wertentwicklung · {roi}', wrappedLongestHeld: 'Am längsten behalten: {name} (seit {year})', wrappedClose: 'Schließen', wrappedShareYear: 'Mein Jahr teilen' });
Object.assign(de.data, { reportPreparing: 'Bericht wird vorbereitet…', insuranceReportTitle: 'BricksVault-Versicherungsbericht', reportSharedReady: 'Bericht ist bereit — öffne ihn und drucke ihn als PDF.', reportDownloadedReady: 'Bericht heruntergeladen — öffne ihn und drucke ihn als PDF.', noSnapshotsYet: 'Noch keine Sicherungen — die erste wird nächsten Sonntag erstellt.', backupsUnavailable: 'Sicherungen sind gerade nicht verfügbar.', retryingSync: 'Synchronisierung wird erneut versucht…', guestVaultSynced: 'Gast-Tresor synchronisiert', exportPreparing: 'Export wird vorbereitet…', collectionExportTitle: 'BricksVault-Sammlung teilen', guestExportShared: 'Dein lokaler Gastexport ist zum Teilen oder Speichern bereit.', guestExportDownloaded: 'Export aus lokalen Gastdaten heruntergeladen.', syncedExportShared: 'Dein synchronisierter Export ist zum Teilen oder Speichern bereit.', syncedExportDownloaded: 'Export aus deinem synchronisierten Tresor heruntergeladen.' });
// en.js declares `market` twice as an object literal, so the later one wins and
// keys added to the earlier block are silently dropped. Assigning after the fact
// lands on whichever object survived.
Object.assign(de.market, { comps: '{n} Vergleiche', slashComps: ' / {n} Vergleiche', usedValue: 'Gebraucht: {price}', updated: 'Aktualisiert {date}', compsAboveMsrp: 'Neu-Verkäufe liegen {amount} ({pct}) über der UVP.', compsBelowMsrp: 'Neu-Verkäufe liegen {amount} ({pct}) unter der UVP.' });

Object.assign(de.detail, { tagsMoreOne: '+{n} mehr', tagsMoreOther: '+{n} mehr' });
Object.assign(de.market, { compsOne: '{n} Vergleich', compsOther: '{n} Vergleiche', slashCompsOne: ' / {n} Vergleich', slashCompsOther: ' / {n} Vergleiche' });

Object.assign(de.settings, { appLockUnchanged: 'App-Sperre unverändert: {error}' });
Object.assign(de.game, { checkGuessFailed: 'Der Tipp konnte nicht geprüft werden: {error}' });
Object.assign(de.alerts, { sellOpportunityOne: 'Verkaufschance · vor {n} Tag', sellOpportunityOther: 'Verkaufschance · vor {n} Tagen' });
Object.assign(de.detail, { minifigsCountOne: '{n} Minifigur', minifigsCountOther: '{n} Minifiguren' });
Object.assign(de.market, { listingsOne: '{n} Angebot', listingsOther: '{n} Angebote', slashListingsOne: ' / {n} Angebot', slashListingsOther: ' / {n} Angebote', slashSamplesOne: ' / {n} Stichprobe', slashSamplesOther: ' / {n} Stichproben' });
Object.assign(de.scanner, { estimatedValue: '(~geschätzter Wert)', marketGrabThreshold: 'Marktwert {market} — unter {price} ist ein Schnäppchen{estimated}', underMarket: '{amount} unter Marktwert{estimated}', withinMarket: 'innerhalb von {pct}% des Marktwerts{estimated}', overMarket: '{amount} über Marktwert{estimated}' });

export default de;
