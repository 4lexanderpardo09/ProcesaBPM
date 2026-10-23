import { describe, expect, it } from 'vitest';
import { diffFieldFiles, type FileField, findRepeatedFiles } from './field-file-changes.js';

const file = (code: string): FileField => ({ code, type: 'FILE', config: {} });

describe('diffFieldFiles', () => {
  it('reports added and removed ids of the fields the submission carried', () => {
    expect(diffFieldFiles([file('A'), file('B')], { A: ['x', 'y'] }, { A: ['y', 'z'], B: ['q'] })).toEqual([{ fieldCode: 'A', added: ['x'], removed: ['z'] }]);
  });
  it('ignores a field whose files did not change and one that was not sent', () => {
    expect(diffFieldFiles([file('A'), file('B')], { A: ['x'] }, { A: ['x'], B: ['q'] })).toEqual([]);
  });
  it('treats a field with no stored value as empty', () => {
    expect(diffFieldFiles([file('A')], { A: ['x'] }, {})).toEqual([{ fieldCode: 'A', added: ['x'], removed: [] }]);
  });
  it('counts the files of every row of a table under the table, and a row that goes takes its files', () => {
    const table: FileField = { code: 'T', type: 'TABLE', config: { columns: [{ code: 'NAME', type: 'TEXT' }, { code: 'PROOF', type: 'FILE' }] } };
    expect(diffFieldFiles([table], { T: [{ NAME: 'a', PROOF: ['x'] }, { NAME: 'b', PROOF: ['y'] }] }, { T: [{ NAME: 'a', PROOF: ['x'] }, { NAME: 'c', PROOF: ['z'] }] })).toEqual([{ fieldCode: 'T', added: ['y'], removed: ['z'] }]);
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
