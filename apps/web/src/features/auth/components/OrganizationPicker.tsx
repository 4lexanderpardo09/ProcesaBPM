import type { Organization } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Alert, Badge, Button } from '@/shared/ui';
import { isSelectable, type OrganizationChoice, PLATFORM_CHOICE } from '../hooks/login-flow';
import type { AuthMessageKey } from '../lib/auth-error-message';
import styles from './auth-forms.module.css';
import picker from './OrganizationPicker.module.css';
import { StepError } from './StepError';
import { StepHeading } from './StepHeading';

export interface OrganizationPickerProps {
  readonly choice: OrganizationChoice;
  readonly backupCodesLeft?: number | undefined;
  readonly rowErrors: Readonly<Record<string, AuthMessageKey>>;
  readonly openingTenantId?: string | undefined;
  readonly error: unknown;
  readonly onChoose: (tenantId: string) => void;
  /** A platform administrator enters the console instead. */
  readonly onOpenPlatform?: () => void;
  readonly onRestart: () => void;
}

export function OrganizationPicker({ choice, backupCodesLeft, rowErrors, openingTenantId, error, onChoose, onOpenPlatform, onRestart }: OrganizationPickerProps) {
  const { t } = useTranslation(['auth', 'common']);
  return (
    <div className={styles.form}>
      <StepHeading title={t('organizations.title')} />
      {error !== undefined && <StepError error={error} context="selection" />}
      {backupCodesLeft !== undefined && <Alert tone="warn">{t('organizations.backupCodesLeft', { count: backupCodesLeft })}</Alert>}
      {choice.platformAdmin && (
        <>
          <Alert tone="info">{t('organizations.platformAdmin')}</Alert>
          {onOpenPlatform !== undefined && (
            <Button variant="primary" disabled={openingTenantId !== undefined} aria-busy={openingTenantId === PLATFORM_CHOICE} onClick={onOpenPlatform}>
              {openingTenantId === PLATFORM_CHOICE ? t('organizations.openingPlatform') : t('organizations.openPlatform')}
            </Button>
          )}
        </>
      )}
      {choice.organizations.length === 0 ? (
        <p className={styles.description}>{t('organizations.empty')}</p>
      ) : (
        <ul className={picker.list}>
          {choice.organizations.map((organization) => (
            <li key={organization.tenantId}>
              <OrganizationRow
                organization={organization}
                opening={openingTenantId === organization.tenantId}
                disabled={openingTenantId !== undefined}
                errorKey={rowErrors[organization.tenantId]}
                onChoose={onChoose}
              />
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={styles.linkButton} onClick={onRestart}>
        {t('back')}
      </button>
    </div>
  );
}

interface OrganizationRowProps {
  readonly organization: Organization;
  readonly opening: boolean;
  readonly disabled: boolean;
  readonly errorKey: AuthMessageKey | undefined;
  readonly onChoose: (tenantId: string) => void;
}

function OrganizationRow({ organization, opening, disabled, errorKey, onChoose }: OrganizationRowProps) {
  const { t } = useTranslation(['auth', 'common']);
  const errorId = `organization-error-${organization.tenantId}`;
  const { maintenance } = organization;
  return (
    <>
      <button
        type="button"
        className={picker.row}
        disabled={disabled || !isSelectable(organization)}
        aria-busy={opening}
        aria-describedby={errorKey === undefined ? undefined : errorId}
        onClick={() => onChoose(organization.tenantId)}
      >
        <span className={picker.names}>
          <span className={picker.name}>{organization.name}</span>
          <span className={picker.slug}>{organization.slug}</span>
        </span>
        {opening && <span className={picker.status}>{t('organizations.opening')}</span>}
        {organization.membershipStatus === 'INVITED' && <Badge>{t('organizations.invited')}</Badge>}
        {maintenance !== null && <Badge tone="warn">{t('organizations.maintenance')}</Badge>}
      </button>
      {organization.membershipStatus === 'INVITED' && <p className={picker.note}>{t('organizations.invitedHelp')}</p>}
      {maintenance?.endsAt != null && <p className={picker.note}>{t('organizations.until', { date: formatDateTime(maintenance.endsAt) })}</p>}
      {errorKey !== undefined && (
        <p id={errorId} className={picker.error}>
          {t(errorKey)}
        </p>
      )}
    </>
  );
}
