import type { ExportSchedule } from '@procesabpm/shared';
import type { TFunction } from 'i18next';

/** "Cada lunes y jueves a las 17:00": the schedule of a cutoff as people say it. */
export function scheduleText(t: TFunction<'workflows'>, schedule: ExportSchedule): string {
  const time = schedule.cutoffTime;
  switch (schedule.frequency) {
    case 'WEEKLY': {
      const names = [...schedule.weekdays].sort().map((day) => t(`exports.schedule.weekdays.${String(day) as '1'}`));
      const days = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')}${t('exports.schedule.and')}${names.at(-1)!}`;
      return t('exports.schedule.WEEKLY', { days, time });
    }
    case 'MONTHLY':
      return t('exports.schedule.MONTHLY', { day: schedule.monthDay ?? 1, time });
    case 'EVERY_N_DAYS':
      return t('exports.schedule.EVERY_N_DAYS', { count: schedule.intervalDays ?? 1, time });
    default:
      return t('exports.schedule.DAILY', { time });
  }
}
