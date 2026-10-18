import type { BadgeTone } from '@/shared/ui';
import type { TicketStatus } from './inbox-params';

/** README "Color": open is the interactive accent, paused a warning and closed muted. */
export const TICKET_STATUS_TONE: Readonly<Record<TicketStatus, BadgeTone>> = {
  OPEN: 'accent',
  PAUSED: 'warn',
  CLOSED: 'neutral',
};
