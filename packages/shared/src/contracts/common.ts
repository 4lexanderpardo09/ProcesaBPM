import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
