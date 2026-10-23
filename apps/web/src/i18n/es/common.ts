export const common = {
  appName: 'ProcesaBPM',
  notFound: {
    title: 'Página no encontrada',
    description: 'La dirección no existe o ya no está disponible.',
    backHome: 'Volver al inicio',
  },
  underConstruction: 'Esta sección está en construcción.',
  formatting: {
    toolbar: 'Formato de «{{field}}»',
    bold: 'Negrita',
    boldHint: 'Negrita: **texto**',
    italic: 'Cursiva',
    italicHint: 'Cursiva: _texto_',
    list: 'Lista',
    listHint: 'Lista: líneas que empiezan con «- »',
    numbered: 'Lista numerada',
    numberedHint: 'Lista numerada: líneas que empiezan con «1. »',
    hint: '**negrita**, _cursiva_, líneas con «- » o «1. » para listas; las direcciones web quedan como enlaces.',
  },
  pagination: {
    label: 'Paginación',
    range: 'Mostrando {{from}}–{{to}} de {{total}}',
    previous: 'Anterior',
    next: 'Siguiente',
  },
  errors: {
    unexpected: 'Ocurrió un error inesperado. Intenta de nuevo.',
    unexpectedWithReference: 'Ocurrió un error inesperado. Intenta de nuevo. Código de referencia: {{requestId}}',
    network: 'No hay conexión con el servidor. Revisa tu conexión e intenta de nuevo.',
  },
} as const;
