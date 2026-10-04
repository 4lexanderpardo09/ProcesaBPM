// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
export const MAX_EXPORTED_FILE_NAME = 120;
const MAX_EXTENSION = 16;

function truncate(name: string, max: number): string {
  const characters = Array.from(name);
  if (characters.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? Array.from(name.slice(dot)) : [];
  if (extension.length === 0 || extension.length > MAX_EXTENSION) return characters.slice(0, max).join('');
  return characters.slice(0, max - extension.length).join('') + extension.join('');
}

/**
 * A name a person gave a file, made safe as one path segment in any operating system: no separators or characters
 * Windows refuses, no `..`, no leading or trailing dots or spaces, at most 120 characters (the extension kept).
 */
export function sanitizeExportedFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(UNSAFE_CHARACTERS, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const bounded = truncate(cleaned, MAX_EXPORTED_FILE_NAME).replace(/[.\s]+$/g, '');
  if (bounded === '') return 'file';
  return WINDOWS_RESERVED.test(bounded) ? `_${bounded}` : bounded;
}

/** `files/<file id>/<name>`: the id keeps names from colliding and nothing can leave the folder. */
export function exportedFilePath(fileId: string, originalName: string): string {
  return `files/${fileId}/${sanitizeExportedFileName(originalName)}`;
}
