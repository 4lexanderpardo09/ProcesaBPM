import { Injectable } from '@nestjs/common';
import { isSnsUrl } from '../domain/sns-message.js';

const TIMEOUT_MS = 5_000;
const MAX_CERTIFICATE_BYTES = 16 * 1024;
const CACHED_CERTIFICATES = 20;

/**
 * The two calls this endpoint makes to SNS: fetch the certificate a message was signed with (kept in memory: SNS rotates
 * them rarely) and confirm a subscription. Both only ever go to an HTTPS address on an SNS regional host.
 */
@Injectable()
export class SnsClient {
  private readonly certificates = new Map<string, string>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async certificate(url: string): Promise<string> {
    const cached = this.certificates.get(url);
    if (cached !== undefined) return cached;
    const pem = await this.get(url);
    if (pem.length > MAX_CERTIFICATE_BYTES || !pem.trimStart().startsWith('-----BEGIN CERTIFICATE-----')) throw new Error('Not an SNS signing certificate');
    if (this.certificates.size >= CACHED_CERTIFICATES) this.certificates.delete(this.certificates.keys().next().value!);
    this.certificates.set(url, pem);
    return pem;
  }

  async confirmSubscription(subscribeUrl: string): Promise<void> {
    await this.get(subscribeUrl);
  }

  private async get(url: string): Promise<string> {
    if (!isSnsUrl(url)) throw new Error('Not an SNS address');
    const response = await this.fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`SNS answered HTTP ${response.status}`);
    return response.text();
  }
}
