import { describe, expect, it } from 'vitest';
import { buildManifest, EXPORT_FORMAT_VERSION, exportCounts, renderReadme } from './export-manifest.js';

const input = {
  exportId: 'e1',
  tenant: { id: 't1', name: 'Acme', slug: 'acme' },
  generatedAt: new Date('2026-10-04T12:30:00Z'),
  includeFiles: true,
  datasets: { tickets: 3, members: 2 },
  csv: { tickets: 3 },
  files: 4,
  missingFiles: [{ fileId: 'f9', name: 'lost.pdf', reason: 'MISSING' as const }],
};

describe('export manifest', () => {
  it('describes the archive', () => {
    expect(buildManifest(input)).toEqual({
      formatVersion: EXPORT_FORMAT_VERSION,
      exportId: 'e1',
      tenant: { id: 't1', name: 'Acme', slug: 'acme' },
      generatedAt: '2026-10-04T12:30:00.000Z',
      includeFiles: true,
      datasets: { tickets: 3, members: 2 },
      csv: { tickets: 3 },
      files: 4,
      missingFiles: [{ fileId: 'f9', name: 'lost.pdf', reason: 'MISSING' }],
    });
  });

  it('stores whole numbers only in the counts', () => {
    expect(exportCounts(buildManifest(input))).toEqual({ tickets: 3, members: 2, files: 4, missing_files: 1 });
  });

  it('explains the archive in Spanish, before anything is counted', () => {
    const readme = renderReadme({ tenant: input.tenant, generatedAt: input.generatedAt, includeFiles: true });
    expect(readme).toContain('Exportación de datos de «Acme»');
    expect(readme).toContain('Generada el 2026-10-04 12:30:00 (hora UTC).');
    expect(readme).toContain('manifest.json (al final del archivo)');
    expect(readme).toContain('missingFiles');
    expect(readme).toContain('\r\n');
    expect(renderReadme({ tenant: input.tenant, generatedAt: input.generatedAt, includeFiles: false })).toContain('sin archivos');
  });
});
