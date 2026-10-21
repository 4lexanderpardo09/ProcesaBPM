import type { StepType, WorkflowProblem } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker, useNavigate } from 'react-router';
import { ApiError } from '@/shared/api';
import { paths, workflowPath, workflowVersionPath } from '@/shared/lib/paths';
import { useApiClient, usePermissions } from '@/shared/session';
import { Alert, Badge, Breadcrumb, Button, ButtonLink, Dialog } from '@/shared/ui';
import { createVersion, workflowQueryKeys, workflowQueryOptions } from '../../api/workflows-api';
import { builderQueryKeys, publishVersion, type VersionDetail } from '../api/builder-api';
import { useBuilder } from '../hooks/use-builder';
import { useDraftContent } from '../hooks/use-draft-content';
import { addStep, connect, connectSystem, freeSpot, removeStep, removeTransition, type Selection, updateStep, updateTransition } from '../lib/builder-doc';
import { problemsByElement, problemTarget } from '../lib/problems';
import { serverOnlyProblems, withServerProblems } from '../lib/server-problems';
import { AmountRulesDialog } from './AmountRulesDialog';
import { BlockPalette } from './BlockPalette';
import { BuilderCanvas } from './BuilderCanvas';
import { ProblemsPanel } from './ProblemsPanel';
import { PublishDialog } from './PublishDialog';
import { StepInspector } from './StepInspector';
import { TransitionInspector } from './TransitionInspector';
import styles from './Builder.module.css';

const STALE_REVISION = 'STALE_REVISION';

/**
 * The builder of one version: palette, canvas and inspector, with the draft's problems always in view. A published or
 * archived version, or a person who may only read, gets the same screen without the editing.
 */
export function WorkflowBuilder({ detail, onPublished }: { readonly detail: VersionDetail; readonly onPublished: (number: number) => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const builder = useBuilder(detail);
  const { doc, change, dirty, selection, setSelection, save } = builder;
  const content = useDraftContent(builder, detail.workflow.id, detail.version.id);
  const status = detail.version.status;
  const readOnly = status !== 'DRAFT' || !can('update', 'Workflow');
  const [serverProblems, setServerProblems] = useState<WorkflowProblem[]>([]);
  const validation = useMemo(() => withServerProblems(builder.validation, serverProblems), [builder.validation, serverProblems]);
  const problemsOf = useMemo(() => problemsByElement(validation), [validation]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [amountRulesOpen, setAmountRulesOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const navigate = useNavigate();
  // From a version that no longer changes, the way on is the draft: open it, or make one from this version.
  const offerDraft = status !== 'DRAFT' && can('update', 'Workflow');
  // `enabled` alone would still hand back what the workflow's page cached: inside a draft there is nothing to offer.
  const workflowVersions = useQuery({ ...workflowQueryOptions(client, detail.workflow.id), enabled: offerDraft }).data?.versions;
  const versions = offerDraft ? workflowVersions : undefined;
  const draft = versions?.find((version) => version.status === 'DRAFT');
  const copy = useMutation({
    mutationFn: () => createVersion(client, detail.workflow.id, { fromVersionId: detail.version.id }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all });
      void navigate(workflowVersionPath(detail.workflow.id, created.id));
    },
  });

  const edit = useCallback(
    (next: Parameters<typeof change>[0]) => {
      setServerProblems([]);
      change(next);
    },
    [change],
  );
  const select = useCallback((next: Selection) => setSelection(next), [setSelection]);
  const typeName = (type: StepType) => t(`builder.types.${type}`);

  const addBlock = (type: StepType, position?: { x: number; y: number }) => {
    let at = position;
    if (at === undefined) {
      const rect = canvasRef.current?.getBoundingClientRect();
      const center = rect === undefined ? { x: 0, y: 0 } : flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      at = freeSpot(doc, { x: center.x - 90, y: center.y - 32 });
    }
    const result = addStep(doc, type, t(`builder.defaultNames.${type}`), at);
    edit(() => result.doc);
    setSelection({ kind: 'step', id: result.id });
    setAnnouncement(t('builder.canvas.added', { name: result.doc.steps.at(-1)?.name ?? typeName(type) }));
  };

  const connectBlocks = (fromId: string, toId: string) => {
    const result = connect(doc, fromId, toId, {
      continue: t('builder.labels.continue'),
      approve: t('builder.labels.approve'),
      reject: t('builder.labels.reject'),
      otherwise: t('builder.labels.otherwise'),
      branch: (index) => t('builder.labels.branch', { index }),
      option: (index) => t('builder.labels.option', { index }),
    });
    if ('refusal' in result) {
      setAnnouncement(t(`builder.refusals.${result.refusal}`));
      return;
    }
    edit(() => result.doc);
    setSelection({ kind: 'transition', id: result.id });
    const nameOf = (id: string) => doc.steps.find((step) => step.id === id)?.name ?? '';
    setAnnouncement(t('builder.canvas.connected', { from: nameOf(fromId), to: nameOf(toId) }));
  };

  /** Selects a block or connection and brings it into view. */
  const focusOn = (target: Selection) => {
    if (target === null) return;
    setSelection(target);
    const stepId = target.kind === 'step' ? target.id : doc.transitions.find((transition) => transition.id === target.id)?.fromStepId;
    const step = doc.steps.find((candidate) => candidate.id === stepId);
    if (step !== undefined) void flow.setCenter(step.ui.x + 90, step.ui.y + 32, { zoom: Math.max(flow.getZoom(), 0.9), duration: 300 });
  };
  const goTo = (problem: WorkflowProblem) => focusOn(problemTarget(problem));
  const problemOwner = (problem: WorkflowProblem) => {
    const target = problemTarget(problem);
    if (target?.kind === 'step') return doc.steps.find((step) => step.id === target.id)?.name;
    if (target?.kind === 'transition') return doc.transitions.find((transition) => transition.id === target.id)?.label;
    if (problem.amountRuleId !== undefined) return t('builder.panel.amountRule');
    return undefined;
  };

  const publish = useMutation({
    mutationFn: async (notes: string | undefined) => {
      if (dirty) await save.mutateAsync();
      return publishVersion(client, detail.workflow.id, detail.version.id, notes);
    },
    onSuccess: async (published) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: builderQueryKeys.version(detail.workflow.id, detail.version.id) }),
      ]);
      onPublished(published.version.number);
    },
    onError: (error) => {
      const extra = serverOnlyProblems(error);
      if (extra.length > 0) {
        setServerProblems(extra);
        setPublishing(false);
        setPanelOpen(true);
      }
    },
  });

  // Ctrl/⌘+S saves the draft from anywhere in the builder.
  useEffect(() => {
    if (readOnly) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty && !save.isPending && !content.pending) save.mutate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readOnly, dirty, save, content.pending]);

  // Leaving with unsaved work asks first: in the app, and when the tab is closed or reloaded.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const selectedStep = selection?.kind === 'step' ? doc.steps.find((step) => step.id === selection.id) : undefined;
  const selectedTransition = selection?.kind === 'transition' ? doc.transitions.find((transition) => transition.id === selection.id) : undefined;
  const stale = save.error instanceof ApiError && save.error.code === STALE_REVISION;
  const errors = validation.errors.length;
  const warnings = validation.warnings.length;

  return (
    <div className={styles.builder}>
      <Breadcrumb
        label={t('builder.breadcrumb')}
        items={[{ label: t('title'), to: paths.workflows }, { label: detail.workflow.name, to: workflowPath(detail.workflow.id) }, { label: t('builder.versionLabel', { number: detail.version.number }) }]}
      />
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <h1 className="text-page-title">{detail.workflow.name}</h1>
          <Badge tone={status === 'DRAFT' ? 'accent' : status === 'PUBLISHED' ? 'ok' : 'neutral'}>
            {t(`versions.statuses.${status}`)} · {t('builder.versionLabel', { number: detail.version.number })}
          </Badge>
          {!readOnly && <span className={dirty ? styles.dirty : styles.clean}>{dirty ? t('builder.dirty') : t('builder.clean')}</span>}
        </div>
        <div className={styles.headerActions}>
          <Button onClick={() => setAmountRulesOpen(true)}>
            {doc.amountRules.length === 0 ? t('builder.amountRules.open') : t('builder.amountRules.openCount', { count: doc.amountRules.length })}
          </Button>
          <Button aria-expanded={panelOpen} onClick={() => setPanelOpen((open) => !open)}>
            {t('builder.problems')}
            <span className={errors > 0 ? styles.countError : warnings > 0 ? styles.countWarning : styles.countOk}>
              {errors > 0 ? t('builder.problemsSummary', { count: errors }) : warnings > 0 ? t('builder.warningsSummary', { count: warnings }) : t('builder.noProblems')}
            </span>
          </Button>
          {versions !== undefined &&
            (draft === undefined ? (
              <Button disabled={copy.isPending} onClick={() => copy.mutate()}>
                {t('builder.createDraft')}
              </Button>
            ) : (
              <ButtonLink to={workflowVersionPath(detail.workflow.id, draft.id)}>{t('builder.openDraft', { number: draft.number })}</ButtonLink>
            ))}
          {!readOnly && (
            <>
              <Button disabled={!dirty || save.isPending || content.pending} onClick={() => save.mutate()}>
                {save.isPending ? t('builder.saving') : t('builder.save')}
              </Button>
              {can('publish', 'Workflow') && (
                <Button variant="primary" onClick={() => setPublishing(true)}>
                  {t('builder.publish')}
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      {status === 'PUBLISHED' && <Alert tone="info">{t('builder.readOnlyPublished')}</Alert>}
      {status === 'ARCHIVED' && <Alert tone="info">{t('builder.readOnlyArchived')}</Alert>}
      {status === 'DRAFT' && readOnly && <Alert tone="info">{t('builder.readOnlyNoPermission')}</Alert>}
      {stale && (
        <Alert tone="danger">
          <span className={styles.alertRow}>
            {t('builder.stale')}
            <Button onClick={() => window.location.reload()}>{t('builder.reload')}</Button>
          </span>
        </Alert>
      )}
      {save.error !== null && !stale && <Alert tone="danger">{t('builder.saveFailed')}</Alert>}
      {copy.error !== null && <Alert tone="danger">{t('builder.saveFailed')}</Alert>}

      <div className={readOnly ? styles.workspaceReadOnly : styles.workspace}>
        {!readOnly && <BlockPalette onAdd={(type) => addBlock(type)} />}
        <div ref={canvasRef} className={styles.canvasWrap}>
          <BuilderCanvas
            doc={doc}
            selection={selection}
            readOnly={readOnly}
            problemsOf={problemsOf}
            onSelect={select}
            onChange={edit}
            onConnect={connectBlocks}
            onDropBlock={addBlock}
          />
          {panelOpen && <ProblemsPanel validation={validation} nameOf={problemOwner} onGoTo={goTo} onOpenAmountRules={() => setAmountRulesOpen(true)} onClose={() => setPanelOpen(false)} />}
        </div>
        <aside className={styles.inspector} aria-label={t('builder.inspector.label')}>
          {selectedStep !== undefined ? (
            <StepInspector
              key={selectedStep.id}
              step={selectedStep}
              doc={doc}
              workflowId={detail.workflow.id}
              readOnly={readOnly}
              problems={problemsOf(selectedStep.id)}
              onChange={(patch) => edit((current) => updateStep(current, selectedStep.id, patch))}
              onRemove={() => {
                edit((current) => removeStep(current, selectedStep.id));
                setSelection(null);
                setAnnouncement(t('builder.canvas.removed', { name: selectedStep.name }));
              }}
              onConnect={(toId) => connectBlocks(selectedStep.id, toId)}
              onSelect={select}
              content={content}
              saving={save.isPending}
              onSave={() => save.mutate()}
            />
          ) : selectedTransition !== undefined ? (
            <TransitionInspector
              key={selectedTransition.id}
              transition={selectedTransition}
              doc={doc}
              readOnly={readOnly}
              problems={problemsOf(selectedTransition.id)}
              onChange={(patch) => edit((current) => updateTransition(current, selectedTransition.id, patch))}
              onRemove={() => {
                edit((current) => removeTransition(current, selectedTransition.id));
                setSelection(null);
                setAnnouncement(t('builder.canvas.removed', { name: selectedTransition.label }));
              }}
            />
          ) : (
            <div className={styles.inspectorBody}>
              <h2 className={styles.inspectorTitle}>{t('builder.inspector.emptyTitle')}</h2>
              <p className={styles.note}>{t('builder.inspector.emptyHint')}</p>
              <p className={styles.note}>{t('builder.inspector.counts', { steps: doc.steps.length, transitions: doc.transitions.length, fields: doc.fields.length })}</p>
            </div>
          )}
          <nav className={styles.outline} aria-label={t('builder.canvas.outline')}>
            <ul>
              {doc.steps.map((step) => (
                <li key={step.id}>
                  <button type="button" aria-current={selection?.kind === 'step' && selection.id === step.id ? 'true' : undefined} onClick={() => focusOn({ kind: 'step', id: step.id })}>
                    {t('builder.canvas.outlineItem', { type: typeName(step.type), name: step.name })}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {announcement}
      </p>

      {publishing && (
        <PublishDialog
          number={detail.version.number}
          dirty={dirty}
          validation={validation}
          pending={publish.isPending}
          error={publish.error === null ? undefined : publish.error instanceof ApiError && publish.error.code === 'WORKFLOW_NOT_PUBLISHABLE' ? t('builder.publishDialog.refused') : t('builder.saveFailed')}
          onPublish={(notes) => publish.mutate(notes)}
          onClose={() => {
            setPublishing(false);
            publish.reset();
          }}
        />
      )}
      {amountRulesOpen && (
        <AmountRulesDialog
          doc={doc}
          readOnly={readOnly || save.isPending}
          content={content}
          onWire={(fromId, toId) => edit((current) => connectSystem(current, fromId, toId, t('builder.amountRules.wireLabel')).doc)}
          onClose={() => setAmountRulesOpen(false)}
        />
      )}
      {blocker.state === 'blocked' && (
        <Dialog
          open
          title={t('builder.dirty')}
          closeLabel={t('close')}
          onClose={() => blocker.reset()}
          footer={
            <>
              <Button onClick={() => blocker.reset()}>{t('cancel')}</Button>
              <Button variant="brand" onClick={() => blocker.proceed()}>
                {t('builder.leaveConfirm')}
              </Button>
            </>
          }
        >
          <p className={styles.note}>{t('builder.leave')}</p>
        </Dialog>
      )}
    </div>
  );
}
