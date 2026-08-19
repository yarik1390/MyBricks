/** French. Missing keys fall back to English (see lib/i18n.js). */
export const fr = {
  nav: { vault: 'Coffre', catalog: 'Catalogue', scan: 'Scanner', minifigs: 'Figurines', me: 'Moi', badges: 'Badges' },
  common: {
    cancel: 'Annuler', save: 'Enregistrer', close: 'Fermer', retry: 'Réessayer',
    delete: 'Supprimer', edit: 'Modifier', done: 'Terminé', undo: 'Annuler',
    loading: 'Chargement…', search: 'Rechercher', all: 'Tous', none: 'Aucun',
    yes: 'Oui', no: 'Non', error: 'Une erreur est survenue', offline: 'Vous êtes hors ligne',
    seeAll: 'Tout voir', share: 'Partager',
    and: 'et',
  },
  settings: {
    title: 'Réglages', language: 'Langue',
    languageDesc: 'Suit votre appareil sauf si vous en choisissez une.', languageAuto: 'Automatique ({name})',
    currency: 'Devise', currencyDesc: 'Afficher les valeurs dans votre devise locale.',
    market: 'Marché', marketDesc: 'Marché local pour les offres en boutique. Les valeurs de revente restent en USD.',
    appearance: 'Apparence', notifications: 'Notifications', signOut: 'Se déconnecter',
  },
  detail: {
    value: 'Valeur', retired: 'Retiré', comingSoon: 'Bientôt', retiringSoon: 'Bientôt retiré',
    pieces: 'pièces', minifigs: 'figurines', retail: 'Prix public',
    addToVault: 'Ajouter au coffre', inVault: 'Dans le coffre', removeFromVault: 'Retirer du coffre',
    tabInfo: 'Infos', tabForecast: 'Prévision', tabCommunity: 'Communauté',
    reliablePrice: 'Prix fiable', pricingDetails: 'Détails du prix', priceHistory: 'Historique des prix',
    details: 'Détails', estimated: 'Estimé', year: 'Année', theme: 'Thème',
    addToWishlist: 'Ajouter aux envies', inWishlist: 'Dans vos envies',
    addToVaultPrice: 'Ajouter au coffre · {price}', priceHistoryDays: 'Historique des prix · {days} jours', priceHistoryShort: 'Historique des prix · {days} j', fromSources: 'De {n} sources de marché', fromSourcesOne: 'De 1 source de marché', typicalRange: ' · généralement {low}–{high}', likelyRange: ' · probablement {low}-{high}', tagsMore: '+{n} de plus', reviews: '{n} avis', reviewsOne: '1 avis', up: 'Hausse {pct}%', down: 'Baisse {pct}%',
  },
  counts: {
    results: '{n} résultats', resultsOne: '1 résultat', collected: '{owned}/{total} collectées', owned: '{n} en possession', ofFigs: 'sur {total} figurines', figs: '{n} figurines', figsOne: '1 figurine',
  },
  market: {
    sellNowLabel: 'Vendre maintenant',
    fastSaleAfterFees: 'vente rapide après frais',
    pctOfValue: '{pct}% de la valeur',
    pctOfFairValue: '{pct}% de la juste valeur',
    confidentlyPriced: '{pct}% évalués avec confiance',
    families: '{n} sources de marché indépendantes',
    familyOne: '1 source de marché indépendante',
    sales: '{n} ventes vérifiées',
    saleOne: '1 vente vérifiée',
    estimateUnlocks: 'L’estimation {list} se débloquera avec plus de données de ventes.',
    estimatesUnlock: 'Les estimations {list} se débloqueront avec plus de données de ventes.',
    soldEvidenceHeadline: 'Basé sur {sales} provenant de {markets}.',
    soldEvidenceFallback: 'Aucune vente vérifiée récente — l’estimation utilise les prix demandés ou des guides du marché.',
    soldEvidenceTitle: 'Ventes de référence',
    soldEvidenceNewSealed: 'Neuf et scellé',
    soldEvidenceUsedComplete: 'D’occasion et complet',
    soldEvidenceFresh: 'Récent',
    soldEvidenceOlder: 'Ancien',
    soldEvidenceSalesOne: '1 vente vérifiée',
    soldEvidenceSalesOther: '{n} ventes vérifiées',
    soldEvidenceMarketplacesOne: '1 place de marché',
    soldEvidenceMarketplacesOther: '{n} places de marché',
    partOutVerdictPartout: 'La vente en pièces rapporte plus',
    partOutVerdictSealed: 'Vendez-le scellé',
    partOutVerdictSame: 'Presque identique',
    partOutSellSealed: 'Vendre scellé',
    partOutSellParts: 'Vendre en pièces',
    partOutDeltaPartout: '{pct} de plus que la valeur scellée',
    partOutDeltaSealed: 'la valeur scellée est supérieure de {pct}',
    partOutClose: 'les valeurs sont proches',
    partOutCoverage: '{pct} des pièces évaluées',
    sellingAbove: 'Se vend environ {pct} au-dessus de cette valeur',
    sellingBelow: 'Se vend environ {pct} en dessous de cette valeur',
  },
  card: {
    pieces: '{n} PCS',
    perPiece: '{price}/pièce',
    lots: '{n} lots',
    deal: 'AFFAIRE {pct}',
    strongBuy: 'TRÈS BON PLAN {pct}',
    forecast2y: '{price} 2 ans',
    gamePieces: '{n} pièces',
    gameRetail: 'prix public {price}',
  },
  deal: {
    buyRetail: 'Disponible en magasin à environ {pct}% sous sa valeur de marché.',
    buyResale: 'Se vend environ {pct}% sous sa valeur de marché.',
    retiring: 'Bientôt retiré — fenêtre d’achat limitée.',
    premiumRetail: 'Actuellement au-dessus de sa valeur de marché.',
    premiumResale: 'Les prix demandés dépassent sa valeur de marché.',
    fair: 'Au niveau de sa valeur de marché.',
    labelBuy: 'ACHETER',
    labelStrongBuy: 'TRÈS BON PLAN',
    labelFair: 'PRIX JUSTE',
    labelPremium: 'AU-DESSUS',
    labelPct: '{label} · {pct}%',
  },
  time: {
    unknown: 'inconnu', today: 'Aujourd’hui', yesterday: 'Hier', daysAgo: 'il y a {n} jours',
  },
  me: {
    trophyShelf: 'Vitrine ({n}/6)',
  },
  kids: {
    xp: '{n} XP', xpToLevel: '{n} XP avant le niveau {level}', maxLevel: 'Niveau max !', pcs: '{n} pièces', earned: '{n} sur {total} obtenus', setsToGo: 'Encore {n} sets', setsToGoOne: 'Encore 1 set !',
  },
  fees: {
    marketplace: 'Frais de place de marché ({pct}%)', payment: 'Frais de paiement ({pct}% + fixe)',
  },
  alerts: {
    priceDrop: 'Baisse de prix · il y a {days} j', targetWas: '— votre objectif était {price}.',
  },
  game: {
    roundOf: 'Manche {n} sur {total}', pctOff: 'Écart de {pct}%', streakLine: '{day} · série {streak} · record {best}',
  },
  build: {
    needParts: 'Il manque {n} pièces', ofOwnedSets: 'sur {n} sets possédés', indexing: 'Indexation de {n} set(s) supplémentaire(s) en arrière-plan…',
  },
  catalog: {
    title: 'Catalogue', searchPlaceholder: 'Trouver un set', results: '{count} sets',
    sortValue: 'Valeur', sortGrowth: 'Croissance', sortNewest: 'Plus récents', sortTrending: 'Tendance',
    noResults: 'Aucun set trouvé', filters: 'Filtres', sort: 'Trier', clearFilters: 'Effacer les filtres',
  },
  vault: {
    title: 'Coffre', empty: 'Votre coffre est vide', emptyDesc: 'Ajoutez un set pour suivre sa valeur.',
    setsOwned: 'Sets possédés', totalValue: 'Valeur totale', invested: 'Investi', gain: 'Gain', addSet: 'Ajouter un set',
    investedAmount: 'Investi {amount}',
  },
  wishlist: {
    title: 'Liste d’envies', empty: 'Votre liste d’envies est vide', targetPrice: 'Prix cible',
    priceDropAlert: 'M’alerter en cas de baisse', remove: 'Retirer des envies',
    setsCount: '{n} sets', setsCountOne: '1 set', alertsCount: '{n} alertes', alertsCountOne: '1 alerte', nowPrice: 'Maintenant {price}',
  },
};
Object.assign(fr.catalog, { filtersWithCount: 'Filtres · {n}' });
fr.community = { pendingSubmissionOne: '⏳ Vous avez {n} contribution en attente d’approbation.', pendingSubmissionFew: '⏳ Vous avez {n} contributions en attente d’approbation.', pendingSubmissionMany: '⏳ Vous avez {n} contributions en attente d’approbation.', pendingSubmissionOther: '⏳ Vous avez {n} contributions en attente d’approbation.' };
fr.contributions = { approvedOne: '{n} contribution approuvée', approvedFew: '{n} contributions approuvées', approvedMany: '{n} contributions approuvées', approvedOther: '{n} contributions approuvées', contributorBadge: ' · ⭐ Contributeur' };
fr.admin = { uploadingFile: 'Import de {file}…', importedMinifigs: '{inserted} minifigurines sur {parsed} importées. Elles seront associées aux prix lors de leur évaluation.', uploadFailed: 'Échec : {error}', lastRun: 'dernière exécution {when}{duration}' };
fr.downloads = { interrupted: 'Téléchargement interrompu à {pct}% — touchez « Reprendre » pour continuer.', resume: 'Reprendre ({pct})', scanProgress: 'Identification de {current} sur {total}…' };
Object.assign(fr.detail, { acquired: 'Acquis le {date}{source}' });
Object.assign(fr.wishlist, { targetPriceCurrency: 'Prix cible ({symbol})', suggestedPrice: 'Suggéré : {price}' });
Object.assign(fr.wishlist, { ackAlert: 'Masquer l\'alerte de prix cible', alertAcked: 'Alerte masquée' });
fr.minifigs = { appearsInSetsOne: 'Apparaît dans {n} set', appearsInSetsFew: 'Apparaît dans {n} sets', appearsInSetsMany: 'Apparaît dans {n} sets', appearsInSetsOther: 'Apparaît dans {n} sets' };
Object.assign(fr.admin, { syncJobRunning: '{label} : en cours…', syncJobSkipped: 'ignoré — {n}', syncJobSummary: '{processed} traités, {updated} mis à jour, {rejected} rejetés', syncJobResult: '{label} : {summary}', syncJobFailed: '{label} a échoué : {error}', uploadSuccessToast: 'Catalogue de minifigurines BrickLink : {inserted} importées', uploadErrorToast: 'Échec de l’import du catalogue : {error}', countRunning: '{n} en cours', countHealthy: '{n} sains', countFailed: '{n} en échec', countNotRun: '{n} pas encore exécutés', completedSlices: '{n} tranches sûres terminées', jobId: 'Tâche #{id}', filled: '{n} remplis', processed: '{n} traités', figures: '{n} minifigurines', noItemsProcessed: 'Aucun élément traité' });
Object.assign(fr.admin, { jobStarted: 'Tâche #{id} démarrée', jobFailed: 'Échec de la tâche : {error}', maintenanceComplete: '{label} terminé', maintenanceFailed: 'Échec de {label} : {error}', lastSeen: 'vu pour la dernière fois {when}' });
Object.assign(fr.admin, { tools: { sets: 'Importer les sets', figs: 'Importer les minifigurines', upc: 'Compléter les codes-barres', populate: 'Compléter la couverture', revalue: 'Réévaluer les prix', everything: 'Compléter toutes les sources sûres', pricechartingBulk: 'Actualiser PriceCharting (lot LEGO)', pricechartingVerify: 'Vérifier les associations PriceCharting', pricesapi: 'Exécuter pricesAPI maintenant', ebaySold: 'Lancer la recherche des ventes eBay' }, maintenanceTools: { expire: 'Expirer les valorisations', repair: 'Réparer l’index de recherche' }, countRunningOne: '{n} en cours', countRunningFew: '{n} en cours', countRunningMany: '{n} en cours', countRunningOther: '{n} en cours', countHealthyOne: '{n} sain', countHealthyFew: '{n} sains', countHealthyMany: '{n} sains', countHealthyOther: '{n} sains', countFailedOne: '{n} en échec', countFailedFew: '{n} en échec', countFailedMany: '{n} en échec', countFailedOther: '{n} en échec', countNotRunOne: '{n} pas encore exécuté', countNotRunFew: '{n} pas encore exécutés', countNotRunMany: '{n} pas encore exécutés', countNotRunOther: '{n} pas encore exécutés', completedSlicesOne: '{n} tranche sûre terminée', completedSlicesFew: '{n} tranches sûres terminées', completedSlicesMany: '{n} tranches sûres terminées', completedSlicesOther: '{n} tranches sûres terminées', filledOne: '{n} rempli', filledFew: '{n} remplis', filledMany: '{n} remplis', filledOther: '{n} remplis', processedOne: '{n} traité', processedFew: '{n} traités', processedMany: '{n} traités', processedOther: '{n} traités', figuresOne: '{n} minifigurine', figuresFew: '{n} minifigurines', figuresMany: '{n} minifigurines', figuresOther: '{n} minifigurines' });
Object.assign(fr.detail, { uploadFailed: 'Échec de l’envoi : {error}', removeFailed: 'Échec de la suppression : {error}', forecastUpside: 'la prévision offre encore ~{pct} de potentiel' }); fr.data = { reportFailed: 'Échec du rapport : {error}', restoreFailed: 'Échec de la restauration : {error}', retryFailed: 'Échec de la nouvelle tentative : {error}', exportFailed: 'Échec de l’export : {error}', importFailed: 'Échec de l’import : {error}', bricklinkImportFailed: 'Échec de l’import BrickLink : {error}' }; fr.integrations = { bricksetSyncFailed: 'Échec de la synchronisation Brickset : {error}' }; fr.scanner = { timedOut: 'Cela a pris trop de temps — réessayez.', timedOutShort: 'Délai dépassé', scanFailed: 'Erreur : {error}' };
Object.assign(fr.common, { errorWithDetails: 'Erreur : {error}' }); Object.assign(fr.integrations, { bricksetSyncResult: '{added} sets importés ({skipped} hors catalogue, {total} au total sur Brickset).', bricksetSyncSuccess: 'Synchronisation Brickset : {added} sets ajoutés' }); Object.assign(fr.scanner, { bulkPartial: '{added} sur {total} ajoutés — {failed} ont échoué, réessayez', addSetsFailed: 'Échec de l’ajout des sets : {error}' }); fr.portfolio = { collectionLoadFailed: 'Impossible de charger la collection : {error}', bulkRemovePartial: '{removed} sur {total} supprimés — {failed} ont échoué, réessayez', restoredCount: '{restored} sur {total} restaurés' };
Object.assign(fr.settings, { currencyUpdated: 'Devise mise à jour sur {currency}' });
Object.assign(fr.common, { offlineActionsSynced: '{count} actions hors ligne synchronisées', offlineActionsDiscarded: '{count} actions hors ligne n’ont pas pu être synchronisées et ont été supprimées', localItemsSynced: '{count} éléments locaux synchronisés', kidsXp: '+{xp} XP ! {level} {badge}', copied: '{label} copié' }); Object.assign(fr.admin, { serviceTestResult: '{head} — {detail} ({ms} ms)', providerStatus: '{provider} : {status}', serviceTestFailed: 'Échec : {error}', providerTestFailed: 'Test de {provider} échoué', featureFlagStatus: '{flag} : {status}{suffix}', featureFlagUpdateFailed: 'Impossible de mettre à jour {flag} : {error}', providerSaved: '{provider} enregistré.', providerSaveFailed: 'Erreur lors de l’enregistrement de {provider} : {error}', pricingConfigLoadFailed: 'Impossible de charger la configuration des prix : {error}', resetFailed: 'Réinitialisation échouée : {error}', contributionAction: '{action} — {applied}', enabled: 'activé', disabled: 'désactivé', approved: 'Approuvé', rejected: 'Rejeté' }); Object.assign(fr.minifigs, { ownedCount: '{count} possédés' }); Object.assign(fr.data, { restoredFromBackup: '{count} sets restaurés depuis {date}', migrationStillFailing: '{count} éléments échouent encore : {error}', migrationComplete: 'Terminé — {count} éléments synchronisés.', importResult: '✓ {imported} importés, {skipped} ignorés, {errors} erreurs', setsImported: '{count} sets importés', bricklinkImportResult: '✓ {added} sets ajoutés, {skipped} ignorés. {errors}', bricklinkSetsImported: '{count} sets importés depuis les commandes BrickLink' }); Object.assign(fr.integrations, { keyRemoved: 'Clé {label} supprimée', keyVerified: 'Clé {label} vérifiée et enregistrée' }); Object.assign(fr.scanner, { setNotFound: 'Le set {setNum} est introuvable dans le catalogue.', localAiOfflineFailed: 'L’IA sur l’appareil a échoué et vous êtes hors ligne : {error}', addItemFailed: 'Impossible d’ajouter {name} : {error}', minifig: 'minifigurine', itemsAdded: '{count} éléments ajoutés au coffre', itemsSavedOffline: '{count} enregistrés hors ligne — seront synchronisés', setsSavedOffline: '{count} sets enregistrés hors ligne — seront synchronisés à la connexion' }); Object.assign(fr.portfolio, { soldFor: 'Vendu pour {price} — retiré du coffre' });
Object.assign(fr.common, { offlineActionsSyncedOne: '{count} action hors ligne synchronisée', offlineActionsSyncedOther: '{count} actions hors ligne synchronisées', offlineActionsDiscardedOne: '{count} action hors ligne n’a pas pu être synchronisée et a été supprimée', offlineActionsDiscardedOther: '{count} actions hors ligne n’ont pas pu être synchronisées et ont été supprimées', localItemsSyncedOne: '{count} élément local synchronisé', localItemsSyncedOther: '{count} éléments locaux synchronisés', kidsXp: '+{xp} XP !{details}', kidsXpLevel: ' Niveau {level} !', kidsXpBadge: ' · Badge : {badge} ! 🎉' }); Object.assign(fr.scanner, { itemsAddedOne: '{count} élément ajouté au coffre', itemsAddedOther: '{count} éléments ajoutés au coffre', itemsSavedOfflineOne: '{count} élément enregistré hors ligne — sera synchronisé', itemsSavedOfflineOther: '{count} éléments enregistrés hors ligne — seront synchronisés', setsSavedOfflineOne: '{count} set enregistré hors ligne — sera synchronisé à la connexion', setsSavedOfflineOther: '{count} sets enregistrés hors ligne — seront synchronisés à la connexion' }); Object.assign(fr.portfolio, { wishlistAlertsTooltip: 'Alertes de souhaits ({spikes} hausses, {drops} baisses de prix)', bulkLocationPartial: '{updated} sur {total} mis à jour — {failed} échecs, réessayez-les' });
Object.assign(fr.data, { restoredFromBackupOne: '{count} set restauré depuis {date}', restoredFromBackupOther: '{count} sets restaurés depuis {date}' }); Object.assign(fr.integrations, { bricksetSyncResultOne: '{count} set importé ({skipped} absent du catalogue, {total} sur Brickset).', bricksetSyncResultOther: '{count} sets importés ({skipped} absents du catalogue, {total} sur Brickset).', bricksetSyncSuccessOne: 'Synchronisation Brickset : {count} set ajouté', bricksetSyncSuccessOther: 'Synchronisation Brickset : {count} sets ajoutés' }); Object.assign(fr.wishlist, { unreadAlertsOne: '{count} alerte non lue', unreadAlertsOther: '{count} alertes non lues' }); Object.assign(fr.portfolio, { wishlistAlertsTooltip: 'Alertes de souhaits ({spikes}, {drops})', wishlistAlertSpikesOne: '{count} hausse', wishlistAlertSpikesOther: '{count} hausses', wishlistAlertDropsOne: '{count} baisse de prix', wishlistAlertDropsOther: '{count} baisses de prix', insightSignal: 'Revente {direction}{pct}% par rapport à {basis}{quantity}', insightMarket: 'marché', insightValue: 'valeur', insightQuantity: ' · ×{count}' });
Object.assign(fr.kids, { badgeCelebration: 'Nouveau badge : {badge} ! 🎉', badgeQuip: 'Tu es une superstar de la construction ! 🌟', levelCelebration: 'Niveau {level} atteint ! 🎉', levelQuip: 'Continue à construire ! 🧱', badgeFirstBrick: 'Première brique !', badgeJuniorBuilder: 'Jeune constructeur', badgeArchitect: 'Architecte', badgeMaster: 'Maître constructeur', badgeGrandMaster: 'Grand maître', badgeLegend: 'Légendaire !' });
Object.assign(fr.data, { csvImportConfirmTitleOne: 'Importer 1 set ?', csvImportConfirmTitleOther: 'Importer {count} sets ?', csvImportMore: ' et {count} de plus', csvImportConfirmMessage: 'En commençant par : {sample}{more}. Les sets existants sont conservés.', importConfirm: 'Importer' });
Object.assign(fr.scanner, { setNumberMatched: 'Le numéro du set correspond au catalogue.' });
Object.assign(fr.portfolio, { insightHeadlineOne: '≈ {value} de potentiel sur 1 set vendu maintenant', insightHeadlineOther: '≈ {value} de potentiel sur {count} sets vendus maintenant' });
Object.assign(fr.market, { goodTimeToSell: 'Bon moment pour vendre', goodTimeToBuy: 'Bon moment pour acheter', onlyForSale: 'Seulement {count} en vente actuellement', askingHighHint: 'Les vendeurs demandent beaucoup — vendez près du dernier prix réalisé pour vendre vite', askingLowHint: 'Prix affiché sous les dernières ventes — bon moment pour acheter', askingSummary: '{count} en vente · prix demandé {asking}', askingSummaryWithSold: '{count} en vente · prix demandé {asking} contre {sold} récemment vendu' });
Object.assign(fr.game, { marketGenius: '{score}/5 — market genius! 🎯', streakQuipOne: 'Streak: {count} day.', streakQuipOther: 'Streak: {count} days.' }); fr.market = Object.assign(fr.market || {}, { sellingAbove: 'Selling about {pct} above this value', sellingBelow: 'Selling about {pct} below this value' }); Object.assign(fr.scanner, { findingSet: 'Finding set...', lookingUpSet: 'Looking up {setNum} in the catalog.' });
Object.assign(fr.game, { marketGenius: '{score}/5 — génie du marché ! 🎯', streakQuipOne: 'Série : {count} jour.', streakQuipOther: 'Série : {count} jours.' });
Object.assign(fr.market, { sellingAbove: 'Se vend environ {pct} au-dessus de cette valeur', sellingBelow: 'Se vend environ {pct} au-dessous de cette valeur' }); Object.assign(fr.scanner, { findingSet: 'Recherche du set…', lookingUpSet: 'Recherche de {setNum} dans le catalogue.', bulkMatched: '{matched} sur {total} trouvés' }); Object.assign(fr.game, { revealCorrect: '🎯 Bien joué ! — c’est {value}', revealIncorrect: 'Pas tout à fait — c’est {value}' }); Object.assign(fr.catalog, { activeFiltersOne: '1 actif', activeFiltersOther: '{count} actifs' }); Object.assign(fr.portfolio, { anniversaryGain: 'Acheté {paid} — en hausse de {gain} depuis.', anniversaryNoGain: 'Acheté {paid}. Certains sets sont pour le plaisir, pas le profit.', anniversaryQuip: 'Le temps file quand on construit.', anniversaryCelebrationOne: '1 an avec {set} ! 🎂', anniversaryCelebrationOther: '{count} ans avec {set} ! 🎂' });
Object.assign(fr.market, { partsCoverage: '{pct}% de couverture des pièces', forecastScenarios: 'Baissier {bear} · Base {base} · Haussier {bull}', salesSuffix: ' / {count} ventes', newSold: 'Neuf vendu', usedSold: 'Occasion vendu', viewOnBrickLink: 'Voir sur BrickLink' }); Object.assign(fr.catalog, { loadFailedDetail: '{error}. Vérifiez votre connexion et réessayez.' }); Object.assign(fr.portfolio, { moreThemesOne: '+1 thème de plus', moreThemesOther: '+{count} thèmes de plus', sealedParts: 'Scellé {sealed} · {approximate}Pièces {parts}' }); fr.advisor = Object.assign(fr.advisor || {}, { moreThemesOne: '+1 autre thème dans votre coffre', moreThemesOther: '+{count} autres thèmes dans votre coffre' });
Object.assign(fr.game, { loadFailed: 'Impossible de charger le jeu du jour : {error}' }); Object.assign(fr.contributions, { loadFailed: 'Impossible de charger : {error}' }); Object.assign(fr.me, { wrappedLoadFailed: 'Impossible de charger votre année : {error}', wrappedValueChange: 'Le coffre est {direction} de {value} cette année', wrappedUp: 'en hausse', wrappedDown: 'en baisse' });
Object.assign(fr.catalog, { filterSummaryNone: 'Aucun filtre actif', filterSummaryActiveOne: '{count} actif : {items}', filterSummaryActiveOther: '{count} actifs : {items}', filterSummarySearch: 'Recherche « {value} »', filterSummaryStatusRetired: 'Retirés seulement', filterSummaryStatusActive: 'Actifs seulement', filterSummaryStatusRetiring: 'Bientôt retirés', filterSummaryDeal: 'Bonnes affaires seulement', filterSummaryRangeYear: 'Année', filterSummaryRangePieces: 'Pièces', filterSummaryRangeValue: 'Valeur', filterSummaryRangeBetween: '{label} {min}–{max}', filterSummaryRangeMin: '{label} ≥ {value}', filterSummaryRangeMax: '{label} ≤ {value}', filterSummaryPiecesValue: '{value} pièces', filterSummaryValueAmount: '{value} $US' });
Object.assign(fr.minifigs, { filterSummaryNone: 'Aucun filtre actif', filterSummaryActiveOne: '{count} actif : {items}', filterSummaryActiveOther: '{count} actifs : {items}', filterSummarySearch: 'Recherche « {value} »', filterSummaryRarity: 'Rareté : {rarity}', filterSummaryRarityCommon: 'Courante', filterSummaryRarityUncommon: 'Peu courante', filterSummaryRarityRare: 'Rare', filterSummaryRarityLegendary: 'Légendaire', filterSummaryOwned: 'Possédées seulement', filterSummaryUnowned: 'Non possédées seulement' });
Object.assign(fr.catalog, { emptySearchResults: 'Aucun résultat pour « {query} ». Essayez une autre recherche ou effacez les filtres.', emptyFilteredResults: 'Aucun set ne correspond à ces filtres. Essayez une autre recherche ou effacez les filtres.' });
Object.assign(fr.advisor, { retiredSetsOfTotalOne: '{retired} set retiré sur {total}', retiredSetsOfTotalOther: '{retired} sets retirés sur {total}' });
Object.assign(fr.scanner, { duplicateConfirmTitle: 'Déjà possédé', duplicateConfirmMessage: 'Vous avez déjà {names} dans votre coffre. Ajouter un autre exemplaire ?', duplicateConfirmAction: 'Ajouter quand même' });
Object.assign(fr.scanner, { minifigWithSeries: '{minifig} — série {series}', minifigWithRarity: '{minifig} — rareté : {rarity}', rarityUnknown: 'Inconnue' });
Object.assign(fr.admin, { jobAccepted: '{label} accepté ; il apparaîtra bientôt dans Activité', pricechartingBulkAccepted: 'Téléchargement groupé PriceCharting lancé ; les résultats apparaîtront bientôt dans Activité', pricechartingVerifyAccepted: 'Vérification PriceCharting lancée ; consultez Activité pour les correspondances promues', pricesapiAccepted: 'Actualisation pricesAPI lancée ; consultez Activité pour le résultat' });
Object.assign(fr.scanner, { setsFoundOne: '{count} set trouvé', setsFoundOther: '{count} sets trouvés', minifigsFoundOne: '{count} minifigurine trouvée', minifigsFoundOther: '{count} minifigurines trouvées', mixedResultsFoundOne: '{count} résultat trouvé (sets et minifigurines)', mixedResultsFoundOther: '{count} résultats trouvés (sets et minifigurines)', confidenceHigh: 'Confiance élevée', confidenceMedium: 'Confiance moyenne', confidenceLow: 'Confiance faible', confidenceUnknown: 'Confiance de correspondance indisponible', matchHigh: 'Correspondance élevée', matchMedium: 'Correspondance moyenne', matchLow: 'Correspondance faible', match: 'Correspondance' });
Object.assign(fr.detail, { sellReasonGainSincePurchase: 'En hausse de {roi} depuis l’achat', sellReasonTrendDown: 'La tendance des prix baisse', sellReasonClimbFlattened: 'La hausse du prix s’essouffle', sellReasonLittleUpside: 'Il ne reste que {upside} de potentiel prévu', sellReasonSellsFast: '{volume} ventes récentes indiquent une vente rapide', sellReasonWatchClosely: 'Surveillez le marché de près', sellReasonStillClimbing: 'Le prix continue de monter', sellReasonForecastUpside: 'La prévision suggère encore {upside} de potentiel', sellReasonNotRetired: 'Il n’est pas encore retiré', sellReasonNoSellTrigger: 'Pas encore de signal de vente clair' });
Object.assign(fr.data, { migrationStillFailingOne: 'Il reste {count} élément en échec : {error}', migrationStillFailingOther: 'Il reste {count} éléments en échec : {error}', migrationCompleteOne: 'Terminé — {count} élément synchronisé.', migrationCompleteOther: 'Terminé — {count} éléments synchronisés.', setsImportedOne: '{count} set importé', setsImportedOther: '{count} sets importés', bricklinkSetsImportedOne: '{count} set importé depuis les commandes BrickLink', bricklinkSetsImportedOther: '{count} sets importés depuis les commandes BrickLink' });
Object.assign(fr.detail, { sellReasonSellsFastOne: '{volume} vente récente indique une vente rapide', sellReasonSellsFastOther: '{volume} ventes récentes indiquent une vente rapide' });
Object.assign(fr.minifigs, { setExclusive: 'Exclusif au set', inSetsOne: 'Dans {count} set', inSetsOther: 'Dans {count} sets', partsOne: '{count} pièce', partsOther: '{count} pièces' });
Object.assign(fr.minifigs, { emptySearchResults: 'Aucun résultat pour « {query} ».', emptyFilteredResults: 'Aucune figurine ne correspond à ces filtres.' });
Object.assign(fr.detail, { partsComplete: 'Complet', partsMissingOne: '{count} pièce manquante', partsMissingOther: '{count} pièces manquantes', allPartsPresent: 'toutes les pièces présentes' });
Object.assign(fr.build, { needPartsOne: 'Il manque {n} pièce', needPartsOther: 'Il manque {n} pièces' });
Object.assign(fr.card, { lotsOne: '{n} lot', lotsOther: '{n} lots' });
Object.assign(fr.market, { salesSuffixOne: ' / {count} vente', salesSuffixOther: ' / {count} ventes' });
Object.assign(fr.data, { importedCountOne: '{n} set importé', importedCountOther: '{n} sets importés', skippedCountOne: '{n} set ignoré', skippedCountOther: '{n} sets ignorés', errorsCountOne: '{n} erreur', errorsCountOther: '{n} erreurs', setsAddedCountOne: '{n} set ajouté', setsAddedCountOther: '{n} sets ajoutés', importResult: '✓ {imported} · {skipped} · {errors}', bricklinkImportResult: '✓ {added} · {skipped}. {errors}' });
Object.assign(fr.admin, { minifigsImportedOne: '{n} minifigurine', minifigsImportedOther: '{n} minifigurines', minifigsParsedOne: '{n} minifigurine', minifigsParsedOther: '{n} minifigurines', importedMinifigs: '{inserted} sur {parsed} importées. Les prix seront associés lors de l’évaluation.' });
Object.assign(fr.time, {"daysAgoOne":"il y a {n} jours","daysAgoOther":"il y a {n} jours"});
Object.assign(fr.scanner, {"bulkPartialOne":"{added} sur {total} ajoutés — {failed} ont échoué, réessayez","bulkPartialOther":"{added} sur {total} ajoutés — {failed} ont échoué, réessayez"});
Object.assign(fr.kids, {"setsToGoOne":"Encore {n} sets","setsToGoOther":"Encore {n} sets","earnedOne":"{n} sur {total} obtenus","earnedOther":"{n} sur {total} obtenus"});
Object.assign(fr.market, {"familiesOne":"{n} sources de marché indépendantes","familiesOther":"{n} sources de marché indépendantes","salesOne":"{n} ventes vérifiées","salesOther":"{n} ventes vérifiées","onlyForSaleOne":"Seulement {count} en vente actuellement","onlyForSaleOther":"Seulement {count} en vente actuellement","askingSummaryOne":"{count} en vente · prix demandé {asking}","askingSummaryOther":"{count} en vente · prix demandé {asking}","askingSummaryWithSoldOne":"{count} en vente · prix demandé {asking} contre {sold} récemment vendu","askingSummaryWithSoldOther":"{count} en vente · prix demandé {asking} contre {sold} récemment vendu"});
Object.assign(fr.detail, {"fromSourcesOne":"De {n} sources de marché","fromSourcesOther":"De {n} sources de marché","reviewsOne":"{n} avis","reviewsOther":"{n} avis","priceHistoryDaysOne":"Historique des prix · {n} jours","priceHistoryDaysOther":"Historique des prix · {n} jours","priceHistoryShortOne":"Historique des prix · {n} j","priceHistoryShortOther":"Historique des prix · {n} j"});
Object.assign(fr.alerts, {"priceDropOne":"Baisse de prix · il y a {n} j","priceDropOther":"Baisse de prix · il y a {n} j"});
Object.assign(fr.portfolio, {"bulkLocationPartialOne":"{updated} sur {total} mis à jour — {failed} échecs, réessayez-les","bulkLocationPartialOther":"{updated} sur {total} mis à jour — {failed} échecs, réessayez-les","bulkRemovePartialOne":"{removed} sur {total} supprimés — {failed} ont échoué, réessayez","bulkRemovePartialOther":"{removed} sur {total} supprimés — {failed} ont échoué, réessayez","restoredCountOne":"{restored} sur {total} restaurés","restoredCountOther":"{restored} sur {total} restaurés"});
Object.assign(fr.wishlist, {"setsCountOne":"{n} sets","setsCountOther":"{n} sets","alertsCountOne":"{n} alertes","alertsCountOther":"{n} alertes"});
Object.assign(fr.admin, {"syncJobSkippedOne":"ignoré — {n}","syncJobSkippedOther":"ignoré — {n}","syncJobSummaryOne":"{processed} traités, {updated} mis à jour, {rejected} rejetés","syncJobSummaryOther":"{processed} traités, {updated} mis à jour, {rejected} rejetés","uploadSuccessToastOne":"Catalogue de minifigurines BrickLink : {n} importées","uploadSuccessToastOther":"Catalogue de minifigurines BrickLink : {n} importées","contributionActionOne":"{action} — {n}","contributionActionOther":"{action} — {n}"});
Object.assign(fr.data, {"csvImportMoreOne":" et {n} de plus","csvImportMoreOther":" et {n} de plus","csvImportConfirmMessageOne":"En commençant par : {sample}{more}. Les sets existants sont conservés.","csvImportConfirmMessageOther":"En commençant par : {sample}{more}. Les sets existants sont conservés."});
Object.assign(fr.me, {"trophyShelfOne":"Vitrine ({n}/6)","trophyShelfOther":"Vitrine ({n}/6)"});
Object.assign(fr.build, {"ofOwnedSetsOne":"sur {n} sets possédés","ofOwnedSetsOther":"sur {n} sets possédés","indexingOne":"Indexation de {n} set(s) supplémentaire(s) en arrière-plan…","indexingOther":"Indexation de {n} set(s) supplémentaire(s) en arrière-plan…"});
Object.assign(fr.counts, {"collectedOne":"{owned}/{total} collectées","collectedOther":"{owned}/{total} collectées","ownedOne":"{n} en possession","ownedOther":"{n} en possession","ofFigsOne":"sur {total} figurines","ofFigsOther":"sur {total} figurines","resultsOne":"{n} résultats","resultsOther":"{n} résultats","figsOne":"{n} figurines","figsOther":"{n} figurines"});
Object.assign(fr.minifigs, {"ownedCountOne":"{n} possédés","ownedCountOther":"{n} possédés"});
Object.assign(fr.catalog, {"filtersWithCountOne":"Filtres · {n}","filtersWithCountOther":"Filtres · {n}"});
Object.assign(fr.scanner, {"bulkMatchedOne":"{matched} sur {total} trouvés","bulkMatchedOther":"{matched} sur {total} trouvés"});
Object.assign(fr.kids, {"pcsOne":"{n} pièces","pcsOther":"{n} pièces"});
Object.assign(fr.card, {"gamePiecesOne":"{n} pièces","gamePiecesOther":"{n} pièces","piecesOne":"{n} PCS","piecesOther":"{n} PCS"});
Object.assign(fr.scanner, { bulkMatchedOne: '{n} sur {total} trouvé', bulkMatchedOther: '{n} sur {total} trouvés' });
Object.assign(fr.kids, { pcsOne: '{n} pièce', pcsOther: '{n} pièces' });
Object.assign(fr.card, { gamePiecesOne: '{n} pièce', gamePiecesOther: '{n} pièces', piecesOne: '{n} pièce', piecesOther: '{n} pièces' });
Object.assign(fr.share ??= {}, {"gameTitle":"Price It!","gameText":"🧱 Price It! {day}\\n{tiles} {score}/5 · streak {streak}\\nGuess LEGO market prices on BricksVault","setText":"Check out {name} ({setNum}) on BricksVault!","setDialogTitle":"Share {name}","portfolioTitle":"My LEGO BricksVault","portfolioText":"Check out my LEGO collection on BricksVault!","portfolioDialogTitle":"Share my BricksVault","wrappedTitle":"Brick Wrapped {year}","wrappedBest":"Best performer: {name}{roi}","wrappedTracked":"Tracked with BricksVault","wrappedSetsAdded":"sets added","wrappedPiecesAdded":"pieces","wrappedValueChange":"vault value change","wrappedTagline":"BRICKSVAULT · STACK SOMETHING BEAUTIFUL"});
Object.assign(fr.share, { gameTitle: 'Estimez le prix !', gameText: '🧱 Estimez le prix ! {day}\n{tiles} {score}/5 · série {streak}\nDevinez les prix du marché LEGO sur BricksVault', setText: 'Découvrez {name} ({setNum}) sur BricksVault !', setDialogTitle: 'Partager {name}', portfolioTitle: 'Mon BricksVault LEGO', portfolioText: 'Découvrez ma collection LEGO sur BricksVault !', portfolioDialogTitle: 'Partager mon BricksVault', wrappedTitle: 'Récap Brick {year}', wrappedBest: 'Meilleure performance : {name}{roi}', wrappedTracked: 'Suivi avec BricksVault', wrappedValueChange: 'évolution de la valeur du coffre', wrappedTagline: 'BRICKSVAULT · CONSTRUISEZ QUELQUE CHOSE DE BEAU', wrappedHeading: 'Récap Brick', wrappedDescription: 'Votre année de collectionneur en chiffres — partagez-la.', wrappedLoading: 'Comptage de vos briques…', wrappedSummaryTitle: '🧱 Mon récap Brick {year}', wrappedSetsAddedOne: '{count} set ajouté', wrappedSetsAddedOther: '{count} sets ajoutés', wrappedPiecesAddedOne: '{count} pièce', wrappedPiecesAddedOther: '{count} pièces', wrappedMinifigsOne: '{count} minifigurine', wrappedMinifigsOther: '{count} minifigurines', wrappedInvested: 'investi', wrappedSoldOne: '{count} set vendu', wrappedSoldOther: '{count} sets vendus', wrappedSoldLabel: 'vendu', wrappedBestLabel: 'Meilleure performance', wrappedBestCanvas: 'Meilleure performance', wrappedBestCanvasWithRoi: 'Meilleure performance · {roi}', wrappedLongestHeld: 'Détenu le plus longtemps : {name} (depuis {year})', wrappedClose: 'Fermer', wrappedShareYear: 'Partager mon année' });
Object.assign(fr.data, { reportPreparing: 'Préparation du rapport…', insuranceReportTitle: 'Rapport d’assurance BricksVault', reportSharedReady: 'Rapport prêt — ouvrez-le et imprimez-le en PDF.', reportDownloadedReady: 'Rapport téléchargé — ouvrez-le et imprimez-le en PDF.', noSnapshotsYet: 'Aucune sauvegarde pour le moment — la première sera créée dimanche prochain.', backupsUnavailable: 'Les sauvegardes sont indisponibles pour le moment.', retryingSync: 'Nouvelle tentative de synchronisation…', guestVaultSynced: 'Coffre invité synchronisé', exportPreparing: 'Préparation de l’export…', collectionExportTitle: 'Partager la collection BricksVault', guestExportShared: 'Votre export invité local est prêt à être partagé ou enregistré.', guestExportDownloaded: 'Export téléchargé depuis les données invité locales.', syncedExportShared: 'Votre export synchronisé est prêt à être partagé ou enregistré.', syncedExportDownloaded: 'Export téléchargé depuis votre coffre synchronisé.' });
// en.js declares `market` twice as an object literal, so the later one wins and
// keys added to the earlier block are silently dropped. Assigning after the fact
// lands on whichever object survived.
Object.assign(fr.market, { comps: '{n} comparables', slashComps: ' / {n} comparables', usedValue: 'Occasion : {price}', updated: 'Mis à jour {date}', compsAboveMsrp: 'Les ventes neuves sont {amount} ({pct}) au-dessus du prix public.', compsBelowMsrp: 'Les ventes neuves sont {amount} ({pct}) en dessous du prix public.' });

Object.assign(fr.detail, { tagsMoreOne: '+{n} de plus', tagsMoreOther: '+{n} de plus' });
Object.assign(fr.market, { compsOne: '{n} comparable', compsOther: '{n} comparables', slashCompsOne: ' / {n} comparable', slashCompsOther: ' / {n} comparables' });

Object.assign(fr.settings, { appLockUnchanged: 'Verrouillage de l’app inchangé : {error}' });
Object.assign(fr.game, { checkGuessFailed: 'Impossible de vérifier l’estimation : {error}' });
Object.assign(fr.alerts, { sellOpportunityOne: 'Occasion de vendre · il y a {n} jour', sellOpportunityOther: 'Occasion de vendre · il y a {n} jours' });
Object.assign(fr.detail, { minifigsCountOne: '{n} figurine', minifigsCountOther: '{n} figurines' });
Object.assign(fr.market, { listingsOne: '{n} annonce', listingsOther: '{n} annonces', slashListingsOne: ' / {n} annonce', slashListingsOther: ' / {n} annonces', slashSamplesOne: ' / {n} échantillon', slashSamplesOther: ' / {n} échantillons' });
Object.assign(fr.scanner, { estimatedValue: '(~valeur estimée)', marketGrabThreshold: 'Marché {market} — sous {price}, c’est une affaire{estimated}', underMarket: '{amount} sous le marché{estimated}', withinMarket: 'à {pct}% du marché{estimated}', overMarket: '{amount} au-dessus du marché{estimated}' });

Object.assign(fr.admin, { llmUnavailable: 'Routage LLM indisponible', llmMergeBalance: 'Crédit Merge restant ce mois-ci', llmMeteredNote: 'Calculé à partir du coût que Merge renvoie à chaque appel — son tableau de bord fait foi.', llmEffective: 'Exécuté maintenant', llmEffectiveNone: 'aucun fournisseur configuré', llmLivePool: 'Pool gratuit en direct (auto)', llmNoKey: 'pas de clé', llmNoKeyHint: 'Ce fournisseur n\'a pas de clé API configurée ; l\'étape est ignorée à l\'exécution.', llmMoveUp: 'Déplacer l\'étape avant', llmMoveDown: 'Déplacer l\'étape après', llmOn: 'Activé', llmOff: 'Désactivé', llmReset: 'Rétablir les valeurs par défaut', llmSave: 'Enregistrer le routage', llmSaved: 'Routage LLM enregistré', llmSaveFailed: 'Impossible d\'enregistrer le routage LLM', llmRefreshModels: 'Actualiser les modèles Merge', llmModelsRefreshedOne: '{n} modèle Merge actualisé', llmModelsRefreshedOther: '{n} modèles Merge actualisés', llmModelsFailed: 'Impossible d\'actualiser le catalogue de modèles Merge' });

Object.assign(fr.admin, { llmModelPlaceholder: "fournisseur/modèle, ex. openai/gpt-5.6-luna" });

Object.assign(fr.admin, { llmReload: "Recharger", llmChooseModel: "Choisir un modèle", llmCustomModel: "ID de modèle personnalisé…", llmSpentOf: "{spent} dépensés sur {budget}", llmLivePoolShort: "pool gratuit", llmUnsaved: "Modifications non enregistrées", llmModelsOther: "Autres", llmWorkload_scan: "Scan photo", llmWorkload_advisor: "Conseiller IA", llmWorkload_valuation: "Estimation", llmWorkload_listing: "Brouillons d’annonce" });

Object.assign(fr.admin, { llmLivePoolHint: "Mis à jour chaque jour depuis OpenRouter" });

export default fr;
Object.assign(fr.detail, { movementUp: 'Up {pct}% over {days} days', movementDown: 'Down {pct}% over {days} days', movementResaleUp: ' · resale comps also rose', movementResaleDown: ' · resale comps also fell', movementMarketUp: ' · market guide also rose', movementMarketDown: ' · market guide also fell' });
