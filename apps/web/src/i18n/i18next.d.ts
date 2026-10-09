import 'i18next';
import type { es } from './es';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: typeof es;
  }
}
