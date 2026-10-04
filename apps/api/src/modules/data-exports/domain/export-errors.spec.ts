import { StorageUnavailableError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { ExportInconsistentError, ExportLeaseLostError, ExportStoppedError, ExportTimeoutError, ExportTooLargeError, exportFailureOf } from './export-errors.js';

describe('exportFailureOf', () => {
  it('maps each known failure to its stored code and whether to retry', () => {
    expect(exportFailureOf(new ExportTooLargeError())).toEqual({ code: 'EXPORT_TOO_LARGE', retry: 'never' });
    expect(exportFailureOf(new ExportTimeoutError())).toEqual({ code: 'EXPORT_TIMEOUT', retry: 'never' });
    expect(exportFailureOf(new ExportLeaseLostError())).toEqual({ code: 'LEASE_LOST', retry: 'later' });
    expect(exportFailureOf(new ExportStoppedError())).toEqual({ code: 'WORKER_STOPPED', retry: 'soon' });
    expect(exportFailureOf(new ExportInconsistentError())).toEqual({ code: 'EXPORT_INCONSISTENT', retry: 'later' });
    expect(exportFailureOf(new StorageUnavailableError())).toEqual({ code: 'STORAGE_UNAVAILABLE', retry: 'later' });
  });

  it('never stores a message: anything else is a generic code', () => {
    expect(exportFailureOf(new Error('row of tenant x with secret y'))).toEqual({ code: 'EXPORT_FAILED', retry: 'later' });
    for (const code of ['EXPORT_TOO_LARGE', 'EXPORT_FAILED', 'WORKER_STOPPED']) expect(code).toMatch(/^[A-Z_]{3,64}$/);
  });
});
