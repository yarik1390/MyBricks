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
    addToVaultPrice: 'Añadir a la cámara · {price}', priceHistoryDays: 'Historial de precios · {days} días', priceHistoryShort: 'Historial de precios · {days} d', fromSources: 'De {n} fuentes de mercado', fromSourcesOne: 'De 1 fuente de mercado', typicalRange: ' · normalmente {low}–{high}', likelyRange: ' · probablemente {low}-{high}',
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
export default es;
