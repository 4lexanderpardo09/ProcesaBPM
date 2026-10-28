import { describe, expect, it, vi } from 'vitest';
import type { DemoRequest } from '@procesabpm/shared';
import type { AuthTransaction, AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { DemoRequestRepository } from '../data/demo-request.repository.js';
import { DemoRequestService } from './demo-request.service.js';

const request: DemoRequest = { fullName: 'Laura Méndez', company: 'Distribuidora del Valle', email: 'laura@example.com', teamSize: 'UNDER_20', privacyConsent: true };

function service() {
  const tx = {} as AuthTransaction;
  const runner = { withAnonymousTransaction: vi.fn((work: (t: AuthTransaction) => Promise<unknown>) => work(tx)) } as unknown as AuthTransactionRunner;
  const repository = { submit: vi.fn(() => Promise.resolve()) } as unknown as DemoRequestRepository;
  return { subject: new DemoRequestService(runner, repository), repository, tx };
}

describe('DemoRequestService', () => {
  it('stores the request in an anonymous transaction', async () => {
    const { subject, repository, tx } = service();
    await subject.submit(request);
    expect(repository.submit).toHaveBeenCalledWith(tx, request);
  });

  it('a bot that filled the hidden field is answered as anyone else, and nothing is stored', async () => {
    const { subject, repository } = service();
    await subject.submit({ ...request, website: 'http://spam.example' });
    expect(repository.submit).not.toHaveBeenCalled();
  });

  it('a blank hidden field (some browsers autofill spaces) is a person', async () => {
    const { subject, repository } = service();
    await subject.submit({ ...request, website: '  ' });
    expect(repository.submit).toHaveBeenCalled();
  });
});
