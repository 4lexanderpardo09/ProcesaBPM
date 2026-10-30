import { z } from 'zod';

/**
 * Zod validates without compiling code at run time. Its compiled mode evaluates strings as JavaScript, which the app's
 * Content-Security-Policy (script-src 'self', no 'unsafe-eval') refuses: in report-only it floods the console, and
 * enforced it makes zod fall back anyway. Imported first, before any schema is used.
 */
z.config({ jitless: true });
