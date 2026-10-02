import { type FieldDocument, sampleRenderValues, type StepDocument } from '@procesabpm/shared';
import { documentsEs as es } from '../i18n/es.js';
import type { RenderFacts, SignerRecord } from './render-facts.js';

const SAMPLE_SIGNER = 'Firmante de ejemplo';
const PEOPLE_TYPES = new Set(['TASK', 'APPROVAL', 'DECISION', 'SIGNATURE']);

/** Raw values the resolver understands, derived from the display samples of each field type. */
function rawSamples(fields: readonly FieldDocument[], names: { users: Map<string, string>; sites: Map<string, string>; files: Map<string, string> }): Record<string, unknown> {
  const display = sampleRenderValues(fields);
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const sample = display[field.code];
    if (field.type === 'DATETIME') result[field.code] = sample instanceof Date ? sample.toISOString() : sample;
    else if (field.type === 'MULTI_SELECT') result[field.code] = typeof sample === 'string' ? sample.split(', ') : sample;
    else if (field.type === 'USER' && typeof sample === 'string') (names.users.set(sample, sample), (result[field.code] = sample));
    else if (field.type === 'SITE' && typeof sample === 'string') (names.sites.set(sample, sample), (result[field.code] = sample));
    else if (field.type === 'FILE' && typeof sample === 'string') (names.files.set(sample, sample), (result[field.code] = [sample]));
    else result[field.code] = sample;
  }
  return result;
}

/** A ticket that does not exist: every field with a sample of its type, every people step signed by a made-up person. */
export function buildPreviewFacts(fields: readonly FieldDocument[], steps: readonly StepDocument[], overrides: Readonly<Record<string, unknown>>, locale: { timeZone: string; currencyCode: string }, now: Date): RenderFacts {
  const names = { users: new Map<string, string>(), sites: new Map<string, string>(), files: new Map<string, string>() };
  const signer: SignerRecord = { userId: 'preview-creator', name: SAMPLE_SIGNER, signedAt: now, imageKey: null };
  return {
    ticket: { number: '0000', title: es.previewTicket.title, status: 'OPEN', createdAt: now, closedAt: null, companyName: es.previewTicket.companyName, creatorId: 'preview-creator', creatorName: es.previewTicket.creatorName, currentStepName: es.previewTicket.stepName },
    timeZone: locale.timeZone,
    currencyCode: locale.currencyCode,
    fields,
    values: { ...rawSamples(fields, names), ...overrides },
    names,
    signers: new Map(steps.filter((step) => PEOPLE_TYPES.has(step.type)).map((step) => [step.name, [signer]])),
    now,
  };
}
