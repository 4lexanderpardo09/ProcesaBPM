import { type FormEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './Dialog.module.css';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  /** Escape, the close button or a parent decision: the parent hides the dialog. */
  readonly onClose: () => void;
  /** When given, the body is a form and its submit button lives in `footer`. */
  readonly onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  readonly footer: ReactNode;
  readonly closeLabel: string;
  readonly children: ReactNode;
  /** `wide` for content that needs room, such as a table. */
  readonly size?: 'default' | 'wide';
}

/**
 * A modal over the page on the native `<dialog>`: the browser traps the focus, makes the rest inert and closes it
 * with Escape. Use it for a decision or a short form; the page behind does not change until it is confirmed.
 */
export function Dialog({ open, title, onClose, onSubmit, footer, closeLabel, children, size = 'default' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const body = (
    <>
      <div className={styles.body}>{children}</div>
      <footer className={styles.footer}>{footer}</footer>
    </>
  );
  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, size === 'wide' && styles.wide)}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <header className={styles.header}>
            <h2 id={titleId} className={cx('text-card-title', styles.title)}>
              {title}
            </h2>
            <button type="button" className={styles.close} aria-label={closeLabel} onClick={onClose}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          {onSubmit === undefined ? (
            body
          ) : (
            <form className={styles.form} onSubmit={onSubmit} noValidate>
              {body}
            </form>
          )}
        </>
      )}
    </dialog>
  );
}
