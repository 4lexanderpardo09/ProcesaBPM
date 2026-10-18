import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { isUrlLoginNotice } from '@/shared/lib/paths';
import { Alert } from '@/shared/ui';
import { AuthCard } from '../components/AuthCard';
import { BackupCodesPanel } from '../components/BackupCodesPanel';
import { CredentialsForm } from '../components/CredentialsForm';
import { MfaChallengeForm } from '../components/MfaChallengeForm';
import { MfaEnrollmentPanel } from '../components/MfaEnrollmentPanel';
import { OrganizationPicker } from '../components/OrganizationPicker';
import type { LoginFlowState } from '../hooks/login-flow';
import { useLoginFlow } from '../hooks/use-login-flow';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const notice = searchParams.get('notice');
  const flow = useLoginFlow(isUrlLoginNotice(notice) ? notice : undefined);
  return (
    <AuthCard>
      <LoginStep flow={flow} />
    </AuthCard>
  );
}

function LoginStep({ flow }: { readonly flow: ReturnType<typeof useLoginFlow> }) {
  const { state, failure, busy } = flow;
  const error = failure?.error;
  switch (state.step) {
    case 'credentials':
      return (
        <>
          <NoticeOf state={state} />
          <CredentialsForm busy={busy} error={error} onSubmit={flow.submitCredentials} />
        </>
      );
    case 'mfa':
      return (
        <MfaChallengeForm key={state.method} method={state.method} busy={busy} error={error} onSubmit={flow.submitMfa} onSwitchMethod={flow.switchMfaMethod} onRestart={flow.restart} />
      );
    case 'enrollment':
      return <MfaEnrollmentPanel reason={state.reason} enrollment={state.enrollment} busy={busy} error={error} onSubmit={flow.submitEnrollmentCode} onRestart={flow.restart} />;
    case 'backupCodes':
      return <BackupCodesPanel codes={state.codes} onContinue={flow.saveBackupCodes} />;
    case 'organization':
      return (
        <OrganizationPicker
          choice={state.choice}
          backupCodesLeft={state.backupCodesLeft}
          rowErrors={state.rowErrors}
          openingTenantId={state.openingTenantId}
          error={error}
          onChoose={flow.chooseOrganization}
          onRestart={flow.restart}
        />
      );
  }
}

function NoticeOf({ state }: { readonly state: Extract<LoginFlowState, { step: 'credentials' }> }) {
  const { t } = useTranslation('auth');
  if (state.notice === undefined) return null;
  return <Alert tone={state.notice === 'signedOutElsewhere' ? 'info' : 'warn'}>{t(`notices.${state.notice}`)}</Alert>;
}
