import { createHash, randomBytes } from 'node:crypto';
import { createPlatformAdmin } from '@procesabpm/db/seed/platform-admin';
import pg from 'pg';
import { base32Decode, stepOf, totpCode } from '../modules/auth/domain/totp.js';
import { ApiClient, sleep, text } from './api-client.js';
import { Mailbox, tokenFromMail } from './mailbox.js';
import { probeRealtime } from './realtime-probe.js';
import type { SmokeConfig } from './smoke-config.js';

/** Everything the smoke run creates is named so that it can be recognized (and only it removed) afterwards. */
export const SMOKE_TENANT_NAME = 'Smoke test (delete me)';
export const SMOKE_SLUG = /^smoke-[0-9a-f]{8}$/;
const PASSWORD = 'smoke-test password 7391 and more';

export interface SmokeState {
  adminUserId?: string;
  tenantId?: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const totpNow = (secret: string) => totpCode(base32Decode(secret), stepOf(Date.now()));
/** A password change is stamped with second resolution: tokens issued in the same second are void. */
const afterPasswordChange = () => sleep(1_200);

/**
 * The checks of a deployment, in order. Each public method is one step of `verify.sh`'s output: it either returns or
 * throws a message that says what was wrong. The state it leaves behind (`SmokeState`) is what the cleanup removes.
 */
export class SmokeRun {
  private readonly api: ApiClient;
  private readonly mailbox: Mailbox;
  private platformToken = '';
  private ownerToken = '';
  private readonly suffix = randomBytes(4).toString('hex');
  readonly state: SmokeState = {};
  readonly slug = `smoke-${this.suffix}`;
  private readonly adminEmail = `smoke-admin-${this.suffix}@smoke.invalid`;
  private readonly ownerEmail = `smoke-owner-${this.suffix}@smoke.invalid`;
  private subcategoryId = '';
  private transitions: string[] = [];
  private ticket: { id: string; openVisitId: string } | undefined;
  private fileId = '';
  private readonly fileContent = Buffer.from(`%PDF-1.4\nsmoke ${this.suffix}\n%%EOF`);

  constructor(private readonly config: SmokeConfig) {
    this.api = new ApiClient(config.BASE_URL);
    this.mailbox = new Mailbox(config.MAILPIT_URL);
  }

  async health(): Promise<void> {
    await this.api.expect(200, 'GET', '/health');
    await this.api.expect(200, 'GET', '/ready');
  }

  /** The command-line path of the first administrator, then password link, mandatory MFA enrollment and platform session. */
  async platformAdmin(): Promise<void> {
    const client = new pg.Client({ connectionString: this.config.SMOKE_DATABASE_URL });
    await client.connect();
    try {
      const created = await createPlatformAdmin(client, { email: this.adminEmail, firstName: 'Smoke', lastName: 'Admin', forceAdditional: true, webBaseUrl: 'https://smoke.invalid' });
      this.state.adminUserId = created.userId;
      const link = text(created.setPasswordLink, 'password link');
      await this.api.expect(204, 'POST', '/auth/password-reset/confirm', { body: { token: tokenFromMail(link), newPassword: PASSWORD } });
    } finally {
      await client.end();
    }
    await afterPasswordChange();
    const login = await this.api.expect(200, 'POST', '/auth/login', { body: { email: this.adminEmail, password: PASSWORD } });
    if (login.step !== 'MFA_ENROLLMENT_REQUIRED') throw new Error(`A platform administrator must enroll MFA at the first sign-in, but the step was ${String(login.step)}`);
    const challenge = text(login.challengeToken, 'challenge token');
    const enrollment = await this.api.expect(200, 'POST', '/auth/login/mfa/enrollment', { token: challenge });
    const confirmed = await this.api.expect(200, 'POST', '/auth/login/mfa/enrollment/confirm', { token: challenge, body: { code: totpNow(text(enrollment.secret, 'secret')) } });
    const session = await this.api.expect(200, 'POST', '/auth/platform/select', { token: text(confirmed.selectionToken, 'selection token') });
    this.platformToken = text(session.accessToken, 'platform access token');
  }

  async organization(): Promise<void> {
    const created = await this.api.expect(201, 'POST', '/platform/tenants', {
      token: this.platformToken,
      body: { slug: this.slug, name: SMOKE_TENANT_NAME, planCode: this.config.SMOKE_PLAN_CODE, countryCode: 'CO', owner: { email: this.ownerEmail, firstName: 'Smoke', lastName: 'Owner' } },
    });
    this.state.tenantId = text(created.tenantId, 'tenant id');
    const detail = await this.api.expect(200, 'GET', `/platform/tenants/${this.state.tenantId}`, { token: this.platformToken });
    if (detail.status !== 'ACTIVE') throw new Error(`The new organization is ${String(detail.status)}, not ACTIVE`);
  }

  /** The invitation e-mail travels through the outbox, the worker and SMTP to the mail catcher. */
  async ownerInvitation(): Promise<void> {
    const mail = await this.mailbox.waitForText(this.ownerEmail);
    await this.api.expect(200, 'POST', '/auth/invitations/accept', { body: { token: tokenFromMail(mail), password: PASSWORD } });
    await afterPasswordChange();
    const login = await this.api.expect(200, 'POST', '/auth/login', { body: { email: this.ownerEmail, password: PASSWORD } });
    if (login.step !== 'SELECT_ORGANIZATION') throw new Error(`The owner's sign-in answered step ${String(login.step)}`);
    const session = await this.api.expect(200, 'POST', '/auth/select-tenant', { token: text(login.selectionToken, 'selection token'), body: { tenantId: this.state.tenantId } });
    this.ownerToken = text(session.accessToken, 'access token');
  }

  /** START → TASK → TASK → END, built through the builder API and published. */
  async workflow(): Promise<void> {
    const token = this.ownerToken;
    const category = text((await this.api.expect(201, 'POST', '/categories', { token, body: { name: `Smoke ${this.suffix}` } })).id, 'category id');
    this.subcategoryId = text((await this.api.expect(201, 'POST', '/subcategories', { token, body: { categoryId: category, name: `Smoke ${this.suffix}` } })).id, 'subcategory id');
    const workflow = await this.api.expect(201, 'POST', '/workflows', { token, body: { subcategoryId: this.subcategoryId, name: `Smoke ${this.suffix}` } });
    const workflowId = text(workflow.id, 'workflow id');
    const versionId = text(((workflow.versions as Array<{ id: string }>)[0] ?? {}).id, 'version id');
    const task = (key: string) => ({ id: `new:${key}`, type: 'TASK', name: key, assignmentMode: 'CREATOR' });
    const saved = await this.api.expect(200, 'PUT', `/workflows/${workflowId}/versions/${versionId}/graph`, {
      token,
      body: {
        revision: 0,
        steps: [{ id: 'new:start', type: 'START', name: 'start' }, task('first'), task('second'), { id: 'new:end', type: 'END', name: 'end' }],
        transitions: [
          { id: 'new:t0', fromStepId: 'new:start', toStepId: 'new:first', type: 'DEFAULT', label: 'start->first', sortOrder: 0 },
          { id: 'new:t1', fromStepId: 'new:first', toStepId: 'new:second', type: 'DECISION', label: 'Next', sortOrder: 1 },
          { id: 'new:t2', fromStepId: 'new:second', toStepId: 'new:end', type: 'DECISION', label: 'Done', sortOrder: 2 },
        ],
      },
    });
    const idMap = saved.idMap as Record<string, string>;
    this.transitions = ['new:t1', 'new:t2'].map((key) => text(idMap[key], `transition ${key}`));
    await this.api.expect(200, 'POST', `/workflows/${workflowId}/versions/${versionId}/publish`, { token, body: {} });
  }

  /** The file travels like a browser's: reserve, PUT to the presigned URL, confirm. */
  async upload(): Promise<void> {
    const sha256 = createHash('sha256').update(this.fileContent).digest('hex');
    const reserved = await this.api.expect(201, 'POST', '/files/uploads', { token: this.ownerToken, body: { files: [{ name: 'smoke.pdf', sizeBytes: this.fileContent.length, sha256 }] } });
    const slot = (reserved.uploads as Array<{ fileId: string; url: string; method: string; headers: Record<string, string> }>)[0]!;
    const { 'content-length': _fromBody, ...headers } = slot.headers;
    const put = await fetch(slot.url, { method: slot.method, headers, body: new Uint8Array(this.fileContent) });
    if (!put.ok) throw new Error(`The storage refused the presigned upload (${put.status}): check STORAGE_ENDPOINT / STORAGE_PUBLIC_ENDPOINT and the bucket policy`);
    await this.api.expect(200, 'POST', `/files/${slot.fileId}/confirm`, { token: this.ownerToken });
    this.fileId = slot.fileId;
  }

  /** A ticket with the file attached, advanced twice until it is closed. */
  async ticketFlow(): Promise<void> {
    const token = this.ownerToken;
    const created = await this.api.expect(201, 'POST', '/tickets', { token, body: { subcategoryId: this.subcategoryId, title: 'Smoke ticket', attachments: [this.fileId] } });
    this.ticket = { id: text(created.id, 'ticket id'), openVisitId: text(created.openVisitId, 'open visit') };
    let current = this.ticket;
    for (const transitionId of this.transitions) {
      const moved = await this.api.expect(200, 'POST', `/tickets/${current.id}/transition`, { token, body: { transitionId, visitId: current.openVisitId } });
      current = { id: current.id, openVisitId: moved.openVisitId === null ? '' : text(moved.openVisitId, 'open visit') };
      if (moved.status === 'CLOSED') break;
    }
    const detail = await this.api.expect(200, 'GET', `/tickets/${current.id}`, { token });
    if (detail.status !== 'CLOSED') throw new Error(`The ticket is ${String(detail.status)} after its last transition, not CLOSED`);
  }

  /** The file comes back from the bucket through a presigned URL, byte for byte. */
  async download(): Promise<void> {
    const link = await this.api.expect(200, 'GET', `/tickets/${this.ticket!.id}/files/${this.fileId}/download-url`, { token: this.ownerToken });
    const response = await fetch(text(link.url, 'download url'));
    if (!response.ok) throw new Error(`The presigned download answered ${response.status}`);
    if (!Buffer.from(await response.arrayBuffer()).equals(this.fileContent)) throw new Error('The downloaded file is not the one that was uploaded');
  }

  /** The WebSocket works through the proxy: the web's origin and the owner's token connect, a foreign origin and a bad token do not. */
  async realtime(): Promise<void> {
    const source = this.config.SMOKE_ORIGIN ?? this.config.WEB_BASE_URL;
    if (source === undefined) throw new Error('Set WEB_BASE_URL (or SMOKE_ORIGIN): the realtime check needs the origin of the web application');
    const origin = new URL(source).origin;
    const connected = await probeRealtime(this.config.BASE_URL, { origin, token: this.ownerToken });
    if (connected.outcome !== 'CONNECTED') throw new Error(`The owner's socket was not accepted (${JSON.stringify(connected)}): does the proxy forward WebSocket upgrades on /realtime, and is REALTIME_ALLOWED_ORIGINS ${origin}?`);
    const foreign = await probeRealtime(this.config.BASE_URL, { origin: 'https://not-allowed.invalid', token: this.ownerToken });
    if (foreign.outcome !== 'NOT_UPGRADED') throw new Error(`A foreign Origin was not refused (${JSON.stringify(foreign)})`);
    const forged = await probeRealtime(this.config.BASE_URL, { origin, token: 'not-a-token' });
    if (forged.outcome !== 'REFUSED' || forged.code !== 'UNAUTHENTICATED') throw new Error(`A bad token was not refused with UNAUTHENTICATED (${JSON.stringify(forged)})`);
  }

  async report(): Promise<void> {
    const summary = await this.api.expect(200, 'GET', `/reports/summary?from=${today()}&to=${today()}`, { token: this.ownerToken });
    if (typeof summary !== 'object') throw new Error('The report is not an object');
  }
}
