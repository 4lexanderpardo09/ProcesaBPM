import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

/** The one-time token of an e-mail link (`…/reset-password#token=…`), or nothing. */
export function tokenFromHash(hash: string): string | undefined {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token === null || token === '' ? undefined : token;
}

/**
 * Reads the token once and takes it out of the address bar. It travels in the fragment, which is never sent to a
 * server; removing it keeps it out of the history and of a copied URL.
 */
export function useLinkToken(): string | undefined {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => tokenFromHash(location.hash));
  const hasHash = location.hash !== '';
  useEffect(() => {
    if (hasHash) void navigate({ pathname: location.pathname, search: location.search }, { replace: true });
  }, [hasHash, navigate, location.pathname, location.search]);
  return token;
}
