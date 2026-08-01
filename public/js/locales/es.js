/** Spanish. Missing keys fall back to English (see lib/i18n.js). */
export const es = {
  nav: { vault: 'Colección', catalog: 'Catálogo', scan: 'Escanear', minifigs: 'Minifiguras', me: 'Yo', badges: 'Insignias' },
  common: {
    cancel: 'Cancelar', save: 'Guardar', close: 'Cerrar', retry: 'Reintentar',
    delete: 'Eliminar', edit: 'Editar', done: 'Hecho', undo: 'Deshacer',
    loading: 'Cargando…', search: 'Buscar', all: 'Todos', none: 'Ninguno',
    yes: 'Sí', no: 'No', error: 'Algo salió mal', offline: 'Estás sin conexión',
    seeAll: 'Ver todo', share: 'Compartir',
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
  },
  counts: {
    results: '{n} resultados', resultsOne: '1 resultado', collected: '{owned}/{total} coleccionadas', owned: '{n} en propiedad', ofFigs: 'de {total} minifiguras', figs: '{n} minifiguras', figsOne: '1 minifigura',
  },
  catalog: {
    title: 'Catálogo', searchPlaceholder: 'Buscar un set', results: '{count} sets',
    noResults: 'No se encontraron sets', filters: 'Filtros', sort: 'Ordenar', clearFilters: 'Borrar filtros',
  },
  vault: {
    title: 'Colección', empty: 'Tu colección está vacía', emptyDesc: 'Añade un set para seguir su valor.',
    setsOwned: 'Sets en propiedad', totalValue: 'Valor total', invested: 'Invertido', gain: 'Ganancia', addSet: 'Añadir un set',
  },
  wishlist: {
    title: 'Lista de deseos', empty: 'Tu lista de deseos está vacía', targetPrice: 'Precio objetivo',
    priceDropAlert: 'Avisarme si baja el precio', remove: 'Quitar de deseos',
  },
};
export default es;
