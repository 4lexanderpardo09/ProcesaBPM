import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { es } from './es';

export const DEFAULT_NAMESPACE = 'common';

void i18n.use(initReactI18next).init({
  lng: 'es',
  fallbackLng: 'es',
  resources: { es },
  defaultNS: DEFAULT_NAMESPACE,
  interpolation: { escapeValue: false },
  initAsync: false,
});

export { i18n };
