import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonPicker } from '@/features/profile';
import { Button, Select } from '@/shared/ui';
import { type RecordKind, useRecordNames } from '../../hooks/use-record-names';
import type { Participant } from '../../lib/participants';
import styles from '../Builder.module.css';

export interface ParticipantListProps {
  readonly label: string;
  readonly empty: string;
  readonly kinds: readonly RecordKind[];
  readonly items: readonly Participant[];
  readonly readOnly: boolean;
  readonly pending: boolean;
  /** The whole list after a change: the API replaces it at once. */
  readonly onChange: (items: Participant[]) => void;
}

/** People, positions, groups or places, each with its name, to take out or to add one more. */
export function ParticipantList({ label, empty, kinds, items, readOnly, pending, onChange }: ParticipantListProps) {
  const { t } = useTranslation('workflows');
  const [kind, setKind] = useState<RecordKind>(kinds[0] ?? 'USER');
  const [recordId, setRecordId] = useState('');
  const { records, nameOf } = useRecordNames(new Set(kinds), items.filter((item) => item.kind === 'USER').map((item) => item.id));
  const taken = new Set(items.map((item) => item.id));
  const add = (id: string) => {
    onChange([...items, { kind, id }]);
    setRecordId('');
  };

  return (
    <div className={styles.participants}>
      {items.length === 0 ? (
        <p className={styles.note}>{empty}</p>
      ) : (
        <ul className={styles.fieldList} aria-label={label}>
          {items.map((item) => {
            const name = nameOf(item.id) ?? t('builder.participants.unknown');
            return (
              <li key={`${item.kind}-${item.id}`} className={styles.fieldRow}>
                <span className={styles.fieldText}>
                  <span className={styles.fieldName}>{name}</span>
                  <span className={styles.fieldMetaPlain}>{t(`builder.participants.kinds.${item.kind}`)}</span>
                </span>
                {!readOnly && (
                  <Button variant="ghost" aria-label={t('builder.participants.removeNamed', { name })} disabled={pending} onClick={() => onChange(items.filter((other) => other !== item))}>
                    {t('builder.participants.remove')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <div className={styles.addParticipant}>
          {kinds.length > 1 && (
            <Select
              label={t('builder.participants.kind')}
              options={kinds.map((value) => ({ value, label: t(`builder.participants.kinds.${value}`) }))}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as RecordKind);
                setRecordId('');
              }}
            />
          )}
          {kind === 'USER' ? (
            <PersonPicker label={t('builder.participants.person')} actionLabel={t('builder.participants.add')} actionLabelNamed={(name) => t('builder.participants.addNamed', { name })} taken={taken} onPick={(person) => add(person.userId)} />
          ) : (
            <div className={styles.addExit}>
              <Select
                label={t('builder.participants.record')}
                placeholder={t('builder.participants.recordPlaceholder')}
                options={records[kind].filter((record) => record.isActive && !taken.has(record.id)).map((record) => ({ value: record.id, label: record.name }))}
                value={recordId}
                onChange={(event) => setRecordId(event.target.value)}
              />
              <Button disabled={recordId === '' || pending} onClick={() => add(recordId)}>
                {t('builder.participants.add')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
