import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import type { SeededTenant } from '@procesabpm/db/testing/fixtures';
import { type DraftCatalog, ImmutableDataError, StaleRevisionError, translateDraftSpec, type VersionDetailResponse, type WorkflowVersionDocument } from '@procesabpm/shared';
import { advanceSpec, travelAdvanceSpec } from '../../../../packages/shared/src/workflow/draft-spec/test-fixtures.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantContext } from '../../src/infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../src/infrastructure/database/tenant-transaction-runner.js';
import { DraftDocumentImporter, DraftImportRejectedError } from '../../src/modules/workflows/application/draft-document-importer.js';
import { adminOf, type ApiClient, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

describe('DraftDocumentImporter (one-transaction replacement of a draft)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: ApiClient;
  let tenant: SeededTenant;
  let catalog: DraftCatalog;

  const newDraft = async () => {
    const category = (await admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    const subcategoryId = (await admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
    const workflow = (await admin.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body;
    return { workflowId: workflow.id as string, versionId: workflow.versions[0].id as string };
  };
  const detail = async (draft: { workflowId: string; versionId: string }) => (await admin.get(`/workflows/${draft.workflowId}/versions/${draft.versionId}`).expect(200)).body as VersionDetailResponse;
  const translated = (): WorkflowVersionDocument => {
    const result = translateDraftSpec(advanceSpec(), catalog);
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    return result.document;
  };
  const importInto = (draft: { workflowId: string; versionId: string }, document: WorkflowVersionDocument, expectedRevision: number) =>
    app.get(TenantContext).run({ tenantId: tenant.tenantId, userId: tenant.userId }, () =>
      app.get(TenantTransactionRunner).withTenantTransaction((tx) => app.get(DraftDocumentImporter).replaceContent(tx, { tenantId: tenant.tenantId, ...draft, expectedRevision, document })),
    );

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    ({ admin, tenant } = await adminOf(db, app));
    const position = async () => (await admin.post('/positions', { name: unique('P') }).expect(201)).body.id as string;
    catalog = {
      positions: [
        { id: await position(), name: 'Gerente general' },
        { id: await position(), name: 'Contador' },
        { id: await position(), name: 'Tesorero' },
      ],
      groups: [{ id: (await admin.post('/groups', { name: unique('G') }).expect(201)).body.id, name: 'Mesa TI' }],
      approvalTypes: [{ id: (await admin.post('/approval-group-types', { name: unique('T') }).expect(201)).body.id, name: 'Jefatura' }],
    };
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('replaces the whole content of the draft and leaves it publishable', async () => {
    const draft = await newDraft();
    const before = await detail(draft);
    const result = await importInto(draft, translated(), before.version.revision);
    expect(result.revision).toBe(before.version.revision + 1);
    expect(result.validation.errors).toEqual([]);

    const after = await detail(draft);
    expect(after.document.steps.map((step) => step.name)).toEqual(expect.arrayContaining(['Solicitud de anticipo', 'Aprobación del jefe', 'Revisión contable', 'Fin']));
    expect(after.document.steps).toHaveLength(9);
    expect(after.document.steps.some((step) => before.document.steps.some((old) => old.id === step.id))).toBe(false);
    expect(after.document.fields.find((field) => field.code === 'TOTAL')).toMatchObject({ type: 'FORMULA', capture: 'CREATION' });
    expect(after.document.steps.find((step) => step.name === 'Aprobación de gerencia')).toMatchObject({ assignmentMode: 'POSITION', positionId: catalog.positions[0]!.id });
    expect(after.validation).toEqual({ errors: [], warnings: [] });
    await admin.post(`/workflows/${draft.workflowId}/versions/${draft.versionId}/publish`, {}).expect(200);
  });

  it('writes initiators, a SIGNATURE block and an EXTRA_APPROVAL amount rule, and the draft publishes', async () => {
    const draft = await newDraft();
    const result = translateDraftSpec(travelAdvanceSpec(), catalog);
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    const written = await importInto(draft, result.document, (await detail(draft)).version.revision);
    expect(written.validation).toEqual({ errors: [], warnings: [] });

    const after = await detail(draft);
    const byName = (name: string) => after.document.steps.find((step) => step.name === name)!;
    expect(byName('Solicitud de anticipo de viaje').initiators).toMatchObject([{ participantType: 'POSITION', positionId: catalog.positions[1]!.id }]);
    const signature = byName('Firma del anticipo');
    expect(signature).toMatchObject({ type: 'SIGNATURE', positionId: catalog.positions[2]!.id, config: { document: 'MAIN_DOCUMENT' } });
    expect(signature.signers.map((signer) => signer.signerType)).toEqual(['POSITION', 'CREATOR']);
    expect(after.document.amountRules).toMatchObject([{ fieldCode: 'MONTO', maxAmount: '5000000.00', currencyCode: 'COP', action: 'EXTRA_APPROVAL', stepId: byName('Solicitud de anticipo de viaje').id, approvalStepId: byName('Aprobación de gerencia').id }]);
    expect(after.document.transitions.filter((transition) => transition.type === 'SYSTEM_ONLY')).toHaveLength(1);
    await admin.post(`/workflows/${draft.workflowId}/versions/${draft.versionId}/publish`, {}).expect(200);
  });

  it('writes nothing when the document breaks a rule the database enforces', async () => {
    const draft = await newDraft();
    const before = await detail(draft);
    const doc = translated();
    const broken = { ...doc, transitions: doc.transitions.map((transition) => (transition.label === 'Enviar' ? { ...transition, type: 'DECISION' as const } : transition)) };
    await expect(importInto(draft, broken, before.version.revision)).rejects.toBeInstanceOf(DraftImportRejectedError);
    expect(await detail(draft)).toEqual(before);
  });

  it('rolls everything back when a write fails half way (a position of no one)', async () => {
    const draft = await newDraft();
    const before = await detail(draft);
    const doc = translated();
    const orphan = { ...doc, steps: doc.steps.map((step) => (step.name === 'Pago del anticipo' ? { ...step, positionId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' } : step)) };
    await expect(importInto(draft, orphan, before.version.revision)).rejects.toThrow();
    expect(await detail(draft)).toEqual(before);
  });

  it('refuses a draft edited since the requester read it, and a published version', async () => {
    const draft = await newDraft();
    const before = await detail(draft);
    await expect(importInto(draft, translated(), before.version.revision + 5)).rejects.toBeInstanceOf(StaleRevisionError);
    expect(await detail(draft)).toEqual(before);

    await admin.post(`/workflows/${draft.workflowId}/versions/${draft.versionId}/publish`, {}).expect(200);
    const published = await detail(draft);
    await expect(importInto(draft, translated(), published.version.revision)).rejects.toBeInstanceOf(ImmutableDataError);
    expect(await detail(draft)).toEqual(published);
  });
});
