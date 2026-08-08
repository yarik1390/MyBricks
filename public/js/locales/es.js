/** Spanish. Missing keys fall back to English (see lib/i18n.js). */
export const es = {
  nav: { vault: 'Colección', catalog: 'Catálogo', scan: 'Escanear', minifigs: 'Minifiguras', me: 'Yo', badges: 'Insignias' },
  common: {
    cancel: 'Cancelar', save: 'Guardar', close: 'Cerrar', retry: 'Reintentar',
    delete: 'Eliminar', edit: 'Editar', done: 'Hecho', undo: 'Deshacer',
    loading: 'Cargando…', search: 'Buscar', all: 'Todos', none: 'Ninguno',
    yes: 'Sí', no: 'No', error: 'Algo salió mal', offline: 'Estás sin conexión',
    seeAll: 'Ver todo', share: 'Compartir',
    and: 'y',
  },
  settings: {
    title: 'Ajustes', language: 'Idioma',
    languageDesc: 'Sigue tu dispositivo salvo que elijas uno.', languageAuto: 'Automático ({name})',
    currency: 'Moneda', currencyDesc: 'Mostrar los valores en tu moneda local.',
    market: 'Mercado', marketDesc: 'Mercado local para ofertas de tienda. Los valores de reventa siguen en USD.',
    appearance: 'Apariencia', notifications: 'Notificaciones', signOut: 'Cerrar sesión',
  },
  detail: {
    value: 'Valor', retired: 'Descatalogado', comingSoon: 'Próximamente', retiringSoon: 'Se descataloga pronto',
    pieces: 'piezas', minifigs: 'minifiguras', retail: 'PVP',
    addToVault: 'Añadir a la colección', inVault: 'En la colección', removeFromVault: 'Quitar de la colección',
    tabInfo: 'Info', tabForecast: 'Previsión', tabCommunity: 'Comunidad',
    reliablePrice: 'Precio fiable', pricingDetails: 'Detalles del precio', priceHistory: 'Historial de precios',
    details: 'Detalles', estimated: 'Estimado', year: 'Año', theme: 'Tema',
    addToWishlist: 'Añadir a deseos', inWishlist: 'En tu lista de deseos',
    addToVaultPrice: 'Añadir a la cámara · {price}', priceHistoryDays: 'Historial de precios · {days} días', priceHistoryShort: 'Historial de precios · {days} d', fromSources: 'De {n} fuentes de mercado', fromSourcesOne: 'De 1 fuente de mercado', typicalRange: ' · normalmente {low}–{high}', likelyRange: ' · probablemente {low}-{high}', tagsMore: '+{n} más', reviews: '{n} reseñas', reviewsOne: '1 reseña', up: 'Sube {pct}%', down: 'Baja {pct}%',
  },
  counts: {
    results: '{n} resultados', resultsOne: '1 resultado', collected: '{owned}/{total} coleccionadas', owned: '{n} en propiedad', ofFigs: 'de {total} minifiguras', figs: '{n} minifiguras', figsOne: '1 minifigura',
  },
  market: {
    sellNowLabel: 'Vender ahora',
    fastSaleAfterFees: 'venta rápida tras comisiones',
    pctOfValue: '{pct}% del valor',
    pctOfFairValue: '{pct}% del valor razonable',
    confidentlyPriced: '{pct}% con precio fiable',
    families: '{n} fuentes de mercado independientes',
    familyOne: '1 fuente de mercado independiente',
    sales: '{n} ventas verificadas',
    saleOne: '1 venta verificada',
    estimateUnlocks: 'La estimación de {list} se desbloqueará con más datos de ventas.',
    estimatesUnlock: 'Las estimaciones de {list} se desbloquearán con más datos de ventas.',
    sellingAbove: 'Se vende alrededor de {pct} por encima de este valor',
    sellingBelow: 'Se vende alrededor de {pct} por debajo de este valor',
  },
  card: {
    pieces: '{n} PZS',
    perPiece: '{price}/pieza',
    lots: '{n} lotes',
    deal: 'CHOLLO {pct}',
    strongBuy: 'GRAN COMPRA {pct}',
    forecast2y: '{price} 2 años',
    gamePieces: '{n} piezas',
    gameRetail: 'PVP {price}',
  },
  deal: {
    buyRetail: 'Disponible en tienda a un {pct}% por debajo de su valor de mercado.',
    buyResale: 'Se vende un {pct}% por debajo de su valor de mercado.',
    retiring: 'Se retira pronto: ventana de compra limitada.',
    premiumRetail: 'Actualmente por encima de su valor de mercado.',
    premiumResale: 'Los precios pedidos superan su valor de mercado.',
    fair: 'Al nivel de su valor de mercado.',
    labelBuy: 'COMPRAR',
    labelStrongBuy: 'GRAN COMPRA',
    labelFair: 'PRECIO JUSTO',
    labelPremium: 'POR ENCIMA',
    labelPct: '{label} · {pct}%',
  },
  time: {
    unknown: 'desconocido', today: 'Hoy', yesterday: 'Ayer', daysAgo: 'hace {n} días',
  },
  me: {
    trophyShelf: 'Estantería de trofeos ({n}/6)',
  },
  kids: {
    xp: '{n} XP', xpToLevel: '{n} XP para el nivel {level}', maxLevel: '¡Nivel máximo!', pcs: '{n} piezas', earned: '{n} de {total} conseguidos', setsToGo: 'Faltan {n} sets', setsToGoOne: '¡Falta 1 set!',
  },
  fees: {
    marketplace: 'Comisión del marketplace ({pct}%)', payment: 'Comisión de pago ({pct}% + fija)',
  },
  alerts: {
    priceDrop: 'Bajada de precio · hace {days} d', targetWas: '— tu objetivo era {price}.',
  },
  game: {
    roundOf: 'Ronda {n} de {total}', pctOff: 'Te desviaste un {pct}%', streakLine: '{day} · racha {streak} · mejor {best}',
  },
  build: {
    needParts: 'Faltan {n} piezas', ofOwnedSets: 'de {n} sets en propiedad', indexing: 'Indexando {n} set(s) más en segundo plano…',
  },
  catalog: {
    title: 'Catálogo', searchPlaceholder: 'Buscar un set', results: '{count} sets',
    sortValue: 'Valor', sortGrowth: 'Crecimiento', sortNewest: 'Más recientes', sortTrending: 'En tendencia',
    noResults: 'No se encontraron sets', filters: 'Filtros', sort: 'Ordenar', clearFilters: 'Borrar filtros',
  },
  vault: {
    title: 'Colección', empty: 'Tu colección está vacía', emptyDesc: 'Añade un set para seguir su valor.',
    setsOwned: 'Sets en propiedad', totalValue: 'Valor total', invested: 'Invertido', gain: 'Ganancia', addSet: 'Añadir un set',
    investedAmount: 'Invertido {amount}',
  },
  wishlist: {
    title: 'Lista de deseos', empty: 'Tu lista de deseos está vacía', targetPrice: 'Precio objetivo',
    priceDropAlert: 'Avisarme si baja el precio', remove: 'Quitar de deseos',
    setsCount: '{n} sets', setsCountOne: '1 set', alertsCount: '{n} alertas', alertsCountOne: '1 alerta', nowPrice: 'Ahora {price}',
  },
};
Object.assign(es.catalog, { filtersWithCount: 'Filtros · {n}' });
es.community = { pendingSubmissionOne: '⏳ Tienes {n} contribución pendiente de aprobación.', pendingSubmissionFew: '⏳ Tienes {n} contribuciones pendientes de aprobación.', pendingSubmissionMany: '⏳ Tienes {n} contribuciones pendientes de aprobación.', pendingSubmissionOther: '⏳ Tienes {n} contribuciones pendientes de aprobación.' };
es.contributions = { approvedOne: '{n} contribución aprobada', approvedFew: '{n} contribuciones aprobadas', approvedMany: '{n} contribuciones aprobadas', approvedOther: '{n} contribuciones aprobadas', contributorBadge: ' · ⭐ Colaborador' };
es.admin = { uploadingFile: 'Subiendo {file}…', importedMinifigs: 'Se importaron {inserted} de {parsed} minifiguras. Se asociarán a precios al valorarlas.', uploadFailed: 'Error: {error}', lastRun: 'última ejecución {when}{duration}' };
es.downloads = { interrupted: 'La descarga se interrumpió al {pct}% — toca «Reanudar» para continuar.', resume: 'Reanudar ({pct})', scanProgress: 'Identificando {current} de {total}…' };
Object.assign(es.detail, { acquired: 'Adquirido el {date}{source}' });
Object.assign(es.wishlist, { targetPriceCurrency: 'Precio objetivo ({symbol})', suggestedPrice: 'Sugerido: {price}' });
es.minifigs = { appearsInSetsOne: 'Aparece en {n} set', appearsInSetsFew: 'Aparece en {n} sets', appearsInSetsMany: 'Aparece en {n} sets', appearsInSetsOther: 'Aparece en {n} sets' };
Object.assign(es.admin, { syncJobRunning: '{label}: en ejecución…', syncJobSkipped: 'omitido — {n}', syncJobSummary: '{processed} procesados, {updated} actualizados, {rejected} rechazados', syncJobResult: '{label}: {summary}', syncJobFailed: '{label} falló: {error}', uploadSuccessToast: 'Catálogo de minifiguras BrickLink: {inserted} importadas', uploadErrorToast: 'Falló la carga del catálogo: {error}', countRunning: '{n} en ejecución', countHealthy: '{n} correctos', countFailed: '{n} fallidos', countNotRun: '{n} sin ejecutar', completedSlices: '{n} bloques seguros completados', jobId: 'Trabajo #{id}', filled: '{n} completados', processed: '{n} procesados', figures: '{n} minifiguras', noItemsProcessed: 'No se procesaron elementos' });
Object.assign(es.admin, { jobStarted: 'Trabajo #{id} iniciado', jobFailed: 'El trabajo falló: {error}', maintenanceComplete: '{label} completado', maintenanceFailed: '{label} falló: {error}', lastSeen: 'visto por última vez {when}' });
Object.assign(es.admin, { tools: { sets: 'Importar sets', figs: 'Importar minifiguras', upc: 'Completar códigos de barras', populate: 'Completar cobertura', revalue: 'Revalorar precios', everything: 'Completar todas las fuentes seguras', pricechartingBulk: 'Actualizar PriceCharting (lote LEGO)', pricechartingVerify: 'Verificar asignaciones de PriceCharting', pricesapi: 'Ejecutar pricesAPI ahora', ebaySold: 'Ejecutar búsqueda de ventas de eBay' }, maintenanceTools: { expire: 'Caducar valoraciones', repair: 'Reparar índice de búsqueda' }, countRunningOne: '{n} en ejecución', countRunningFew: '{n} en ejecución', countRunningMany: '{n} en ejecución', countRunningOther: '{n} en ejecución', countHealthyOne: '{n} correcto', countHealthyFew: '{n} correctos', countHealthyMany: '{n} correctos', countHealthyOther: '{n} correctos', countFailedOne: '{n} fallido', countFailedFew: '{n} fallidos', countFailedMany: '{n} fallidos', countFailedOther: '{n} fallidos', countNotRunOne: '{n} sin ejecutar', countNotRunFew: '{n} sin ejecutar', countNotRunMany: '{n} sin ejecutar', countNotRunOther: '{n} sin ejecutar', completedSlicesOne: '{n} bloque seguro completado', completedSlicesFew: '{n} bloques seguros completados', completedSlicesMany: '{n} bloques seguros completados', completedSlicesOther: '{n} bloques seguros completados', filledOne: '{n} completado', filledFew: '{n} completados', filledMany: '{n} completados', filledOther: '{n} completados', processedOne: '{n} procesado', processedFew: '{n} procesados', processedMany: '{n} procesados', processedOther: '{n} procesados', figuresOne: '{n} minifigura', figuresFew: '{n} minifiguras', figuresMany: '{n} minifiguras', figuresOther: '{n} minifiguras' });
Object.assign(es.detail, { uploadFailed: 'Error al subir: {error}', removeFailed: 'Error al eliminar: {error}', forecastUpside: 'el pronóstico tiene ~{pct} más de potencial' }); es.data = { reportFailed: 'El informe falló: {error}', restoreFailed: 'La restauración falló: {error}', retryFailed: 'El reintento falló: {error}', exportFailed: 'La exportación falló: {error}', importFailed: 'La importación falló: {error}', bricklinkImportFailed: 'La importación de BrickLink falló: {error}' }; es.integrations = { bricksetSyncFailed: 'La sincronización de Brickset falló: {error}' }; es.scanner = { timedOut: 'Tardó demasiado — inténtalo de nuevo.', timedOutShort: 'Tiempo agotado', scanFailed: 'Error: {error}' };
Object.assign(es.common, { errorWithDetails: 'Error: {error}' }); Object.assign(es.integrations, { bricksetSyncResult: 'Se importaron {added} sets ({skipped} fuera del catálogo, {total} en total en Brickset).', bricksetSyncSuccess: 'Sincronización de Brickset: {added} sets añadidos' }); Object.assign(es.scanner, { bulkPartial: 'Se añadieron {added} de {total} — {failed} fallaron, inténtalo de nuevo', addSetsFailed: 'No se pudieron añadir los sets: {error}' }); es.portfolio = { collectionLoadFailed: 'No se pudo cargar la colección: {error}', bulkRemovePartial: 'Se eliminaron {removed} de {total} — {failed} fallaron, inténtalo de nuevo', restoredCount: 'Se restauraron {restored} de {total}' };
Object.assign(es.settings, { currencyUpdated: 'Moneda actualizada a {currency}' });
Object.assign(es.common, { offlineActionsSynced: '{count} acciones sin conexión sincronizadas', offlineActionsDiscarded: '{count} acciones sin conexión no se pudieron sincronizar y se descartaron', localItemsSynced: '{count} elementos locales sincronizados', kidsXp: '+{xp} XP! {level} {badge}', copied: '{label} copiado' }); Object.assign(es.admin, { serviceTestResult: '{head} — {detail} ({ms} ms)', providerStatus: '{provider}: {status}', serviceTestFailed: 'Error: {error}', providerTestFailed: 'Falló la prueba de {provider}', featureFlagStatus: '{flag}: {status}{suffix}', featureFlagUpdateFailed: 'No se pudo actualizar {flag}: {error}', providerSaved: '{provider} guardado.', providerSaveFailed: 'Error al guardar {provider}: {error}', pricingConfigLoadFailed: 'No se pudo cargar la configuración de precios: {error}', resetFailed: 'Error al restablecer: {error}', contributionAction: '{action} — {applied}', enabled: 'activado', disabled: 'desactivado', approved: 'Aprobado', rejected: 'Rechazado' }); Object.assign(es.minifigs, { ownedCount: '{count} en propiedad' }); Object.assign(es.data, { restoredFromBackup: '{count} sets restaurados desde {date}', migrationStillFailing: '{count} elementos aún fallan: {error}', migrationComplete: 'Listo — {count} elementos sincronizados.', importResult: '✓ {imported} importados, {skipped} omitidos, {errors} errores', setsImported: '{count} sets importados', bricklinkImportResult: '✓ {added} sets añadidos, {skipped} omitidos. {errors}', bricklinkSetsImported: '{count} sets importados desde pedidos de BrickLink' }); Object.assign(es.integrations, { keyRemoved: 'Clave de {label} eliminada', keyVerified: 'Clave de {label} verificada y guardada' }); Object.assign(es.scanner, { setNotFound: 'El set {setNum} no se encontró en el catálogo.', localAiOfflineFailed: 'La IA en el dispositivo falló y estás sin conexión: {error}', addItemFailed: 'No se pudo añadir {name}: {error}', minifig: 'minifigura', itemsAdded: '{count} elementos añadidos a la bóveda', itemsSavedOffline: '{count} guardados sin conexión — se sincronizarán', setsSavedOffline: '{count} sets guardados sin conexión — se sincronizarán al conectarte' }); Object.assign(es.portfolio, { soldFor: 'Vendido por {price} — eliminado de la bóveda' });
Object.assign(es.common, { offlineActionsSyncedOne: '{count} acción sin conexión sincronizada', offlineActionsSyncedOther: '{count} acciones sin conexión sincronizadas', offlineActionsDiscardedOne: '{count} acción sin conexión no se pudo sincronizar y se descartó', offlineActionsDiscardedOther: '{count} acciones sin conexión no se pudieron sincronizar y se descartaron', localItemsSyncedOne: '{count} elemento local sincronizado', localItemsSyncedOther: '{count} elementos locales sincronizados', kidsXp: '+{xp} XP!{details}', kidsXpLevel: ' ¡Nivel {level}!', kidsXpBadge: ' · Insignia: {badge}! 🎉' }); Object.assign(es.scanner, { itemsAddedOne: '{count} elemento añadido a la bóveda', itemsAddedOther: '{count} elementos añadidos a la bóveda', itemsSavedOfflineOne: '{count} elemento guardado sin conexión — se sincronizará', itemsSavedOfflineOther: '{count} elementos guardados sin conexión — se sincronizarán', setsSavedOfflineOne: '{count} set guardado sin conexión — se sincronizará al conectarte', setsSavedOfflineOther: '{count} sets guardados sin conexión — se sincronizarán al conectarte' }); Object.assign(es.portfolio, { wishlistAlertsTooltip: 'Alertas de deseos ({spikes} picos, {drops} bajadas de precio)', bulkLocationPartial: '{updated} de {total} actualizados — {failed} fallaron, inténtalo de nuevo' });
Object.assign(es.data, { restoredFromBackupOne: 'Restaurado {count} set desde {date}', restoredFromBackupOther: 'Restaurados {count} sets desde {date}' }); Object.assign(es.integrations, { bricksetSyncResultOne: 'Importado {count} set ({skipped} fuera del catálogo, {total} en Brickset).', bricksetSyncResultOther: 'Importados {count} sets ({skipped} fuera del catálogo, {total} en Brickset).', bricksetSyncSuccessOne: 'Sincronización Brickset: {count} set añadido', bricksetSyncSuccessOther: 'Sincronización Brickset: {count} sets añadidos' }); Object.assign(es.wishlist, { unreadAlertsOne: '{count} alerta sin leer', unreadAlertsOther: '{count} alertas sin leer' }); Object.assign(es.portfolio, { wishlistAlertsTooltip: 'Alertas de deseos ({spikes}, {drops})', wishlistAlertSpikesOne: '{count} pico', wishlistAlertSpikesOther: '{count} picos', wishlistAlertDropsOne: '{count} bajada de precio', wishlistAlertDropsOther: '{count} bajadas de precio', insightSignal: 'Reventa {direction}{pct}% frente a {basis}{quantity}', insightMarket: 'mercado', insightValue: 'valor', insightQuantity: ' · ×{count}' });
Object.assign(es.kids, { badgeCelebration: '¡Nueva insignia: {badge}! 🎉', badgeQuip: '¡Eres una superestrella de la construcción! 🌟', levelCelebration: '¡Has llegado al nivel {level}! 🎉', levelQuip: '¡Sigue construyendo! 🧱', badgeFirstBrick: '¡Primer ladrillo!', badgeJuniorBuilder: 'Constructor juvenil', badgeArchitect: 'Arquitecto', badgeMaster: 'Maestro constructor', badgeGrandMaster: 'Gran maestro', badgeLegend: '¡Legendario!' });
Object.assign(es.data, { csvImportConfirmTitleOne: '¿Importar 1 set?', csvImportConfirmTitleOther: '¿Importar {count} sets?', csvImportMore: ' y {count} más', csvImportConfirmMessage: 'Empezando por: {sample}{more}. Los sets existentes se conservan.', importConfirm: 'Importar' });
Object.assign(es.scanner, { setNumberMatched: 'El número de set coincide con el catálogo.' });
Object.assign(es.portfolio, { insightHeadlineOne: '≈ {value} de potencial en 1 set si se vende ahora', insightHeadlineOther: '≈ {value} de potencial en {count} sets si se venden ahora' });
Object.assign(es.market, { goodTimeToSell: 'Buen momento para vender', goodTimeToBuy: 'Buen momento para comprar', onlyForSale: 'Solo hay {count} a la venta ahora', askingHighHint: 'Los vendedores piden mucho — publica cerca del precio vendido reciente para vender rápido', askingLowHint: 'Listado por debajo de los precios vendidos recientes — buen momento para comprar', askingSummary: '{count} a la venta ahora · piden {asking}', askingSummaryWithSold: '{count} a la venta ahora · piden {asking} frente a {sold} vendido recientemente' });
Object.assign(es.game, { marketGenius: '{score}/5 — market genius! 🎯', streakQuipOne: 'Streak: {count} day.', streakQuipOther: 'Streak: {count} days.' }); es.market = Object.assign(es.market || {}, { sellingAbove: 'Selling about {pct} above this value', sellingBelow: 'Selling about {pct} below this value' }); Object.assign(es.scanner, { findingSet: 'Finding set...', lookingUpSet: 'Looking up {setNum} in the catalog.' });
Object.assign(es.game, { marketGenius: '{score}/5 — ¡genio del mercado! 🎯', streakQuipOne: 'Racha: {count} día.', streakQuipOther: 'Racha: {count} días.' });
Object.assign(es.market, { sellingAbove: 'Se vende cerca de un {pct} por encima de este valor', sellingBelow: 'Se vende cerca de un {pct} por debajo de este valor' }); Object.assign(es.scanner, { findingSet: 'Buscando el set…', lookingUpSet: 'Buscando {setNum} en el catálogo.', bulkMatched: '{matched} de {total} encontrados' }); Object.assign(es.game, { revealCorrect: '🎯 ¡Acertaste! — son {value}', revealIncorrect: 'Casi — son {value}' }); Object.assign(es.catalog, { activeFiltersOne: '1 activo', activeFiltersOther: '{count} activos' }); Object.assign(es.portfolio, { anniversaryGain: 'Comprado por {paid} — ha subido {gain} desde entonces.', anniversaryNoGain: 'Comprado por {paid}. Algunos sets son por amor, no por ganancia.', anniversaryQuip: 'El tiempo vuela cuando construyes.', anniversaryCelebrationOne: '¡1 año con {set}! 🎂', anniversaryCelebrationOther: '¡{count} años con {set}! 🎂' });
Object.assign(es.market, { partsCoverage: '{pct}% de cobertura de piezas', forecastScenarios: 'Bajista {bear} · Base {base} · Alcista {bull}', salesSuffix: ' / {count} ventas', newSold: 'Nuevo vendido', usedSold: 'Usado vendido', viewOnBrickLink: 'Ver en BrickLink' }); Object.assign(es.catalog, { loadFailedDetail: '{error}. Revisa tu conexión e inténtalo de nuevo.' }); Object.assign(es.portfolio, { moreThemesOne: '+1 tema más', moreThemesOther: '+{count} temas más', sealedParts: 'Sellado {sealed} · {approximate}Piezas {parts}' }); es.advisor = Object.assign(es.advisor || {}, { moreThemesOne: '+1 tema más en tu bóveda', moreThemesOther: '+{count} temas más en tu bóveda' });
Object.assign(es.game, { loadFailed: 'No se pudo cargar el juego de hoy: {error}' }); Object.assign(es.contributions, { loadFailed: 'No se pudo cargar: {error}' }); Object.assign(es.me, { wrappedLoadFailed: 'No se pudo cargar tu año: {error}', wrappedValueChange: 'La bóveda {direction} {value} este año', wrappedUp: 'subió', wrappedDown: 'bajó' });
Object.assign(es.catalog, { filterSummaryNone: 'No hay filtros activos', filterSummaryActiveOne: '{count} activo: {items}', filterSummaryActiveOther: '{count} activos: {items}', filterSummarySearch: 'Buscar «{value}»', filterSummaryStatusRetired: 'Solo retirados', filterSummaryStatusActive: 'Solo activos', filterSummaryStatusRetiring: 'Próximos a retirarse', filterSummaryDeal: 'Solo ofertas', filterSummaryRangeYear: 'Año', filterSummaryRangePieces: 'Piezas', filterSummaryRangeValue: 'Valor', filterSummaryRangeBetween: '{label} {min}–{max}', filterSummaryRangeMin: '{label} ≥ {value}', filterSummaryRangeMax: '{label} ≤ {value}', filterSummaryPiecesValue: '{value} piezas', filterSummaryValueAmount: '{value} US$' });
Object.assign(es.minifigs, { filterSummaryNone: 'No hay filtros activos', filterSummaryActiveOne: '{count} activo: {items}', filterSummaryActiveOther: '{count} activos: {items}', filterSummarySearch: 'Buscar «{value}»', filterSummaryRarity: 'Rareza: {rarity}', filterSummaryRarityCommon: 'Común', filterSummaryRarityUncommon: 'Poco común', filterSummaryRarityRare: 'Rara', filterSummaryRarityLegendary: 'Legendaria', filterSummaryOwned: 'Solo propias', filterSummaryUnowned: 'Solo no propias' });
Object.assign(es.catalog, { emptySearchResults: 'Nada coincide con «{query}». Prueba otra búsqueda o borra los filtros.', emptyFilteredResults: 'Ningún set coincide con estos filtros. Prueba otra búsqueda o borra los filtros.' });
Object.assign(es.advisor, { retiredSetsOfTotalOne: '{retired} de {total} set', retiredSetsOfTotalOther: '{retired} de {total} sets' });
Object.assign(es.scanner, { duplicateConfirmTitle: 'Ya lo tienes', duplicateConfirmMessage: 'Ya tienes {names} en tu colección. ¿Añadir otra copia?', duplicateConfirmAction: 'Añadir de todos modos' });
Object.assign(es.scanner, { minifigWithSeries: '{minifig} de la serie {series}', minifigWithRarity: '{minifig} — rareza: {rarity}', rarityUnknown: 'Desconocida' });
Object.assign(es.admin, { jobAccepted: '{label} aceptado; aparecerá pronto en Actividad', pricechartingBulkAccepted: 'Descarga masiva de PriceCharting iniciada; los resultados aparecerán pronto en Actividad', pricechartingVerifyAccepted: 'Verificación de PriceCharting iniciada; consulta Actividad para los mapeos promovidos', pricesapiAccepted: 'Actualización de pricesAPI iniciada; consulta Actividad para el resultado' });
Object.assign(es.scanner, { setsFoundOne: '{count} set encontrado', setsFoundOther: '{count} sets encontrados', minifigsFoundOne: '{count} minifigura encontrada', minifigsFoundOther: '{count} minifiguras encontradas', mixedResultsFoundOne: '{count} resultado encontrado (sets y minifiguras)', mixedResultsFoundOther: '{count} resultados encontrados (sets y minifiguras)', confidenceHigh: 'Alta confianza', confidenceMedium: 'Confianza media', confidenceLow: 'Baja confianza', confidenceUnknown: 'Confianza de coincidencia no disponible', matchHigh: 'Coincidencia alta', matchMedium: 'Coincidencia media', matchLow: 'Coincidencia baja', match: 'Coincidencia' });
Object.assign(es.detail, { sellReasonGainSincePurchase: 'Subió {roi} desde la compra', sellReasonTrendDown: 'La tendencia de precio va a la baja', sellReasonClimbFlattened: 'La subida de precio se ha aplanado', sellReasonLittleUpside: 'Solo queda {upside} de potencial previsto', sellReasonSellsFast: '{volume} ventas recientes indican que se vende rápido', sellReasonWatchClosely: 'Vigila el mercado de cerca', sellReasonStillClimbing: 'El precio sigue subiendo', sellReasonForecastUpside: 'La previsión sugiere {upside} más de potencial', sellReasonNotRetired: 'Aún no está retirado', sellReasonNoSellTrigger: 'Aún no hay una señal clara para vender' });
Object.assign(es.data, { migrationStillFailingOne: 'Aún falla {count} elemento: {error}', migrationStillFailingOther: 'Aún fallan {count} elementos: {error}', migrationCompleteOne: 'Listo — {count} elemento sincronizado.', migrationCompleteOther: 'Listo — {count} elementos sincronizados.', setsImportedOne: '{count} set importado', setsImportedOther: '{count} sets importados', bricklinkSetsImportedOne: '{count} set importado desde pedidos de BrickLink', bricklinkSetsImportedOther: '{count} sets importados desde pedidos de BrickLink' });
Object.assign(es.detail, { sellReasonSellsFastOne: '{volume} venta reciente indica que se vende rápido', sellReasonSellsFastOther: '{volume} ventas recientes indican que se vende rápido' });
Object.assign(es.minifigs, { setExclusive: 'Exclusiva del set', inSetsOne: 'En {count} set', inSetsOther: 'En {count} sets', partsOne: '{count} pieza', partsOther: '{count} piezas' });
Object.assign(es.minifigs, { emptySearchResults: 'Nada coincide con «{query}».', emptyFilteredResults: 'Ninguna minifigura coincide con estos filtros.' });
Object.assign(es.detail, { partsComplete: 'Completo', partsMissingOne: 'Falta {count} pieza', partsMissingOther: 'Faltan {count} piezas', allPartsPresent: 'todas las piezas presentes' });
Object.assign(es.build, { needPartsOne: 'Falta {n} pieza', needPartsOther: 'Faltan {n} piezas' });
Object.assign(es.card, { lotsOne: '{n} lote', lotsOther: '{n} lotes' });
Object.assign(es.market, { salesSuffixOne: ' / {count} venta', salesSuffixOther: ' / {count} ventas' });
Object.assign(es.data, { importedCountOne: '{n} set importado', importedCountOther: '{n} sets importados', skippedCountOne: '{n} set omitido', skippedCountOther: '{n} sets omitidos', errorsCountOne: '{n} error', errorsCountOther: '{n} errores', setsAddedCountOne: '{n} set añadido', setsAddedCountOther: '{n} sets añadidos', importResult: '✓ {imported}; {skipped}; {errors}', bricklinkImportResult: '✓ {added}; {skipped}. {errors}' });
Object.assign(es.admin, { minifigsImportedOne: '{n} minifigura', minifigsImportedOther: '{n} minifiguras', minifigsParsedOne: '{n} minifigura', minifigsParsedOther: '{n} minifiguras', importedMinifigs: 'Se importaron {inserted} de {parsed}. Se asignarán precios al valorarlas.' });
Object.assign(es.time, {"daysAgoOne":"hace {n} días","daysAgoOther":"hace {n} días"});
Object.assign(es.scanner, {"bulkPartialOne":"Se añadieron {added} de {total} — {failed} fallaron, inténtalo de nuevo","bulkPartialOther":"Se añadieron {added} de {total} — {failed} fallaron, inténtalo de nuevo"});
Object.assign(es.kids, {"setsToGoOne":"Faltan {n} sets","setsToGoOther":"Faltan {n} sets","earnedOne":"{n} de {total} conseguidos","earnedOther":"{n} de {total} conseguidos"});
Object.assign(es.market, {"familiesOne":"{n} fuentes de mercado independientes","familiesOther":"{n} fuentes de mercado independientes","salesOne":"{n} ventas verificadas","salesOther":"{n} ventas verificadas","onlyForSaleOne":"Solo hay {count} a la venta ahora","onlyForSaleOther":"Solo hay {count} a la venta ahora","askingSummaryOne":"{count} a la venta ahora · piden {asking}","askingSummaryOther":"{count} a la venta ahora · piden {asking}","askingSummaryWithSoldOne":"{count} a la venta ahora · piden {asking} frente a {sold} vendido recientemente","askingSummaryWithSoldOther":"{count} a la venta ahora · piden {asking} frente a {sold} vendido recientemente"});
Object.assign(es.detail, {"fromSourcesOne":"De {n} fuentes de mercado","fromSourcesOther":"De {n} fuentes de mercado","reviewsOne":"{n} reseñas","reviewsOther":"{n} reseñas","priceHistoryDaysOne":"Historial de precios · {n} días","priceHistoryDaysOther":"Historial de precios · {n} días","priceHistoryShortOne":"Historial de precios · {n} d","priceHistoryShortOther":"Historial de precios · {n} d"});
Object.assign(es.alerts, {"priceDropOne":"Bajada de precio · hace {n} d","priceDropOther":"Bajada de precio · hace {n} d"});
Object.assign(es.portfolio, {"bulkLocationPartialOne":"{updated} de {total} actualizados — {failed} fallaron, inténtalo de nuevo","bulkLocationPartialOther":"{updated} de {total} actualizados — {failed} fallaron, inténtalo de nuevo","bulkRemovePartialOne":"Se eliminaron {removed} de {total} — {failed} fallaron, inténtalo de nuevo","bulkRemovePartialOther":"Se eliminaron {removed} de {total} — {failed} fallaron, inténtalo de nuevo","restoredCountOne":"Se restauraron {restored} de {total}","restoredCountOther":"Se restauraron {restored} de {total}"});
Object.assign(es.wishlist, {"setsCountOne":"{n} sets","setsCountOther":"{n} sets","alertsCountOne":"{n} alertas","alertsCountOther":"{n} alertas"});
Object.assign(es.admin, {"syncJobSkippedOne":"omitido — {n}","syncJobSkippedOther":"omitido — {n}","syncJobSummaryOne":"{processed} procesados, {updated} actualizados, {rejected} rechazados","syncJobSummaryOther":"{processed} procesados, {updated} actualizados, {rejected} rechazados","uploadSuccessToastOne":"Catálogo de minifiguras BrickLink: {n} importadas","uploadSuccessToastOther":"Catálogo de minifiguras BrickLink: {n} importadas","contributionActionOne":"{action} — {n}","contributionActionOther":"{action} — {n}"});
Object.assign(es.data, {"csvImportMoreOne":" y {n} más","csvImportMoreOther":" y {n} más","csvImportConfirmMessageOne":"Empezando por: {sample}{more}. Los sets existentes se conservan.","csvImportConfirmMessageOther":"Empezando por: {sample}{more}. Los sets existentes se conservan."});
Object.assign(es.me, {"trophyShelfOne":"Estantería de trofeos ({n}/6)","trophyShelfOther":"Estantería de trofeos ({n}/6)"});
Object.assign(es.build, {"ofOwnedSetsOne":"de {n} sets en propiedad","ofOwnedSetsOther":"de {n} sets en propiedad","indexingOne":"Indexando {n} set(s) más en segundo plano…","indexingOther":"Indexando {n} set(s) más en segundo plano…"});
Object.assign(es.counts, {"collectedOne":"{owned}/{total} coleccionadas","collectedOther":"{owned}/{total} coleccionadas","ownedOne":"{n} en propiedad","ownedOther":"{n} en propiedad","ofFigsOne":"de {total} minifiguras","ofFigsOther":"de {total} minifiguras","resultsOne":"{n} resultados","resultsOther":"{n} resultados","figsOne":"{n} minifiguras","figsOther":"{n} minifiguras"});
Object.assign(es.minifigs, {"ownedCountOne":"{n} en propiedad","ownedCountOther":"{n} en propiedad"});
Object.assign(es.catalog, {"filtersWithCountOne":"Filtros · {n}","filtersWithCountOther":"Filtros · {n}"});
Object.assign(es.scanner, {"bulkMatchedOne":"{matched} de {total} encontrados","bulkMatchedOther":"{matched} de {total} encontrados"});
Object.assign(es.kids, {"pcsOne":"{n} piezas","pcsOther":"{n} piezas"});
Object.assign(es.card, {"gamePiecesOne":"{n} piezas","gamePiecesOther":"{n} piezas","piecesOne":"{n} PZS","piecesOther":"{n} PZS"});
Object.assign(es.scanner, { bulkMatchedOne: '{n} de {total} encontrado', bulkMatchedOther: '{n} de {total} encontrados' });
Object.assign(es.kids, { pcsOne: '{n} pieza', pcsOther: '{n} piezas' });
Object.assign(es.card, { gamePiecesOne: '{n} pieza', gamePiecesOther: '{n} piezas', piecesOne: '{n} pieza', piecesOther: '{n} piezas' });
Object.assign(es.share ??= {}, {"gameTitle":"Price It!","gameText":"🧱 Price It! {day}\\n{tiles} {score}/5 · streak {streak}\\nGuess LEGO market prices on BricksVault","setText":"Check out {name} ({setNum}) on BricksVault!","setDialogTitle":"Share {name}","portfolioTitle":"My LEGO BricksVault","portfolioText":"Check out my LEGO collection on BricksVault!","portfolioDialogTitle":"Share my BricksVault","wrappedTitle":"Brick Wrapped {year}","wrappedBest":"Best performer: {name}{roi}","wrappedTracked":"Tracked with BricksVault","wrappedSetsAdded":"sets added","wrappedPiecesAdded":"pieces","wrappedValueChange":"vault value change","wrappedTagline":"BRICKSVAULT · STACK SOMETHING BEAUTIFUL"});
Object.assign(es.share, { gameTitle: '¡Ponle precio!', gameText: '🧱 ¡Ponle precio! {day}\n{tiles} {score}/5 · racha {streak}\nAdivina los precios de mercado LEGO en BricksVault', setText: '¡Mira {name} ({setNum}) en BricksVault!', setDialogTitle: 'Compartir {name}', portfolioTitle: 'Mi BricksVault LEGO', portfolioText: '¡Mira mi colección LEGO en BricksVault!', portfolioDialogTitle: 'Compartir mi BricksVault', wrappedTitle: 'Resumen Brick {year}', wrappedBest: 'Mejor resultado: {name}{roi}', wrappedTracked: 'Registrado con BricksVault', wrappedValueChange: 'cambio de valor del almacén', wrappedTagline: 'BRICKSVAULT · CONSTRUYE ALGO BONITO', wrappedHeading: 'Resumen Brick', wrappedDescription: 'Tu año de coleccionista en cifras — compártelo.', wrappedLoading: 'Contando tus ladrillos…', wrappedSummaryTitle: '🧱 Mi resumen Brick {year}', wrappedSetsAddedOne: '{count} set añadido', wrappedSetsAddedOther: '{count} sets añadidos', wrappedPiecesAddedOne: '{count} pieza', wrappedPiecesAddedOther: '{count} piezas', wrappedMinifigsOne: '{count} minifigura', wrappedMinifigsOther: '{count} minifiguras', wrappedInvested: 'invertido', wrappedSoldOne: '{count} set vendido', wrappedSoldOther: '{count} sets vendidos', wrappedSoldLabel: 'vendido', wrappedBestLabel: 'Mejor resultado', wrappedBestCanvas: 'Mejor resultado', wrappedBestCanvasWithRoi: 'Mejor resultado · {roi}', wrappedLongestHeld: 'Con más tiempo: {name} (desde {year})', wrappedClose: 'Cerrar', wrappedShareYear: 'Compartir mi año' });
Object.assign(es.data, { reportPreparing: 'Preparando informe…', insuranceReportTitle: 'Informe de seguro de BricksVault', reportSharedReady: 'Informe listo — ábrelo e imprímelo como PDF.', reportDownloadedReady: 'Informe descargado — ábrelo e imprímelo como PDF.', noSnapshotsYet: 'Aún no hay copias — la primera se crea el próximo domingo.', backupsUnavailable: 'Las copias no están disponibles ahora.', retryingSync: 'Reintentando sincronización…', guestVaultSynced: 'Almacén de invitado sincronizado', exportPreparing: 'Preparando exportación…', collectionExportTitle: 'Compartir colección BricksVault', guestExportShared: 'Tu exportación local de invitado está lista para compartir o guardar.', guestExportDownloaded: 'Exportación descargada de los datos locales de invitado.', syncedExportShared: 'Tu exportación sincronizada está lista para compartir o guardar.', syncedExportDownloaded: 'Exportación descargada de tu almacén sincronizado.' });
// en.js declares `market` twice as an object literal, so the later one wins and
// keys added to the earlier block are silently dropped. Assigning after the fact
// lands on whichever object survived.
Object.assign(es.market, { comps: '{n} comparables', slashComps: ' / {n} comparables', usedValue: 'Usado: {price}', updated: 'Actualizado {date}', compsAboveMsrp: 'Las ventas de nuevos están {amount} ({pct}) por encima del PVP.', compsBelowMsrp: 'Las ventas de nuevos están {amount} ({pct}) por debajo del PVP.' });

Object.assign(es.detail, { tagsMoreOne: '+{n} más', tagsMoreOther: '+{n} más' });
Object.assign(es.market, { compsOne: '{n} comparable', compsOther: '{n} comparables', slashCompsOne: ' / {n} comparable', slashCompsOther: ' / {n} comparables' });

Object.assign(es.settings, { appLockUnchanged: 'El bloqueo de la app no cambió: {error}' });
Object.assign(es.game, { checkGuessFailed: 'No se pudo comprobar la estimación: {error}' });
Object.assign(es.alerts, { sellOpportunityOne: 'Oportunidad de venta · hace {n} día', sellOpportunityOther: 'Oportunidad de venta · hace {n} días' });
Object.assign(es.detail, { minifigsCountOne: '{n} minifigura', minifigsCountOther: '{n} minifiguras' });
Object.assign(es.market, { listingsOne: '{n} anuncio', listingsOther: '{n} anuncios', slashListingsOne: ' / {n} anuncio', slashListingsOther: ' / {n} anuncios', slashSamplesOne: ' / {n} muestra', slashSamplesOther: ' / {n} muestras' });
Object.assign(es.scanner, { estimatedValue: '(~valor estimado)', marketGrabThreshold: 'Mercado {market} — por debajo de {price} es una ganga{estimated}', underMarket: '{amount} por debajo del mercado{estimated}', withinMarket: 'a un {pct}% del mercado{estimated}', overMarket: '{amount} por encima del mercado{estimated}' });

export default es;
