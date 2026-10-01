import { type WorkflowVersionDocument } from './document.js';

/**
 * A copy of the version with new ids: each step, field, transition, amount rule and child row gets the id
 * `newId()` returns, and every reference between them follows. Nothing else changes (configs and conditions
 * hold field codes only, never ids of this version).
 */
export function remapVersionDocument(doc: WorkflowVersionDocument, newId: () => string): WorkflowVersionDocument {
  const stepIds = new Map(doc.steps.map((step) => [step.id, newId()]));
  const ref = (id: string): string => stepIds.get(id) ?? id;
  return {
    steps: doc.steps.map((step) => ({
      ...step,
      id: ref(step.id),
      candidates: step.candidates.map((candidate) => ({ ...candidate, id: newId() })),
      initiators: step.initiators.map((initiator) => ({ ...initiator, id: newId() })),
      slaOverrides: step.slaOverrides.map((override) => ({ ...override })),
      signers: step.signers.map((signer) => ({ ...signer, id: newId() })),
      files: step.files.map((file) => ({ ...file })),
    })),
    transitions: doc.transitions.map((transition) => ({ ...transition, id: newId(), fromStepId: ref(transition.fromStepId), toStepId: ref(transition.toStepId) })),
    fields: doc.fields.map((field) => ({ ...field, id: newId(), stepId: ref(field.stepId) })),
    amountRules: doc.amountRules.map((rule) => ({
      ...rule,
      id: newId(),
      stepId: rule.stepId === null ? null : ref(rule.stepId),
      approvalStepId: rule.approvalStepId === null ? null : ref(rule.approvalStepId),
    })),
  };
}
