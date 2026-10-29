import { describe, expect, it } from 'vitest';
import { snsTestSigner } from '../../../../test/support/sns-test-signer.js';
import { hasValidSignature, isSnsUrl, parseSnsMessage, precheck, SNS_MAX_AGE_MS, stringToSign } from './sns-message.js';

const TOPIC = 'arn:aws:sns:us-east-1:123456789012:procesabpm-ses-events';
const signer = snsTestSigner(TOPIC);

describe('SNS messages', () => {
  it('builds the string to sign with the fields AWS lists, in order, skipping a missing Subject', () => {
    const message = signer.sign({ Type: 'Notification', Message: '{"a":1}', MessageId: 'm-1', Timestamp: '2026-10-28T10:00:00.000Z' });
    expect(stringToSign(message)).toBe(`Message\n{"a":1}\nMessageId\nm-1\nTimestamp\n2026-10-28T10:00:00.000Z\nTopicArn\n${TOPIC}\nType\nNotification\n`);
    const confirmation = signer.sign({ Type: 'SubscriptionConfirmation', Message: 'confirm', MessageId: 'm-2', Timestamp: 't', SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription', Token: 'tok' });
    expect(stringToSign(confirmation)).toBe(`Message\nconfirm\nMessageId\nm-2\nSubscribeURL\nhttps://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription\nTimestamp\nt\nToken\ntok\nTopicArn\n${TOPIC}\nType\nSubscriptionConfirmation\n`);
  });

  it.each(['1', '2'] as const)('accepts signature version %s, and refuses any change to what was signed', (version) => {
    const message = signer.sign({ Type: 'Notification', Message: '{"notificationType":"Bounce"}', Subject: 'Amazon SES Email Event Notification' }, version);
    expect(hasValidSignature(message, signer.publicKeyPem)).toBe(true);
    expect(hasValidSignature({ ...message, Message: '{"notificationType":"Complaint"}' }, signer.publicKeyPem)).toBe(false);
    expect(hasValidSignature({ ...message, SignatureVersion: version === '1' ? '2' : '1' }, signer.publicKeyPem)).toBe(false);
    expect(hasValidSignature(message, snsTestSigner(TOPIC).publicKeyPem)).toBe(false);
    expect(hasValidSignature({ ...message, Signature: 'not base64 at all' }, signer.publicKeyPem)).toBe(false);
  });

  it('reads the envelope from text or an object, and nothing else', () => {
    const message = signer.sign({ Type: 'Notification', Message: 'x' });
    expect(parseSnsMessage(JSON.stringify(message))).toEqual(message);
    expect(parseSnsMessage(message)).toEqual(message);
    for (const bad of ['not json', '[]', JSON.stringify({ ...message, Type: 'Other' }), JSON.stringify({ ...message, SignatureVersion: '3' }), JSON.stringify({ ...message, Signature: '' })]) {
      expect(parseSnsMessage(bad)).toBeUndefined();
    }
    expect(parseSnsMessage(JSON.stringify({ ...message, Type: 'SubscriptionConfirmation' }))).toBeUndefined();
  });

  it('only trusts HTTPS addresses on an SNS regional host', () => {
    for (const url of ['https://sns.us-east-1.amazonaws.com/cert.pem', 'https://sns.eu-central-1.amazonaws.com/x.pem', 'https://sns.us-gov-west-1.amazonaws.com/x.pem']) expect(isSnsUrl(url), url).toBe(true);
    for (const url of [
      'http://sns.us-east-1.amazonaws.com/cert.pem',
      'https://sns.us-east-1.amazonaws.com.evil.example/cert.pem',
      'https://evil.example/sns.us-east-1.amazonaws.com/cert.pem',
      'https://s3.amazonaws.com/cert.pem',
      'https://sns.us-east-1.amazonaws.com:8443/cert.pem',
      'https://user@sns.us-east-1.amazonaws.com/cert.pem',
      'not a url',
    ]) {
      expect(isSnsUrl(url), url).toBe(false);
    }
  });

  it('refuses another topic, a certificate that is not SNS’s, and a message too old or from the future', () => {
    const now = new Date();
    const message = signer.sign({ Type: 'Notification', Message: 'x', Timestamp: now.toISOString() });
    expect(precheck(message, TOPIC, now)).toBeUndefined();
    expect(precheck(message, 'arn:aws:sns:us-east-1:123456789012:other', now)).toBe('FOREIGN_TOPIC');
    expect(precheck({ ...message, SigningCertURL: 'https://evil.example/cert.pem' }, TOPIC, now)).toBe('BAD_CERT_URL');
    expect(precheck({ ...message, SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.txt' }, TOPIC, now)).toBe('BAD_CERT_URL');
    expect(precheck({ ...message, SubscribeURL: 'https://evil.example/confirm' }, TOPIC, now)).toBe('BAD_CERT_URL');
    expect(precheck(message, TOPIC, new Date(now.getTime() + SNS_MAX_AGE_MS + 1_000))).toBe('STALE');
    expect(precheck(message, TOPIC, new Date(now.getTime() - SNS_MAX_AGE_MS - 1_000))).toBe('STALE');
  });
});
