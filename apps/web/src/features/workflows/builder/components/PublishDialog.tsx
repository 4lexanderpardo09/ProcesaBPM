import type { WorkflowValidation } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dialog, TextArea } from '@/shared/ui';
import { problemText } from '../lib/problems';
import styles from './Builder.module.css';

export interface PublishDialogProps {
  readonly number: number;
  readonly dirty: boolean;
  readonly validation: WorkflowValidation;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onPublish: (notes: string | undefined) => void;
  readonly onClose: () => void;
}

/** Confirms the publication: what it means, the warnings it will carry, and optional notes. Errors keep it closed. */
export function PublishDialog({ number, dirty, validation, pending, error, onPublish, onClose }: PublishDialogProps) {
  const { t } = useTranslation('workflows');
  const { t: tProblems } = useTranslation(['workflowProblems', 'workflows']);
  const [notes, setNotes] = useState('');
  const blocked = validation.errors.length > 0;
  return (
    <Dialog
      open
      title={t('builder.publishDialog.title', { number })}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked && !pending) onPublish(notes.trim() === '' ? undefined : notes.trim());
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={blocked || pending}>
            {pending ? t('saving') : t('builder.publishDialog.confirm')}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        {blocked ? (
          <Alert tone="danger">{t('builder.publishDialog.hasErrors')}</Alert>
        ) : (
          <>
            <p className={styles.note}>{t('builder.publishDialog.body')}</p>
            {dirty && <p className={styles.note}>{t('builder.publishDialog.saveFirst')}</p>}
            {validation.warnings.length > 0 && (
              <div>
                <p className={styles.note}>{t('builder.publishDialog.warnings')}</p>
                <ul className={styles.problemItems}>
                  {validation.warnings.map((problem, index) => (
                    <li key={`${problem.code}-${String(index)}`} className={`${styles.problemItem} ${styles.problemWarning}`}>
                      {problemText(problem, tProblems)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <TextArea label={t('builder.publishDialog.notes')} maxLength={2000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </>
        )}
        {error !== undefined && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
