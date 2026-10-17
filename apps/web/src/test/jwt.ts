const encode = (value: object) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export interface TestClaims {
  readonly sub?: string;
  readonly tid?: string;
  readonly sid?: string;
}

/** An unsigned JWT with the access-token claims: the web only reads them, the API verifies. */
export function makeJwt({ sub = 'user-1', tid = 'tenant-1', sid = 'session-1' }: TestClaims = {}): string {
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, tid, sid, aud: 'procesabpm:api' })}.signature`;
}
