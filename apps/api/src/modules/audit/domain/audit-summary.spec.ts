import { describe, expect, it } from 'vitest';
import { sanitizeAuditSummary } from './audit-summary.js';

describe('sanitizeAuditSummary', () => {
  it('keeps ids, names and flags', () => {
    expect(sanitizeAuditSummary({ id: 'a', name: 'Admin', isAdmin: true, count: 3, at: new Date('2026-10-01T00:00:00Z'), none: null })).toEqual({
      id: 'a',
      name: 'Admin',
      isAdmin: true,
      count: 3,
      at: '2026-10-01T00:00:00.000Z',
      none: null,
    });
  });

  it.each(['password', 'newPassword', 'passwordHash', 'secret', 'mfaSecretEncrypted', 'accessToken', 'selectionToken', 'backupCodes', 'apiKey', 'otp', 'privateKey', 'credentials'])('drops the key %s at any depth', (key) => {
    expect(sanitizeAuditSummary({ [key]: 'x', nested: { deeper: { [key]: 'x', ok: 1 } } })).toEqual({ nested: { deeper: { ok: 1 } } });
  });

  it('keeps ordinary codes and keys that are not secrets', () => {
    expect(sanitizeAuditSummary({ code: 'LUNCH', keyboard: 'es', sortKey: 3 })).toEqual({ code: 'LUNCH', keyboard: 'es', sortKey: 3 });
  });

  it('cuts long strings', () => {
    expect((sanitizeAuditSummary({ note: 'x'.repeat(500) }) as { note: string }).note).toHaveLength(201);
  });

  it('limits the depth', () => {
    expect(sanitizeAuditSummary({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({ a: { b: { c: {} } } });
  });

  it('stays under the table limit once PostgreSQL writes it as jsonb text (spaces after : and ,)', () => {
    const ids = Array.from({ length: 400 }, () => '0199a000-0000-7000-8000-000000000001');
    const kept = sanitizeAuditSummary({ userIds: ids });
    const pgText = JSON.stringify(kept).replace(/([:,])/g, '$1 ');
    expect(Buffer.byteLength(pgText, 'utf8')).toBeLessThanOrEqual(8192);
  });

  it('replaces a summary above 6 KiB by a marker', () => {
    const big = Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`field${index}`, 'x'.repeat(100)]));
    expect(sanitizeAuditSummary(big)).toEqual({ truncated: true });
  });

  it('has nothing to keep for undefined', () => {
    expect(sanitizeAuditSummary(undefined)).toBeUndefined();
  });
});
