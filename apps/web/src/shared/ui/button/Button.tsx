import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';
import { cx } from '@/shared/lib/cx';

/**
 * `primary` is the screen's main action (accent), `brand` the main action of a form (navy),
 * `secondary` everything else and `ghost` low-emphasis actions.
 */
export type ButtonVariant = 'primary' | 'brand' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly icon?: ReactNode;
}

export function Button({ variant = 'secondary', icon, type = 'button', className, children, ...props }: ButtonProps) {
  const classes = cx(styles.button, styles[variant], className);
  return (
    <button type={type} className={classes} {...props}>
      {icon}
      {children}
    </button>
  );
}
