import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '@/shared/ui';
import { AdminError } from './AdminError';
import styles from './Admin.module.css';

export interface AdminDialogProps {
  readonly title: string;
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly error: unknown;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** Create or edit one record of the catalog: its fields, why the API refused it, and Cancel / Save. */
export function AdminDialog({ title, submitLabel, pending, error, onSubmit, onClose, children }: AdminDialogProps) {
  const { t } = useTranslation('admin');
  return (
    <Dialog
      open
      title={title}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) onSubmit();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('dialog.cancel')}</Button>
          <Button type="submit" variant="brand" disabled={pending}>
            {pending ? t('dialog.saving') : submitLabel}
          </Button>
        </>
      }
    >
      <div className={styles.dialogFields}>
        {children}
        <AdminError error={error} />
      </div>
    </Dialog>
  );
}
