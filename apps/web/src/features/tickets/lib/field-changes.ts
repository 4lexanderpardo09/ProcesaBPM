import type { FormFieldResponse, TicketValueNamesResponse } from '@procesabpm/shared';
import { z } from 'zod';
import { type FieldValueDisplay, fieldValueDisplay } from './field-value';

/** What a `FIELDS_UPDATED` event changed, ready to read: the ticket's own header or a field of its form. */
export type FieldChange =
  | { readonly kind: 'title'; readonly before: string; readonly after: string }
  | { readonly kind: 'description' }
  | { readonly kind: 'priority'; readonly before: string | null; readonly after: string | null }
  | { readonly kind: 'field'; readonly label: string; readonly before: FieldValueDisplay | undefined; readonly after: FieldValueDisplay | undefined };

const changesSchema = z.object({
  changes: z.array(z.object({ code: z.string(), before: z.unknown(), after: z.unknown() })),
});

const nullableId = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Reads the `{ changes: [{ code, before, after }] }` an edit, a submitted form or a calculation records. A field the
 * version no longer has keeps its code as label, and an event of another shape reads as no change at all.
 */
export function fieldChanges(data: unknown, fields: readonly FormFieldResponse[], names: TicketValueNamesResponse, timeZone?: string): FieldChange[] {
  const parsed = changesSchema.safeParse(data);
  if (!parsed.success) return [];
  return parsed.data.changes.map(({ code, before, after }): FieldChange => {
    if (code === 'title') return { kind: 'title', before: String(before ?? ''), after: String(after ?? '') };
    if (code === 'descriptionHtml') return { kind: 'description' };
    if (code === 'priorityId') return { kind: 'priority', before: nullableId(before), after: nullableId(after) };
    const field = fields.find((candidate) => candidate.code === code);
    if (field === undefined) return { kind: 'field', label: code, before: plain(before), after: plain(after) };
    return { kind: 'field', label: field.label, before: fieldValueDisplay(field, before, names, timeZone), after: fieldValueDisplay(field, after, names, timeZone) };
  });
}

function plain(value: unknown): FieldValueDisplay | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return typeof value === 'object' ? { kind: 'unknown' } : { kind: 'text', text: String(value) };
}
