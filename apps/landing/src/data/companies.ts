/** Demo companies of the test organization «procesa»; each brings its own brand color (it replaces only the accent). */
export const COMPANIES = [
  { code: 'DV', name: 'Distribuidora del Valle', color: '#0369a1', tint: '#eff8ff' },
  { code: 'SL', name: 'Clínica Santa Lucía', color: '#be123c', tint: '#fff1f2' },
  { code: 'DP', name: 'Dispomédica del Pacífico', color: '#047857', tint: '#ecfdf5' },
] as const;

export const INBOX_SAMPLE = [
  { number: 155, title: 'Anticipo feria Expoagro', badge: 'b-acc', state: 'Caja' },
  { number: 151, title: 'Reembolso de gastos de viaje', badge: 'b-warn', state: 'Por vencer' },
  { number: 148, title: 'Pago de arrendamiento', badge: 'b-ok', state: 'Cerrado' },
] as const;
