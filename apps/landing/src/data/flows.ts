/** The diagrams drawn on the page with the builder's node look. Positions are percentages of the canvas. */
export type BlockType = 'start' | 'end' | 'step' | 'approval' | 'decision' | 'condition' | 'document' | 'notification';

export interface FlowNodeSpec {
  readonly id: string;
  readonly type: BlockType;
  readonly name: string;
  readonly status: string;
  readonly left: number;
  readonly top: number;
}

export interface FlowEdgeSpec {
  readonly from: string;
  readonly to: string;
  readonly kind?: 'retry' | 'effect';
  readonly label?: string;
  /** A label in the warning colors (a return path). */
  readonly warn?: boolean;
}

export interface FlowSpec {
  readonly nodes: readonly FlowNodeSpec[];
  readonly edges: readonly FlowEdgeSpec[];
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  start: 'Inicio',
  end: 'Fin',
  step: 'Paso',
  approval: 'Aprobación',
  decision: 'Decisión',
  condition: 'Condición',
  document: 'Documento',
  notification: 'Notificación',
};

/** «Compra de insumos médicos»: a condition on the quoted amount picks the route. */
export const AMOUNT_RULE_FLOW: FlowSpec = {
  nodes: [
    { id: 'q', type: 'step', name: 'Cotización', status: 'Tomás Trujillo', left: 3, top: 10 },
    { id: 'c', type: 'condition', name: '¿Supera 10 millones?', status: 'Valor cotizado', left: 37, top: 10 },
    { id: 'g', type: 'approval', name: 'Gerencia', status: 'Firma requerida', left: 71, top: 10 },
    { id: 'p', type: 'step', name: 'Pedido al proveedor', status: 'Compras', left: 37, top: 46 },
    { id: 'r', type: 'step', name: 'Recepción en almacén', status: 'Bruno Bedoya', left: 71, top: 46 },
    { id: 'f', type: 'end', name: 'Cerrado', status: '—', left: 71, top: 78 },
  ],
  edges: [
    { from: 'q', to: 'c' },
    { from: 'c', to: 'g', label: 'Más de 10 M' },
    { from: 'c', to: 'p', label: 'Monto normal' },
    { from: 'g', to: 'p', label: 'Aprobado' },
    { from: 'p', to: 'r' },
    { from: 'r', to: 'f' },
    { from: 'r', to: 'p', kind: 'retry', label: 'Llegó incompleto', warn: true },
  ],
};

/** The draft the assistant builds from the sales team's description. */
export const AI_DRAFT_FLOW: FlowSpec = {
  nodes: [
    { id: 'a', type: 'start', name: 'Nueva cotización', status: 'Ventas', left: 4, top: 8 },
    { id: 'b', type: 'step', name: 'Armar cotización', status: 'Ventas', left: 37, top: 8 },
    { id: 'c', type: 'decision', name: '¿Más de $20 M?', status: 'Total', left: 70, top: 8 },
    { id: 'd', type: 'approval', name: 'Gerencia', status: 'Rol', left: 70, top: 42 },
    { id: 'e', type: 'document', name: 'Cotización PDF', status: 'Formato', left: 37, top: 42 },
    { id: 'g', type: 'notification', name: 'Avisar al cliente', status: 'Correo', left: 37, top: 75 },
    { id: 'f', type: 'end', name: 'Enviada', status: '—', left: 4, top: 42 },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd', label: 'Sí' },
    { from: 'c', to: 'e', label: 'No' },
    { from: 'd', to: 'e' },
    { from: 'e', to: 'f' },
    { from: 'e', to: 'g', kind: 'effect' },
  ],
};

/** The amount above which the purchase goes through management (the condition of AMOUNT_RULE_FLOW). */
export const AMOUNT_RULE_THRESHOLD = 10_000_000;
