export const notifications = {
  title: 'Notificaciones',
  bell: {
    label: 'Notificaciones',
    labelUnread_one: 'Notificaciones: {{count}} sin leer',
    labelUnread_other: 'Notificaciones: {{count}} sin leer',
  },
  unreadCount_one: '{{count}} sin leer',
  unreadCount_other: '{{count}} sin leer',
  unreadPrefix: 'Sin leer:',
  markRead: 'Marcar como leída',
  markReadNamed: 'Marcar como leída: {{title}}',
  markAllRead: 'Marcar todas como leídas',
  seeAll: 'Ver todas',
  loading: 'Cargando…',
  loadFailed: 'No se pudieron cargar las notificaciones. Intenta de nuevo en un momento.',
  empty: 'No tienes notificaciones.',
  emptyUnread: 'No tienes notificaciones sin leer.',
  filtersLabel: 'Filtrar notificaciones',
  filters: {
    all: 'Todas',
    unread: 'Sin leer',
  },
} as const;
