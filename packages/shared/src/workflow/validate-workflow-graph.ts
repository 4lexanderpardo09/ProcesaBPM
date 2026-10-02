import { type WorkflowVersionDocument } from './document.js';
import { ProblemCollector, type WorkflowValidation } from './problems.js';
import { checkAssignmentModes } from './rules/parallel.js';
import { checkAmountRules } from './rules/amount-rules.js';
import { checkCalculators } from './rules/calculators.js';
import { checkConditions } from './rules/conditions.js';
import { buildContext } from './rules/context.js';
import { checkFields } from './rules/fields.js';
import { checkLoops } from './rules/loops.js';
import { checkSteps } from './rules/steps.js';
import { checkStructure } from './rules/structure.js';
import { checkTransitions } from './rules/transitions.js';

/**
 * Checks a workflow version and returns its problems: errors block publishing, warnings do not. Pure and
 * deterministic (same document, same list in the same order), so the frontend runs the very same check on an
 * unsaved canvas. The rules mirror the ones the database enforces (so the canvas can say so before saving)
 * and add the ones only the whole graph can know.
 */
export function validateWorkflowGraph(doc: WorkflowVersionDocument): WorkflowValidation {
  const problems = new ProblemCollector();
  const context = buildContext(doc, problems);
  checkStructure(context);
  checkTransitions(context);
  checkSteps(context);
  checkLoops(context);
  checkFields(context);
  checkCalculators(context);
  checkConditions(context);
  checkAmountRules(context);
  checkAssignmentModes(context);
  return problems.result();
}
