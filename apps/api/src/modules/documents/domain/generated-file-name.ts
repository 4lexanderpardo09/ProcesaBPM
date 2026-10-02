import { sanitizeFileName } from '../../files/domain/file-name.js';

const MAX_BASE_LENGTH = 120;
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

/** `<name>.pdf`: no path separators or characters Windows refuses, and never empty. */
export function generatedFileName(base: string, fallback: string): string {
  const cleaned = sanitizeFileName(base).replace(UNSAFE, '-').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, MAX_BASE_LENGTH).trim();
  return `${cleaned === '' ? fallback : cleaned}.pdf`;
}
