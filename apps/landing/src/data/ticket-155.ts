/**
 * Ticket #155 «Anticipo feria Expoagro» of the test organization «procesa», as its activity recorded it. `x`/`y` place each
 * step on the flow map screenshot (0–1). Two steps left no comment; their text is a description (`described`) and the page says so.
 */
export interface JourneyStop {
  readonly x: number;
  readonly y: number;
  readonly step: string;
  /** Who acted, as HTML with the name in <b>. */
  readonly who: string;
  readonly initials: string;
  readonly text: string;
  readonly described?: boolean;
  readonly files?: readonly string[];
  /** What the ticket's key-data band shows while it is at this step: current step and who has it. */
  readonly band: readonly [step: string, holder: string];
}

export const TICKET = {
  number: 155,
  title: 'Anticipo feria Expoagro: stand y material',
  requester: 'Andrés Arango',
  company: 'Distribuidora del Valle',
  amount: '$2.000.000',
} as const;

export const JOURNEY: readonly JourneyStop[] = [
  { x: 0.069, y: 0.156, step: 'Inicio · Solicitar anticipo', who: '<b>Andrés Arango</b> creó el ticket', initials: 'AA', text: 'Detalle: stand, material POP y transporte para la feria. Valor: $2.000.000.', files: ['cotizacion-stand-feria.pdf'], band: ['Anticipo de compras', 'Jorge Jaramillo'] },
  { x: 0.147, y: 0.153, step: 'Paso · Anticipo de compras', who: '<b>Jorge Jaramillo</b> avanzó con «Siguiente»', initials: 'JJ', text: 'Aprobado. Que se vea bien el stand.', band: ['Revisión contable del anticipo', 'Camilo Cuesta'] },
  { x: 0.225, y: 0.153, step: 'Paso · Revisión contable del anticipo', who: '<b>Camilo Cuesta</b> avanzó con «Siguiente»', initials: 'CC', text: 'Cotización y presupuesto revisados.', band: ['Contabilización del anticipo', 'Carla Castro'] },
  { x: 0.303, y: 0.153, step: 'Paso · Contabilización del anticipo', who: '<b>Carla Castro</b> avanzó con «Siguiente»', initials: 'CC', text: 'Contabilizado.', band: ['Caja (desembolso del anticipo)', 'Carlos Cano'] },
  { x: 0.381, y: 0.153, step: 'Paso · Caja', who: '<b>Carlos Cano</b> avanzó con «Siguiente»', initials: 'CC', text: 'Entregados $2.000.000 en efectivo.', band: ['Creador del proceso', 'Andrés Arango'] },
  { x: 0.461, y: 0.148, step: 'Paso · Legalización', who: '<b>Andrés Arango</b> legalizó con tres facturas', initials: 'AA', text: 'Legalizo: gasté $1.850.000. Devuelvo $150.000.', files: ['factura-stand.pdf', 'factura-material-pop.pdf', 'factura-transporte.pdf'], band: ['Revisión contable de la legalización', 'Contabilidad'] },
  { x: 0.539, y: 0.322, step: 'Paso · Revisión contable de la legalización', who: '<b>Contabilidad</b> revisó las facturas', initials: 'CO', text: 'Revisa las tres facturas contra lo entregado y pasa a contabilizar la legalización.', described: true, band: ['Contabilización de la legalización', 'Carla Castro'] },
  { x: 0.776, y: 0.415, step: 'Paso · Saldo a favor de la empresa', who: '<b>Carla Castro</b> contabilizó y eligió a Carlos Cano', initials: 'CC', text: 'Quedan $150.000 a favor de la empresa.', band: ['Saldo a favor de la empresa', 'Carlos Cano'] },
  { x: 0.923, y: 0.531, step: 'Fin · Cerrado', who: '<b>Carlos Cano</b> recibió el saldo y cerró', initials: 'CC', text: 'Anticipo, legalización y saldo quedan en un mismo registro.', described: true, band: ['Cerrado', '—'] },
];
