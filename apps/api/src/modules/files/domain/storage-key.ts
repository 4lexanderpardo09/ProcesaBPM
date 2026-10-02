/** `tenants/{tenant}/{yyyy}/{mm}/{file id}`: fixed by the row (the database checks the format), never chosen by the client. */
export function buildStorageKey(tenantId: string, fileId: string, at: Date): string {
  const year = at.getUTCFullYear().toString().padStart(4, '0');
  const month = (at.getUTCMonth() + 1).toString().padStart(2, '0');
  return `tenants/${tenantId}/${year}/${month}/${fileId}`;
}
