import { z } from 'zod';

const schema = z.object({
  /** Where the deployed API answers (through the reverse proxy, as users reach it). */
  BASE_URL: z.url(),
  /** The mail catcher of the environment (Mailpit's HTTP address); the invitation e-mail is read from it. */
  MAILPIT_URL: z.url().default('http://mailpit:8025'),
  /** A login of `app_platform`: creates the smoke administrator and removes everything at the end. */
  SMOKE_DATABASE_URL: z.string().min(1),
  /** Plan of the smoke organization. */
  SMOKE_PLAN_CODE: z.string().min(1).default('professional'),
  /** The same variables the API and the worker use: the smoke organization's files are removed from the bucket at the end. */
  STORAGE_ENDPOINT: z.url(),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_BUCKET: z.string().min(3),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export type SmokeConfig = z.infer<typeof schema>;

export function loadSmokeConfig(env: NodeJS.ProcessEnv): SmokeConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid smoke configuration: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  return parsed.data;
}
