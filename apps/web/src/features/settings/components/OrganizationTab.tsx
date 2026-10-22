import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PDF_IMAGE_MAX_BYTES, PDF_IMAGE_TYPES, removeTenantLogo, tenantLogoQueryKey, tenantLogoQueryOptions, uploadTenantLogo } from '@/shared/organization/logo-api';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Card } from '@/shared/ui';
import { SettingsError } from './SettingsError';
import styles from './Settings.module.css';

/** The organization's logo, which the PDF formats print where they place it. PNG or JPEG, up to 1 MB. */
export function OrganizationTab() {
  const { t } = useTranslation('settings');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<'type' | 'size'>();
  const logo = useQuery(tenantLogoQueryOptions(client));
  const refresh = () => queryClient.invalidateQueries({ queryKey: tenantLogoQueryKey });
  const upload = useMutation({ mutationFn: (file: File) => uploadTenantLogo(client, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => removeTenantLogo(client), onSuccess: refresh });
  const busy = upload.isPending || remove.isPending;
  const has = logo.data !== null && logo.data !== undefined;

  return (
    <Card title={t('organization.logoTitle')}>
      <div className={styles.stack}>
        <p className={styles.note}>{t('organization.logoHint')}</p>
        {logo.data === undefined ? (
          <p className={styles.note}>{logo.isError ? t('loadFailed') : t('loading')}</p>
        ) : logo.data === null ? (
          <p className={styles.note}>{t('organization.noLogo')}</p>
        ) : (
          <img className={styles.logo} src={logo.data.url} alt={t('organization.logoAlt')} />
        )}
        {problem !== undefined && <Alert tone="danger">{t(problem === 'type' ? 'organization.wrongType' : 'organization.tooLarge')}</Alert>}
        <SettingsError error={upload.error ?? remove.error} />
        <input
          ref={input}
          type="file"
          accept={PDF_IMAGE_TYPES.join(',')}
          hidden
          aria-label={t('organization.logoFile')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file === undefined) return;
            setProblem(undefined);
            if (!PDF_IMAGE_TYPES.includes(file.type)) setProblem('type');
            else if (file.size > PDF_IMAGE_MAX_BYTES) setProblem('size');
            else upload.mutate(file);
          }}
        />
        <div className={styles.buttons}>
          <Button variant="brand" disabled={busy} onClick={() => input.current?.click()}>
            {upload.isPending ? t('organization.uploading') : has ? t('organization.replace') : t('organization.upload')}
          </Button>
          {has && (
            <Button variant="ghost" disabled={busy} onClick={() => remove.mutate()}>
              {t('organization.remove')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
