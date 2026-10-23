import { useTranslation } from 'react-i18next';

const MINUTES_PER_HOUR = 60;
/** A business day of the default calendar, to read long times in days. */
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** Business minutes as people read them: minutes, hours and minutes, or days and hours. */
export function useFormatMinutes(): (minutes: number | null) => string {
  const { t } = useTranslation('reports');
  return (minutes) => {
    if (minutes === null) return t('none');
    const whole = Math.round(minutes);
    if (whole < MINUTES_PER_HOUR) return t('minutes.minutes', { m: whole });
    if (whole < MINUTES_PER_DAY) return t('minutes.hours', { h: Math.floor(whole / MINUTES_PER_HOUR), m: whole % MINUTES_PER_HOUR });
    return t('minutes.days', { d: Math.floor(whole / MINUTES_PER_DAY), h: Math.floor((whole % MINUTES_PER_DAY) / MINUTES_PER_HOUR) });
  };
}

export const formatPct = (value: number | null): string => (value === null ? '–' : `${value.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`);
export const formatCount = (value: number): string => value.toLocaleString('es-CO');
