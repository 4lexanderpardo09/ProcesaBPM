import { createHash } from 'node:crypto';
import type { Member } from './ticket-world.js';

export const sha256Of = (content: Buffer): string => createHash('sha256').update(content).digest('hex');

/** A minimal but recognizable PDF: what matters is the first bytes. */
export const pdf = (text = 'hello'): Buffer => Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);
export const png = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake image body')]);

export interface UploadSlot {
  readonly fileId: string;
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
}

export interface FileToUpload {
  readonly name: string;
  readonly content: Buffer;
  /** Overrides what is declared to the API (to lie about the hash). */
  readonly declaredSha256?: string;
}

export const declare = (file: FileToUpload) => ({ name: file.name, sizeBytes: file.content.length, sha256: file.declaredSha256 ?? sha256Of(file.content) });

/** What the browser does with a slot: PUT the bytes with the signed headers (the length comes from the body). */
export async function putToStorage(slot: UploadSlot, content: Buffer): Promise<Response> {
  const { 'content-length': _fromBody, ...headers } = slot.headers;
  return fetch(slot.url, { method: slot.method, headers, body: new Uint8Array(content) });
}

export async function reserve(member: Member, files: readonly FileToUpload[]): Promise<UploadSlot[]> {
  const response = await member.client.post('/files/uploads', { files: files.map(declare) }).expect(201);
  return response.body.uploads as UploadSlot[];
}

/** Reserve, upload and confirm one file; returns its id. */
export async function uploadFile(member: Member, file: FileToUpload): Promise<string> {
  const [slot] = await reserve(member, [file]);
  const put = await putToStorage(slot!, file.content);
  if (!put.ok) throw new Error(`The test upload failed: ${put.status}`);
  await member.client.post(`/files/${slot!.fileId}/confirm`).expect(200);
  return slot!.fileId;
}
