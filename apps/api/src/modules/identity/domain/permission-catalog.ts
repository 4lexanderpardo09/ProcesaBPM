import type { PermissionCatalogGroup } from '@procesabpm/shared';
import type { SubjectRegistry } from '../../authorization/domain/subject-registry.js';

export interface CatalogRow {
  readonly action: string;
  readonly subject: string;
  readonly description: string | null;
}

/** Groups the catalog by subject (alphabetical, actions in the catalog order) and marks which subjects take conditions. */
export function groupCatalogBySubject(rows: readonly CatalogRow[], registry: SubjectRegistry): PermissionCatalogGroup[] {
  const bySubject = new Map<string, Array<{ action: string; description: string | null }>>();
  for (const row of rows) bySubject.set(row.subject, [...(bySubject.get(row.subject) ?? []), { action: row.action, description: row.description }]);
  return [...bySubject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subject, actions]) => ({ subject, acceptsConditions: registry.get(subject) !== undefined, actions }));
}
