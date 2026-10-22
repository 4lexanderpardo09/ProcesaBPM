import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';
import { type UploadRoutes, uploadFiles } from '@/shared/files/upload-files';

export const tenantLogoQueryKey = ['organization', 'logo'] as const;

const logoSchema = z.object({ url: z.string(), expiresAt: z.string() });
export type TenantLogo = z.infer<typeof logoSchema>;

/** The organization's logo (a short-lived link), or null when it has none. Settings and the PDF designer show it. */
export function tenantLogoQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: tenantLogoQueryKey,
    // "None" comes back as an empty body, which the client reads as `undefined`.
    queryFn: ({ signal }) => client.request('/settings/logo', { schema: logoSchema.nullish().transform((logo) => logo ?? null), signal }),
    // The link lasts 15 minutes: ask again before it runs out.
    staleTime: 10 * 60_000,
  });
}

/** The logo is uploaded under the permission to change settings, not the ticket ones. */
export const LOGO_UPLOAD_ROUTES: UploadRoutes = { request: '/settings/logo/uploads', confirm: (fileId) => `/settings/logo/uploads/${encodeURIComponent(fileId)}/confirm` };

export async function uploadTenantLogo(client: HttpClient, file: File): Promise<void> {
  const [stored] = await uploadFiles(client, [file], fetch, LOGO_UPLOAD_ROUTES);
  if (stored !== undefined) await client.request('/settings/logo', { method: 'PUT', body: { fileId: stored.id }, schema: logoSchema });
}

export function removeTenantLogo(client: HttpClient) {
  return client.request('/settings/logo', { method: 'DELETE' });
}

/** What the documents can draw: PNG or JPEG, up to 1 MB (a larger image would be left out of the PDF). */
export const PDF_IMAGE_TYPES = ['image/png', 'image/jpeg'];
export const PDF_IMAGE_MAX_BYTES = 1024 * 1024;
