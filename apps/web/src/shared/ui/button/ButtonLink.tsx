import type { ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from '@/shared/lib/cx';
import type { ButtonVariant } from './Button';
import styles from './Button.module.css';

export interface ButtonLinkProps extends LinkProps {
  readonly variant?: ButtonVariant;
  readonly icon?: ReactNode;
}

/** Navigation that looks like a button ("Nuevo ticket"): a real link, so it opens in a new tab and reads as a link. */
export function ButtonLink({ variant = 'secondary', icon, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={cx(styles.button, styles[variant], className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}
