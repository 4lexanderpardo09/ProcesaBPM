const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i;

/** The token of an `Authorization: Bearer …` header, if well formed. */
export function bearerToken(header: string | undefined): string | undefined {
  return header === undefined ? undefined : BEARER.exec(header.trim())?.[1];
}
