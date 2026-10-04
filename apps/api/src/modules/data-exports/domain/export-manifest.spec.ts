import { describe, expect, it } from 'vitest';
import { buildManifest, EXPORT_FORMAT_VERSION, exportCounts, renderReadme } from './export-manifest.js';

const input = {
  exportId: 'e1',
  tenant: { id: 't1', name: 'Acme', slug: 'acme' },
  generatedAt: new Date('2026-10-04T12:30:00Z'),
  includeFiles: true,
  datasets: { tickets: 3, members: 2 },
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
      files: 4,
      missingFiles: [{ fileId: 'f9', name: 'lost.pdf', reason: 'MISSING' }],
    });
  });

  it('stores whole numbers only in the counts', () => {
    expect(exportCounts(buildManifest(input))).toEqual({ tickets: 3, members: 2, files: 4, missing_files: 1 });
  });

  it('explains the archive in Spanish, with the missing files or the absence of files', () => {
    const readme = renderReadme(buildManifest(input));
    expect(readme).toContain('Exportación de datos de «Acme»');
    expect(readme).toContain('Generada el 2026-10-04 12:30:00 (hora UTC).');
    expect(readme).toContain('1 archivo no se encontró');
    expect(readme).toContain('\r\n');
    expect(renderReadme(buildManifest({ ...input, includeFiles: false, missingFiles: [] }))).toContain('sin archivos');
  });
});
