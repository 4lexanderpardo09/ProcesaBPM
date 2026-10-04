import { describe, expect, it } from 'vitest';
import { readZip } from '../../../../test/support/zip-reader.js';
import { YazlZipArchiveFactory, type ZipSink } from '../../../infrastructure/archive/zip-archive.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { InMemoryObjectStorage } from '../../../infrastructure/storage/in-memory-object-storage.js';
import type { DataExportClaim } from '../data/data-export-claims.repository.js';
import type { ExportDataRepository, ExportFileRow, ExportRow } from '../data/export-data.repository.js';
import { EXPORT_DATASETS } from '../domain/export-datasets.js';
import { ExportBudget } from './export-budget.js';
import { EXPORT_MAX_FILE_BYTES, EXPORT_PAGE_SIZE, ExportArchiveBuilder } from './export-archive-builder.js';

const TENANT = '0199a8f0-0000-7000-8000-00000000000a';
const CLAIM: DataExportClaim = { tenantId: TENANT, exportId: '0199a8f0-0000-7000-8000-00000000000e', includeFiles: true, claimToken: 't', attempt: 1 };
const NOW = new Date('2026-10-04T10:00:00Z');
const file = (id: string, name: string): ExportFileRow => ({ id, storageKey: `tenants/${TENANT}/2026/10/${id}`, originalName: name, mimeType: 'application/pdf', sizeBytes: 3n, sha256: null, origin: 'USER', createdAt: NOW, ticketId: null, fieldCode: null, documentRole: null });

/** Serves `rows` per dataset in key order, one page per call, and the given files. */
class FakeData {
  readonly pageCalls: Array<{ dataset: string; after: unknown }> = [];
  constructor(
    private readonly rows: Record<string, ExportRow[]>,
    private readonly files: ExportFileRow[] = [],
    private readonly countDelta: Record<string, number> = {},
  ) {}
  async organization() {
    return { id: TENANT, name: 'Acme', slug: 'acme' };
  }
  async count(_tx: unknown, _tenant: string, dataset: string) {
    return (this.rows[dataset]?.length ?? 0) + (this.countDelta[dataset] ?? 0);
  }
  async page(_tx: unknown, tenantId: string, dataset: string, after: unknown[] | null, limit: number) {
    expect(tenantId).toBe(TENANT);
    this.pageCalls.push({ dataset, after });
    const all = this.rows[dataset] ?? [];
    const start = after === null ? 0 : all.findIndex((row) => row.id === after[0]) + 1;
    return all.slice(start, start + limit);
  }
  async filePage(_tx: unknown, _tenant: string, afterId: string, limit: number) {
    return this.files.filter((row) => row.id > afterId).slice(0, limit);
  }
}

class Sink implements ZipSink {
  readonly chunks: Uint8Array[] = [];
  async write(chunk: Uint8Array) {
    this.chunks.push(Buffer.from(chunk));
  }
}

const ticket = (n: number): ExportRow => ({ tenant_id: TENANT, id: `0199a8f0-0000-7000-8000-${String(n).padStart(12, '0')}`, title: n === 1 ? '=cmd|calc' : `Ticket ${n}` });

async function build(data: FakeData, storage = new InMemoryObjectStorage(), claim = CLAIM) {
  const runner = { withTenant: (_t: string, work: (tx: unknown) => Promise<unknown>) => work({}) };
  const builder = new ExportArchiveBuilder(runner as unknown as WorkerTransactionRunner, data as unknown as ExportDataRepository, storage, { now: () => NOW } as Clock);
  const sink = new Sink();
  const budget = new ExportBudget({ now: () => NOW } as Clock, NOW.getTime() + 60_000, 1e12, new AbortController().signal);
  const manifest = await builder.build(new YazlZipArchiveFactory().open(sink, { mtime: NOW }), claim, budget);
  return { manifest, entries: await readZip(Buffer.concat(sink.chunks)) };
}

describe('ExportArchiveBuilder', () => {
  it('writes the manifest and LEEME.txt first, then every dataset as JSONL (and CSV where decided), then the files', async () => {
    const storage = new InMemoryObjectStorage();
    storage.seed(file('0199a8f0-0000-7000-8000-0000000000f1', 'a.pdf').storageKey, Buffer.from('pdf'));
    const data = new FakeData({ tickets: [ticket(1), ticket(2)] }, [file('0199a8f0-0000-7000-8000-0000000000f1', '../a.pdf')]);
    const { entries, manifest } = await build(data, storage);
    const names = entries.map((entry) => entry.name);
    expect(names.slice(0, 2)).toEqual(['manifest.json', 'LEEME.txt']);
    expect(names).toContain('data/tickets.jsonl');
    expect(names).toContain('csv/tickets.csv');
    expect(names.filter((name) => name.startsWith('data/'))).toHaveLength(EXPORT_DATASETS.length);
    expect(names.slice(-2)).toEqual(['files/index.csv', 'files/0199a8f0-0000-7000-8000-0000000000f1/_a.pdf']);
    expect(JSON.parse(entries[0]!.content.toString())).toEqual(JSON.parse(JSON.stringify(manifest)));
    expect(manifest.datasets.tickets).toBe(2);
    expect(entries.find((entry) => entry.name === 'data/tickets.jsonl')!.content.toString().trim().split('\n').map((line) => JSON.parse(line).title)).toEqual(['=cmd|calc', 'Ticket 2']);
    const csv = entries.find((entry) => entry.name === 'csv/tickets.csv')!.content.toString('utf8');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain("'=cmd|calc");
    expect(entries.at(-1)!.content.toString()).toBe('pdf');
  });

  it('lists a missing or oversized object in the manifest and the index, and still finishes', async () => {
    const storage = new InMemoryObjectStorage();
    const present = file('0199a8f0-0000-7000-8000-0000000000f1', 'here.pdf');
    const absent = file('0199a8f0-0000-7000-8000-0000000000f2', 'gone.pdf');
    const huge = file('0199a8f0-0000-7000-8000-0000000000f3', 'huge.pdf');
    storage.seed(present.storageKey, Buffer.from('pdf'));
    storage.seed(huge.storageKey, new Uint8Array(EXPORT_MAX_FILE_BYTES + 1));
    const { manifest, entries } = await build(new FakeData({}, [present, absent, huge]), storage);
    expect(manifest.files).toBe(1);
    expect(manifest.missingFiles).toEqual([
      { fileId: absent.id, name: 'gone.pdf', reason: 'MISSING' },
      { fileId: huge.id, name: 'huge.pdf', reason: 'TOO_LARGE' },
    ]);
    const index = entries.find((entry) => entry.name === 'files/index.csv')!.content.toString().split('\r\n');
    expect(index.find((line) => line.startsWith(absent.id))).toMatch(/,false$/);
    expect(entries.filter((entry) => entry.name.startsWith('files/0199'))).toHaveLength(1);
  });

  it('pages by key, one page of 1000 rows at a time', async () => {
    const rows = Array.from({ length: EXPORT_PAGE_SIZE + 5 }, (_, index) => ticket(index + 10));
    const data = new FakeData({ tickets: rows });
    await build(data, undefined, { ...CLAIM, includeFiles: false });
    const calls = data.pageCalls.filter((call) => call.dataset === 'tickets');
    // JSONL and CSV: two pages each.
    expect(calls.map((call) => call.after)).toEqual([null, [rows[EXPORT_PAGE_SIZE - 1]!.id], null, [rows[EXPORT_PAGE_SIZE - 1]!.id]]);
  });

  it('fails as inconsistent when a dataset changed between its count and its rows', async () => {
    await expect(build(new FakeData({ tickets: [ticket(1)] }, [], { tickets: 1 }), undefined, { ...CLAIM, includeFiles: false })).rejects.toMatchObject({ code: 'EXPORT_INCONSISTENT' });
  });

  it('writes no files and no index without includeFiles', async () => {
    const { entries } = await build(new FakeData({}, [file('0199a8f0-0000-7000-8000-0000000000f1', 'a.pdf')]), undefined, { ...CLAIM, includeFiles: false });
    expect(entries.some((entry) => entry.name.startsWith('files/'))).toBe(false);
  });
});
