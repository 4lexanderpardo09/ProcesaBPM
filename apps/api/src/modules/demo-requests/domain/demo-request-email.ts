import type { DemoTeamSize } from '@procesabpm/shared';
import { renderEmail } from '../../../infrastructure/mail/layout.js';
import { demoRequestMailEs as es } from '../i18n/es.js';

export interface DemoRequestMailInput {
  readonly fullName: string;
  readonly company: string;
  readonly email: string;
  readonly teamSize: DemoTeamSize;
  readonly process: string | null;
  readonly createdAt: Date;
}

/** To the sales inbox. The subject carries no name: subjects show up in lock screens and logs. */
export function renderDemoRequestEmail(input: DemoRequestMailInput): { subject: string; html: string; text: string } {
  const when = input.createdAt.toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });
  return {
    subject: es.subject,
    ...renderEmail({
      overline: es.overline,
      title: es.title,
      greeting: es.greeting,
      paragraphs: [es.who(input.fullName, input.company)],
      facts: [
        { label: es.labels.name, value: input.fullName },
        { label: es.labels.company, value: input.company },
        { label: es.labels.email, value: input.email },
        { label: es.labels.teamSize, value: es.teamSizes[input.teamSize] },
        { label: es.labels.process, value: input.process ?? es.noProcess },
        { label: es.labels.sentAt, value: es.when(when) },
      ],
      note: es.reply,
      footer: es.footer,
    }),
  };
}
