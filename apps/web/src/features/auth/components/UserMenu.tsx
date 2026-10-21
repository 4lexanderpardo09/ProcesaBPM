import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { useCurrentUser, useSessionManager } from '@/shared/session';
import { Avatar, Button, LogOutIcon } from '@/shared/ui';
import styles from './UserMenu.module.css';

/** The signed-in person (avatar, name, role; a link to their profile) and the sign-out action, on the right of the top bar. */
export function UserMenu() {
  const { t } = useTranslation(['auth', 'profile']);
  const manager = useSessionManager();
  const { data: me } = useCurrentUser();
  if (me === undefined) return null;
  const fullName = `${me.user.firstName} ${me.user.lastName}`;
  return (
    <div className={styles.menu} role="group" aria-label={t('auth:session.account')}>
      <Link to={paths.profile} className={styles.profile} title={t('profile:open')}>
        <Avatar name={fullName} size="md" />
        <span className={styles.who}>
          <span className={styles.name}>{fullName}</span>
          <span className={styles.role}>{me.membership.role.name}</span>
        </span>
      </Link>
      <Button variant="ghost" icon={<LogOutIcon size={16} />} aria-label={t('auth:session.signOut')} title={t('auth:session.signOut')} onClick={() => void manager.signOut()} />
    </div>
  );
}
