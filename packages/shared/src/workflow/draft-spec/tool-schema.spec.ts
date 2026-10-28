import { describe, expect, it } from 'vitest';
import { buildDraftToolSchema, type JsonSchema, MAX_CATALOG_ENUM } from './tool-schema.js';
import { catalog } from './test-fixtures.js';

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
});
