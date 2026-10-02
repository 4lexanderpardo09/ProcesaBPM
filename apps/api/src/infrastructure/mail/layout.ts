import { html, SafeHtml } from './html.js';

export interface EmailContent {
  readonly title: string;
  readonly greeting: string;
  readonly paragraphs: readonly string[];
  readonly action?: { readonly label: string; readonly url: string };
  readonly footer: string;
}

/** The plain-text and HTML versions of one message. All text is escaped in the HTML; the text version is raw. */
export function renderEmail(content: EmailContent): { html: string; text: string } {
  const paragraphs = content.paragraphs.map((paragraph) => html`<p style="margin:0 0 16px">${paragraph}</p>`.value).join('');
  const button =
    content.action === undefined
      ? ''
      : html`<p style="margin:24px 0"><a href="${content.action.url}" style="background:#2563eb;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${content.action.label}</a></p><p style="margin:0 0 16px;font-size:13px;color:#555555">${content.action.url}</p>`.value;
  const document = html`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${content.title}</title></head><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b"><div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:8px"><h1 style="margin:0 0 24px;font-size:20px">${content.title}</h1><p style="margin:0 0 16px">${content.greeting}</p>${new SafeHtml(paragraphs)}${new SafeHtml(button)}<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0"><p style="margin:0;font-size:12px;color:#71717a">${content.footer}</p></div></body></html>`;
  const text = [content.title, '', content.greeting, '', ...content.paragraphs.flatMap((paragraph) => [paragraph, '']), ...(content.action === undefined ? [] : [`${content.action.label}: ${content.action.url}`, '']), '--', content.footer].join('\n');
  return { html: document.value, text };
}
