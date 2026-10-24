import type { FormEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '@/shared/ui';
import { ActionError } from './ActionError';

export interface ActionDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly error: unknown;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly children?: ReactNode;
  /** `wide` for an answer with room to write (the step's instructions, a long note). */
  readonly size?: 'default' | 'wide';
}

/** The frame every ticket action shares: its fields, why it failed, and Cancel / confirm (the form's main action, navy). */
export function ActionDialog({ open, title, submitLabel, pending, error, onSubmit, onClose, children, size = 'default' }: ActionDialogProps) {
  const { t } = useTranslation('tickets');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pending) onSubmit();
  };
  return (
    <Dialog
      open={open}
      title={title}
      closeLabel={t('actions.dismiss')}
      onClose={onClose}
      onSubmit={submit}
      size={size}
      footer={
        <>
          <Button onClick={onClose}>{t('actions.cancel')}</Button>
          <Button type="submit" variant="brand" disabled={pending}>
            {pending ? t('actions.sending') : submitLabel}
          </Button>
        </>
      }
    >
      {children}
      {error !== null && error !== undefined && <ActionError error={error} />}
    </Dialog>
  );
}
