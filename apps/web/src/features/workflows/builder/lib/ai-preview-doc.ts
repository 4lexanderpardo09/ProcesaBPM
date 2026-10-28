import { type AiDraftPreview, DEFAULT_EXIT_STEP_TYPES, type TransitionDocument, type TransitionType, type WorkflowVersionDocument } from '@procesabpm/shared';
import { addStep, moveStep } from './builder-doc';
import { layeredPositions } from './canvas-extras';

const EMPTY: WorkflowVersionDocument = { steps: [], transitions: [], fields: [], amountRules: [] };

/**
 * The diagram the AI has written so far as a document the canvas can draw (read-only): its blocks with the builder's
 * defaults, its connections, laid out like «Ordenar». Only for showing: it is never saved.
 */
export function previewDocument(preview: AiDraftPreview): WorkflowVersionDocument {
  let doc = EMPTY;
  const ids = new Map<string, string>();
  for (const step of preview.steps) {
    const added = addStep(doc, step.type, step.name, { x: 0, y: 0 });
    doc = added.doc;
    ids.set(step.ref, added.id);
  }
  const transitions: TransitionDocument[] = preview.transitions.flatMap((transition, index) => {
    const from = ids.get(transition.from);
    const to = ids.get(transition.to);
    const fromType = preview.steps.find((step) => step.ref === transition.from)?.type;
    if (from === undefined || to === undefined || fromType === undefined) return [];
    return [{ id: `t${index + 1}`, fromStepId: from, toStepId: to, type: exitType(fromType), label: transition.label, condition: null, sortOrder: index, uiPoints: null, requiresComment: false }];
  });
  doc = { ...doc, transitions };
  return [...layeredPositions(doc)].reduce((next, [id, position]) => moveStep(next, id, position), doc);
}

function exitType(fromType: AiDraftPreview['steps'][number]['type']): TransitionType {
  if (fromType === 'CONDITION') return 'CONDITION';
  return DEFAULT_EXIT_STEP_TYPES.has(fromType) ? 'DEFAULT' : 'DECISION';
}
