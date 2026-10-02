/** Limits of the PDF module, shared by the API (preview) and the worker (generation). */
export const PDF_LIMITS = {
  /** A template PDF is uploaded like any user file (4 MB); it can have this many pages. */
  maxTemplatePages: 50,
  maxIndirectObjects: 100_000,
  /** What a generated document may have. */
  maxPages: 200,
  maxOutputBytes: 20 * 1024 * 1024,
  maxTableRows: 2000,
  maxTableColumns: 12,
  maxCellLines: 20,
  maxBlocks: 200,
  maxExpressionLength: 2000,
  maxPlaceholders: 50,
  maxMappedFields: 500,
  maxMappedSignatures: 100,
  maxSignatureImageBytes: 1024 * 1024,
  defaultRenderTimeoutMs: 30_000,
  maxRenderTimeoutMs: 120_000,
} as const;
