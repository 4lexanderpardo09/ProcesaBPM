import { createVerify } from 'node:crypto';

/** The SNS message types this endpoint handles; the rest (UnsubscribeConfirmation) is acknowledged and ignored. */
export type SnsMessageType = 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';

export interface SnsMessage {
  readonly Type: SnsMessageType;
  readonly MessageId: string;
  readonly TopicArn: string;
  readonly Message: string;
  readonly Timestamp: string;
  readonly SignatureVersion: '1' | '2';
  readonly Signature: string;
  readonly SigningCertURL: string;
  readonly Subject?: string;
  readonly SubscribeURL?: string;
  readonly Token?: string;
}

/** Why a message is refused: the endpoint answers 400 (or 403 for a foreign topic) without saying more. */
export type SnsRefusal = 'MALFORMED' | 'FOREIGN_TOPIC' | 'BAD_CERT_URL' | 'BAD_SIGNATURE' | 'STALE';

/** SNS signs with certificates it serves from its own regional host, over HTTPS (sns.<region>.amazonaws.com). */
const SNS_HOST = /^sns\.[a-z]{2}(-gov)?-[a-z]+-\d\.amazonaws\.com$/;
/** A notification older than this is refused even when its signature is good: a replayed message. */
export const SNS_MAX_AGE_MS = 60 * 60 * 1000;

const FIELDS_SIGNED: Readonly<Record<SnsMessageType, readonly (keyof SnsMessage)[]>> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** The SNS envelope from the request body (SNS posts JSON as text/plain), or `undefined` when it is not one. */
export function parseSnsMessage(body: unknown): SnsMessage | undefined {
  let value: unknown = body;
  if (typeof body === 'string') {
    try {
      value = JSON.parse(body) as unknown;
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const message = value as Record<string, unknown>;
  if (!(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'] as const).includes(message.Type as SnsMessageType)) return undefined;
  if (message.SignatureVersion !== '1' && message.SignatureVersion !== '2') return undefined;
  for (const field of ['MessageId', 'TopicArn', 'Message', 'Timestamp', 'Signature', 'SigningCertURL'] as const) if (!isText(message[field])) return undefined;
  if (message.Type !== 'Notification' && (!isText(message.SubscribeURL) || !isText(message.Token))) return undefined;
  if (message.Subject !== undefined && typeof message.Subject !== 'string') return undefined;
  return message as unknown as SnsMessage;
}

/** Whether a URL is an HTTPS address on an SNS regional host (where certificates and confirmations live). */
export function isSnsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.port === '' && parsed.username === '' && SNS_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** What SNS signed: each signed field present, as `name\nvalue\n`, in this order (AWS: "Verifying the signatures of Amazon SNS messages"). */
export function stringToSign(message: SnsMessage): string {
  return FIELDS_SIGNED[message.Type]
    .filter((field) => message[field] !== undefined)
    .map((field) => `${field}\n${message[field]}\n`)
    .join('');
}

/** SignatureVersion 1 is SHA1withRSA, 2 is SHA256withRSA, over the string to sign, with the certificate's public key. */
export function hasValidSignature(message: SnsMessage, certificatePem: string): boolean {
  try {
    const verifier = createVerify(message.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
    verifier.update(stringToSign(message), 'utf8');
    return verifier.verify(certificatePem, message.Signature, 'base64');
  } catch {
    return false;
  }
}

/** Checks everything but the signature itself: the topic is ours, the certificate is SNS's, the message is recent. */
export function precheck(message: SnsMessage, topicArn: string, now: Date): SnsRefusal | undefined {
  if (message.TopicArn !== topicArn) return 'FOREIGN_TOPIC';
  if (!isSnsUrl(message.SigningCertURL) || !new URL(message.SigningCertURL).pathname.endsWith('.pem')) return 'BAD_CERT_URL';
  if (message.SubscribeURL !== undefined && !isSnsUrl(message.SubscribeURL)) return 'BAD_CERT_URL';
  const sent = Date.parse(message.Timestamp);
  if (Number.isNaN(sent) || Math.abs(now.getTime() - sent) > SNS_MAX_AGE_MS) return 'STALE';
  return undefined;
}
