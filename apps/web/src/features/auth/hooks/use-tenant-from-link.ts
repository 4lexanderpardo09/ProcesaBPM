import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useCurrentUser } from '@/shared/session';
import { useSwitchOrganization } from './use-switch-organization';

const TENANT_PARAM = 'tenant';

/**
 * E-mail links name their organization (`/tickets/…?tenant=…`). When the session is in another one of the person's
 * organizations, it moves there and opens the same page without the parameter; when it already is, the parameter is
 * just dropped. If the switch is refused (not a member, suspended), the page stays and answers as it would.
 */
export function useTenantFromLink() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: me } = useCurrentUser();
  const change = useSwitchOrganization();
  const handled = useRef<string | undefined>(undefined);
  const params = new URLSearchParams(location.search);
  const wanted = params.get(TENANT_PARAM);

  useEffect(() => {
    if (wanted === null || me === undefined || handled.current === location.key) return;
    handled.current = location.key;
    params.delete(TENANT_PARAM);
    const query = params.toString();
    const to = `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`;
    if (wanted === me.membership.tenantId) void navigate(to, { replace: true });
    else change.mutate({ tenantId: wanted, to });
  });
  return change;
}
