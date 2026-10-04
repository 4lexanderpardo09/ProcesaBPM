import { renderEmail } from '../../../infrastructure/mail/layout.js';
import { formatNoticeDate, type RenderedMail } from '../../auth/domain/auth-email-templates.js';
import { authMailEs } from '../../auth/i18n/es.js';
import { dataExportsEs as es } from '../i18n/es.js';

export interface DataExportReadyInput {
  readonly firstName: string;
  readonly organization: string;
  readonly expiresAt: Date;
  readonly timeZone: string | null;
  /** The export page of the app; never the archive (the download asks for the password again). */
  readonly pageUrl: string;
}

export function renderDataExportReadyEmail(input: DataExportReadyInput): RenderedMail {
  const t = es.readyMail;
  return {
    subject: t.subject,
    ...renderEmail({
      title: t.title,
      greeting: t.greeting(input.firstName),
      paragraphs: [t.ready(input.organization), t.expires(formatNoticeDate(input.expiresAt, input.timeZone)), t.how],
      action: { label: t.action, url: input.pageUrl },
      footer: authMailEs.footerAutomatic,
    }),
  };
}
