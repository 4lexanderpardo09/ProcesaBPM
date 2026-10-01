import { type WorkflowVersionDocument } from './document.js';

export type ReferenceKind = 'WORKFLOW_DOCUMENT' | 'EXPORT_DEFINITION' | 'WEBHOOK' | 'DATASET' | 'USER' | 'POSITION' | 'GROUP';

export interface DocumentReference {
  readonly kind: ReferenceKind;
  readonly id: string;
  readonly stepId?: string;
  readonly fieldId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (value: unknown): string | undefined => (typeof value === 'string' && UUID.test(value) ? value : undefined);

/**
 * The ids of records outside the version that block and field configs point at. They sit inside JSON (no foreign
 * key can check them), so the service checks that each one exists and belongs to the right place before publishing.
 */
export function collectReferences(doc: WorkflowVersionDocument): DocumentReference[] {
  const found: DocumentReference[] = [];
  const add = (kind: ReferenceKind, value: unknown, where: { stepId?: string; fieldId?: string }) => {
    const id = idOf(value);
    if (id !== undefined) found.push({ kind, id, ...where });
  };
  for (const step of doc.steps) {
    const at = { stepId: step.id };
    if (step.type === 'DOCUMENT') add('WORKFLOW_DOCUMENT', step.config.workflowDocumentId, at);
    if (step.type === 'EXPORT') add('EXPORT_DEFINITION', step.config.exportDefinitionId, at);
    if (step.type === 'WEBHOOK') add('WEBHOOK', step.config.webhookId, at);
    if (step.type === 'NOTIFICATION' && Array.isArray(step.config.recipients)) {
      for (const recipient of step.config.recipients as Array<{ kind?: unknown; id?: unknown }>) {
        if (recipient.kind === 'USER') add('USER', recipient.id, at);
        if (recipient.kind === 'POSITION') add('POSITION', recipient.id, at);
        if (recipient.kind === 'GROUP') add('GROUP', recipient.id, at);
      }
    }
  }
  for (const field of doc.fields) {
    const at = { fieldId: field.id };
    if (Array.isArray(field.config.positionIds)) for (const id of field.config.positionIds) add('POSITION', id, at);
    if (field.dataSource?.kind === 'DATASET') add('DATASET', field.dataSource.datasetId, at);
  }
  return found;
}
