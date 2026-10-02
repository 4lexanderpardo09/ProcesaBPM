const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

/** Markup that is already safe: produced by `html` or by the layout, never from user input. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Template tag: every interpolated value is escaped unless it is itself `SafeHtml`. */
export function html(strings: TemplateStringsArray, ...values: Array<string | number | SafeHtml>): SafeHtml {
  return new SafeHtml(strings.reduce((result, part, index) => result + part + (index < values.length ? render(values[index]!) : ''), ''));
}

const render = (value: string | number | SafeHtml): string => (value instanceof SafeHtml ? value.value : escapeHtml(String(value)));

/** A header value without line breaks (header injection) and with a sane length. */
export const singleLine = (value: string, max = 150): string => value.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
