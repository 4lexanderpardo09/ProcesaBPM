import { Body, Controller, Delete, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Res } from '@nestjs/common';
import {
  type AmountRuleDocument,
  type CreateAmountRuleRequest,
  createAmountRuleRequestSchema,
  type CreateFieldRequest,
  createFieldRequestSchema,
  type FieldDocument,
  type ReplaceCandidatesRequest,
  replaceCandidatesRequestSchema,
  type ReplaceInitiatorsRequest,
  replaceInitiatorsRequestSchema,
  type ReplaceSignersRequest,
  replaceSignersRequestSchema,
  type ReplaceSlaOverridesRequest,
  replaceSlaOverridesRequestSchema,
  type ReplaceStepFilesRequest,
  replaceStepFilesRequestSchema,
  type UpdateAmountRuleRequest,
  updateAmountRuleRequestSchema,
  type UpdateFieldRequest,
  updateFieldRequestSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import type { Response } from 'express';
import { DraftEditorService, type Edited } from '../application/draft-editor.service.js';

const uuid = new ParseUUIDPipe();
export const REVISION_HEADER = 'Workflow-Revision';

/** Granular edits of a draft. They need `update Workflow`; a published or archived version answers 409. */
@Controller('workflows/:workflowId/versions/:versionId')
export class DraftContentController {
  constructor(@Inject(DraftEditorService) private readonly editor: DraftEditorService) {}

  /** The body is the edited content; the new revision of the draft travels in a header (a canvas save echoes it back). */
  private async reply<T>(response: Response, edit: Promise<Edited<T>>): Promise<T> {
    const { value, revision } = await edit;
    response.setHeader(REVISION_HEADER, String(revision));
    return value;
  }

  @RequirePermission('update', 'Workflow')
  @Post('fields')
  createField(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Body(new ZodValidationPipe(createFieldRequestSchema)) body: CreateFieldRequest, @Res({ passthrough: true }) response: Response): Promise<FieldDocument> {
    return this.reply(response, this.editor.createField(workflowId, versionId, body));
  }

  @RequirePermission('update', 'Workflow')
  @Patch('fields/:fieldId')
  updateField(
    @Param('workflowId', uuid) workflowId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('fieldId', uuid) fieldId: string,
    @Body(new ZodValidationPipe(updateFieldRequestSchema)) body: UpdateFieldRequest,
    @Res({ passthrough: true }) response: Response): Promise<FieldDocument> {
    return this.reply(response, this.editor.updateField(workflowId, versionId, fieldId, body));
  }

  @RequirePermission('update', 'Workflow')
  @Delete('fields/:fieldId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteField(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('fieldId', uuid) fieldId: string, @Res({ passthrough: true }) response: Response): Promise<void> {
    return this.reply(response, this.editor.deleteField(workflowId, versionId, fieldId));
  }

  @RequirePermission('update', 'Workflow')
  @Post('amount-rules')
  createAmountRule(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Body(new ZodValidationPipe(createAmountRuleRequestSchema)) body: CreateAmountRuleRequest, @Res({ passthrough: true }) response: Response): Promise<AmountRuleDocument> {
    return this.reply(response, this.editor.createAmountRule(workflowId, versionId, body));
  }

  @RequirePermission('update', 'Workflow')
  @Patch('amount-rules/:ruleId')
  updateAmountRule(
    @Param('workflowId', uuid) workflowId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('ruleId', uuid) ruleId: string,
    @Body(new ZodValidationPipe(updateAmountRuleRequestSchema)) body: UpdateAmountRuleRequest,
    @Res({ passthrough: true }) response: Response): Promise<AmountRuleDocument> {
    return this.reply(response, this.editor.updateAmountRule(workflowId, versionId, ruleId, body));
  }

  @RequirePermission('update', 'Workflow')
  @Delete('amount-rules/:ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAmountRule(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('ruleId', uuid) ruleId: string, @Res({ passthrough: true }) response: Response): Promise<void> {
    return this.reply(response, this.editor.deleteAmountRule(workflowId, versionId, ruleId));
  }

  @RequirePermission('update', 'Workflow')
  @Put('steps/:stepId/candidates')
  replaceCandidates(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('stepId', uuid) stepId: string, @Body(new ZodValidationPipe(replaceCandidatesRequestSchema)) body: ReplaceCandidatesRequest, @Res({ passthrough: true }) response: Response) {
    return this.reply(response, this.editor.replaceCandidates(workflowId, versionId, stepId, body));
  }

  @RequirePermission('update', 'Workflow')
  @Put('steps/:stepId/initiators')
  replaceInitiators(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('stepId', uuid) stepId: string, @Body(new ZodValidationPipe(replaceInitiatorsRequestSchema)) body: ReplaceInitiatorsRequest, @Res({ passthrough: true }) response: Response) {
    return this.reply(response, this.editor.replaceInitiators(workflowId, versionId, stepId, body));
  }

  @RequirePermission('update', 'Workflow')
  @Put('steps/:stepId/signers')
  replaceSigners(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('stepId', uuid) stepId: string, @Body(new ZodValidationPipe(replaceSignersRequestSchema)) body: ReplaceSignersRequest, @Res({ passthrough: true }) response: Response) {
    return this.reply(response, this.editor.replaceSigners(workflowId, versionId, stepId, body));
  }

  @RequirePermission('update', 'Workflow')
  @Put('steps/:stepId/sla-overrides')
  replaceSlaOverrides(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('stepId', uuid) stepId: string, @Body(new ZodValidationPipe(replaceSlaOverridesRequestSchema)) body: ReplaceSlaOverridesRequest, @Res({ passthrough: true }) response: Response) {
    return this.reply(response, this.editor.replaceSlaOverrides(workflowId, versionId, stepId, body));
  }

  @RequirePermission('update', 'Workflow')
  @Put('steps/:stepId/files')
  replaceFiles(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('stepId', uuid) stepId: string, @Body(new ZodValidationPipe(replaceStepFilesRequestSchema)) body: ReplaceStepFilesRequest, @Res({ passthrough: true }) response: Response) {
    return this.reply(response, this.editor.replaceFiles(workflowId, versionId, stepId, body));
  }
}
