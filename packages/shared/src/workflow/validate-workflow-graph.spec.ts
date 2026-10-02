import { describe, expect, it } from 'vitest';
import type { WorkflowVersionDocument } from './document.js';
import { amountRule, field, minimalFlow, next, step, transition, version } from './test-builders.js';
import { validateWorkflowGraph } from './validate-workflow-graph.js';

const codes = (doc: WorkflowVersionDocument, severity: 'errors' | 'warnings' = 'errors') => validateWorkflowGraph(doc)[severity].map((problem) => problem.code);
const withParts = (parts: Partial<WorkflowVersionDocument>): WorkflowVersionDocument => ({ ...minimalFlow(), ...parts });

/** START -> CONDITION -> (A | default B) -> END, with a field on the START block. */
function branching(conditionOverrides: Partial<Parameters<typeof transition>[4]> = {}): WorkflowVersionDocument {
  return version({
    steps: [step('start', 'START'), step('cond', 'CONDITION'), step('a', 'TASK'), step('b', 'TASK'), step('end', 'END')],
    transitions: [
      next('start', 'cond'),
      transition('cond->a', 'cond', 'a', 'CONDITION', { condition: [{ field: 'AMOUNT', op: 'gt', value: 100 }], ...conditionOverrides }),
      transition('cond->b', 'cond', 'b', 'DEFAULT'),
      next('a', 'end', 'DECISION'),
      next('b', 'end', 'DECISION'),
    ],
    fields: [field('f1', 'start', 'AMOUNT', { type: 'NUMBER' })],
  });
}

describe('validateWorkflowGraph: a valid flow', () => {
  it('has no problems', () => {
    expect(validateWorkflowGraph(minimalFlow())).toEqual({ errors: [], warnings: [] });
    expect(validateWorkflowGraph(branching())).toEqual({ errors: [], warnings: [] });
  });

  it('is deterministic: the same document gives the same list', () => {
    const broken = withParts({ transitions: [] });
    expect(validateWorkflowGraph(broken)).toEqual(validateWorkflowGraph(broken));
  });
});

describe('validateWorkflowGraph: structure', () => {
  it('needs a START and an END', () => {
    expect(codes(version())).toEqual(expect.arrayContaining(['NO_START', 'NO_END']));
    expect(codes(version({ steps: [step('end', 'END')] }))).toContain('NO_START');
    expect(codes(version({ steps: [step('start', 'START')], transitions: [] }))).toContain('NO_END');
  });

  it('the END must be reachable from a START', () => {
    const doc = withParts({ transitions: [next('start', 'task')] });
    expect(codes(doc)).toEqual(expect.arrayContaining(['END_NOT_REACHABLE', 'DEAD_END_BLOCK']));
  });

  it('every block is reachable from a START', () => {
    const doc = withParts({ steps: [...minimalFlow().steps, step('lost', 'TASK')], transitions: [...minimalFlow().transitions, next('lost', 'end', 'DECISION')] });
    const problems = validateWorkflowGraph(doc).errors.filter((problem) => problem.code === 'BLOCK_UNREACHABLE');
    expect(problems.map((problem) => problem.stepId)).toEqual(['lost']);
  });

  it('every block can reach an END, and a block without exits is reported as a dead end', () => {
    const doc = version({
      steps: [step('start', 'START'), step('loop1', 'TASK'), step('loop2', 'TASK'), step('end', 'END'), step('stuck', 'TASK')],
      transitions: [next('start', 'loop1'), next('loop1', 'loop2', 'DECISION'), next('loop2', 'loop1', 'DECISION'), next('loop1', 'stuck', 'DECISION'), transition('s-end', 'start', 'end', 'SYSTEM_ONLY')],
    });
    const errors = validateWorkflowGraph(doc).errors;
    expect(errors.filter((problem) => problem.code === 'BLOCK_CANNOT_REACH_END').map((problem) => problem.stepId)).toEqual(['loop1', 'loop2']);
    expect(errors.filter((problem) => problem.code === 'DEAD_END_BLOCK').map((problem) => problem.stepId)).toEqual(['stuck']);
  });

  it('block names are unique per version, ignoring case and spaces', () => {
    const doc = withParts({ steps: [step('start', 'START'), step('task', 'TASK', { name: 'Review' }), step('end', 'END', { name: ' review ' })] });
    expect(codes(doc)).toContain('STEP_NAME_DUPLICATE');
  });
});

describe('validateWorkflowGraph: transitions and exits', () => {
  it('mirrors the database rules for transitions', () => {
    const base = minimalFlow();
    expect(codes({ ...base, transitions: [...base.transitions, transition('x', 'end', 'task', 'DECISION')] })).toContain('TRANSITION_FROM_END');
    expect(codes({ ...base, transitions: [...base.transitions, transition('x', 'task', 'start', 'DECISION')] })).toContain('TRANSITION_TO_START');
    expect(codes({ ...base, transitions: [...base.transitions, transition('x', 'task', 'end', 'DEFAULT')] })).toContain('TRANSITION_TYPE_NOT_ALLOWED');
    expect(codes({ ...base, transitions: [...base.transitions, transition('x', 'start', 'end', 'DECISION')] })).toContain('TRANSITION_TYPE_NOT_ALLOWED');
    expect(codes({ ...base, transitions: [...base.transitions, transition('x', 'task', 'ghost', 'DECISION')] })).toContain('TRANSITION_UNKNOWN_BLOCK');
    expect(codes({ ...base, transitions: [...base.transitions, transition('x', 'start', 'end', 'DEFAULT')] })).toContain('TRANSITION_DUPLICATE_DEFAULT');
    expect(codes({ ...base, transitions: [...base.transitions, transition('x', 'task', 'end', 'DECISION', { label: 'TASK->END' })] })).toContain('TRANSITION_LABEL_DUPLICATE');
  });

  it('a CONDITION transition needs its rule, and no other type carries one', () => {
    expect(codes(branching({ condition: null }))).toContain('CONDITION_RULE_MISSING');
    const base = minimalFlow();
    const withRule = { ...base, transitions: [transition('s', 'start', 'task', 'DEFAULT', { condition: [{ field: 'X', op: 'equals', value: 'a' }] }), base.transitions[1]!] };
    expect(codes(withRule)).toContain('CONDITION_RULE_MISSING');
  });

  it('automatic blocks leave through a DEFAULT, people blocks through a DECISION', () => {
    const noDefault = withParts({ transitions: [transition('s', 'start', 'task', 'SYSTEM_ONLY'), minimalFlow().transitions[1]!] });
    expect(codes(noDefault)).toContain('AUTOMATIC_BLOCK_WITHOUT_DEFAULT');
    const noDecision = withParts({ transitions: [minimalFlow().transitions[0]!, transition('t', 'task', 'end', 'SYSTEM_ONLY')] });
    expect(codes(noDecision)).toContain('PEOPLE_BLOCK_WITHOUT_DECISION');
  });

  it('every CONDITION block has a DEFAULT branch', () => {
    const doc = branching();
    const withoutDefault = { ...doc, transitions: doc.transitions.filter((entry) => entry.id !== 'cond->b') };
    expect(codes(withoutDefault)).toContain('CONDITION_WITHOUT_DEFAULT');
  });

  it('a CONDITION block with only the default is a warning', () => {
    const doc = branching();
    const onlyDefault = { ...doc, transitions: doc.transitions.filter((entry) => entry.id !== 'cond->a') };
    expect(codes(onlyDefault, 'warnings')).toContain('CONDITION_WITHOUT_BRANCHES');
  });

  it('a DECISION block with a single exit is a warning', () => {
    const doc = withParts({ steps: [step('start', 'START'), step('d', 'DECISION'), step('end', 'END')], transitions: [next('start', 'd'), next('d', 'end', 'DECISION')] });
    expect(codes(doc, 'warnings')).toContain('DECISION_BLOCK_SINGLE_EXIT');
    expect(codes(doc)).toEqual([]);
  });
});

describe('validateWorkflowGraph: people blocks', () => {
  const withTask = (overrides: Parameters<typeof step>[2]) => withParts({ steps: [step('start', 'START'), step('task', 'TASK', overrides), step('end', 'END')] });
  const candidate = (type: 'USER' | 'GROUP' | 'POSITION') => ({ id: 'c', participantType: type, userId: type === 'USER' ? 'u' : null, positionId: type === 'POSITION' ? 'p' : null, groupId: type === 'GROUP' ? 'g' : null });

  it.each([
    ['an automatic block with a mode', { type: 'END' as const, overrides: { assignmentMode: 'CREATOR' as const } }],
  ])('assignment mode must agree with the block type: %s', (_label, { overrides }) => {
    const doc = withParts({ steps: [step('start', 'START'), step('task', 'TASK'), step('end', 'END', overrides)] });
    expect(codes(doc)).toContain('ASSIGNMENT_MODE_INVALID');
    expect(codes(withTask({ assignmentMode: 'NONE' }))).toContain('ASSIGNMENT_MODE_INVALID');
  });

  it('automatic blocks have no SLA, manual close, manual selection or assignees', () => {
    const base = (overrides: Parameters<typeof step>[2]) => withParts({ steps: [step('start', 'START', overrides), step('task', 'TASK'), step('end', 'END')] });
    expect(codes(base({ slaValue: 4, slaUnit: 'BUSINESS_HOURS' }))).toContain('AUTOMATIC_BLOCK_WITH_SLA');
    expect(codes(base({ closeRule: 'ALLOWED' }))).toContain('AUTOMATIC_BLOCK_WITH_SLA');
    expect(codes(base({ candidates: [candidate('USER')] }))).toContain('CHILDREN_ON_AUTOMATIC_BLOCK');
  });

  it('initiators belong to START blocks', () => {
    const initiator = { id: 'i', participantType: 'COMPANY' as const, userId: null, positionId: null, groupId: null, departmentId: null, companyId: 'c', siteId: null };
    expect(codes(withTask({ initiators: [initiator] }))).toContain('INITIATORS_ON_NON_START');
    const onStart = withParts({ steps: [step('start', 'START', { initiators: [initiator] }), step('task', 'TASK'), step('end', 'END')] });
    expect(codes(onStart)).toEqual([]);
  });

  it('APPROVER needs the group type and a level of 1 or more; POSITION needs the position', () => {
    expect(codes(withTask({ assignmentMode: 'APPROVER' }))).toContain('APPROVER_CONFIG_MISSING');
    expect(codes(withTask({ assignmentMode: 'APPROVER', approvalGroupTypeId: 't', approvalLevel: 0 }))).toContain('APPROVER_CONFIG_MISSING');
    expect(codes(withTask({ assignmentMode: 'APPROVER', approvalGroupTypeId: 't', approvalLevel: 1 }))).toEqual([]);
    expect(codes(withTask({ assignmentMode: 'POSITION' }))).toContain('POSITION_MISSING');
    expect(codes(withTask({ assignmentMode: 'POSITION', positionId: 'p' }))).toEqual([]);
  });

  it('USERS, GROUP, POOL and RANDOM_DISPATCH need people to choose from', () => {
    expect(codes(withTask({ assignmentMode: 'USERS' }))).toContain('ASSIGNMENT_MISSING_CANDIDATES');
    expect(codes(withTask({ assignmentMode: 'USERS', candidates: [candidate('GROUP')] }))).toContain('ASSIGNMENT_MISSING_CANDIDATES');
    expect(codes(withTask({ assignmentMode: 'USERS', candidates: [candidate('USER')] }))).toEqual([]);
    expect(codes(withTask({ assignmentMode: 'GROUP' }))).toContain('ASSIGNMENT_MISSING_CANDIDATES');
    expect(codes(withTask({ assignmentMode: 'GROUP', candidates: [candidate('GROUP')] }))).toEqual([]);
    expect(codes(withTask({ assignmentMode: 'POOL' }))).toContain('ASSIGNMENT_MISSING_CANDIDATES');
    expect(codes(withTask({ assignmentMode: 'POOL', positionId: 'p' }))).toEqual([]);
    expect(codes(withTask({ assignmentMode: 'RANDOM_DISPATCH', candidates: [candidate('POSITION')] }))).toContain('RANDOM_DISPATCH_WITHOUT_INTERVAL');
    expect(codes(withTask({ assignmentMode: 'RANDOM_DISPATCH', candidates: [candidate('POSITION')], dispatchIntervalMin: 15 }))).toEqual([]);
  });

  it('PARALLEL and SIGNATURE blocks need signers', () => {
    expect(codes(withTask({ assignmentMode: 'PARALLEL' }))).toContain('PARALLEL_WITHOUT_SIGNERS');
    const signature = withParts({ steps: [step('start', 'START'), step('sign', 'SIGNATURE', { signers: [] }), step('end', 'END')], transitions: [next('start', 'sign'), next('sign', 'end', 'DECISION')] });
    expect(codes(signature)).toContain('SIGNATURE_WITHOUT_SIGNERS');
  });

  it('manual selection that cannot apply is a warning', () => {
    expect(codes(withTask({ assignmentMode: 'CREATOR', manualSelection: true }), 'warnings')).toContain('MANUAL_SELECTION_NOT_APPLICABLE');
  });

  it('a CUTOFF deadline needs a date field of the version and its business days', () => {
    expect(codes(withTask({ deadlineType: 'CUTOFF' }))).toContain('CUTOFF_CONFIG_MISSING');
    expect(codes(withTask({ deadlineType: 'CUTOFF', deadlineFieldCode: 'NOPE', deadlineBusinessDays: 2 }))).toContain('DEADLINE_FIELD_UNKNOWN');
    const doc = (type: 'DATE' | 'TEXT') => ({ ...withTask({ deadlineType: 'CUTOFF', deadlineFieldCode: 'DUE', deadlineBusinessDays: 2 }), fields: [field('f', 'start', 'DUE', { type })] });
    expect(codes(doc('TEXT'))).toContain('DEADLINE_FIELD_NOT_DATE');
    expect(codes(doc('DATE'))).toEqual([]);
    const automatic = withParts({ steps: [step('start', 'START', { deadlineType: 'CUTOFF' }), step('task', 'TASK'), step('end', 'END')] });
    expect(codes(automatic)).toContain('CUTOFF_ON_AUTOMATIC_BLOCK');
  });
});

describe('validateWorkflowGraph: loops', () => {
  const loop = (overrides: Parameters<typeof step>[2] = {}) =>
    version({
      steps: [step('start', 'START'), step('review', 'TASK', overrides), step('end', 'END')],
      transitions: [next('start', 'review'), transition('back', 'review', 'review', 'DECISION'), next('review', 'end', 'DECISION')],
    });

  it('a loop without max_loops is a warning, not an error', () => {
    const result = validateWorkflowGraph(loop());
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((problem) => problem.code)).toEqual(['LOOP_WITHOUT_LIMIT']);
    expect(result.warnings[0]!.params).toEqual({ stepIds: ['review'] });
  });

  it('max_loops on any block of the loop silences it', () => {
    expect(validateWorkflowGraph(loop({ maxLoops: 3 }))).toEqual({ errors: [], warnings: [] });
  });

  it('a loop made only of automatic blocks is an error', () => {
    const doc = version({
      steps: [step('start', 'START'), step('wait', 'WAIT', { config: { mode: 'COMPANY_CUTOFF' } }), step('cond', 'CONDITION'), step('end', 'END')],
      transitions: [next('start', 'wait'), next('wait', 'cond'), transition('c', 'cond', 'wait', 'CONDITION', { condition: [{ field: 'X', op: 'equals', value: 'a' }] }), next('cond', 'end')].map((entry) => (entry.id === 'cond->end' ? { ...entry, type: 'DEFAULT' as const } : entry)),
      fields: [field('f', 'start', 'X')],
    });
    expect(codes(doc)).toContain('AUTOMATIC_LOOP');
  });
});

describe('validateWorkflowGraph: regressions from the review', () => {
  it('an automatic cycle inside a loop that also has people is still an error', () => {
    const doc = version({
      steps: [step('start', 'START'), step('cond', 'CONDITION'), step('notify', 'NOTIFICATION', { config: { recipients: [{ kind: 'CREATOR' }], channels: ['EMAIL'], subject: 's', body: 'b' } }), step('task', 'TASK'), step('end', 'END')],
      transitions: [
        next('start', 'cond'),
        transition('c-n', 'cond', 'notify', 'DEFAULT'),
        next('notify', 'cond'),
        transition('c-t', 'cond', 'task', 'CONDITION', { condition: [{ field: 'X', op: 'equals', value: 'a' }] }),
        next('task', 'cond', 'DECISION'),
        transition('t-end', 'task', 'end', 'DECISION', { label: 'done' }),
      ],
      fields: [field('f', 'start', 'X')],
    });
    const loop = validateWorkflowGraph(doc).errors.filter((problem) => problem.code === 'AUTOMATIC_LOOP');
    expect(loop).toHaveLength(1);
    expect(loop[0]!.params).toEqual({ stepIds: expect.arrayContaining(['cond', 'notify']) });
  });

  it('formula cycle detection is linear: many formulas that all reference each other validate quickly', () => {
    const codes = Array.from({ length: 60 }, (_, index) => `F${String(index).padStart(2, '0')}`);
    const fields = codes.map((code, index) => field(code, 'start', code, { type: 'FORMULA', config: { expression: codes.slice(index + 1).join(' + ') || '1', resultType: 'NUMBER' } }));
    const startedAt = Date.now();
    expect(validateWorkflowGraph({ ...minimalFlow(), fields }).errors).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('formula references that form a cycle through several fields are reported once per field in it', () => {
    const formula = (code: string, expression: string) => field(code, 'start', code, { type: 'FORMULA', config: { expression, resultType: 'NUMBER' } });
    const problems = validateWorkflowGraph({ ...minimalFlow(), fields: [formula('A', 'B'), formula('B', 'C'), formula('C', 'A'), formula('D', 'A')] }).errors.filter((problem) => problem.code === 'FORMULA_CYCLE');
    expect(problems.map((problem) => problem.params)).toEqual(expect.arrayContaining([{ code: 'A' }, { code: 'B' }, { code: 'C' }]));
    expect(problems).toHaveLength(3);
  });
});

describe('validateWorkflowGraph: fields', () => {
  it('codes are unique and upper snake case', () => {
    const doc = withParts({ fields: [field('1', 'start', 'A'), field('2', 'task', 'A'), field('3', 'task', 'bad code')] });
    expect(codes(doc)).toEqual(expect.arrayContaining(['FIELD_CODE_DUPLICATE', 'FIELD_CODE_INVALID']));
  });

  it('fields live in START or people blocks, and CREATION capture only on START', () => {
    const doc = withParts({ steps: [step('start', 'START'), step('wait', 'WAIT', { config: { mode: 'COMPANY_CUTOFF' } }), step('task', 'TASK'), step('end', 'END')], transitions: [next('start', 'wait'), next('wait', 'task'), next('task', 'end', 'DECISION')], fields: [field('1', 'wait', 'A'), field('2', 'task', 'B', { capture: 'CREATION' }), field('3', 'ghost', 'C')] });
    expect(codes(doc)).toEqual(expect.arrayContaining(['FIELD_ON_AUTOMATIC_BLOCK', 'FIELD_CREATION_CAPTURE_NOT_ON_START', 'FIELD_UNKNOWN_STEP']));
  });

  it('validates config and data source per field type', () => {
    expect(codes(withParts({ fields: [field('1', 'start', 'A', { type: 'SELECT' })] }))).toContain('FIELD_CONFIG_INVALID');
    expect(codes(withParts({ fields: [field('1', 'start', 'A', { type: 'SELECT', config: { options: [{ value: 'a', label: 'A' }] } })] }))).toEqual([]);
    expect(codes(withParts({ fields: [field('1', 'start', 'A', { type: 'SELECT', dataSource: { kind: 'PRESET', preset: 'COMPANIES' } })] }))).toEqual([]);
    expect(codes(withParts({ fields: [field('1', 'start', 'A', { type: 'NUMBER', dataSource: { kind: 'PRESET', preset: 'COMPANIES' } })] }))).toContain('FIELD_DATA_SOURCE_INVALID');
    expect(codes(withParts({ fields: [field('1', 'start', 'A', { type: 'TEXT', config: { regex: '(a+)+$' } })] }))).toContain('FIELD_CONFIG_INVALID');
  });

  it('formulas reference existing fields and no cycles', () => {
    const formula = (id: string, code: string, expression: string) => field(id, 'start', code, { type: 'FORMULA', config: { expression, resultType: 'NUMBER' } });
    expect(codes(withParts({ fields: [formula('1', 'TOTAL', 'PRICE * 2')] }))).toContain('FORMULA_UNKNOWN_FIELD');
    expect(codes(withParts({ fields: [field('p', 'start', 'PRICE', { type: 'NUMBER' }), formula('1', 'TOTAL', 'ROUND(PRICE) * 2')] }))).toEqual([]);
    expect(codes(withParts({ fields: [formula('1', 'A', 'B + 1'), formula('2', 'B', 'A + 1')] }))).toContain('FORMULA_CYCLE');
    expect(codes(withParts({ fields: [formula('1', 'A', 'A + 1')] }))).toContain('FORMULA_CYCLE');
    expect(codes(withParts({ fields: [formula('1', 'A', '1 +')] }))).toContain('FORMULA_INVALID');
    expect(codes(withParts({ fields: [formula('1', 'A', '"text"')] }))).toContain('FORMULA_RESULT_TYPE_MISMATCH');
  });
});

describe('validateWorkflowGraph: conditions read earlier fields', () => {
  it('an unknown field code is an error', () => {
    expect(codes(branching({ condition: [{ field: 'NOPE', op: 'equals', value: 'x' }] }))).toContain('CONDITION_UNKNOWN_FIELD');
  });

  it('a field of a block that is not before the condition is an error', () => {
    const doc = branching();
    const later = { ...doc, fields: [field('f1', 'a', 'AMOUNT', { type: 'NUMBER' })] };
    expect(codes(later)).toContain('CONDITION_FIELD_NOT_EARLIER');
  });

  it('a field captured on only some paths is a warning', () => {
    const doc = version({
      steps: [step('start', 'START'), step('opt', 'TASK'), step('cond', 'CONDITION'), step('a', 'TASK'), step('end', 'END')],
      transitions: [
        next('start', 'opt'),
        next('opt', 'cond', 'DECISION'),
        transition('skip', 'opt', 'end', 'DECISION'),
        transition('c1', 'cond', 'a', 'CONDITION', { condition: [{ field: 'EXTRA', op: 'gt', value: 1 }] }),
        transition('c2', 'cond', 'end', 'DEFAULT'),
        next('a', 'end', 'DECISION'),
      ],
      fields: [field('f', 'opt', 'EXTRA', { type: 'NUMBER' })],
    });
    // `opt` is on every path to `cond`, so this one is fine; take the field from `a` (only on one branch) instead.
    expect(codes(doc)).toEqual([]);
    const maybe = { ...doc, fields: [field('f', 'a', 'EXTRA', { type: 'NUMBER' })], transitions: [...doc.transitions, transition('loopback', 'a', 'cond', 'SYSTEM_ONLY')] };
    expect(codes(maybe, 'warnings')).toContain('CONDITION_FIELD_MAYBE_UNSET');
    expect(codes(maybe)).not.toContain('CONDITION_FIELD_NOT_EARLIER');
  });

  it('a malformed condition and an operator that does not fit the field type are errors', () => {
    expect(codes(branching({ condition: [{ field: 'AMOUNT', op: 'gt', value: 'many' } as never] }))).toContain('CONDITION_INVALID');
    expect(codes(branching({ condition: [{ field: 'AMOUNT', op: 'starts_with', value: 'a' }, { field: 'AMOUNT', op: 'date_before', value: '2026-01-01' }] }))).toContain('CONDITION_OPERATOR_TYPE_MISMATCH');
    const text = { ...branching(), fields: [field('f1', 'start', 'AMOUNT', { type: 'TEXT' })] };
    expect(codes({ ...text, transitions: text.transitions.map((entry) => (entry.id === 'cond->a' ? { ...entry, condition: [{ field: 'AMOUNT', op: 'gt' as const, value: 1 }] } : entry)) })).toContain('CONDITION_OPERATOR_TYPE_MISMATCH');
  });
});

describe('validateWorkflowGraph: amount rules', () => {
  const approvalFlow = (rule: ReturnType<typeof amountRule>, extra: Partial<WorkflowVersionDocument> = {}) =>
    version({
      steps: [step('start', 'START'), step('task', 'TASK'), step('extra', 'APPROVAL', { assignmentMode: 'APPROVER', approvalGroupTypeId: 't', approvalLevel: 1 }), step('end', 'END')],
      transitions: [next('start', 'task'), next('task', 'end', 'DECISION'), transition('sys', 'task', 'extra', 'SYSTEM_ONLY'), next('extra', 'end', 'DECISION')],
      fields: [field('f', 'start', 'AMOUNT', { type: 'CURRENCY' })],
      amountRules: [rule],
      ...extra,
    });

  it('a rule on an existing numeric field with its extra approval step is valid', () => {
    expect(validateWorkflowGraph(approvalFlow(amountRule('r', 'AMOUNT', { action: 'EXTRA_APPROVAL', approvalStepId: 'extra' })))).toEqual({ errors: [], warnings: [] });
  });

  it('the field must exist and be numeric', () => {
    expect(codes(approvalFlow(amountRule('r', 'NOPE')))).toContain('AMOUNT_RULE_UNKNOWN_FIELD');
    expect(codes(approvalFlow(amountRule('r', 'AMOUNT'), { fields: [field('f', 'start', 'AMOUNT', { type: 'TEXT' })] }))).toContain('AMOUNT_RULE_FIELD_NOT_NUMERIC');
  });

  it('a TABLE field needs its amount column (and the type column, when given) to exist', () => {
    const table = field('f', 'start', 'LINES', { type: 'TABLE', config: { columns: [{ code: 'PRICE', label: 'Price', type: 'NUMBER' }, { code: 'KIND', label: 'Kind', type: 'TEXT' }] } });
    expect(codes(approvalFlow(amountRule('r', 'LINES', { amountColumn: 'PRICE', typeColumn: 'KIND' }), { fields: [table] }))).toEqual([]);
    expect(codes(approvalFlow(amountRule('r', 'LINES'), { fields: [table] }))).toContain('AMOUNT_RULE_TABLE_COLUMN_UNKNOWN');
    expect(codes(approvalFlow(amountRule('r', 'LINES', { amountColumn: 'PRICE', typeColumn: 'GHOST' }), { fields: [table] }))).toContain('AMOUNT_RULE_TABLE_COLUMN_UNKNOWN');
  });

  it('the block of the rule and the extra approval block must exist in the version', () => {
    expect(codes(approvalFlow(amountRule('r', 'AMOUNT', { stepId: 'ghost' })))).toContain('AMOUNT_RULE_STEP_NOT_IN_VERSION');
    expect(codes(approvalFlow(amountRule('r', 'AMOUNT', { action: 'EXTRA_APPROVAL' })))).toContain('AMOUNT_RULE_APPROVAL_STEP_MISSING');
    expect(codes(approvalFlow(amountRule('r', 'AMOUNT', { action: 'EXTRA_APPROVAL', approvalStepId: 'ghost' })))).toContain('AMOUNT_RULE_APPROVAL_STEP_MISSING');
    expect(codes(approvalFlow(amountRule('r', 'AMOUNT', { action: 'EXTRA_APPROVAL', approvalStepId: 'start' })))).toContain('AMOUNT_RULE_APPROVAL_STEP_NOT_PEOPLE');
  });

  it('an extra approval block that no SYSTEM_ONLY transition reaches is a warning', () => {
    const flow = approvalFlow(amountRule('r', 'AMOUNT', { action: 'EXTRA_APPROVAL', approvalStepId: 'extra' }));
    const unwired = { ...flow, transitions: flow.transitions.map((entry) => (entry.id === 'sys' ? { ...entry, type: 'DECISION' as const } : entry)) };
    expect(codes(unwired, 'warnings')).toContain('AMOUNT_RULE_APPROVAL_STEP_NOT_WIRED');
  });

  it('inactive rules are not checked', () => {
    expect(codes(approvalFlow(amountRule('r', 'NOPE', { isActive: false })))).toEqual([]);
  });
});

describe('validateWorkflowGraph: block config', () => {
  const doc = (type: 'NOTIFICATION' | 'WEBHOOK' | 'CALCULATOR' | 'WAIT', config: Record<string, unknown>) =>
    version({
      steps: [step('start', 'START'), step('auto', type, { config }), step('end', 'END')],
      transitions: [next('start', 'auto'), next('auto', 'end')],
      fields: [field('f', 'start', 'NAME'), field('g', 'start', 'TOTAL', { type: 'NUMBER' })],
    });

  it('every block type validates its own config', () => {
    expect(codes(doc('NOTIFICATION', {}))).toContain('BLOCK_CONFIG_INVALID');
    expect(codes(doc('NOTIFICATION', { recipients: [{ kind: 'CREATOR' }], channels: ['EMAIL'], subject: 'Hello {{NAME}}', body: 'Total {{TOTAL}}' }))).toEqual([]);
    expect(codes(doc('WEBHOOK', { webhookId: 'not-a-uuid' }))).toContain('BLOCK_CONFIG_INVALID');
    expect(codes(doc('WAIT', { mode: 'DURATION', value: 0, unit: 'BUSINESS_DAYS' }))).toContain('BLOCK_CONFIG_INVALID');
    expect(codes(doc('WAIT', { mode: 'DURATION', value: 2, unit: 'BUSINESS_DAYS' }))).toEqual([]);
    expect(codes(withParts({ steps: [step('start', 'START', { config: { surprise: true } }), step('task', 'TASK'), step('end', 'END')] }))).toContain('BLOCK_CONFIG_INVALID');
  });

  it('templates naming unknown fields are warnings', () => {
    const result = doc('NOTIFICATION', { recipients: [{ kind: 'CREATOR' }], channels: ['EMAIL'], subject: 'Hi {{GHOST}}', body: 'x' });
    expect(codes(result)).toEqual([]);
    expect(validateWorkflowGraph(result).warnings[0]).toMatchObject({ code: 'TEMPLATE_UNKNOWN_FIELD', params: { codes: ['GHOST'] } });
  });

  it('calculator and wait blocks name fields of the version', () => {
    expect(codes(doc('CALCULATOR', { calculatorCode: 'MEAL_ALLOWANCE', inputs: { departure: 'NOPE', return: 'NOPE' }, outputFieldCode: 'TOTAL' }))).toContain('CALCULATOR_UNKNOWN_FIELD');
    expect(codes(doc('WAIT', { mode: 'UNTIL_FIELD_DATE', fieldCode: 'NOPE', offsetBusinessDays: 1 }))).toContain('WAIT_UNKNOWN_FIELD');
    expect(codes(doc('WAIT', { mode: 'UNTIL_FIELD_DATE', fieldCode: 'TOTAL', offsetBusinessDays: 1 }))).toContain('WAIT_FIELD_NOT_DATE');
  });

  describe('calculators', () => {
    const calculatorFlow = (config: Record<string, unknown>, outputOverrides: Record<string, unknown> = {}) =>
      version({
        steps: [step('start', 'START'), step('calc', 'CALCULATOR', { config }), step('end', 'END')],
        transitions: [next('start', 'calc'), next('calc', 'end')],
        fields: [
          field('a', 'start', 'LEAVES', { type: 'DATETIME' }),
          field('b', 'start', 'BACK', { type: 'DATETIME' }),
          field('c', 'start', 'NOTE', { type: 'TEXT' }),
          field('d', 'start', 'ALLOWANCE', { type: 'CURRENCY', isReadOnly: true, ...outputOverrides }),
        ],
      });
    const valid = { calculatorCode: 'MEAL_ALLOWANCE', inputs: { departure: 'LEAVES', return: 'BACK' }, outputFieldCode: 'ALLOWANCE' };

    it('accepts a wired calculator block', () => expect(codes(calculatorFlow(valid))).toEqual([]));
    it('refuses an unknown calculator', () => expect(codes(calculatorFlow({ ...valid, calculatorCode: 'TAX' }))).toContain('CALCULATOR_UNKNOWN'));
    it('refuses unknown and missing inputs', () => {
      expect(codes(calculatorFlow({ ...valid, inputs: { departure: 'LEAVES', return: 'BACK', extra: 'BACK' } }))).toContain('CALCULATOR_INPUT_UNKNOWN');
      expect(codes(calculatorFlow({ ...valid, inputs: { departure: 'LEAVES' } }))).toContain('CALCULATOR_INPUT_MISSING');
    });
    it('refuses an input of another type', () => expect(codes(calculatorFlow({ ...valid, inputs: { departure: 'NOTE', return: 'BACK' } }))).toContain('CALCULATOR_INPUT_TYPE_MISMATCH'));
    it('needs a read-only numeric output', () => {
      expect(codes(calculatorFlow(valid, { isReadOnly: false }))).toContain('CALCULATOR_OUTPUT_NOT_READ_ONLY');
      expect(codes(calculatorFlow({ ...valid, outputFieldCode: 'NOTE' }))).toContain('CALCULATOR_OUTPUT_TYPE_MISMATCH');
    });
    it('checks CALCULATOR fields the same way and finds cycles through them', () => {
      const calculatorField = (inputs: Record<string, string>) => field('x', 'start', 'ALLOWANCE', { type: 'CALCULATOR', config: { calculatorCode: 'MEAL_ALLOWANCE', inputs } });
      const dates = [field('a', 'start', 'LEAVES', { type: 'DATETIME' }), field('b', 'start', 'BACK', { type: 'DATETIME' })];
      expect(codes(withParts({ fields: [...dates, calculatorField({ departure: 'LEAVES', return: 'BACK' })] }))).toEqual([]);
      expect(codes(withParts({ fields: [...dates, calculatorField({ departure: 'LEAVES' })] }))).toContain('CALCULATOR_INPUT_MISSING');
      const loop = field('y', 'start', 'LOOP', { type: 'FORMULA', config: { expression: 'ALLOWANCE + 1', resultType: 'NUMBER' } });
      expect(codes(withParts({ fields: [...dates, calculatorField({ departure: 'LEAVES', return: 'LOOP' }), loop] }))).toContain('FORMULA_CYCLE');
    });
  });

  it('batch settings need allowsBatch', () => {
    const task = (allowsBatch: boolean) => withParts({ steps: [step('start', 'START'), step('task', 'TASK', { allowsBatch, config: { batch: { maxTickets: 10 } } }), step('end', 'END')] });
    expect(codes(task(false))).toContain('BATCH_CONFIG_WITHOUT_ALLOWS_BATCH');
    expect(codes(task(true))).toEqual([]);
  });
});

describe('validateWorkflowGraph: close_rule REQUIRED', () => {
  /** START -> work -> (finish: END | escalate: a step that can only close). */
  const required = (exits: ReturnType<typeof next>[] = []) =>
    version({
      steps: [step('start', 'START'), step('work', 'TASK'), step('closer', 'TASK', { closeRule: 'REQUIRED' }), step('end', 'END')],
      transitions: [next('start', 'work'), transition('finish', 'work', 'end', 'DECISION'), transition('escalate', 'work', 'closer', 'DECISION'), ...exits],
    });

  it('a step that can only close needs no exits and counts as an end', () => {
    expect(validateWorkflowGraph(required())).toEqual({ errors: [], warnings: [] });
  });

  it('refuses a REQUIRED step that also has a DECISION or SYSTEM_ONLY exit', () => {
    expect(codes(required([next('closer', 'end', 'DECISION')]))).toContain('CLOSE_REQUIRED_WITH_EXITS');
    expect(codes(required([transition('sys', 'closer', 'end', 'SYSTEM_ONLY')]))).toContain('CLOSE_REQUIRED_WITH_EXITS');
  });

  it('a flow that only ends by closing still needs an END block', () => {
    const doc = version({ steps: [step('start', 'START'), step('closer', 'TASK', { closeRule: 'REQUIRED' })], transitions: [next('start', 'closer')] });
    expect(codes(doc)).toContain('NO_END');
  });
});

describe('validateWorkflowGraph: PARALLEL and RANDOM_DISPATCH steps', () => {
  const signer = (signerType: 'USER' | 'APPROVER' | 'CREATOR' | 'STEP_ASSIGNEE', id = signerType) => ({ id, signerType, userId: null, positionId: null, label: null, sortOrder: 0 });
  const parallel = (overrides: Partial<ReturnType<typeof step>> = {}, parts: Partial<WorkflowVersionDocument> = {}) =>
    version({
      steps: [step('start', 'START'), step('sign', 'TASK', { assignmentMode: 'PARALLEL', signers: [signer('CREATOR')], ...overrides }), step('end', 'END')],
      transitions: [next('start', 'sign'), next('sign', 'end', 'DECISION')],
      ...parts,
    });

  it('a well-formed parallel step has no problems', () => expect(validateWorkflowGraph(parallel())).toEqual({ errors: [], warnings: [] }));

  it('needs exactly one DECISION exit and at most one SYSTEM_ONLY exit', () => {
    const extra = [next('start', 'sign'), next('sign', 'end', 'DECISION')];
    expect(codes(parallel({}, { transitions: [next('start', 'sign'), transition('a', 'sign', 'end', 'DECISION'), transition('b', 'sign', 'end', 'DECISION')] }))).toContain('PARALLEL_DECISION_EXIT_COUNT');
    expect(codes(parallel({}, { transitions: [...extra, transition('r1', 'sign', 'end', 'SYSTEM_ONLY'), transition('r2', 'sign', 'end', 'SYSTEM_ONLY')] }))).toContain('PARALLEL_REJECTION_EXIT_COUNT');
    expect(codes(parallel({}, { transitions: [...extra, transition('r1', 'sign', 'end', 'SYSTEM_ONLY')] }))).not.toContain('PARALLEL_REJECTION_EXIT_COUNT');
  });

  it('signers capture no fields and no amount rule applies to the step', () => {
    expect(codes(parallel({}, { fields: [field('f', 'sign', 'NOTE', { capture: 'STEP' })] }))).toContain('PARALLEL_STEP_WITH_FIELDS');
    expect(codes(parallel({}, { fields: [field('n', 'start', 'AMOUNT', { type: 'NUMBER' })], amountRules: [amountRule('r', 'AMOUNT', { stepId: 'sign' })] }))).toContain('AMOUNT_RULE_ON_PARALLEL_STEP');
  });

  it('cannot be closed by hand', () => expect(codes(parallel({ closeRule: 'ALLOWED' }))).toContain('PARALLEL_STEP_CLOSE_RULE'));

  it('signer types: STEP_ASSIGNEE is refused and APPROVER needs the group type and level', () => {
    expect(codes(parallel({ signers: [signer('STEP_ASSIGNEE')] }))).toContain('PARALLEL_SIGNER_TYPE_NOT_ALLOWED');
    expect(codes(parallel({ signers: [signer('APPROVER')] }))).toContain('PARALLEL_APPROVER_CONFIG_MISSING');
    expect(codes(parallel({ signers: [signer('APPROVER')], approvalGroupTypeId: 'type', approvalLevel: 1 }))).not.toContain('PARALLEL_APPROVER_CONFIG_MISSING');
  });

  it('warns about a RANDOM_DISPATCH interval longer than a day', () => {
    const dispatch = (minutes: number) => withParts({ steps: [step('start', 'START'), step('task', 'TASK', { assignmentMode: 'RANDOM_DISPATCH', dispatchIntervalMin: minutes, positionId: 'p' }), step('end', 'END')] });
    expect(codes(dispatch(1500), 'warnings')).toContain('RANDOM_DISPATCH_INTERVAL_TOO_LONG');
    expect(codes(dispatch(60), 'warnings')).not.toContain('RANDOM_DISPATCH_INTERVAL_TOO_LONG');
  });
});
