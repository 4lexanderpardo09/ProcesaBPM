const SECRET_KEY = /pass|secret|token|hash|code|key|otp/i;
const MAX_STRING = 200;
const MAX_DEPTH = 4;
const MAX_BYTES = 8192;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function clean(value: unknown, depth: number): Json | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1) ?? null);
  if (typeof value === 'object' && value !== undefined) {
    const entries = Object.entries(value).flatMap(([key, item]) => {
      if (SECRET_KEY.test(key)) return [];
      const cleaned = clean(item, depth + 1);
      return cleaned === undefined ? [] : [[key, cleaned] as const];
    });
    return Object.fromEntries(entries);
  }
  return undefined;
}

/**
 * What the audit trail keeps of a change: a summary, never a row dump. Keys that look like secrets are dropped at any
 * depth, long strings are cut, the nesting is limited, and anything above 8 KiB is replaced by a marker, so the trail
 * can neither leak a credential nor grow without bound.
 */
export function sanitizeAuditSummary(value: unknown): Json | undefined {
  const cleaned = clean(value, 0);
  if (cleaned === undefined) return undefined;
  return Buffer.byteLength(JSON.stringify(cleaned), 'utf8') > MAX_BYTES ? { truncated: true } : cleaned;
}
