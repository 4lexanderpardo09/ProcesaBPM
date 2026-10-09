import { z } from 'zod';
import type { CloseRule, FieldType, StepType } from '../../workflow/constants.js';
import { uuidSchema } from '../ids.js';

/**
 * The forms a member fills: what the web app needs to draw them. The same rules decide what is shown and what the
 * engine accepts, so a form never offers what the submission would then refuse.
 */

/** A field of the workflow version, as the form draws it. */
export interface FormFieldResponse {
  readonly id: string;
  readonly stepId: string;
  readonly code: string;
  readonly label: string;
  readonly type: FieldType;
  readonly isRequired: boolean;
  readonly isReadOnly: boolean;
  readonly sortOrder: number;
  readonly config: Readonly<Record<string, unknown>>;
  /** Where the values come from (preset list, dataset or calculator); `null` for a free field. */
  readonly dataSource: Readonly<Record<string, unknown>> | null;
}

export const creationFormQuerySchema = z.object({ companyId: uuidSchema.optional() });
export type CreationFormQuery = z.infer<typeof creationFormQuerySchema>;

export interface CreationFormStart {
  readonly stepId: string;
  readonly name: string;
  readonly description: string | null;
  /** The fields captured when creating from this start, in order. */
  readonly fields: readonly FormFieldResponse[];
}

/** Creating a ticket of a subcategory for oneself: only the START blocks that admit the caller are listed. */
export interface CreationFormResponse {
  readonly subcategoryId: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly companyId: string;
  readonly defaultPriorityId: string | null;
  readonly starts: readonly CreationFormStart[];
}

/** A decision the people on the step can take: the `transitionId` of `POST /tickets/:id/transition`. */
export interface FormDecisionResponse {
  readonly transitionId: string;
  readonly label: string;
}

/**
 * The current step of a ticket: every field of its version (to show the values), which of them are filled on this
 * step, and the decisions that move it on. `step` is `null` once the ticket is closed.
 */
export interface TicketFormResponse {
  readonly ticketId: string;
  readonly versionId: string;
  readonly visitId: string | null;
  readonly step: { readonly id: string; readonly name: string; readonly type: StepType; readonly description: string | null; readonly closeRule: CloseRule } | null;
  readonly fields: readonly FormFieldResponse[];
  /** Codes of the fields captured on the current step (empty when closed). */
  readonly editableFieldCodes: readonly string[];
  readonly decisions: readonly FormDecisionResponse[];
}
