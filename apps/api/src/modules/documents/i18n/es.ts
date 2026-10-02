/** Text printed in generated documents (what the end user reads). */
export const documentsEs = {
  ticketStatus: { OPEN: 'Abierto', PAUSED: 'En pausa', CLOSED: 'Cerrado' } as const,
  signedBy: (name: string, date: string): string => `Firmado por ${name} · ${date}`,
  pendingSignature: (label: string): string => `Pendiente: ${label}`,
  total: 'Total',
  rows: (count: number): string => `${count} ${count === 1 ? 'fila' : 'filas'}`,
  files: (names: readonly string[]): string => names.join(', '),
  defaultFileName: (ticketNumber: string): string => `ticket-${ticketNumber}`,
  previewTicket: { title: 'Ticket de ejemplo', companyName: 'Empresa de ejemplo', creatorName: 'Nombre de ejemplo', stepName: 'Paso de ejemplo' },
} as const;
