import { type ReplaceSignersRequest, SIGNER_TYPES, type SignerDocument } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonPicker } from '@/features/profile';
import { Button, Select, TextField } from '@/shared/ui';
import { useRecordNames } from '../../hooks/use-record-names';
import styles from '../Builder.module.css';

type SignerType = SignerDocument['signerType'];
type Signer = ReplaceSignersRequest['signers'][number];

const toRequest = (signer: SignerDocument): Signer =>
  signer.signerType === 'USER'
    ? { signerType: 'USER', userId: signer.userId ?? '', label: signer.label }
    : signer.signerType === 'POSITION'
      ? { signerType: 'POSITION', positionId: signer.positionId ?? '', label: signer.label }
      : { signerType: signer.signerType, label: signer.label };

export interface SignersEditorProps {
  readonly signers: readonly SignerDocument[];
  /** A parallel step cannot ask the one who takes it to sign (everybody takes it). */
  readonly parallel: boolean;
  readonly readOnly: boolean;
  readonly pending: boolean;
  readonly onChange: (signers: Signer[]) => void;
}

/** Who signs, in order: a person, whoever holds a position, the approver, the creator or the step's assignee. */
export function SignersEditor({ signers, parallel, readOnly, pending, onChange }: SignersEditorProps) {
  const { t } = useTranslation('workflows');
  const ordered = [...signers].sort((a, b) => a.sortOrder - b.sortOrder);
  const types = SIGNER_TYPES.filter((type) => !(parallel && type === 'STEP_ASSIGNEE'));
  const [type, setType] = useState<SignerType>('CREATOR');
  const [positionId, setPositionId] = useState('');
  const [label, setLabel] = useState('');
  const { records, nameOf } = useRecordNames(new Set(['POSITION']), ordered.flatMap((signer) => (signer.userId === null ? [] : [signer.userId])));
  const current = ordered.map(toRequest);
  const describe = (signer: SignerDocument) => {
    const who = signer.signerType === 'USER' ? nameOf(signer.userId) : signer.signerType === 'POSITION' ? nameOf(signer.positionId) : undefined;
    return who === undefined ? t(`builder.participants.signerTypes.${signer.signerType}`) : `${t(`builder.participants.signerTypes.${signer.signerType}`)}: ${who}`;
  };
  const add = (signer: Signer) => {
    onChange([...current, signer]);
    setLabel('');
    setPositionId('');
  };
  const move = (index: number, offset: -1 | 1) => {
    const next = [...current];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + offset, 0, moved);
    onChange(next);
  };
  const labelValue = label.trim() === '' ? null : label.trim();

  return (
    <div className={styles.participants}>
      {ordered.length === 0 ? (
        <p className={styles.note}>{t('builder.participants.signersEmpty')}</p>
      ) : (
        <ol className={styles.fieldList} aria-label={t('builder.participants.signers')}>
          {ordered.map((signer, index) => {
            const name = describe(signer);
            return (
              <li key={signer.id} className={styles.fieldRow}>
                <span className={styles.fieldText}>
                  <span className={styles.fieldName}>
                    {index + 1}. {name}
                  </span>
                  {signer.label !== null && <span className={styles.fieldMetaPlain}>{signer.label}</span>}
                </span>
                {!readOnly && (
                  <span className={styles.fieldActions}>
                    <Button variant="ghost" aria-label={t('builder.participants.up', { name })} disabled={index === 0 || pending} onClick={() => move(index, -1)}>
                      ↑
                    </Button>
                    <Button variant="ghost" aria-label={t('builder.participants.down', { name })} disabled={index === ordered.length - 1 || pending} onClick={() => move(index, 1)}>
                      ↓
                    </Button>
                    <Button variant="ghost" aria-label={t('builder.participants.removeNamed', { name })} disabled={pending} onClick={() => onChange(current.filter((_signer, at) => at !== index))}>
                      {t('builder.participants.remove')}
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!readOnly && (
        <div className={styles.addParticipant}>
          <Select label={t('builder.participants.kind')} options={types.map((value) => ({ value, label: t(`builder.participants.signerTypes.${value}`) }))} value={type} onChange={(event) => setType(event.target.value as SignerType)} />
          <TextField label={t('builder.participants.signerLabel')} maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} />
          {type === 'USER' ? (
            <PersonPicker label={t('builder.participants.person')} actionLabel={t('builder.participants.add')} actionLabelNamed={(name) => t('builder.participants.addNamed', { name })} onPick={(person) => add({ signerType: 'USER', userId: person.userId, label: labelValue })} />
          ) : type === 'POSITION' ? (
            <div className={styles.addExit}>
              <Select
                label={t('builder.participants.record')}
                placeholder={t('builder.participants.recordPlaceholder')}
                options={records.POSITION.filter((record) => record.isActive).map((record) => ({ value: record.id, label: record.name }))}
                value={positionId}
                onChange={(event) => setPositionId(event.target.value)}
              />
              <Button disabled={positionId === '' || pending} onClick={() => add({ signerType: 'POSITION', positionId, label: labelValue })}>
                {t('builder.participants.add')}
              </Button>
            </div>
          ) : (
            <div>
              <Button disabled={pending} onClick={() => add({ signerType: type, label: labelValue })}>
                {t('builder.participants.add')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
