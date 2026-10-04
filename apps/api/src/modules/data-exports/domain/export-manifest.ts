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
  /** Rows written per dataset (data/*.jsonl). */
  readonly datasets: Readonly<Record<string, number>>;
  /** Rows written per CSV (read again for the CSV: the counts can differ if the organization changed in between). */
  readonly csv: Readonly<Record<string, number>>;
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
  readonly csv: Readonly<Record<string, number>>;
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
    csv: input.csv,
    files: input.files,
    missingFiles: input.missingFiles,
  };
}

/** What `finish_tenant_export` stores: rows per dataset plus the files written and missing (whole numbers only). */
export function exportCounts(manifest: ExportManifest): Record<string, number> {
  return { ...manifest.datasets, files: manifest.files, missing_files: manifest.missingFiles.length };
}

export interface ReadmeInput {
  readonly tenant: ExportOrganization;
  readonly generatedAt: Date;
  readonly includeFiles: boolean;
}

/**
 * LEEME.txt, the first entry: what the archive holds and how to read it, in Spanish (the counts are in manifest.json, the
 * last entry). CRLF so that every editor shows the lines.
 */
export function renderReadme(input: ReadmeInput): string {
  const t = es.readme;
  const lines = [
    t.title(input.tenant.name),
    t.generatedAt(input.generatedAt.toISOString().replace('T', ' ').slice(0, 19)),
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
    '',
    t.consistency,
  ];
  lines.push('', input.includeFiles ? t.missingFiles : t.withoutFiles);
  return `${lines.join('\r\n')}\r\n`;
}
