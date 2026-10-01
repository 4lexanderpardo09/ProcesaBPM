import { Body, Controller, Delete, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
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
import { DraftEditorService } from '../application/draft-editor.service.js';

const uuid = new ParseUUIDPipe();

/** Granular edits of a draft. They need `update Workflow`; a published or archived version answers 409. */
@Controller('workflows/:workflowId/versions/:versionId')
export class DraftContentController {
  constructor(@Inject(DraftEditorService) private readonly editor: DraftEditorService) {}

  @RequirePermission('update', 'Workflow')
  @Post('fields')
  createField(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Body(new ZodValidationPipe(createFieldRequestSchema)) body: CreateFieldRequest): Promise<FieldDocument> {
    return this.editor.createField(workflowId, versionId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Patch('fields/:fieldId')
  updateField(
    @Param('workflowId', uuid) workflowId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('fieldId', uuid) fieldId: string,
    @Body(new ZodValidationPipe(updateFieldRequestSchema)) body: UpdateFieldRequest,
  ): Promise<FieldDocument> {
    return this.editor.updateField(workflowId, versionId, fieldId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Delete('fields/:fieldId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteField(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('fieldId', uuid) fieldId: string): Promise<void> {
    return this.editor.deleteField(workflowId, versionId, fieldId);
  }

  @RequirePermission('update', 'Workflow')
  @Post('amount-rules')
  createAmountRule(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Body(new ZodValidationPipe(createAmountRuleRequestSchema)) body: CreateAmountRuleRequest): Promise<AmountRuleDocument> {
    return this.editor.createAmountRule(workflowId, versionId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Patch('amount-rules/:ruleId')
  updateAmountRule(
    @Param('workflowId', uuid) workflowId: string,
    @Param('versionId', uuid) versionId: string,
    @Param('ruleId', uuid) ruleId: string,
    @Body(new ZodValidationPipe(updateAmountRuleRequestSchema)) body: UpdateAmountRuleRequest,
  ): Promise<AmountRuleDocument> {
    return this.editor.updateAmountRule(workflowId, versionId, ruleId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Delete('amount-rules/:ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAmountRule(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('ruleId', uuid) ruleId: string): Promise<void> {
    return this.editor.deleteAmountRule(workflowId, versionId, ruleId);
  }

  @RequirePermission('update', 'Workflow')
  @Put('steps/:stepId/candidates')
  replaceCandidates(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('stepId', uuid) stepId: string, @Body(new ZodValidationPipe(replaceCandidatesRequestSchema)) body: ReplaceCandidatesRequest) {
    return this.editor.replaceCandidates(workflowId, versionId, stepId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Put('steps/:stepId/initiators')
  replaceInitiators(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('stepId', uuid) stepId: string, @Body(new ZodValidationPipe(replaceInitiatorsRequestSchema)) body: ReplaceInitiatorsRequest) {
    return this.editor.replaceInitiators(workflowId, versionId, stepId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Put('steps/:stepId/signers')
  replaceSigners(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('stepId', uuid) stepId: string, @Body(new ZodValidationPipe(replaceSignersRequestSchema)) body: ReplaceSignersRequest) {
    return this.editor.replaceSigners(workflowId, versionId, stepId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Put('steps/:stepId/sla-overrides')
  replaceSlaOverrides(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('stepId', uuid) stepId: string, @Body(new ZodValidationPipe(replaceSlaOverridesRequestSchema)) body: ReplaceSlaOverridesRequest) {
    return this.editor.replaceSlaOverrides(workflowId, versionId, stepId, body);
  }

  @RequirePermission('update', 'Workflow')
  @Put('steps/:stepId/files')
  replaceFiles(@Param('workflowId', uuid) workflowId: string, @Param('versionId', uuid) versionId: string, @Param('stepId', uuid) stepId: string, @Body(new ZodValidationPipe(replaceStepFilesRequestSchema)) body: ReplaceStepFilesRequest) {
    return this.editor.replaceFiles(workflowId, versionId, stepId, body);
  }
}
