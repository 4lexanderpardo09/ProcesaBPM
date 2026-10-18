import { useTranslation } from 'react-i18next';
import { useCurrentUser, useSessionManager } from '@/shared/session';
import { Avatar, Button, LogOutIcon } from '@/shared/ui';
import styles from './UserMenu.module.css';

/** The signed-in person (avatar, name, role) and the sign-out action, on the right of the top bar. */
export function UserMenu() {
  const { t } = useTranslation('auth');
  const manager = useSessionManager();
  const { data: me } = useCurrentUser();
  if (me === undefined) return null;
  const fullName = `${me.user.firstName} ${me.user.lastName}`;
  return (
    <div className={styles.menu} role="group" aria-label={t('session.account')}>
      <Avatar name={fullName} size="md" />
      <div className={styles.who}>
        <span className={styles.name}>{fullName}</span>
        <span className={styles.role}>{me.membership.role.name}</span>
      </div>
      <Button variant="ghost" icon={<LogOutIcon size={16} />} aria-label={t('session.signOut')} title={t('session.signOut')} onClick={() => void manager.signOut()} />
    </div>
  );
}
