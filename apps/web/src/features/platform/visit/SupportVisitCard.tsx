import type { TenantDetail } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { Alert, Button, Card } from '@/shared/ui';
import { PlatformError } from '../components/PlatformError';
import styles from '../pages/Platform.module.css';
import { useSupportVisits } from './SupportVisitContext';
import type { VisitEndReason } from './support-visit';

/**
 * Opening the organization read-only, which it allows only while it has given support access (Ajustes → Acceso de
 * soporte). Says why the last visit ended when it brings the person back here.
 */
export function SupportVisitCard({ tenant }: { readonly tenant: TenantDetail }) {
  const { t } = useTranslation('platform');
  const navigate = useNavigate();
  const { visit, ended, start, acknowledge } = useSupportVisits();
  const [endedReason, setEndedReason] = useState<VisitEndReason>();
  const open = useMutation({
    mutationFn: () => start({ id: tenant.tenantId, name: tenant.name, slug: tenant.slug }),
    onSuccess: () => void navigate(paths.home),
  });

  useEffect(() => {
    if (ended === null || ended.tenantId !== tenant.tenantId) return;
    setEndedReason(ended.reason);
    acknowledge();
  }, [ended, tenant.tenantId, acknowledge]);

  const visiting = visit !== null && visit.tenant.id === tenant.tenantId;
  return (
    <Card title={t('visit.title')}>
      <div className={styles.stack}>
        {endedReason !== undefined && <Alert tone={endedReason === 'closed' ? 'ok' : 'warn'}>{t(`visit.ended.${endedReason}`)}</Alert>}
        <p className={styles.note}>{t('visit.hint')}</p>
        <div className={styles.actions}>
          {visiting ? (
            <>
              <Button variant="primary" onClick={() => void navigate(paths.home)}>
                {t('visit.resume')}
              </Button>
              <Button onClick={() => void visit.close()}>{t('visit.end')}</Button>
            </>
          ) : (
            <Button variant="primary" disabled={tenant.status !== 'ACTIVE' || open.isPending} onClick={() => open.mutate()}>
              {open.isPending ? t('visit.opening') : t('visit.open')}
            </Button>
          )}
        </div>
        {open.isError && <PlatformError error={open.error} />}
      </div>
    </Card>
  );
}
