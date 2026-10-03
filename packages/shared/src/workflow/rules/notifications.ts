import { validateExpressionText } from '../../pdf/validate-pdf-sources.js';
import { expandNotificationText } from '../notification-text.js';
import { type RuleContext } from './context.js';

/**
 * NOTIFICATION blocks: the subject and the body are expressions (`{{ticket.number}}`, `{{field.CODE}}`, `{{CODE}}`…).
 * A text that does not parse or names a step that is not there is an error; a field that is not there is a warning
 * (the placeholder renders empty), like in the other templates of a block.
 */
export function checkNotifications(context: RuleContext): void {
  const { doc, problems } = context;
  for (const step of doc.steps.filter((candidate) => candidate.type === 'NOTIFICATION')) {
    const unknownFields = new Set<string>();
    for (const part of ['subject', 'body'] as const) {
      const text = step.config[part];
      if (typeof text !== 'string') continue;
      for (const problem of validateExpressionText(expandNotificationText(text), part, doc)) {
        if (problem.code === 'DOCUMENT_FIELD_UNKNOWN') unknownFields.add(problem.detail ?? '');
        else problems.error('NOTIFICATION_TEXT_INVALID', { stepId: step.id, params: { part, reason: problem.code, detail: problem.detail ?? '' } });
      }
    }
    if (unknownFields.size > 0) problems.warning('TEMPLATE_UNKNOWN_FIELD', { stepId: step.id, params: { codes: [...unknownFields] } });
  }
}
