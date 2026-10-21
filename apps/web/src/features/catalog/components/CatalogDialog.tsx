import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '@/shared/ui';
import { CatalogError } from './CatalogError';
import styles from './Catalog.module.css';

export interface CatalogDialogProps {
  readonly title: string;
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly error: unknown;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** Create or edit one record of the catalog: its fields, why the API refused it, and Cancel / Save. */
export function CatalogDialog({ title, submitLabel, pending, error, onSubmit, onClose, children }: CatalogDialogProps) {
  const { t } = useTranslation('catalog');
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
        <CatalogError error={error} />
      </div>
    </Dialog>
  );
}
