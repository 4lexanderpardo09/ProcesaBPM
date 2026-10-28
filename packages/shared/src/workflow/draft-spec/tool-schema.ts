import { CONDITION_OPERATORS } from '../../engine/conditions/types.js';
import { SLA_UNITS } from '../constants.js';
import { AMOUNT_RULE_ACTIONS } from '../constants.js';
import {
  DRAFT_ASSIGNMENT_MODES,
  DRAFT_COLUMN_TYPES,
  DRAFT_DECISION_TOPICS,
  DRAFT_FIELD_TYPES,
  DRAFT_FORMULA_RESULT_TYPES,
  DRAFT_INITIATOR_KINDS,
  DRAFT_SIGNATURE_DOCUMENTS,
  DRAFT_RECIPIENT_KINDS,
  DRAFT_SIGNER_KINDS,
  DRAFT_STEP_TYPES,
  type DraftCatalog,
} from './spec.js';

export type JsonSchema = Readonly<Record<string, unknown>>;

/** Above this many names the enum would bloat the prompt: the translator checks the name instead. */
export const MAX_CATALOG_ENUM = 300;

const string: JsonSchema = { type: 'string' };
const boolean: JsonSchema = { type: 'boolean' };
const integer: JsonSchema = { type: 'integer' };
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const enumOf = (values: readonly string[]): JsonSchema => ({ type: 'string', enum: [...values] });
const array = (items: JsonSchema): JsonSchema => ({ type: 'array', items });

/** Strict tool mode: every property required, nothing extra, optional values as `null`. */
function object(properties: Record<string, JsonSchema>, description?: string): JsonSchema {
  return { type: 'object', ...(description === undefined ? {} : { description }), properties, required: Object.keys(properties), additionalProperties: false };
}

function catalogName(names: readonly string[]): JsonSchema {
  if (names.length === 0 || names.length > MAX_CATALOG_ENUM) return string;
  return enumOf(names);
}

/**
 * The JSON Schema of the `submit_workflow_draft` tool, written by hand so it stays inside what strict tool
 * calling accepts (no length or item bounds: `workflowDraftSpecSchema` enforces those on the server). The
 * catalog names become enums, so the model can only pick names the organization has.
 */
export function buildDraftToolSchema(catalog: DraftCatalog): JsonSchema {
  const position = catalogName(catalog.positions.map((entry) => entry.name));
  const group = catalogName(catalog.groups.map((entry) => entry.name));
  const approvalType = catalogName(catalog.approvalTypes.map((entry) => entry.name));
  const duration = object({ value: integer, unit: enumOf(SLA_UNITS) });
  const options = nullable(array(string));

  const assignment = object(
    {
      mode: enumOf(DRAFT_ASSIGNMENT_MODES),
      position: nullable(position),
      group: nullable(group),
      approvalType: nullable(approvalType),
      approvalLevel: nullable(integer),
      poolPositions: array(position),
      poolGroups: array(group),
      sameAsStep: nullable(string),
      signers: array(object({ kind: enumOf(DRAFT_SIGNER_KINDS), position: nullable(position) })),
    },
    'Who handles a TASK or APPROVAL. null on automatic blocks.',
  );

  const step = object({
    ref: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
    type: enumOf(DRAFT_STEP_TYPES),
    name: string,
    instructions: nullable(string),
    assignment: nullable(assignment),
    sla: nullable(duration),
    maxLoops: nullable(integer),
    notification: nullable(object({ recipients: array(object({ kind: enumOf(DRAFT_RECIPIENT_KINDS), name: nullable(string) })), subject: string, body: string })),
    wait: nullable(duration),
    signatureDocument: nullable(enumOf(DRAFT_SIGNATURE_DOCUMENTS)),
  });

  const conditionValue: JsonSchema = { anyOf: [string, { type: 'number' }, boolean, array({ anyOf: [string, { type: 'number' }] })] };
  const transition = object({
    from: string,
    to: string,
    label: string,
    condition: nullable(array(object({ field: string, op: enumOf(CONDITION_OPERATORS), value: conditionValue }))),
    requiresComment: boolean,
    whenRejected: boolean,
  });

  const column = object({ code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' }, label: string, type: enumOf(DRAFT_COLUMN_TYPES), required: boolean, options, expression: nullable(string), showTotal: boolean });
  const field = object({
    step: string,
    code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' },
    label: string,
    type: enumOf(DRAFT_FIELD_TYPES),
    required: boolean,
    options,
    formula: nullable(object({ expression: string, resultType: enumOf(DRAFT_FORMULA_RESULT_TYPES) })),
    columns: nullable(array(column)),
  });

  const initiator = object({ kind: enumOf(DRAFT_INITIATOR_KINDS), name: catalogName([...catalog.positions, ...catalog.groups].map((entry) => entry.name)) });
  const amountRule = object({
    field: string,
    amountColumn: nullable(string),
    step: nullable(string),
    maxAmount: { type: 'number' },
    currency: nullable(string),
    action: enumOf(AMOUNT_RULE_ACTIONS),
    approvalStep: nullable(string),
    position: nullable(position),
    message: nullable(string),
  });

  const decision = object({ topic: enumOf(DRAFT_DECISION_TOPICS), text: string });

  return object({ assumptions: array(string), decisions: array(decision), steps: array(step), transitions: array(transition), fields: array(field), initiators: array(initiator), amountRules: array(amountRule) });
}
