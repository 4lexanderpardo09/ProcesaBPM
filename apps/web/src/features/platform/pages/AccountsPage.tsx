import { MFA_RESET_VERIFICATION_METHODS, type MfaResetVerificationMethod, type PlatformUserResponse } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Dialog, PageHeader, Select, TextArea, TextField } from '@/shared/ui';
import { lookUpUser, resetUserMfa } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

const codePoints = (text: string) => [...text.trim()].length;

/**
 * Account support: an account found by its exact e-mail (never a search), what support may see of it, and resetting its
 * second factor once who asked was verified. Nothing of it is cached: a new lookup replaces it.
 */
export function AccountsPage() {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const [email, setEmail] = useState('');
  const [resetting, setResetting] = useState(false);
  const [done, setDone] = useState<{ readonly sessions: number }>();
  const lookup = useMutation({ mutationFn: (address: string) => lookUpUser(client, address) });
  const account = lookup.data;
  return (
    <>
      <PageHeader title={t('accounts.title')} subtitle={t('accounts.subtitle')} />
      <form
        className={styles.actions}
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim() === '' || lookup.isPending) return;
          setDone(undefined);
          lookup.mutate(email.trim());
        }}
      >
        <TextField label={t('accounts.email')} type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
        <Button type="submit" variant="primary" disabled={lookup.isPending}>
          {t('accounts.find')}
        </Button>
      </form>
      <div className={styles.stack}>
        {lookup.isError && <PlatformError error={lookup.error} />}
        {done !== undefined && <Alert tone="ok">{t('accounts.resetDone', { count: done.sessions })}</Alert>}
        {account !== undefined && (
          <Card title={`${account.firstName} ${account.lastName}`}>
            <div className={styles.stack}>
              <dl className={styles.facts}>
                <div>
                  <dt>{t('accounts.status')}</dt>
                  <dd>
                    <Badge tone={account.status === 'ACTIVE' ? 'ok' : 'warn'}>{t(`accountStatuses.${account.status}`)}</Badge>
                  </dd>
                </div>
                <div>
                  <dt>{t('accounts.mfa')}</dt>
                  <dd>{account.mfaEnabled ? t('accounts.mfaOn') : t('accounts.mfaOff')}</dd>
                </div>
                <div>
                  <dt>{t('accounts.platformAdmin')}</dt>
                  <dd>{account.isPlatformAdmin ? t('yes') : t('no')}</dd>
                </div>
              </dl>
              <ul className={styles.list} aria-label={t('accounts.memberships')}>
                {account.memberships.map((membership) => (
                  <li key={membership.tenantId}>
                    {membership.tenantName} · {t(`membershipStatuses.${membership.status}`)}
                    {membership.isOwner && ` · ${t('accounts.owner')}`}
                  </li>
                ))}
              </ul>
              <div>
                <Button disabled={!account.mfaEnabled || account.isPlatformAdmin} onClick={() => setResetting(true)}>
                  {t('accounts.reset')}
                </Button>
                {account.isPlatformAdmin && <p className={styles.note}>{t('accounts.adminNoReset')}</p>}
              </div>
            </div>
          </Card>
        )}
      </div>
      {resetting && account !== undefined && (
        <ResetDialog
          account={account}
          onClose={() => setResetting(false)}
          onDone={(sessions) => {
            setResetting(false);
            setDone({ sessions });
            lookup.mutate(email.trim());
          }}
        />
      )}
    </>
  );
}

/** Why, how who asked was verified and the case it belongs to; a request of an organization's administrator names them by e-mail. */
function ResetDialog({ account, onClose, onDone }: { readonly account: PlatformUserResponse; readonly onClose: () => void; readonly onDone: (sessions: number) => void }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<MfaResetVerificationMethod>('VIDEO_CALL');
  const [reference, setReference] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const reset = useMutation({
    mutationFn: async () => {
      const tenantAdminUserId = method === 'TENANT_ADMIN_REQUEST' ? (await lookUpUser(client, adminEmail.trim())).id : undefined;
      return resetUserMfa(client, account.id, { reason: reason.trim(), verification: { method, reference: reference.trim(), ...(tenantAdminUserId === undefined ? {} : { tenantAdminUserId }) } });
    },
    onSuccess: (result) => onDone(result.revokedSessions),
  });
  const reasonOk = codePoints(reason) >= 10 && codePoints(reason) <= 500;
  const referenceOk = codePoints(reference) >= 3 && codePoints(reference) <= 200;
  const adminOk = method !== 'TENANT_ADMIN_REQUEST' || adminEmail.trim() !== '';
  return (
    <Dialog
      open
      title={t('accounts.resetTitle', { name: `${account.firstName} ${account.lastName}` })}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (reasonOk && referenceOk && adminOk && !reset.isPending) reset.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={reset.isPending}>
            {t('accounts.reset')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <p className={styles.note}>{t('accounts.resetHint')}</p>
        <TextArea label={t('accounts.reason')} required maxLength={500} error={submitted && !reasonOk ? t('accounts.reasonShort') : undefined} value={reason} onChange={(event) => setReason(event.target.value)} />
        <Select label={t('accounts.method')} options={MFA_RESET_VERIFICATION_METHODS.map((value) => ({ value, label: t(`accounts.methods.${value}`) }))} value={method} onChange={(event) => setMethod(event.target.value as MfaResetVerificationMethod)} />
        <TextField label={t('accounts.reference')} hint={t('accounts.referenceHint')} required maxLength={200} error={submitted && !referenceOk ? t('accounts.referenceShort') : undefined} value={reference} onChange={(event) => setReference(event.target.value)} />
        {method === 'TENANT_ADMIN_REQUEST' && (
          <TextField label={t('accounts.adminEmail')} type="email" required maxLength={254} error={submitted && !adminOk ? t('create.required') : undefined} value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} />
        )}
        {reset.isError && <PlatformError error={reset.error} />}
      </div>
    </Dialog>
  );
}
