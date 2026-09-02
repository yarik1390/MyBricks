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
    addToVaultPrice: 'Aan kluis toevoegen · {price}', priceHistoryDays: 'Prijsgeschiedenis · {days} dagen', priceHistoryShort: 'Prijsgeschiedenis · {days} d', fromSources: 'Uit {n} marktbronnen', fromSourcesOne: 'Uit 1 marktbron', typicalRange: ' · doorgaans {low}–{high}', likelyRange: ' · waarschijnlijk {low}-{high}', tagsMore: '+{n} meer', reviews: '{n} recensies', reviewsOne: '1 recensie', up: 'Stijging {pct}%', down: 'Daling {pct}%',
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
    soldEvidenceHeadline: 'Gebaseerd op {sales} van {markets}.',
    soldEvidenceFallback: 'Geen recente geverifieerde verkopen — de schatting gebruikt vraagprijzen of marktgidsen.',
    soldEvidenceTitle: 'Verkoopbewijs',
    soldEvidenceNewSealed: 'Nieuw en verzegeld',
    soldEvidenceUsedComplete: 'Gebruikt en compleet',
    soldEvidenceFresh: 'Recent',
    soldEvidenceOlder: 'Ouder',
    soldEvidenceSalesOne: '1 geverifieerde verkoop',
    soldEvidenceSalesOther: '{n} geverifieerde verkopen',
    soldEvidenceMarketplacesOne: '1 marktplaats',
    soldEvidenceMarketplacesOther: '{n} marktplaatsen',
    partOutVerdictPartout: 'Uit elkaar verkopen levert meer op',
    partOutVerdictSealed: 'Verkoop verzegeld',
    partOutVerdictSame: 'Ongeveer gelijk',
    partOutSellSealed: 'Verkoop verzegeld',
    partOutSellParts: 'Verkoop in onderdelen',
    partOutDeltaPartout: '{pct} meer dan de verzegelde waarde',
    partOutDeltaSealed: 'de verzegelde waarde is {pct} hoger',
    partOutClose: 'de waarden liggen dicht bij elkaar',
    partOutCoverage: '{pct} van de onderdelen geprijsd',
    sellingAbove: 'Verkoopt ongeveer {pct} boven deze waarde',
    sellingBelow: 'Verkoopt ongeveer {pct} onder deze waarde',
  },
  card: {
    pieces: '{n} STKS',
    perPiece: '{price}/steen',
    lots: '{n} kavels',
    deal: 'DEAL {pct}',
    strongBuy: 'TOPKOOP {pct}',
    forecast2y: '{price} 2 jr',
    gamePieces: '{n} stenen',
    gameRetail: 'adviesprijs {price}',
  },
  deal: {
    buyRetail: 'In de winkel verkrijgbaar voor ongeveer {pct}% onder de marktwaarde.',
    buyResale: 'Verkoopt ongeveer {pct}% onder de marktwaarde.',
    retiring: 'Binnenkort uit productie — beperkt koopmoment.',
    premiumRetail: 'Momenteel boven de marktwaarde geprijsd.',
    premiumResale: 'De vraagprijzen liggen boven de marktwaarde.',
    fair: 'Geprijsd op de marktwaarde.',
    labelBuy: 'KOPEN',
    labelStrongBuy: 'TOPKOOP',
    labelFair: 'EERLIJKE PRIJS',
    labelPremium: 'BOVEN WAARDE',
    labelPct: '{label} · {pct}%',
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
    sortValue: 'Waarde', sortGrowth: 'Groei', sortNewest: 'Nieuwste', sortTrending: 'Trending',
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
Object.assign(nl.catalog, { filtersWithCount: 'Filters · {n}' });
nl.community = { pendingSubmissionOne: '⏳ Je hebt {n} bijdrage die wacht op goedkeuring.', pendingSubmissionFew: '⏳ Je hebt {n} bijdragen die wachten op goedkeuring.', pendingSubmissionMany: '⏳ Je hebt {n} bijdragen die wachten op goedkeuring.', pendingSubmissionOther: '⏳ Je hebt {n} bijdragen die wachten op goedkeuring.' };
nl.contributions = { approvedOne: '{n} goedgekeurde bijdrage', approvedFew: '{n} goedgekeurde bijdragen', approvedMany: '{n} goedgekeurde bijdragen', approvedOther: '{n} goedgekeurde bijdragen', contributorBadge: ' · ⭐ Bijdrager' };
nl.admin = { uploadingFile: '{file} uploaden…', importedMinifigs: '{inserted} van {parsed} minifiguren geïmporteerd. Ze worden tijdens de waardering aan prijzen gekoppeld.', uploadFailed: 'Mislukt: {error}', lastRun: 'laatste uitvoering {when}{duration}' };
nl.downloads = { interrupted: 'Download onderbroken bij {pct}% — tik op ‘Hervatten’ om door te gaan.', resume: 'Hervatten ({pct})', scanProgress: '{current} van {total} identificeren…' };
Object.assign(nl.detail, { acquired: 'Verkregen op {date}{source}' });
Object.assign(nl.wishlist, { targetPriceCurrency: 'Doelprijs ({symbol})', suggestedPrice: 'Voorgesteld: {price}' });
Object.assign(nl.wishlist, { ackAlert: 'Waarschuwing voor doelprijs negeren', alertAcked: 'Waarschuwing genegeerd' });
nl.minifigs = { appearsInSetsOne: 'Komt voor in {n} set', appearsInSetsFew: 'Komt voor in {n} sets', appearsInSetsMany: 'Komt voor in {n} sets', appearsInSetsOther: 'Komt voor in {n} sets' };
Object.assign(nl.admin, { syncJobRunning: '{label}: bezig…', syncJobSkipped: 'overgeslagen — {n}', syncJobSummary: '{processed} verwerkt, {updated} bijgewerkt, {rejected} afgewezen', syncJobResult: '{label}: {summary}', syncJobFailed: '{label} mislukt: {error}', uploadSuccessToast: 'BrickLink-minifiguurcatalogus: {inserted} geïmporteerd', uploadErrorToast: 'Catalogusupload mislukt: {error}', countRunning: '{n} bezig', countHealthy: '{n} gezond', countFailed: '{n} mislukt', countNotRun: '{n} nog niet uitgevoerd', completedSlices: '{n} veilige delen voltooid', jobId: 'Taak #{id}', filled: '{n} gevuld', processed: '{n} verwerkt', figures: '{n} minifiguren', noItemsProcessed: 'Geen items verwerkt', anomalyResolved: 'Afwijking opgelost.', anomalyIgnored: 'Afwijking genegeerd.', anomalyResolveFailed: 'Kon afwijking niet bijwerken.', });
Object.assign(nl.admin, { jobStarted: 'Taak #{id} gestart', jobFailed: 'Taak mislukt: {error}', maintenanceComplete: '{label} voltooid', maintenanceFailed: '{label} mislukt: {error}', lastSeen: 'voor het laatst gezien {when}' });
Object.assign(nl.detail, { uploadFailed: 'Upload mislukt: {error}', removeFailed: 'Verwijderen mislukt: {error}', forecastUpside: 'de verwachting heeft nog ~{pct} opwaarts potentieel' }); nl.data = { reportFailed: 'Rapport mislukt: {error}', restoreFailed: 'Herstellen mislukt: {error}', retryFailed: 'Opnieuw proberen mislukt: {error}', exportFailed: 'Export mislukt: {error}', importFailed: 'Import mislukt: {error}', bricklinkImportFailed: 'BrickLink-import mislukt: {error}' }; nl.integrations = { bricksetSyncFailed: 'Brickset-synchronisatie mislukt: {error}' }; nl.scanner = { timedOut: 'Dit duurde te lang — probeer opnieuw.', timedOutShort: 'Time-out', scanFailed: 'Fout: {error}' };
Object.assign(nl.common, { errorWithDetails: 'Fout: {error}' }); Object.assign(nl.integrations, { bricksetSyncResult: '{added} sets geïmporteerd ({skipped} niet in de catalogus, {total} totaal op Brickset).', bricksetSyncSuccess: 'Brickset-synchronisatie: {added} sets toegevoegd' }); Object.assign(nl.scanner, { bulkPartial: '{added} van {total} toegevoegd — {failed} mislukt, probeer opnieuw', addSetsFailed: 'Sets toevoegen mislukt: {error}' }); nl.portfolio = { collectionLoadFailed: 'Collectie laden mislukt: {error}', bulkRemovePartial: '{removed} van {total} verwijderd — {failed} mislukt, probeer opnieuw', restoredCount: '{restored} van {total} hersteld' };
Object.assign(nl.settings, { currencyUpdated: 'Valuta gewijzigd naar {currency}' });
Object.assign(nl.common, { offlineActionsSynced: '{count} offline acties gesynchroniseerd', offlineActionsDiscarded: '{count} offline acties konden niet worden gesynchroniseerd en zijn verwijderd', localItemsSynced: '{count} lokale items gesynchroniseerd', kidsXp: '+{xp} XP! {level} {badge}', copied: '{label} gekopieerd' }); Object.assign(nl.admin, { serviceTestResult: '{head} — {detail} ({ms} ms)', providerStatus: '{provider}: {status}', serviceTestFailed: 'Mislukt: {error}', providerTestFailed: 'Test van {provider} mislukt', featureFlagStatus: '{flag}: {status}{suffix}', featureFlagUpdateFailed: '{flag} kon niet worden bijgewerkt: {error}', providerSaved: '{provider} opgeslagen.', providerSaveFailed: 'Fout bij opslaan van {provider}: {error}', pricingConfigLoadFailed: 'Prijsconfiguratie kon niet worden geladen: {error}', resetFailed: 'Opnieuw instellen mislukt: {error}', contributionAction: '{action} — {applied}', enabled: 'ingeschakeld', disabled: 'uitgeschakeld', approved: 'Goedgekeurd', rejected: 'Afgewezen' }); Object.assign(nl.minifigs, { ownedCount: '{count} in bezit' }); Object.assign(nl.data, { restoredFromBackup: '{count} sets hersteld van {date}', migrationStillFailing: '{count} items mislukken nog: {error}', migrationComplete: 'Klaar — {count} items gesynchroniseerd.', importResult: '✓ {imported} geïmporteerd, {skipped} overgeslagen, {errors} fouten', setsImported: '{count} sets geïmporteerd', bricklinkImportResult: '✓ {added} sets toegevoegd, {skipped} overgeslagen. {errors}', bricklinkSetsImported: '{count} sets geïmporteerd uit BrickLink-bestellingen' }); Object.assign(nl.integrations, { keyRemoved: '{label}-sleutel verwijderd', keyVerified: '{label}-sleutel gecontroleerd en opgeslagen' }); Object.assign(nl.scanner, { setNotFound: 'Set {setNum} is niet gevonden in de catalogus.', localAiOfflineFailed: 'AI op het apparaat is mislukt en je bent offline: {error}', addItemFailed: 'Kan {name} niet toevoegen: {error}', minifig: 'minifiguur', itemsAdded: '{count} items aan de kluis toegevoegd', itemsSavedOffline: '{count} offline opgeslagen — wordt gesynchroniseerd', setsSavedOffline: '{count} sets offline opgeslagen — worden gesynchroniseerd bij verbinding' }); Object.assign(nl.portfolio, { soldFor: 'Verkocht voor {price} — uit de kluis verwijderd' });
Object.assign(nl.common, { offlineActionsSyncedOne: '{count} offline actie gesynchroniseerd', offlineActionsSyncedOther: '{count} offline acties gesynchroniseerd', offlineActionsDiscardedOne: '{count} offline actie kon niet worden gesynchroniseerd en is verwijderd', offlineActionsDiscardedOther: '{count} offline acties konden niet worden gesynchroniseerd en zijn verwijderd', localItemsSyncedOne: '{count} lokaal item gesynchroniseerd', localItemsSyncedOther: '{count} lokale items gesynchroniseerd', kidsXp: '+{xp} XP!{details}', kidsXpLevel: ' Niveau {level}!', kidsXpBadge: ' · Insigne: {badge}! 🎉' }); Object.assign(nl.scanner, { itemsAddedOne: '{count} item aan de kluis toegevoegd', itemsAddedOther: '{count} items aan de kluis toegevoegd', itemsSavedOfflineOne: '{count} item offline opgeslagen — wordt gesynchroniseerd', itemsSavedOfflineOther: '{count} items offline opgeslagen — worden gesynchroniseerd', setsSavedOfflineOne: '{count} set offline opgeslagen — wordt gesynchroniseerd bij verbinding', setsSavedOfflineOther: '{count} sets offline opgeslagen — worden gesynchroniseerd bij verbinding' }); Object.assign(nl.portfolio, { wishlistAlertsTooltip: 'Verlanglijstmeldingen ({spikes} pieken, {drops} prijsdalingen)', bulkLocationPartial: '{updated} van {total} bijgewerkt — {failed} mislukt, probeer die opnieuw' });
Object.assign(nl.data, { restoredFromBackupOne: '{count} set hersteld van {date}', restoredFromBackupOther: '{count} sets hersteld van {date}' }); Object.assign(nl.integrations, { bricksetSyncResultOne: '{count} set geïmporteerd ({skipped} niet in catalogus, {total} totaal op Brickset).', bricksetSyncResultOther: '{count} sets geïmporteerd ({skipped} niet in catalogus, {total} totaal op Brickset).', bricksetSyncSuccessOne: 'Brickset-sync: {count} set toegevoegd', bricksetSyncSuccessOther: 'Brickset-sync: {count} sets toegevoegd' }); Object.assign(nl.wishlist, { unreadAlertsOne: '{count} ongelezen melding', unreadAlertsOther: '{count} ongelezen meldingen' }); Object.assign(nl.portfolio, { wishlistAlertsTooltip: 'Verlanglijstmeldingen ({spikes}, {drops})', wishlistAlertSpikesOne: '{count} piek', wishlistAlertSpikesOther: '{count} pieken', wishlistAlertDropsOne: '{count} prijsdaling', wishlistAlertDropsOther: '{count} prijsdalingen', insightSignal: 'Doorverkoop {direction}{pct}% tegenover {basis}{quantity}', insightMarket: 'markt', insightValue: 'waarde', insightQuantity: ' · ×{count}' });
Object.assign(nl.kids, { badgeCelebration: 'Nieuwe badge: {badge}! 🎉', badgeQuip: 'Jij bent een bouwsuperster! 🌟', levelCelebration: 'Level {level} bereikt! 🎉', levelQuip: 'Blijf bouwen! 🧱', badgeFirstBrick: 'Eerste steen!', badgeJuniorBuilder: 'Jonge bouwer', badgeArchitect: 'Bouwmeester', badgeMaster: 'Meesterbouwer', badgeGrandMaster: 'Grootmeester', badgeLegend: 'Legendarisch!' });
Object.assign(nl.data, { csvImportConfirmTitleOne: '1 set importeren?', csvImportConfirmTitleOther: '{count} sets importeren?', csvImportMore: ' en nog {count}', csvImportConfirmMessage: 'Beginnend met: {sample}{more}. Bestaande sets blijven behouden.', importConfirm: 'Importeren' });
Object.assign(nl.scanner, { setNumberMatched: 'Setnummer komt overeen met de catalogus.' });
Object.assign(nl.portfolio, { insightHeadlineOne: '≈ {value} potentieel bij verkoop van 1 set nu', insightHeadlineOther: '≈ {value} potentieel bij verkoop van {count} sets nu' });
Object.assign(nl.market, { goodTimeToSell: 'Goed moment om te verkopen', goodTimeToBuy: 'Goed moment om te kopen', onlyForSale: 'Slechts {count} nu te koop', askingHighHint: 'Verkopers vragen veel — zet hem rond de recente verkoopprijs om snel te verkopen', askingLowHint: 'Onder recente verkoopprijzen aangeboden — goed moment om te kopen', askingSummary: '{count} nu te koop · vraagprijs {asking}', askingSummaryWithSold: '{count} nu te koop · vraagprijs {asking} tegenover recent verkocht voor {sold}' });
Object.assign(nl.game, { marketGenius: '{score}/5 — market genius! 🎯', streakQuipOne: 'Streak: {count} day.', streakQuipOther: 'Streak: {count} days.' }); nl.market = Object.assign(nl.market || {}, { sellingAbove: 'Selling about {pct} above this value', sellingBelow: 'Selling about {pct} below this value' }); Object.assign(nl.scanner, { findingSet: 'Finding set...', lookingUpSet: 'Looking up {setNum} in the catalog.' });
Object.assign(nl.game, { marketGenius: '{score}/5 — marktgenie! 🎯', streakQuipOne: 'Reeks: {count} dag.', streakQuipOther: 'Reeks: {count} dagen.' });
Object.assign(nl.market, { sellingAbove: 'Verkoopt ongeveer {pct} boven deze waarde', sellingBelow: 'Verkoopt ongeveer {pct} onder deze waarde' }); Object.assign(nl.scanner, { findingSet: 'Set wordt gezocht…', lookingUpSet: '{setNum} wordt in de catalogus opgezocht.', bulkMatched: '{matched} van {total} gevonden' }); Object.assign(nl.game, { revealCorrect: '🎯 Raak! — het is {value}', revealIncorrect: 'Bijna — het is {value}' }); Object.assign(nl.catalog, { activeFiltersOne: '1 actief', activeFiltersOther: '{count} actief' }); Object.assign(nl.portfolio, { anniversaryGain: 'Gekocht voor {paid} — sindsdien {gain} gestegen.', anniversaryNoGain: 'Gekocht voor {paid}. Sommige sets zijn voor liefde, niet voor winst.', anniversaryQuip: 'De tijd vliegt als je bouwt.', anniversaryCelebrationOne: '1 jaar met {set}! 🎂', anniversaryCelebrationOther: '{count} jaar met {set}! 🎂' });
Object.assign(nl.market, { partsCoverage: '{pct}% onderdelen gedekt', forecastScenarios: 'Laag {bear} · Basis {base} · Hoog {bull}', salesSuffix: ' / {count} verkopen', newSold: 'Nieuw verkocht', usedSold: 'Gebruikt verkocht', viewOnBrickLink: 'Bekijken op BrickLink' }); Object.assign(nl.catalog, { loadFailedDetail: '{error}. Controleer je verbinding en probeer het opnieuw.' }); Object.assign(nl.portfolio, { moreThemesOne: '+1 thema meer', moreThemesOther: '+{count} thema’s meer', sealedParts: 'Verzegeld {sealed} · {approximate}Onderdelen {parts}' }); nl.advisor = Object.assign(nl.advisor || {}, { moreThemesOne: '+1 ander thema in je kluis', moreThemesOther: '+{count} andere thema’s in je kluis' });
Object.assign(nl.game, { loadFailed: 'Het spel van vandaag kon niet laden: {error}' }); Object.assign(nl.contributions, { loadFailed: 'Kon niet laden: {error}' }); Object.assign(nl.me, { wrappedLoadFailed: 'Je jaar kon niet laden: {error}', wrappedValueChange: 'Kluis {direction} {value} dit jaar', wrappedUp: 'omhoog', wrappedDown: 'omlaag' });
Object.assign(nl.catalog, { filterSummaryNone: 'Geen actieve filters', filterSummaryActiveOne: '{count} actief: {items}', filterSummaryActiveOther: '{count} actief: {items}', filterSummarySearch: 'Zoeken naar “{value}”', filterSummaryStatusRetired: 'Alleen uit productie', filterSummaryStatusActive: 'Alleen actief', filterSummaryStatusRetiring: 'Binnenkort uit productie', filterSummaryDeal: 'Alleen aanbiedingen', filterSummaryRangeYear: 'Jaar', filterSummaryRangePieces: 'Onderdelen', filterSummaryRangeValue: 'Waarde', filterSummaryRangeBetween: '{label} {min}–{max}', filterSummaryRangeMin: '{label} ≥ {value}', filterSummaryRangeMax: '{label} ≤ {value}', filterSummaryPiecesValue: '{value} stuks', filterSummaryValueAmount: 'US${value}' });
Object.assign(nl.minifigs, { filterSummaryNone: 'Geen actieve filters', filterSummaryActiveOne: '{count} actief: {items}', filterSummaryActiveOther: '{count} actief: {items}', filterSummarySearch: 'Zoeken naar “{value}”', filterSummaryRarity: 'Zeldzaamheid: {rarity}', filterSummaryRarityCommon: 'Gewoon', filterSummaryRarityUncommon: 'Ongewoon', filterSummaryRarityRare: 'Zeldzaam', filterSummaryRarityLegendary: 'Legendarisch', filterSummaryOwned: 'Alleen in bezit', filterSummaryUnowned: 'Alleen niet in bezit' });
Object.assign(nl.catalog, { emptySearchResults: 'Niets komt overeen met “{query}”. Probeer anders te zoeken of wis de filters.', emptyFilteredResults: 'Geen sets komen overeen met deze filters. Probeer anders te zoeken of wis de filters.' });
Object.assign(nl.advisor, { retiredSetsOfTotalOne: '{retired} van {total} set is uit productie', retiredSetsOfTotalOther: '{retired} van {total} sets zijn uit productie' });
Object.assign(nl.scanner, { duplicateConfirmTitle: 'Al in bezit', duplicateConfirmMessage: 'Je hebt {names} al in je kluis. Nog een exemplaar toevoegen?', duplicateConfirmAction: 'Toch toevoegen' });
Object.assign(nl.scanner, { minifigWithSeries: '{minifig}, serie {series}', minifigWithRarity: '{minifig} — zeldzaamheid: {rarity}', rarityUnknown: 'Onbekend' });
Object.assign(nl.scanner, { setsFoundOne: '{count} set gevonden', setsFoundOther: '{count} sets gevonden', minifigsFoundOne: '{count} minifiguur gevonden', minifigsFoundOther: '{count} minifiguren gevonden', mixedResultsFoundOne: '{count} resultaat gevonden (sets en minifiguren)', mixedResultsFoundOther: '{count} resultaten gevonden (sets en minifiguren)', confidenceHigh: 'Hoge zekerheid', confidenceMedium: 'Gemiddelde zekerheid', confidenceLow: 'Lage zekerheid', confidenceUnknown: 'Zekerheid van overeenkomst niet beschikbaar', matchHigh: 'Hoge overeenkomst', matchMedium: 'Gemiddelde overeenkomst', matchLow: 'Lage overeenkomst', match: 'Overeenkomst' });
Object.assign(nl.detail, { sellReasonGainSincePurchase: 'Sinds aankoop {roi} gestegen', sellReasonTrendDown: 'De prijstrend draait omlaag', sellReasonClimbFlattened: 'De prijsstijging vlakt af', sellReasonLittleUpside: 'Slechts {upside} voorspeld potentieel over', sellReasonSellsFast: '{volume} recente verkopen wijzen op snelle verkoop', sellReasonWatchClosely: 'Houd de markt goed in de gaten', sellReasonStillClimbing: 'De prijs stijgt nog steeds', sellReasonForecastUpside: 'De voorspelling geeft nog {upside} potentieel', sellReasonNotRetired: 'Nog niet uit productie', sellReasonNoSellTrigger: 'Nog geen duidelijk verkoopsignaal' });
Object.assign(nl.data, { migrationStillFailingOne: 'Nog {count} element mislukt: {error}', migrationStillFailingOther: 'Nog {count} elementen mislukt: {error}', migrationCompleteOne: 'Klaar — {count} element gesynchroniseerd.', migrationCompleteOther: 'Klaar — {count} elementen gesynchroniseerd.', setsImportedOne: '{count} set geïmporteerd', setsImportedOther: '{count} sets geïmporteerd', bricklinkSetsImportedOne: '{count} set geïmporteerd uit BrickLink-bestellingen', bricklinkSetsImportedOther: '{count} sets geïmporteerd uit BrickLink-bestellingen' });
Object.assign(nl.detail, { sellReasonSellsFastOne: '{volume} recente verkoop wijst op snelle verkoop', sellReasonSellsFastOther: '{volume} recente verkopen wijzen op snelle verkoop' });
Object.assign(nl.minifigs, { setExclusive: 'Set-exclusief', inSetsOne: 'Onderdeel van {count} set', inSetsOther: 'Onderdeel van {count} sets', partsOne: '{count} onderdeel', partsOther: '{count} onderdelen' });
Object.assign(nl.minifigs, { emptySearchResults: 'Niets komt overeen met “{query}”.', emptyFilteredResults: 'Geen minifiguren komen overeen met deze filters.' });
Object.assign(nl.detail, { partsComplete: 'Compleet', partsMissingOne: '{count} onderdeel ontbreekt', partsMissingOther: '{count} onderdelen ontbreken', allPartsPresent: 'alle onderdelen aanwezig' });
Object.assign(nl.build, { needPartsOne: 'Nog {n} onderdeel nodig', needPartsOther: 'Nog {n} onderdelen nodig' });
Object.assign(nl.card, { lotsOne: '{n} lot', lotsOther: '{n} lots' });
Object.assign(nl.market, { salesSuffixOne: ' / {count} verkoop', salesSuffixOther: ' / {count} verkopen' });
Object.assign(nl.data, { importedCountOne: '{n} set geïmporteerd', importedCountOther: '{n} sets geïmporteerd', skippedCountOne: '{n} set overgeslagen', skippedCountOther: '{n} sets overgeslagen', errorsCountOne: '{n} fout', errorsCountOther: '{n} fouten', setsAddedCountOne: '{n} set toegevoegd', setsAddedCountOther: '{n} sets toegevoegd', importResult: '✓ {imported}; {skipped}; {errors}', bricklinkImportResult: '✓ {added}; {skipped}. {errors}' });
Object.assign(nl.admin, { minifigsImportedOne: '{n} minifiguur', minifigsImportedOther: '{n} minifiguren', minifigsParsedOne: '{n} minifiguur', minifigsParsedOther: '{n} minifiguren', importedMinifigs: '{inserted} van {parsed} geïmporteerd. Prijzen worden tijdens de waardering gekoppeld.' });
Object.assign(nl.time, {"daysAgoOne":"{n} dagen geleden","daysAgoOther":"{n} dagen geleden"});
Object.assign(nl.scanner, {"bulkPartialOne":"{added} van {total} toegevoegd — {failed} mislukt, probeer opnieuw","bulkPartialOther":"{added} van {total} toegevoegd — {failed} mislukt, probeer opnieuw"});
Object.assign(nl.kids, {"setsToGoOne":"Nog {n} sets","setsToGoOther":"Nog {n} sets","earnedOne":"{n} van {total} verdiend","earnedOther":"{n} van {total} verdiend"});
Object.assign(nl.market, {"familiesOne":"{n} onafhankelijke marktbronnen","familiesOther":"{n} onafhankelijke marktbronnen","salesOne":"{n} geverifieerde verkopen","salesOther":"{n} geverifieerde verkopen","onlyForSaleOne":"Slechts {count} nu te koop","onlyForSaleOther":"Slechts {count} nu te koop","askingSummaryOne":"{count} nu te koop · vraagprijs {asking}","askingSummaryOther":"{count} nu te koop · vraagprijs {asking}","askingSummaryWithSoldOne":"{count} nu te koop · vraagprijs {asking} tegenover recent verkocht voor {sold}","askingSummaryWithSoldOther":"{count} nu te koop · vraagprijs {asking} tegenover recent verkocht voor {sold}"});
Object.assign(nl.detail, {"fromSourcesOne":"Uit {n} marktbronnen","fromSourcesOther":"Uit {n} marktbronnen","reviewsOne":"{n} recensies","reviewsOther":"{n} recensies","priceHistoryDaysOne":"Prijsgeschiedenis · {n} dagen","priceHistoryDaysOther":"Prijsgeschiedenis · {n} dagen","priceHistoryShortOne":"Prijsgeschiedenis · {n} d","priceHistoryShortOther":"Prijsgeschiedenis · {n} d"});
Object.assign(nl.alerts, {"priceDropOne":"Prijsdaling · {n} d geleden","priceDropOther":"Prijsdaling · {n} d geleden"});
Object.assign(nl.portfolio, {"bulkLocationPartialOne":"{updated} van {total} bijgewerkt — {failed} mislukt, probeer die opnieuw","bulkLocationPartialOther":"{updated} van {total} bijgewerkt — {failed} mislukt, probeer die opnieuw","bulkRemovePartialOne":"{removed} van {total} verwijderd — {failed} mislukt, probeer opnieuw","bulkRemovePartialOther":"{removed} van {total} verwijderd — {failed} mislukt, probeer opnieuw","restoredCountOne":"{restored} van {total} hersteld","restoredCountOther":"{restored} van {total} hersteld"});
Object.assign(nl.wishlist, {"setsCountOne":"{n} sets","setsCountOther":"{n} sets","alertsCountOne":"{n} meldingen","alertsCountOther":"{n} meldingen"});
Object.assign(nl.admin, {"syncJobSkippedOne":"overgeslagen — {n}","syncJobSkippedOther":"overgeslagen — {n}","syncJobSummaryOne":"{processed} verwerkt, {updated} bijgewerkt, {rejected} afgewezen","syncJobSummaryOther":"{processed} verwerkt, {updated} bijgewerkt, {rejected} afgewezen","uploadSuccessToastOne":"BrickLink-minifiguurcatalogus: {n} geïmporteerd","uploadSuccessToastOther":"BrickLink-minifiguurcatalogus: {n} geïmporteerd","contributionActionOne":"{action} — {n}","contributionActionOther":"{action} — {n}"});
Object.assign(nl.data, {"csvImportMoreOne":" en nog {n}","csvImportMoreOther":" en nog {n}","csvImportConfirmMessageOne":"Beginnend met: {sample}{more}. Bestaande sets blijven behouden.","csvImportConfirmMessageOther":"Beginnend met: {sample}{more}. Bestaande sets blijven behouden."});
Object.assign(nl.me, {"trophyShelfOne":"Trofeeplank ({n}/6)","trophyShelfOther":"Trofeeplank ({n}/6)"});
Object.assign(nl.build, {"ofOwnedSetsOne":"van {n} sets in bezit","ofOwnedSetsOther":"van {n} sets in bezit","indexingOne":"{n} extra set(s) worden op de achtergrond geïndexeerd…","indexingOther":"{n} extra set(s) worden op de achtergrond geïndexeerd…"});
Object.assign(nl.counts, {"collectedOne":"{owned}/{total} verzameld","collectedOther":"{owned}/{total} verzameld","ownedOne":"{n} in bezit","ownedOther":"{n} in bezit","ofFigsOne":"van {total} figuren","ofFigsOther":"van {total} figuren","resultsOne":"{n} resultaten","resultsOther":"{n} resultaten","figsOne":"{n} figuren","figsOther":"{n} figuren"});
Object.assign(nl.minifigs, {"ownedCountOne":"{n} in bezit","ownedCountOther":"{n} in bezit"});
Object.assign(nl.catalog, {"filtersWithCountOne":"Filters · {n}","filtersWithCountOther":"Filters · {n}"});
Object.assign(nl.scanner, {"bulkMatchedOne":"{matched} van {total} gevonden","bulkMatchedOther":"{matched} van {total} gevonden"});
Object.assign(nl.kids, {"pcsOne":"{n} onderdelen","pcsOther":"{n} onderdelen"});
Object.assign(nl.card, {"gamePiecesOne":"{n} stenen","gamePiecesOther":"{n} stenen","piecesOne":"{n} STKS","piecesOther":"{n} STKS"});
Object.assign(nl.scanner, { bulkMatchedOne: '{n} van {total} gevonden', bulkMatchedOther: '{n} van {total} gevonden' });
Object.assign(nl.kids, { pcsOne: '{n} onderdeel', pcsOther: '{n} onderdelen' });
Object.assign(nl.card, { gamePiecesOne: '{n} steen', gamePiecesOther: '{n} stenen', piecesOne: '{n} onderdeel', piecesOther: '{n} onderdelen' });
Object.assign(nl.share ??= {}, {"gameTitle":"Price It!","gameText":"🧱 Price It! {day}\\n{tiles} {score}/5 · streak {streak}\\nGuess LEGO market prices on BricksVault","setText":"Check out {name} ({setNum}) on BricksVault!","setDialogTitle":"Share {name}","portfolioTitle":"My LEGO BricksVault","portfolioText":"Check out my LEGO collection on BricksVault!","portfolioDialogTitle":"Share my BricksVault","wrappedTitle":"Brick Wrapped {year}","wrappedBest":"Best performer: {name}{roi}","wrappedTracked":"Tracked with BricksVault","wrappedSetsAdded":"sets added","wrappedPiecesAdded":"pieces","wrappedValueChange":"vault value change","wrappedTagline":"BRICKSVAULT · STACK SOMETHING BEAUTIFUL"});
Object.assign(nl.share, { gameTitle: 'Prijs het!', gameText: '🧱 Prijs het! {day}\n{tiles} {score}/5 · reeks {streak}\nRaad LEGO-marktprijzen op BricksVault', setText: 'Bekijk {name} ({setNum}) op BricksVault!', setDialogTitle: 'Deel {name}', portfolioTitle: 'Mijn LEGO BricksVault', portfolioText: 'Bekijk mijn LEGO-collectie op BricksVault!', portfolioDialogTitle: 'Deel mijn BricksVault', wrappedTitle: 'Brick-jaaroverzicht {year}', wrappedBest: 'Beste prestatie: {name}{roi}', wrappedTracked: 'Bijgehouden met BricksVault', wrappedValueChange: 'waardeverandering van de kluis', wrappedTagline: 'BRICKSVAULT · BOUW IETS MOOIS', wrappedHeading: 'Brick-jaaroverzicht', wrappedDescription: 'Jouw verzamelaarsjaar in cijfers — deel het.', wrappedLoading: 'Je stenen worden geteld…', wrappedSummaryTitle: '🧱 Mijn Brick-jaaroverzicht {year}', wrappedSetsAddedOne: '{count} set toegevoegd', wrappedSetsAddedOther: '{count} sets toegevoegd', wrappedPiecesAddedOne: '{count} onderdeel', wrappedPiecesAddedOther: '{count} onderdelen', wrappedMinifigsOne: '{count} minifiguur', wrappedMinifigsOther: '{count} minifiguren', wrappedInvested: 'geïnvesteerd', wrappedSoldOne: '{count} set verkocht', wrappedSoldOther: '{count} sets verkocht', wrappedSoldLabel: 'verkocht', wrappedBestLabel: 'Beste prestatie', wrappedBestCanvas: 'Beste prestatie', wrappedBestCanvasWithRoi: 'Beste prestatie · {roi}', wrappedLongestHeld: 'Langst in bezit: {name} (sinds {year})', wrappedClose: 'Sluiten', wrappedShareYear: 'Deel mijn jaar' });
Object.assign(nl.data, { reportPreparing: 'Rapport wordt voorbereid…', insuranceReportTitle: 'BricksVault-verzekeringsrapport', reportSharedReady: 'Rapport is klaar — open het en druk het af als PDF.', reportDownloadedReady: 'Rapport gedownload — open het en druk het af als PDF.', noSnapshotsYet: 'Nog geen momentopnamen — de eerste wordt volgende zondag gemaakt.', backupsUnavailable: 'Back-ups zijn nu niet beschikbaar.', retryingSync: 'Synchronisatie wordt opnieuw geprobeerd…', guestVaultSynced: 'Gastkluis gesynchroniseerd', exportPreparing: 'Export wordt voorbereid…', collectionExportTitle: 'Deel BricksVault-collectie', guestExportShared: 'Je lokale gastexport is klaar om te delen of op te slaan.', guestExportDownloaded: 'Export gedownload uit lokale gastgegevens.', syncedExportShared: 'Je gesynchroniseerde export is klaar om te delen of op te slaan.', syncedExportDownloaded: 'Export gedownload uit je gesynchroniseerde kluis.' });
// en.js declares `market` twice as an object literal, so the later one wins and
// keys added to the earlier block are silently dropped. Assigning after the fact
// lands on whichever object survived.
Object.assign(nl.market, { comps: '{n} vergelijkingen', slashComps: ' / {n} vergelijkingen', usedValue: 'Gebruikt: {price}', updated: 'Bijgewerkt {date}', compsAboveMsrp: 'Nieuwverkopen liggen {amount} ({pct}) boven de adviesprijs.', compsBelowMsrp: 'Nieuwverkopen liggen {amount} ({pct}) onder de adviesprijs.' });

Object.assign(nl.detail, { tagsMoreOne: '+{n} meer', tagsMoreOther: '+{n} meer' });
Object.assign(nl.market, { compsOne: '{n} vergelijking', compsOther: '{n} vergelijkingen', slashCompsOne: ' / {n} vergelijking', slashCompsOther: ' / {n} vergelijkingen' });

Object.assign(nl.settings, { appLockUnchanged: 'Appvergrendeling niet gewijzigd: {error}' });
Object.assign(nl.game, { checkGuessFailed: 'De schatting kon niet worden gecontroleerd: {error}' });
Object.assign(nl.alerts, { sellOpportunityOne: 'Verkoopkans · {n} dag geleden', sellOpportunityOther: 'Verkoopkans · {n} dagen geleden' });
Object.assign(nl.detail, { minifigsCountOne: '{n} minifiguur', minifigsCountOther: '{n} minifiguren' });
Object.assign(nl.market, { listingsOne: '{n} advertentie', listingsOther: '{n} advertenties', slashListingsOne: ' / {n} advertentie', slashListingsOther: ' / {n} advertenties', slashSamplesOne: ' / {n} steekproef', slashSamplesOther: ' / {n} steekproeven' });
Object.assign(nl.scanner, { estimatedValue: '(~geschatte waarde)', marketGrabThreshold: 'Markt {market} — onder {price} is het een buitenkans{estimated}', underMarket: '{amount} onder de markt{estimated}', withinMarket: 'binnen {pct}% van de markt{estimated}', overMarket: '{amount} boven de markt{estimated}' });

Object.assign(nl.admin, { llmUnavailable: 'LLM-routering niet beschikbaar', llmMergeBalance: 'Resterend Merge-tegoed deze maand', llmMeteredNote: 'Berekend uit de kosten die Merge per aanroep meldt — het Merge-dashboard is leidend.', llmEffective: 'Draait nu', llmEffectiveNone: 'geen geconfigureerde provider', llmLivePool: 'Actuele gratis pool (automatisch)', llmNoKey: 'geen sleutel', llmNoKeyHint: 'Deze provider heeft geen API-sleutel, dus de stap wordt tijdens uitvoering overgeslagen.', llmMoveUp: 'Stap eerder', llmMoveDown: 'Stap later', llmOn: 'Aan', llmOff: 'Uit', llmReset: 'Terug naar standaard', llmSave: 'Routering opslaan', llmSaved: 'LLM-routering opgeslagen', llmSaveFailed: 'Kon LLM-routering niet opslaan', llmRefreshModels: 'Merge-modellen vernieuwen', llmModelsRefreshedOne: '{n} Merge-model vernieuwd', llmModelsRefreshedOther: '{n} Merge-modellen vernieuwd', llmModelsFailed: 'Kon de Merge-modelcatalogus niet vernieuwen' });

Object.assign(nl.admin, { llmModelPlaceholder: "provider/model, bijv. openai/gpt-5.6-luna" });

Object.assign(nl.admin, { llmReload: "Opnieuw laden", llmChooseModel: "Kies een model", llmCustomModel: "Eigen model-ID…", llmSpentOf: "{spent} van {budget} besteed", llmLivePoolShort: "gratis pool", llmUnsaved: "Niet-opgeslagen wijzigingen", llmModelsOther: "Overig", llmWorkload_scan: "Fotoscan", llmWorkload_advisor: "AI-adviseur", llmWorkload_valuation: "Waardering", llmWorkload_listing: "Advertentieconcepten" });

Object.assign(nl.admin, { llmLivePoolHint: "Dagelijks automatisch bijgewerkt via OpenRouter" });

Object.assign(nl.admin, { jobAccepted: '{label} geaccepteerd en verschijnt binnenkort in Activiteit', pricechartingBulkAccepted: 'PriceCharting-bulkdownload gestart; resultaten verschijnen binnenkort in Activiteit', pricechartingVerifyAccepted: 'PriceCharting-verificatie gestart; bekijk Activiteit voor gepromoveerde koppelingen' });
Object.assign(nl.admin, { tools: { sets: 'Sets importeren', figs: 'Minifiguren importeren', upc: 'Barcodes aanvullen', populate: 'Dekking aanvullen', revalue: 'Prijzen herwaarderen', everything: 'Alle veilige bronnen aanvullen', pricechartingBulk: 'PriceCharting vernieuwen (LEGO-bulk)', pricechartingVerify: 'PriceCharting-koppelingen controleren', ebaySold: 'eBay-verkoopscan uitvoeren' }, maintenanceTools: { expire: 'Waarderingen laten verlopen', repair: 'Zoekindex repareren' }, countRunningOne: '{n} bezig', countRunningFew: '{n} bezig', countRunningMany: '{n} bezig', countRunningOther: '{n} bezig', countHealthyOne: '{n} gezond', countHealthyFew: '{n} gezond', countHealthyMany: '{n} gezond', countHealthyOther: '{n} gezond', countFailedOne: '{n} mislukt', countFailedFew: '{n} mislukt', countFailedMany: '{n} mislukt', countFailedOther: '{n} mislukt', countNotRunOne: '{n} nog niet uitgevoerd', countNotRunFew: '{n} nog niet uitgevoerd', countNotRunMany: '{n} nog niet uitgevoerd', countNotRunOther: '{n} nog niet uitgevoerd', completedSlicesOne: '{n} veilig deel voltooid', completedSlicesFew: '{n} veilige delen voltooid', completedSlicesMany: '{n} veilige delen voltooid', completedSlicesOther: '{n} veilige delen voltooid', filledOne: '{n} gevuld', filledFew: '{n} gevuld', filledMany: '{n} gevuld', filledOther: '{n} gevuld', processedOne: '{n} verwerkt', processedFew: '{n} verwerkt', processedMany: '{n} verwerkt', processedOther: '{n} verwerkt', figuresOne: '{n} minifiguur', figuresFew: '{n} minifiguren', figuresMany: '{n} minifiguren', figuresOther: '{n} minifiguren' });

Object.assign(nl.portfolio, { exploreBrick3d: 'Bekijk in 3D', exploreBrick3dLabel: 'Bekijk de BricksVault-steen in 3D', loadingBrick3d: '3D laden…' });

export default nl;
Object.assign(nl.detail, { movementUp: 'Up {pct}% over {days} days', movementDown: 'Down {pct}% over {days} days', movementResaleUp: ' · resale comps also rose', movementResaleDown: ' · resale comps also fell', movementMarketUp: ' · market guide also rose', movementMarketDown: ' · market guide also fell' });

