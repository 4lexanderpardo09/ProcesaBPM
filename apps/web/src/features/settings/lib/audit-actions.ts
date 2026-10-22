import type { TFunction } from 'i18next';

/**
 * The Spanish name of an audit action (`role.updated` → "Editó un rol"). The names are read as one object: an action
 * has a dot in it, which i18next would take as a nested key. One without a name shows its subject and verb
 * ("role · updated"), so a new action is never hidden.
 */
export function actionLabel(action: string, t: TFunction<'settings'>): string {
  const names = t('audit.actions', { returnObjects: true }) as Readonly<Record<string, string>>;
  const known = names[action];
  if (known !== undefined) return known;
  const [subject = action, verb = ''] = action.split('.');
  return verb === '' ? subject : `${subject} · ${verb}`;
}
