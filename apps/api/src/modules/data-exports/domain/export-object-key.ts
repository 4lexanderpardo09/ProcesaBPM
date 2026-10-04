/** Where an export's archive lives: under the tenant's prefix (the purge empties it), fixed by a CHECK in the database. */
export function exportObjectKey(tenantId: string, exportId: string): string {
  return `tenants/${tenantId}/exports/${exportId}.zip`;
}
