import type { DemoTeamSize } from '@procesabpm/shared';

export const demoRequestMailEs = {
  subject: 'Nuevo pedido de demo desde el sitio web',
  title: 'Nuevo pedido de demo',
  overline: 'Sitio web',
  greeting: 'Hola,',
  who: (fullName: string, company: string) => `${fullName}, de ${company}, pidió una demo de ProcesaBPM.`,
  labels: { name: 'Nombre', company: 'Empresa', email: 'Correo', teamSize: 'Personas', process: 'Proceso', sentAt: 'Enviado' },
  noProcess: 'No indicó qué proceso quiere ver.',
  when: (date: string) => `${date} (hora de Bogotá)`,
  reply: 'Responde a este correo para escribirle directamente. Cuando le escribas, márcalo como contactado en la consola de plataforma.',
  footer: 'Mensaje automático de ProcesaBPM.',
  teamSizes: { UNDER_20: 'menos de 20', FROM_20_TO_100: '20 a 100', FROM_101_TO_500: '101 a 500', OVER_500: 'más de 500' } satisfies Record<DemoTeamSize, string>,
} as const;
