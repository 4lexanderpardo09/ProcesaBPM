import { z } from 'zod';
import { uuidSchema } from '../ids.js';
import { type IncidentMutationResponse, type TicketMutationResponse, ticketStatusSchema } from './schemas.js';

/** Parses `TicketMutationResponse`, the answer of every ticket action (for the web client). */
export const ticketMutationResponseSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  status: ticketStatusSchema,
  currentStepId: uuidSchema.nullable(),
  openVisitId: uuidSchema.nullable(),
}) satisfies z.ZodType<TicketMutationResponse>;

/** Parses `IncidentMutationResponse` (opening or resolving an incident). */
export const incidentMutationResponseSchema = ticketMutationResponseSchema.extend({ incidentId: uuidSchema }) satisfies z.ZodType<IncidentMutationResponse>;
