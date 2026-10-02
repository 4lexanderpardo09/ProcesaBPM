// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** The name as shown to people: normalized (NFC) and without control characters. It is never part of a storage key. */
export function sanitizeFileName(name: string): string {
  return name.normalize('NFC').replace(CONTROL_CHARACTERS, '').trim();
}
