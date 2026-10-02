import { describe, expect, it } from 'vitest';
import { diffFieldFiles, findRepeatedFiles } from './field-file-changes.js';

describe('diffFieldFiles', () => {
  it('reports added and removed ids of the fields the submission carried', () => {
    expect(diffFieldFiles(['A', 'B'], { A: ['x', 'y'] }, { A: ['y', 'z'], B: ['q'] })).toEqual([{ fieldCode: 'A', added: ['x'], removed: ['z'] }]);
  });
  it('ignores a field whose files did not change and one that was not sent', () => {
    expect(diffFieldFiles(['A', 'B'], { A: ['x'] }, { A: ['x'], B: ['q'] })).toEqual([]);
  });
  it('treats a field with no stored value as empty', () => {
    expect(diffFieldFiles(['A'], { A: ['x'] }, {})).toEqual([{ fieldCode: 'A', added: ['x'], removed: [] }]);
  });
});

describe('findRepeatedFiles', () => {
  it('flags a file used by two fields or by a field and an attachment', () => {
    const changes = [{ fieldCode: 'A', added: ['x'], removed: [] }, { fieldCode: 'B', added: ['x', 'y'], removed: [] }];
    expect(findRepeatedFiles(changes, ['y'])).toEqual([
      { code: 'FILE_NOT_ATTACHABLE', fieldCode: 'B' },
      { code: 'FILE_NOT_ATTACHABLE', fieldCode: 'B' },
    ]);
    expect(findRepeatedFiles([{ fieldCode: 'A', added: ['x'], removed: [] }], ['y'])).toEqual([]);
  });
});
