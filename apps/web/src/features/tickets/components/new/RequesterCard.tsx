import { useTranslation } from 'react-i18next';
import { PersonPicker, personName } from '@/features/profile';
import { Button, Card } from '@/shared/ui';
import styles from './NewTicket.module.css';

export interface Requester {
  readonly userId: string;
  readonly name: string;
}

export interface RequesterCardProps {
  /** `undefined`: the ticket is for oneself. */
  readonly requester: Requester | undefined;
  /** Without `create` (only `create_for_others`), there is no "for me". */
  readonly canCreateForSelf: boolean;
  readonly selfId: string;
  readonly onChange: (requester: Requester | undefined) => void;
}

/** Who the ticket is for: oneself, or a colleague found by name (the catalog and the form then are theirs). */
export function RequesterCard({ requester, canCreateForSelf, selfId, onChange }: RequesterCardProps) {
  const { t } = useTranslation('tickets');
  return (
    <Card title={t('new.requester.title')}>
      <div className={styles.requester}>
        {requester === undefined && canCreateForSelf ? (
          <p className={styles.note}>{t('new.requester.self')}</p>
        ) : requester !== undefined ? (
          <p className={styles.note}>{t('new.requester.other', { name: requester.name })}</p>
        ) : (
          <p className={styles.note}>{t('new.requester.pick')}</p>
        )}
        {requester !== undefined && canCreateForSelf && (
          <Button variant="ghost" onClick={() => onChange(undefined)}>
            {t('new.requester.backToSelf')}
          </Button>
        )}
        <PersonPicker
          key={requester?.userId ?? 'self'}
          label={t('new.requester.search')}
          actionLabel={t('new.requester.choose')}
          actionLabelNamed={(name) => t('new.requester.chooseNamed', { name })}
          taken={new Set([selfId, ...(requester === undefined ? [] : [requester.userId])])}
          onPick={(person) => onChange({ userId: person.userId, name: personName(person) })}
        />
      </div>
    </Card>
  );
}
