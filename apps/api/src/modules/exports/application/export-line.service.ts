import { Inject, Injectable } from '@nestjs/common';
import { buildFormulaSchema, compileFormula, Decimal, evaluateFormulaExpression, localDateOf, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { ExportCatalogsRepository } from '../data/export-catalogs.repository.js';
import type { ExportDefinitionRow } from '../data/export-definitions.repository.js';
import { ExportLinesRepository } from '../data/export-lines.repository.js';
import { ExportSourcesRepository, type TicketForExport } from '../data/export-sources.repository.js';
import { type LineSource, passesFilter, projectLine } from '../domain/line-projection.js';

/** A FORMULA cell: the result rounded to 2 decimals, or nothing when the formula does not compile or fails. */
function formulaCell(source: string, document: WorkflowVersionDocument, values: Readonly<Record<string, unknown>>, today: string): string {
  const compiled = compileFormula(source, buildFormulaSchema(document.fields));
  if (!compiled.ok) return '';
  try {
    const result = evaluateFormulaExpression(compiled.formula.expression, { values, today });
    if (result instanceof Decimal) return String(Math.round(Number(result.toPlainString()) * 100) / 100);
    return result === null ? '' : String(result);
  } catch {
    return '';
  }
}

/**
 * Turns a ticket into the line it writes in each export: on the transition or the closing a definition names, or when
 * the ticket goes through an EXPORT block. A ticket that no longer passes the filter leaves the pending lines; a line
 * already in a file is never rewritten.
 */
@Injectable()
export class ExportLineService {
  constructor(
    @Inject(ExportSourcesRepository) private readonly sources: ExportSourcesRepository,
    @Inject(ExportCatalogsRepository) private readonly catalogs: ExportCatalogsRepository,
    @Inject(ExportLinesRepository) private readonly lines: ExportLinesRepository,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
  ) {}

  async project(tx: TenantTransaction, tenantId: string, ticketId: string, definitions: readonly ExportDefinitionRow[], actorId: string | null, at: Date): Promise<void> {
    const ticket = await this.sources.ticket(tx, tenantId, ticketId);
    if (ticket === undefined) return;
    const applicable = definitions.filter((definition) => definition.isActive && definition.workflowId === ticket.workflowId && (definition.companyId === null || definition.companyId === ticket.companyId));
    if (applicable.length === 0) return;
    const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
    const values = valuesByCode(ticket, document);
    for (const definition of applicable) {
      if (!passesFilter(definition.filter, values)) {
        await this.lines.removePending(tx, tenantId, definition.id, ticket.id);
        continue;
      }
      const row = await this.rowOf(tx, tenantId, definition, ticket, document, values, at);
      await this.lines.upsertPending(tx, tenantId, definition.id, ticket.id, row, actorId, at);
    }
  }

  /** How the row of a ticket comes out, without writing it (the preview). */
  async preview(tx: TenantTransaction, tenantId: string, definition: ExportDefinitionRow, ticketId: string, at: Date): Promise<Record<string, string> | undefined> {
    const ticket = await this.sources.ticket(tx, tenantId, ticketId);
    if (ticket === undefined) return undefined;
    const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
    return this.rowOf(tx, tenantId, definition, ticket, document, valuesByCode(ticket, document), at);
  }

  private async rowOf(tx: TenantTransaction, tenantId: string, definition: ExportDefinitionRow, ticket: TicketForExport, document: WorkflowVersionDocument, values: Readonly<Record<string, unknown>>, at: Date): Promise<Record<string, string>> {
    const catalogNames = definition.columns.flatMap((column) => (column.sourceType === 'CATALOG' && column.sourceRef !== null ? [column.sourceRef.split(':')[0]!] : []));
    const today = localDateOf(at.getTime(), ticket.timeZone);
    const source: LineSource = {
      values,
      companyName: ticket.companyName,
      requester: ticket.requester,
      ticketDate: localDateOf(ticket.createdAt.getTime(), ticket.timeZone),
      catalogs: await this.catalogs.load(tx, tenantId, [...new Set(catalogNames)]),
      formulas: new Map(definition.columns.filter((column) => column.sourceType === 'FORMULA').map((column) => [column.header, formulaCell(column.sourceRef ?? '', document, values, today)])),
    };
    return projectLine(definition.columns, source);
  }
}

/** The ticket's stored values by field code, as its own version names them. */
function valuesByCode(ticket: TicketForExport, document: WorkflowVersionDocument): Record<string, unknown> {
  return Object.fromEntries(document.fields.filter((field) => ticket.values.has(field.id)).map((field) => [field.code, ticket.values.get(field.id)]));
}
