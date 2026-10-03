/**
 * Which pages may open a socket. WebSockets are not subject to CORS, so the handshake compares the `Origin` header with
 * an exact list (scheme, host and port). A missing `Origin` is refused: browsers always send it on a WebSocket, and
 * other clients can set it. Defense in depth only: the socket authenticates with an explicit token, never a cookie.
 */
export class OriginPolicy {
  private readonly allowed: ReadonlySet<string>;

  constructor(origins: readonly string[]) {
    this.allowed = new Set(origins.map((origin) => origin.toLowerCase()));
  }

  allows(origin: string | undefined): boolean {
    if (origin === undefined) return false;
    const normalized = normalizeOrigin(origin);
    return normalized !== undefined && this.allowed.has(normalized);
  }
}

/** `undefined` for anything that is not exactly an http(s) origin (a path, a query, the opaque `null` origin). */
function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return value.toLowerCase() === url.origin ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
