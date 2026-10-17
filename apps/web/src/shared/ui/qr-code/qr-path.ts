import { encode } from 'uqr';

export interface QrMatrix {
  readonly size: number;
  /** One SVG path with a 1×1 square per dark module. */
  readonly path: string;
}

/** Encodes the text into a QR matrix in the browser: the value (an `otpauth://` URI) carries a secret and never leaves the page. */
export function qrMatrixOf(value: string): QrMatrix {
  const { size, data } = encode(value, { ecc: 'M', border: 2 });
  const squares: string[] = [];
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) squares.push(`M${x} ${y}h1v1h-1z`);
    }),
  );
  return { size, path: squares.join('') };
}
