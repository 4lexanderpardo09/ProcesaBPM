import { describe, expect, it } from 'vitest';
import { collectReferences } from './references.js';
import { field, step, version } from './test-builders.js';

const A = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const B = '018f3c1e-7b2a-7c3d-9e4f-0123456789ac';

describe('collectReferences', () => {
  it('finds the ids that blocks and fields point at', () => {
    const doc = version({
      steps: [
        step('d', 'DOCUMENT', { config: { workflowDocumentId: A, role: 'MAIN_DOCUMENT' } }),
        step('e', 'EXPORT', { config: { exportDefinitionId: B } }),
        step('w', 'WEBHOOK', { config: { webhookId: A } }),
        step('n', 'NOTIFICATION', { config: { recipients: [{ kind: 'CREATOR' }, { kind: 'USER', id: A }, { kind: 'GROUP', id: B }], channels: ['EMAIL'], subject: 's', body: 'b' } }),
      ],
      fields: [field('f1', 'd', 'WHO', { type: 'USER', config: { positionIds: [A] } }), field('f2', 'd', 'LIST', { type: 'SELECT', dataSource: { kind: 'DATASET', datasetId: B, column: 'x' } })],
    });
    expect(collectReferences(doc).map((reference) => `${reference.kind}:${reference.id === A ? 'A' : 'B'}`)).toEqual(['WORKFLOW_DOCUMENT:A', 'EXPORT_DEFINITION:B', 'WEBHOOK:A', 'USER:A', 'GROUP:B', 'POSITION:A', 'DATASET:B']);
  });

  it('ignores what is not an id (the validator reports malformed configs)', () => {
    expect(collectReferences(version({ steps: [step('d', 'DOCUMENT', { config: { workflowDocumentId: 'nope' } })] }))).toEqual([]);
  });
});
