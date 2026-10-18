import { useMemo } from 'react';
import styles from './QrCode.module.css';
import { qrMatrixOf } from './qr-path';

export interface QrCodeProps {
  readonly value: string;
  readonly label: string;
  readonly size?: number;
}

export function QrCode({ value, label, size = 176 }: QrCodeProps) {
  const matrix = useMemo(() => qrMatrixOf(value), [value]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${matrix.size} ${matrix.size}`} className={styles.qr}>
      <path d={matrix.path} className={styles.modules} />
    </svg>
  );
}
