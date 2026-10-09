import type { NotificationTypeValue } from '@procesabpm/shared';

/** In-app and e-mail texts of the ticket notifications (Spanish). Titles never carry the ticket's own text: that goes in the body. */
export const notificationsEs = {
  titles: {
    TICKET_CREATED: (n: string) => `Se creó el ticket #${n} a tu nombre`,
    TICKET_ASSIGNED: (n: string) => `Se te asignó el ticket #${n}`,
    TICKET_TRANSITIONED: (n: string) => `El ticket #${n} avanzó de paso`,
    TICKET_COMMENTED: (n: string) => `Nuevo comentario en el ticket #${n}`,
    TICKET_CLOSED: (n: string) => `El ticket #${n} se cerró`,
    TICKET_REOPENED: (n: string) => `El ticket #${n} se reabrió`,
    INCIDENT_OPENED: (n: string) => `Hay una novedad en el ticket #${n}`,
    INCIDENT_RESOLVED: (n: string) => `Se resolvió la novedad del ticket #${n}`,
    SLA_WARNING: (n: string) => `El ticket #${n} está por vencer`,
    SLA_OVERDUE: (n: string) => `El ticket #${n} venció su plazo`,
    OBSERVER_UPDATE: (n: string) => `Hay actividad en el ticket #${n} que observas`,
    STORAGE_QUOTA: () => 'Tu organización se acerca al límite de almacenamiento',
    SYSTEM: () => 'Aviso de ProcesaBPM',
  } satisfies Record<NotificationTypeValue, (ticketNumber: string) => string>,
  storageQuota: {
    body: (level: number, used: string, limit: string) =>
      level >= 95
        ? `Tu organización ya usa el ${level} % del almacenamiento de su plan (${used} de ${limit}). Pasado el límite y su margen, no se podrán subir más archivos.`
        : `Tu organización ya usa el ${level} % del almacenamiento de su plan (${used} de ${limit}).`,
    advice: 'Puedes ampliar el almacenamiento con tu plan o liberar espacio. Los documentos que genera el sistema se siguen guardando aunque se llegue al límite.',
    action: 'Ver el almacenamiento',
    why: (organization: string) => `Recibes este correo porque administras «${organization}». Puedes cambiar qué avisos recibes en tus preferencias de notificaciones.`,
  },
  email: {
    greeting: (firstName: string) => `Hola ${firstName},`,
    ticketLine: (title: string) => `Ticket: ${title}`,
    action: 'Ver el ticket',
    why: (organization: string) => `Recibes este correo porque participas en tickets de «${organization}». Puedes cambiar qué avisos recibes en tus preferencias de notificaciones.`,
  },
} as const;
