import { z } from 'zod';
import { type CanvasStyle, defaultCanvasStyle, type PdfCanvasDesign, pdfCanvasDesignSchema } from './canvas-schema.js';

/** What a format's decisions are about, for the summary shown after Jiro designs one. */
export const FORMAT_DECISION_TOPICS = ['LAYOUT', 'FIELDS', 'TABLES', 'SIGNATURES', 'CALCULATIONS', 'IMAGES', 'PAGES'] as const;
export type FormatDecisionTopic = (typeof FORMAT_DECISION_TOPICS)[number];

export const FORMAT_DRAFT_LIMITS = { assumptions: 10, decisions: 10, text: 300 } as const;

export const formatDecisionSchema = z.object({ topic: z.enum(FORMAT_DECISION_TOPICS), text: z.string().trim().min(1).max(FORMAT_DRAFT_LIMITS.text) }).strict();
export type FormatDecision = z.infer<typeof formatDecisionSchema>;

/**
 * What the assistant answers when it designs a PDF format: the whole canvas design (version 2, the same document the
 * designer saves), what it assumed and its main choices. The design is checked like one saved by hand.
 */
export const formatDraftSpecSchema = z
  .object({
    design: pdfCanvasDesignSchema,
    assumptions: z.array(z.string().trim().min(1).max(FORMAT_DRAFT_LIMITS.text)).max(FORMAT_DRAFT_LIMITS.assumptions),
    decisions: z.array(formatDecisionSchema).max(FORMAT_DRAFT_LIMITS.decisions),
  })
  .strict();
export type FormatDraftSpec = z.infer<typeof formatDraftSpecSchema>;

type JsonObject = Record<string, unknown>;

/** The JSON Schema of the answer, for the tool the model calls (the zod schema is the one source of truth). */
export function buildFormatToolSchema(): JsonObject {
  const { $schema: _version, ...schema } = z.toJSONSchema(formatDraftSpecSchema, { io: 'input', unrepresentable: 'any' }) as JsonObject;
  return schema;
}

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fills what a model tends to leave out of an answer before it is checked: the defaults of an element (layer name,
 * sheet, no condition, not repeated, not locked), the style properties not given and missing ids. Anything else is left
 * as it came, for the schema to judge.
 */
export function completeFormatAnswer(answer: unknown): unknown {
  if (!isObject(answer) || !isObject(answer.design)) return answer;
  const design = answer.design;
  const style = (value: unknown): CanvasStyle | unknown => (value === undefined || isObject(value) ? { ...defaultCanvasStyle(), ...(value ?? {}) } : value);
  const used = new Set<string>();
  const elements = Array.isArray(design.elements)
    ? design.elements.map((element, index) => {
        if (!isObject(element)) return element;
        let id = typeof element.id === 'string' && element.id !== '' && !used.has(element.id) ? element.id : `e${index + 1}`;
        while (used.has(id)) id = `${id}_`;
        used.add(id);
        const filled: JsonObject = { name: '', repeat: false, locked: false, sheet: 0, condition: '', ...element, id, style: style(element.style) };
        if (element.type === 'table') filled.headerStyle = style(element.headerStyle);
        return filled;
      })
    : design.elements;
  return {
    ...answer,
    assumptions: answer.assumptions ?? [],
    decisions: answer.decisions ?? [],
    design: { sheets: [{ name: '', condition: '' }], calculations: [], ...design, version: 2, elements },
  };
}

export type { PdfCanvasDesign };
