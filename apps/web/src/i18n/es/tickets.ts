export const tickets = {
  inbox: {
    title: 'Tickets',
    count_one: '{{count}} ticket',
    count_other: '{{count}} tickets',
    newTicket: 'Nuevo ticket',
    viewsLabel: 'Bandejas',
    tableLabel: 'Tickets de la bandeja',
    loading: 'Cargando tickets…',
    retry: 'Reintentar',
    empty: {
      assigned: 'No tienes tickets asignados.',
      created: 'No has creado tickets.',
      observed: 'No observas ningún ticket.',
      all: 'No hay tickets.',
      filtered: 'Ningún ticket coincide con el filtro.',
    },
  },
  views: {
    assigned: 'Asignados a mí',
    created: 'Creados por mí',
    observed: 'Observados',
    all: 'Todos',
  },
  filters: {
    status: 'Estado',
    anyStatus: 'Todos',
  },
  status: {
    OPEN: 'Abierto',
    PAUSED: 'Pausado',
    CLOSED: 'Cerrado',
  },
  columns: {
    number: 'Nº',
    title: 'Título',
    status: 'Estado',
    createdAt: 'Creado',
    tags: 'Etiquetas',
  },
  placeholders: {
    newTicket: 'Nuevo ticket',
    detail: 'Detalle del ticket',
  },
  tags: {
    more: '+{{count}}',
    moreLabel_one: '{{count}} etiqueta más: {{names}}',
    moreLabel_other: '{{count}} etiquetas más: {{names}}',
  },
} as const;
