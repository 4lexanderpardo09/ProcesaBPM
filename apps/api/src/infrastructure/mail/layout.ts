import { html, SafeHtml } from './html.js';

/** What the message is about: it colours the label above the title and the highlighted note. */
export type EmailTone = 'info' | 'warning' | 'danger';

/** One row of the key-data band (the date, the IP, the organization): `mono` for values read character by character. */
export interface EmailFact {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

export interface EmailContent {
  readonly title: string;
  readonly greeting: string;
  readonly paragraphs: readonly string[];
  readonly action?: { readonly label: string; readonly url: string };
  readonly footer: string;
  /** A short label above the title («Seguridad de la cuenta»). */
  readonly overline?: string;
  readonly tone?: EmailTone;
  readonly facts?: readonly EmailFact[];
  /** The one line that must not be missed (the expiry, «si no fuiste tú…»), in a box of the tone's colour. */
  readonly note?: string;
  /** Lines after the button: what to do if the message was not expected. */
  readonly closing?: readonly string[];
}

/**
 * The design system's colours (docs/diseno/tokens.css), written out: mail clients ignore CSS variables and most of
 * <style>, so every rule is inline and the layout is tables (Outlook renders with Word).
 */
const COLOR = {
  bg: '#f5f6f8',
  surface: '#ffffff',
  surface2: '#f8fafc',
  line: '#e4e7ec',
  line2: '#eef1f5',
  ink: '#0b1220',
  navy: '#16233a',
  slate: '#475569',
  muted: '#64748b',
  accentLine: '#bae6fd',
} as const;
const TONES: Readonly<Record<EmailTone, { readonly ink: string; readonly bg: string; readonly line: string }>> = {
  info: { ink: '#075985', bg: '#eff8ff', line: '#bae6fd' },
  warning: { ink: '#b45309', bg: '#fffbeb', line: '#fde68a' },
  danger: { ink: '#be123c', bg: '#fff1f2', line: '#fecdd3' },
};
const SANS = `'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const MONO = `'IBM Plex Mono',SFMono-Regular,Menlo,Consolas,monospace`;
const LINK_HINT = '¿El botón no funciona? Copia y pega este enlace en tu navegador:';

const joined = (parts: readonly SafeHtml[]): SafeHtml => new SafeHtml(parts.map((part) => part.value).join(''));

/** The logo without an image (many inboxes block images by default): the three blocks of the mark and the wordmark. */
function brandBar(): SafeHtml {
  const block = (fill: string) => html`<td width="8" height="8" style="width:8px;height:8px;background:${fill};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>`;
  const gap = html`<td width="8" height="8" style="width:8px;height:8px;font-size:0;line-height:0">&nbsp;</td>`;
  const mark = html`<table role="presentation" cellpadding="0" cellspacing="2" border="0"><tr>${block('#ffffff')}${gap}</tr><tr>${gap}${block('#ffffff')}</tr><tr>${block(COLOR.accentLine)}${gap}</tr></table>`;
  return html`<tr><td style="background:${COLOR.navy};border-radius:14px 14px 0 0;padding:18px 28px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:12px;vertical-align:middle">${mark}</td><td style="vertical-align:middle;font-family:${SANS};font-size:18px;font-weight:800;letter-spacing:-0.02em;color:#ffffff">Procesa<span style="color:${COLOR.accentLine}">BPM</span></td></tr></table></td></tr>`;
}

function factsBand(facts: readonly EmailFact[]): SafeHtml {
  const rows = facts.map((fact, index) => {
    const divider = index > 0 ? `border-top:1px solid ${COLOR.line2};` : '';
    return html`<tr><td style="${divider}padding:12px 16px;width:38%;vertical-align:top;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${COLOR.muted}">${fact.label}</td><td style="${divider}padding:12px 16px;vertical-align:top;word-break:break-word;font-family:${fact.mono === true ? MONO : SANS};font-size:14px;color:${COLOR.ink}">${fact.value}</td></tr>`;
  });
  return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border:1px solid ${COLOR.line};border-radius:10px;background:${COLOR.surface2};border-collapse:separate">${joined(rows)}</table>`;
}

function button(action: { readonly label: string; readonly url: string }): SafeHtml {
  return html`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px"><tr><td style="background:${COLOR.navy};border-radius:8px"><a href="${action.url}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${action.label}</a></td></tr></table><p style="margin:0 0 24px;font-family:${SANS};font-size:12px;line-height:1.5;color:${COLOR.muted}">${LINK_HINT}<br><span style="font-family:${MONO};color:${TONES.info.ink};word-break:break-all">${action.url}</span></p>`;
}

/**
 * The plain-text and HTML versions of one message, in the product's look: navy brand bar, white card, key data in a
 * band and one navy button. All text is escaped in the HTML; the text version is raw.
 */
export function renderEmail(content: EmailContent): { html: string; text: string } {
  const tone = TONES[content.tone ?? 'info'];
  const paragraph = (text: string) => html`<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:${COLOR.slate}">${text}</p>`;
  const overline =
    content.overline === undefined ? '' : html`<p style="margin:0 0 8px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${tone.ink}">${content.overline}</p>`;
  const facts = content.facts === undefined || content.facts.length === 0 ? '' : factsBand(content.facts);
  const note =
    content.note === undefined
      ? ''
      : html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr><td style="padding:14px 16px;background:${tone.bg};border:1px solid ${tone.line};border-radius:10px;font-family:${SANS};font-size:14px;line-height:1.5;font-weight:600;color:${tone.ink}">${content.note}</td></tr></table>`;
  const action = content.action === undefined ? '' : button(content.action);
  const closing = joined((content.closing ?? []).map((text) => html`<p style="margin:0 0 12px;font-family:${SANS};font-size:13px;line-height:1.6;color:${COLOR.muted}">${text}</p>`));
  // What the inbox shows next to the subject: the first sentence, not the greeting.
  const preview = content.paragraphs[0] ?? content.note ?? '';
  const card = html`<tr><td style="background:${COLOR.surface};border:1px solid ${COLOR.line};border-top:none;border-radius:0 0 14px 14px;padding:32px 28px 20px">${overline}<h1 style="margin:0 0 20px;font-family:${SANS};font-size:22px;line-height:1.3;font-weight:800;letter-spacing:-0.02em;color:${COLOR.ink}">${content.title}</h1>${paragraph(content.greeting)}${joined(content.paragraphs.map(paragraph))}${facts}${note}${action}${closing}</td></tr>`;
  const footer = html`<tr><td style="padding:20px 28px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${COLOR.muted}">${content.footer}<br><span style="font-weight:700;color:${COLOR.navy}">ProcesaBPM</span></td></tr>`;
  const document = html`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${content.title}</title></head><body style="margin:0;padding:0;background:${COLOR.bg}"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preview}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.bg}"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">${brandBar()}${card}${footer}</table></td></tr></table></body></html>`;
  const text = [
    ...(content.overline === undefined ? [] : [content.overline.toUpperCase()]),
    content.title,
    '',
    content.greeting,
    '',
    ...content.paragraphs.flatMap((line) => [line, '']),
    ...(content.facts === undefined || content.facts.length === 0 ? [] : [...content.facts.map((fact) => `${fact.label}: ${fact.value}`), '']),
    ...(content.note === undefined ? [] : [content.note, '']),
    ...(content.action === undefined ? [] : [`${content.action.label}: ${content.action.url}`, '']),
    ...(content.closing ?? []).flatMap((line) => [line, '']),
    '--',
    content.footer,
  ].join('\n');
  return { html: document.value, text };
}
