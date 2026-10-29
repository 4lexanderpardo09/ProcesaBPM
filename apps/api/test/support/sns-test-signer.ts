import { createSign, generateKeyPairSync } from 'node:crypto';
import { type SnsMessage, stringToSign } from '../../src/modules/email-suppressions/domain/sns-message.js';

/** Test support: signs SNS messages the way SNS does, with a key of its own (its public key stands in for the certificate). */
export function snsTestSigner(topicArn: string): {
  readonly publicKeyPem: string;
  readonly certUrl: string;
  sign(fields: Partial<SnsMessage> & Pick<SnsMessage, 'Type' | 'Message'>, version?: '1' | '2'): SnsMessage;
} {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certUrl = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0000000000000000000000.pem';
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    certUrl,
    sign(fields, version = '2') {
      const unsigned = {
        MessageId: `msg-${Math.random().toString(36).slice(2)}`,
        TopicArn: topicArn,
        Timestamp: new Date().toISOString(),
        SignatureVersion: version,
        SigningCertURL: certUrl,
        Signature: '',
        ...fields,
      } as SnsMessage;
      const signer = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
      signer.update(stringToSign(unsigned), 'utf8');
      return { ...unsigned, Signature: signer.sign(privateKey, 'base64') };
    },
  };
}
