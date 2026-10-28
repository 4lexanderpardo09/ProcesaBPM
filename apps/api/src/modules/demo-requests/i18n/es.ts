import type { DemoTeamSize } from '@procesabpm/shared';

export const demoRequestMailEs = {
  subject: 'Nuevo pedido de demo desde el sitio web',
  title: 'Nuevo pedido de demo',
  greeting: 'Hola,',
  who: (fullName: string, company: string) => `${fullName}, de ${company}, pidió una demo de ProcesaBPM.`,
  contact: (email: string) => `Correo: ${email}`,
  teamSize: (size: string) => `Personas que lo usarían: ${size}`,
  process: (process: string) => `Proceso que quiere ver: ${process}`,
  noProcess: 'No indicó qué proceso quiere ver.',
  when: (date: string) => `Lo envió el ${date} (hora de Bogotá).`,
  reply: 'Responde a este correo para escribirle directamente. Cuando le escribas, márcalo como contactado en la consola de plataforma.',
  footer: 'Mensaje automático de ProcesaBPM.',
  teamSizes: { UNDER_20: 'menos de 20', FROM_20_TO_100: '20 a 100', FROM_101_TO_500: '101 a 500', OVER_500: 'más de 500' } satisfies Record<DemoTeamSize, string>,
} as const;
