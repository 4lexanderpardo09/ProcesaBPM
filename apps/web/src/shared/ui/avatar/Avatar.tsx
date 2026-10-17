import styles from './Avatar.module.css';
import { initialsOf } from './initials';
import { cx } from '@/shared/lib/cx';

export interface AvatarProps {
  readonly name: string;
  readonly size?: 'sm' | 'md';
}

/** Initials in a circle. The name is announced by the text next to it, so the avatar itself is decorative. */
export function Avatar({ name, size = 'sm' }: AvatarProps) {
  return (
    <span className={cx(styles.avatar, styles[size])} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}
