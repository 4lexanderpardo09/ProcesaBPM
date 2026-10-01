/**
 * Defaults every new tenant starts with (created by the platform sign-up). The names are shown to the
 * users of the tenant, so they are in Spanish; the tenant can rename or extend them afterwards.
 */

export interface WorkingSlotTemplate {
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekdays: readonly number[];
  readonly startTime: string;
  readonly endTime: string;
}

export const DEFAULT_CALENDAR_NAME = 'Calendario laboral';

/** Monday to Friday, 08:00–12:00 and 14:00–18:00. */
export const DEFAULT_WORKING_SLOTS: readonly WorkingSlotTemplate[] = [
  { weekdays: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '12:00' },
  { weekdays: [1, 2, 3, 4, 5], startTime: '14:00', endTime: '18:00' },
];

/** Years of country holidays copied into the calendar: the current one and the next. */
export const DEFAULT_HOLIDAY_YEARS_AHEAD = 1;

export const DEFAULT_COMPANY_NAME = 'Empresa principal';

export const DEFAULT_APPROVAL_GROUP_TYPE_NAME = 'General';

export interface PriorityTemplate {
  readonly name: string;
  readonly sortOrder: number;
  readonly color: string;
}

export const DEFAULT_PRIORITIES: readonly PriorityTemplate[] = [
  { name: 'Baja', sortOrder: 1, color: '#2E7D32' },
  { name: 'Media', sortOrder: 2, color: '#F9A825' },
  { name: 'Alta', sortOrder: 3, color: '#EF6C00' },
  { name: 'Urgente', sortOrder: 4, color: '#C62828' },
];

export interface ErrorTypeTemplate {
  readonly name: string;
  readonly description: string;
  readonly isProcessError: boolean;
  readonly forcesClose: boolean;
  readonly isReopening: boolean;
}

/** Exactly one of them reopens the ticket: the engine uses it when a reviewer sends a ticket back. */
export const DEFAULT_ERROR_TYPES: readonly ErrorTypeTemplate[] = [
  {
    name: 'Reapertura',
    description: 'El ticket se reabre para corregir la respuesta',
    isProcessError: false,
    forcesClose: false,
    isReopening: true,
  },
  {
    name: 'Error de proceso',
    description: 'Falla del procedimiento, no de la persona',
    isProcessError: true,
    forcesClose: false,
    isReopening: false,
  },
  {
    name: 'Error de información',
    description: 'Datos incompletos o incorrectos',
    isProcessError: false,
    forcesClose: false,
    isReopening: false,
  },
];
