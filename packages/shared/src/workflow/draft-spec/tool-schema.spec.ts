import { describe, expect, it } from 'vitest';
import { buildDraftToolSchema, type JsonSchema, MAX_CATALOG_ENUM } from './tool-schema.js';
import { DRAFT_DECISION_TOPICS } from './spec.js';
import { catalog, travelAdvanceSpec } from './test-fixtures.js';

const FORBIDDEN = ['minLength', 'maxLength', 'minItems', 'maxItems'];

/** Every schema node in the tree, so the strict-mode rules can be checked on all of them. */
function nodes(schema: unknown): Array<Record<string, unknown>> {
  if (schema === null || typeof schema !== 'object') return [];
  const node = schema as Record<string, unknown>;
  const children = [
    ...Object.values((node.properties as Record<string, unknown> | undefined) ?? {}),
    ...(node.items === undefined ? [] : [node.items]),
    ...((node.anyOf as unknown[] | undefined) ?? []),
  ];
  return [node, ...children.flatMap(nodes)];
}

const propertyAt = (schema: JsonSchema, path: string[]): Record<string, unknown> =>
  path.reduce<Record<string, unknown>>((node, key) => {
    if (key === '[]') return node.items as Record<string, unknown>;
    if (key === '?') return (node.anyOf as Array<Record<string, unknown>>)[0]!;
    return (node.properties as Record<string, Record<string, unknown>>)[key]!;
  }, schema as Record<string, unknown>);

describe('buildDraftToolSchema', () => {
  it('follows strict tool calling: every property required, nothing extra, no length or item bounds', () => {
    const all = nodes(buildDraftToolSchema(catalog));
    expect(all.length).toBeGreaterThan(50);
    for (const node of all) {
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
      }
      for (const keyword of FORBIDDEN) expect(node).not.toHaveProperty(keyword);
    }
  });

  it('only offers the catalog names the organization has', () => {
    const schema = buildDraftToolSchema(catalog);
    const assignment = propertyAt(schema, ['steps', '[]', 'assignment', '?']);
    expect(propertyAt(assignment as JsonSchema, ['position', '?']).enum).toEqual(['Gerente general', 'Contador', 'Tesorero']);
    expect(propertyAt(assignment as JsonSchema, ['poolGroups', '[]']).enum).toEqual(['Mesa TI']);
    expect(propertyAt(assignment as JsonSchema, ['approvalType', '?']).enum).toEqual(['Jefatura']);
  });

  it('falls back to free text when a list is empty or too long for an enum', () => {
    const many = Array.from({ length: MAX_CATALOG_ENUM + 1 }, (_, index) => ({ id: `p${index}`, name: `Cargo ${index}` }));
    const schema = buildDraftToolSchema({ positions: many, groups: [], approvalTypes: [] });
    const assignment = propertyAt(schema, ['steps', '[]', 'assignment', '?']) as JsonSchema;
    expect(propertyAt(assignment, ['position', '?'])).toEqual({ type: 'string' });
    expect(propertyAt(assignment, ['group', '?'])).toEqual({ type: 'string' });
  });

  it('offers initiators, signature steps and amount rules, with catalog names for positions', () => {
    const schema = buildDraftToolSchema(catalog);
    expect(propertyAt(schema, ['steps', '[]', 'type']).enum).toContain('SIGNATURE');
    expect(propertyAt(schema, ['steps', '[]', 'signatureDocument', '?']).enum).toEqual(['MAIN_DOCUMENT', 'STEP_DOCUMENT']);
    expect(propertyAt(schema, ['initiators', '[]', 'kind']).enum).toEqual(['POSITION', 'GROUP']);
    expect(propertyAt(schema, ['initiators', '[]', 'name']).enum).toEqual(['Gerente general', 'Contador', 'Tesorero', 'Mesa TI']);
    const rule = propertyAt(schema, ['amountRules', '[]']);
    expect(Object.keys(rule.properties as object).sort()).toEqual(['action', 'amountColumn', 'approvalStep', 'currency', 'field', 'maxAmount', 'message', 'position', 'step']);
    expect(propertyAt(rule as JsonSchema, ['action']).enum).toEqual(['BLOCK', 'WARN', 'EXTRA_APPROVAL']);
    expect(propertyAt(rule as JsonSchema, ['maxAmount'])).toEqual({ type: 'number' });
    expect(propertyAt(rule as JsonSchema, ['position', '?']).enum).toEqual(['Gerente general', 'Contador', 'Tesorero']);
  });

  it('asks for the decisions by topic', () => {
    expect(propertyAt(buildDraftToolSchema(catalog), ['decisions', '[]', 'topic']).enum).toEqual([...DRAFT_DECISION_TOPICS]);
  });

  it('declares exactly the keys of the zod spec', () => {
    const schema = buildDraftToolSchema(catalog);
    const keys = (node: unknown): string[] => Object.keys((node as { properties: object }).properties).sort();
    expect(keys(schema)).toEqual(Object.keys(travelAdvanceSpec()).sort());
    expect(keys(propertyAt(schema, ['steps', '[]']))).toEqual(Object.keys(travelAdvanceSpec().steps[0]!).sort());
    expect(keys(propertyAt(schema, ['amountRules', '[]']))).toEqual(Object.keys(travelAdvanceSpec().amountRules[0]!).sort());
  });
});
