/**
 * Groups a client by a key that one machine cannot cheaply rotate. IPv4 keeps its full address; IPv6 is
 * collapsed to its /64 prefix, because a single host owns a /64 (2^64 addresses) and counting the full
 * address would make every per-address limit trivial to bypass. An IPv4-mapped address (`::ffff:1.2.3.4`)
 * counts as IPv4.
 */
export function normalizeClientAddress(address: string | undefined): string {
  if (address === undefined || address.length === 0) return 'unknown';
  const withoutZone = address.split('%', 1)[0]!;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(withoutZone);
  if (mapped !== null) return mapped[1]!;
  if (!withoutZone.includes(':')) return withoutZone;
  const hextets = expandIpv6(withoutZone.toLowerCase());
  return hextets === undefined ? withoutZone.toLowerCase() : `${hextets.slice(0, 4).join(':')}::/64`;
}

/** Eight zero-padded hextets of an IPv6 address, `undefined` when it is not a valid one. */
function expandIpv6(address: string): string[] | undefined {
  const doubleColon = address.indexOf('::');
  const head = doubleColon >= 0 ? address.slice(0, doubleColon) : address;
  const tail = doubleColon >= 0 ? address.slice(doubleColon + 2) : '';
  const headParts = head.length > 0 ? head.split(':') : [];
  const tailParts = tail.length > 0 ? tail.split(':') : [];
  const zeros = 8 - headParts.length - tailParts.length;
  if (doubleColon < 0 ? zeros !== 0 : zeros < 1) return undefined;
  const parts = [...headParts, ...Array(Math.max(zeros, 0)).fill('0'), ...tailParts];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.map((part) => part.padStart(4, '0'));
}
