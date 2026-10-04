import { describe, expect, it } from 'vitest';
import { issueDataExportDownloadSchema, requestDataExportSchema } from './schemas.js';

describe('requestDataExportSchema', () => {
  it('needs the current password and includes the files unless told otherwise', () => {
    expect(requestDataExportSchema.parse({ currentPassword: 'secret' })).toEqual({ currentPassword: 'secret', includeFiles: true });
    expect(requestDataExportSchema.parse({ currentPassword: 'secret', includeFiles: false }).includeFiles).toBe(false);
    expect(requestDataExportSchema.safeParse({ includeFiles: true }).success).toBe(false);
    expect(requestDataExportSchema.safeParse({ currentPassword: '' }).success).toBe(false);
    expect(requestDataExportSchema.safeParse({ currentPassword: 'x'.repeat(129) }).success).toBe(false);
  });
});

describe('issueDataExportDownloadSchema', () => {
  it('needs the current password', () => {
    expect(issueDataExportDownloadSchema.parse({ currentPassword: 'secret' })).toEqual({ currentPassword: 'secret' });
    expect(issueDataExportDownloadSchema.safeParse({}).success).toBe(false);
    expect(issueDataExportDownloadSchema.safeParse({ currentPassword: '' }).success).toBe(false);
  });
});
