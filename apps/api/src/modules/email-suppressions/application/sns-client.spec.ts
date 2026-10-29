import { describe, expect, it, vi } from 'vitest';
import { SnsClient } from './sns-client.js';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-1.pem';

describe('SnsClient', () => {
  it('fetches a certificate once and keeps it, without following redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response(PEM));
    const client = new SnsClient(fetchImpl as unknown as typeof fetch);
    expect(await client.certificate(CERT_URL)).toBe(PEM);
    expect(await client.certificate(CERT_URL)).toBe(PEM);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(CERT_URL, expect.objectContaining({ redirect: 'error' }));
  });

  it('never calls an address that is not SNS’s, and refuses an answer that is not a certificate', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>not a certificate</html>'));
    const client = new SnsClient(fetchImpl as unknown as typeof fetch);
    await expect(client.certificate('https://evil.example/cert.pem')).rejects.toThrow('Not an SNS address');
    await expect(client.confirmSubscription('https://evil.example/confirm')).rejects.toThrow('Not an SNS address');
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(client.certificate(CERT_URL)).rejects.toThrow('Not an SNS signing certificate');
    const failing = new SnsClient((async () => new Response('', { status: 404 })) as unknown as typeof fetch);
    await expect(failing.confirmSubscription('https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription')).rejects.toThrow('HTTP 404');
  });
});
