import { isUuid, type TicketValueNamesResponse } from '@procesabpm/shared';

/** What a stored field value needs to know whether it points to records of the tenant (people, sites, preset entries). */
export interface ReferencingValue {
  readonly value: unknown;
  readonly field: { readonly type: string; readonly dataSource: unknown };
}

export type ReferenceKind = keyof TicketValueNamesResponse;

/** The ids a ticket's values point to, by kind, as they appear in the values (no duplicates, only well-formed UUIDs). */
export type ValueReferences = Readonly<Record<ReferenceKind, readonly string[]>>;

/** Names found in the tenant, by lower-case id. */
export type FoundNames = Readonly<Record<ReferenceKind, ReadonlyMap<string, string>>>;

export const REFERENCE_KINDS: readonly ReferenceKind[] = ['users', 'sites', 'companies', 'departments', 'positions'];

const PRESET_KINDS: Readonly<Record<string, ReferenceKind>> = { USERS: 'users', SITES: 'sites', COMPANIES: 'companies', DEPARTMENTS: 'departments', POSITIONS: 'positions' };

const presetOf = (dataSource: unknown): string | undefined => {
  if (typeof dataSource !== 'object' || dataSource === null) return undefined;
  const source = dataSource as Record<string, unknown>;
  return source.kind === 'PRESET' && typeof source.preset === 'string' ? source.preset : undefined;
};

/** USER and SITE fields hold one id; SELECT and MULTI_SELECT fields hold ids when they take a preset list. */
export function referenceKindOf(field: ReferencingValue['field']): ReferenceKind | undefined {
  if (field.type === 'USER') return 'users';
  if (field.type === 'SITE') return 'sites';
  if (field.type !== 'SELECT' && field.type !== 'MULTI_SELECT') return undefined;
  const preset = presetOf(field.dataSource);
  return preset === undefined ? undefined : PRESET_KINDS[preset];
}

const idsIn = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).filter(isUuid);

export function valueReferences(values: readonly ReferencingValue[]): ValueReferences {
  const found = Object.fromEntries(REFERENCE_KINDS.map((kind) => [kind, new Set<string>()])) as Record<ReferenceKind, Set<string>>;
  for (const entry of values) {
    const kind = referenceKindOf(entry.field);
    if (kind !== undefined) for (const id of idsIn(entry.value)) found[kind].add(id);
  }
  return Object.fromEntries(REFERENCE_KINDS.map((kind) => [kind, [...found[kind]]])) as Record<ReferenceKind, string[]>;
}

/** Each referenced id that names something of the tenant, keyed as it appears in the values; the rest are left out. */
export function valueNamesOf(references: ValueReferences, names: FoundNames): TicketValueNamesResponse {
  const named = (kind: ReferenceKind) =>
    Object.fromEntries(references[kind].flatMap((id) => {
      const name = names[kind].get(id.toLowerCase());
      return name === undefined ? [] : [[id, name] as const];
    }));
  return Object.fromEntries(REFERENCE_KINDS.map((kind) => [kind, named(kind)])) as unknown as TicketValueNamesResponse;
}
