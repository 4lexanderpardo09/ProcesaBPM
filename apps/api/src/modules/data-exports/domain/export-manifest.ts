import { dataExportsEs as es } from '../i18n/es.js';
import { EXPORT_GROUPS } from './export-datasets.js';

export const EXPORT_FORMAT_VERSION = 1;

export interface ExportOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface MissingFile {
  readonly fileId: string;
  readonly name: string;
  /** `MISSING`: not in the storage; `TOO_LARGE`: bigger than any file the application accepts. */
  readonly reason: 'MISSING' | 'TOO_LARGE';
}

export interface ExportManifest {
  readonly formatVersion: number;
  readonly exportId: string;
  readonly tenant: ExportOrganization;
  readonly generatedAt: string;
  readonly includeFiles: boolean;
  /** Rows per dataset. */
  readonly datasets: Readonly<Record<string, number>>;
  /** Files written under files/. */
  readonly files: number;
  readonly missingFiles: readonly MissingFile[];
}

export interface ManifestInput {
  readonly exportId: string;
  readonly tenant: ExportOrganization;
  readonly generatedAt: Date;
  readonly includeFiles: boolean;
  readonly datasets: Readonly<Record<string, number>>;
  readonly files: number;
  readonly missingFiles: readonly MissingFile[];
}

export function buildManifest(input: ManifestInput): ExportManifest {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportId: input.exportId,
    tenant: input.tenant,
    generatedAt: input.generatedAt.toISOString(),
    includeFiles: input.includeFiles,
    datasets: input.datasets,
    files: input.files,
    missingFiles: input.missingFiles,
  };
}

/** What `finish_tenant_export` stores: rows per dataset plus the files written and missing (whole numbers only). */
export function exportCounts(manifest: ExportManifest): Record<string, number> {
  return { ...manifest.datasets, files: manifest.files, missing_files: manifest.missingFiles.length };
}

/** LEEME.txt: what the archive holds and how to read it, in Spanish. CRLF so that every editor shows the lines. */
export function renderReadme(manifest: ExportManifest): string {
  const t = es.readme;
  const lines = [
    t.title(manifest.tenant.name),
    t.generatedAt(manifest.generatedAt.replace('T', ' ').slice(0, 19)),
    '',
    t.intro,
    '',
    t.contentsTitle,
    ...t.contents.map((item) => `- ${item}`),
    '',
    t.groupsTitle,
    ...EXPORT_GROUPS.map((group) => `- ${t.groups[group]}`),
    '',
    t.excluded,
  ];
  if (!manifest.includeFiles) lines.push('', t.withoutFiles);
  else if (manifest.missingFiles.length > 0) lines.push('', t.missingFiles(manifest.missingFiles.length));
  return `${lines.join('\r\n')}\r\n`;
}
