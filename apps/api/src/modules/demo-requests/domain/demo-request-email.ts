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
      title: es.title,
      greeting: es.greeting,
      paragraphs: [
        es.who(input.fullName, input.company),
        es.contact(input.email),
        es.teamSize(es.teamSizes[input.teamSize]),
        input.process === null ? es.noProcess : es.process(input.process),
        es.when(when),
        es.reply,
      ],
      footer: es.footer,
    }),
  };
}
