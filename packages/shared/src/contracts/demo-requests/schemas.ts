import { z } from 'zod';
import { emailSchema } from '../common.js';
import { uuidSchema } from '../ids.js';

/** The privacy notice the website's form shows; bump it when its text changes, so each request records what was accepted. */
export const DEMO_PRIVACY_NOTICE_VERSION = 2;

export const DEMO_TEAM_SIZES = ['UNDER_20', 'FROM_20_TO_100', 'FROM_101_TO_500', 'OVER_500'] as const;
export type DemoTeamSize = (typeof DEMO_TEAM_SIZES)[number];

export const DEMO_REQUEST_STATUSES = ['NEW', 'CONTACTED', 'DISCARDED'] as const;
export type DemoRequestStatus = (typeof DEMO_REQUEST_STATUSES)[number];

/**
 * The website's demo form. `website` is a field people never see: a bot that fills every input fills it too, and the API
 * then answers as usual without storing anything. The same limits are CHECKs in the database.
 */
export const demoRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  company: z.string().trim().min(2).max(160),
  email: emailSchema,
  teamSize: z.enum(DEMO_TEAM_SIZES),
  process: z.string().trim().max(2000).optional(),
  privacyConsent: z.literal(true),
  website: z.string().max(200).optional(),
});
export type DemoRequest = z.infer<typeof demoRequestSchema>;

export const listDemoRequestsQuerySchema = z.object({
  status: z.enum(DEMO_REQUEST_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListDemoRequestsQuery = z.infer<typeof listDemoRequestsQuerySchema>;

export const demoRequestSummarySchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  company: z.string(),
  email: z.string(),
  teamSize: z.enum(DEMO_TEAM_SIZES),
  process: z.string().nullable(),
  status: z.enum(DEMO_REQUEST_STATUSES),
  handledBy: z.string().nullable(),
  handledAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DemoRequestSummary = z.infer<typeof demoRequestSummarySchema>;

/** A request is marked once someone wrote back (CONTACTED) or decided not to (DISCARDED); it never goes back to NEW. */
export const markDemoRequestSchema = z.object({ status: z.enum(['CONTACTED', 'DISCARDED']) });
export type MarkDemoRequest = z.infer<typeof markDemoRequestSchema>;
