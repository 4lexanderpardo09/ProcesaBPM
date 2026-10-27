import { parseBlockConfig, type StepType } from '@procesabpm/shared';
import { sanitizeOptionalRichText } from '../../../infrastructure/text/rich-text.js';

interface StepContent {
  readonly type: StepType;
  readonly description?: string | null;
  readonly config: Record<string, unknown>;
}

/**
 * What every write of a block stores: the instructions with only the formatting the API allows (they are shown
 * on the ticket and copied into answers), and the config normalized (defaults applied) when valid, or as sent
 * for the validator to report.
 */
export function normalizeStepContent(step: StepContent): { description: string | null; config: Record<string, unknown> } {
  const parsed = parseBlockConfig(step.type, step.config);
  return { description: sanitizeOptionalRichText(step.description ?? undefined), config: parsed.valid ? parsed.config : step.config };
}
