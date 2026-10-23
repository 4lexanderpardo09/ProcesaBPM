import type { CanvasElement, PdfCanvasDesign, WorkflowVersionDocument } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router';
import { positionsQueryOptions } from '@/features/people';
import { tenantLogoQueryOptions } from '@/shared/organization/logo-api';
import { useApiClient, usePermissions } from '@/shared/session';
import { Alert, Button, Checkbox, Dialog, PageHeader, Select } from '@/shared/ui';
import { documentQueryKeys, type PdfFormat, pdfImagesQueryOptions, updatePdfFormat } from '../../api/documents-api';
import { DocumentError } from '../../components/DocumentError';
import { FormatSettingsDialog } from '../../components/designer/FormatSettingsDialog';
import { PreviewPane } from '../../components/designer/PreviewPane';
import { fieldPlaceholder } from '../../lib/data-choices';
import { copiedElements, copyElements } from '../lib/canvas-clipboard';
import { addSheet, type Alignment, alignElements, createElement, duplicateElements, isOnSheet, moveLayer, pasteElements, PX_PER_MM, removeElements, roundMm, sheetSizeOf, updateElements } from '../lib/canvas-doc';
import { type CanvasImages, CanvasImagesContext } from '../lib/canvas-images';
import { type CanvasProblem, canvasProblems } from '../lib/canvas-problems';
import { useHistory } from '../lib/use-history';
import { CanvasPalette } from './CanvasPalette';
import { CanvasSheet, type Droppable } from './CanvasSheet';
import { ElementProperties } from './ElementProperties';
import { LayersPanel } from './LayersPanel';
import { PageProperties } from './PageProperties';
import { SheetTabs } from './SheetTabs';
import styles from './Canvas.module.css';

const ZOOMS = [0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 2] as const;
/** The scroller's padding on both sides, so a fitting sheet shows no scroll bar. */
const SCROLLER_PADDING_PX = 40;
const GRIDS = ['0', '1', '2', '5', '10'] as const;
const NUDGE_MM = 1;
const NUDGE_FAR_MM = 5;
const ALIGNMENTS: readonly Alignment[] = ['left', 'centerX', 'right', 'top', 'centerY', 'bottom'];

/** A format of the canvas designer (version 2). */
export type CanvasFormat = PdfFormat & { readonly design: PdfCanvasDesign };

export interface CanvasDesignerProps {
  readonly workflowId: string;
  readonly format: CanvasFormat;
  readonly current: WorkflowVersionDocument;
  readonly upcoming: WorkflowVersionDocument | undefined;
  readonly breadcrumb: (name: string) => ReactNode;
}

/** Whether a key press belongs to a box being typed in, not to the canvas. */
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The canvas designer: elements placed freely on the sheet, a palette of tools and fields, layers, sheets, the
 * properties of what is selected (or of the page and calculations), undo and redo, and the API's preview beside it.
 */
export function CanvasDesigner({ workflowId, format, current, upcoming, breadcrumb }: CanvasDesignerProps) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const canEdit = usePermissions().can('update', 'PdfDocument');
  const history = useHistory<PdfCanvasDesign>(format.design);
  const design = history.current;
  const [saved, setSaved] = useState<PdfFormat>(format);
  const [savedDesign, setSavedDesign] = useState<PdfCanvasDesign>(format.design);
  const [selection, setSelection] = useState<string[]>([]);
  const [sheet, setSheet] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [grid, setGrid] = useState<number | null>(2);
  const [showGrid, setShowGrid] = useState(true);
  const [settings, setSettings] = useState(false);
  // Whether something copied (here, or earlier in another format) is waiting to be pasted.
  const [canPaste, setCanPaste] = useState(() => copiedElements() !== null);
  const scroller = useRef<HTMLDivElement>(null);
  const dirty = design !== savedDesign;
  const logo = useQuery(tenantLogoQueryOptions(client));
  const images = useQuery(pdfImagesQueryOptions(client, workflowId));
  const canvasImages = useMemo<CanvasImages>(() => ({ workflowId, logoUrl: logo.isError ? null : logo.data === undefined ? undefined : (logo.data?.url ?? null), images: images.data }), [workflowId, logo.data, logo.isError, images.data]);
  const imageIds = useMemo(() => (images.data === undefined ? undefined : new Set(images.data.map((image) => image.id))), [images.data]);
  const positions = useQuery(positionsQueryOptions(client));
  const positionIds = useMemo(() => (positions.data === undefined ? undefined : new Set(positions.data.map((position) => position.id))), [positions.data]);
  const problems = canvasProblems(design, current, upcoming, { imageIds, positionIds });
  const blocking = problems.filter((problem) => !problem.draftOnly);
  const readOnly = !canEdit;

  const problemText = (problem: CanvasProblem) => {
    const text = t(`documents.canvas.problems.${problem.code}`, { detail: problem.detail });
    return problem.draftOnly ? t('documents.designer.problems.draftOnly', { text }) : text;
  };
  const problemsOf = (elementId: string | undefined) => problems.filter((problem) => problem.elementId === elementId).map(problemText);

  const remember = (next: PdfFormat) => {
    setSaved(next);
    queryClient.setQueryData(documentQueryKeys.format(workflowId, next.id), next);
  };
  const save = useMutation({
    mutationFn: (toSave: PdfCanvasDesign) => updatePdfFormat(client, workflowId, format.id, { design: toSave }),
    onSuccess: async (next, toSave) => {
      remember(next);
      setSavedDesign(toSave);
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.formats(workflowId) });
    },
  });
  const canSave = canEdit && dirty && blocking.length === 0 && !save.isPending;

  const selectedSet = new Set(selection);
  const size = sheetSizeOf(design);
  // The sheet opens at the largest zoom that fits the width of the space it has (the person can change it).
  useLayoutEffect(() => {
    const width = scroller.current?.clientWidth ?? 0;
    if (width === 0) return;
    const fitting = ZOOMS.filter((value) => size.width * PX_PER_MM * value <= width - SCROLLER_PADDING_PX);
    setZoom(fitting.at(-1) ?? ZOOMS[0]);
    // Only when the designer opens: later the person chooses.
  }, []);
  const single = selection.length === 1 ? design.elements.find((element) => element.id === selection[0]) : undefined;

  const add = useCallback(
    (droppable: Droppable, x = size.width / 2, y = size.height / 3) => {
      let element: CanvasElement;
      if ('tool' in droppable) {
        const tableField = current.fields.find((field) => field.type === 'TABLE');
        element = createElement(droppable.tool, { x, y }, sheet, size, { name: t(`documents.canvas.tools.${droppable.tool}`), tableField });
      } else {
        const field = current.fields.find((candidate) => candidate.code === droppable.field);
        if (field === undefined) return;
        element =
          field.type === 'TABLE'
            ? createElement('table', { x, y }, sheet, size, { name: field.label, tableField: field })
            : createElement('text', { x, y }, sheet, size, { name: field.label, content: `${field.label}: ${fieldPlaceholder(field)}` });
      }
      history.change((previous) => ({ ...previous, elements: [...previous.elements, element] }));
      setSelection([element.id]);
    },
    [current.fields, history, sheet, size, t],
  );

  const removeSelected = useCallback(() => {
    if (selection.length === 0) return;
    history.change((previous) => removeElements(previous, new Set(selection)));
    setSelection([]);
  }, [history, selection]);

  const duplicateSelected = useCallback(() => {
    if (selection.length === 0) return;
    const result = duplicateElements(design, new Set(selection));
    history.change(() => result.design);
    setSelection(result.copies);
  }, [design, history, selection]);

  const copySelected = useCallback(() => {
    const chosen = design.elements.filter((element) => selection.includes(element.id));
    if (chosen.length === 0) return;
    copyElements(chosen);
    setCanPaste(true);
  }, [design, selection]);

  const paste = useCallback(() => {
    const copied = copiedElements();
    if (copied === null) return;
    const result = pasteElements(design, copied, sheet);
    history.change(() => result.design);
    setSelection(result.copies);
  }, [design, history, sheet]);

  // Keys: save, undo and redo, copy, cut and paste, delete, duplicate, select all, deselect, and the arrows nudge the selection.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && key === 's') {
        event.preventDefault();
        if (canSave) save.mutate(design);
        return;
      }
      if (typing(event.target) || readOnly) return;
      if (command && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
      } else if (command && key === 'y') {
        event.preventDefault();
        history.redo();
      } else if (command && key === 'd') {
        event.preventDefault();
        duplicateSelected();
      } else if (command && key === 'c' && selection.length > 0) {
        event.preventDefault();
        copySelected();
      } else if (command && key === 'x' && selection.length > 0) {
        event.preventDefault();
        copySelected();
        removeSelected();
      } else if (command && key === 'v') {
        event.preventDefault();
        paste();
      } else if (command && key === 'a') {
        event.preventDefault();
        setSelection(design.elements.filter((element) => isOnSheet(element, sheet)).map((element) => element.id));
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.length > 0) {
          event.preventDefault();
          removeSelected();
        }
      } else if (event.key === 'Escape') {
        setSelection([]);
      } else if (event.key.startsWith('Arrow') && selection.length > 0) {
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_FAR_MM : NUDGE_MM;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        history.change((previous) => updateElements(previous, selectedSet, (element) => (element.locked ? element : { ...element, x: roundMm(element.x + dx), y: roundMm(element.y + dy) })), 'nudge');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Leaving with unsaved work asks first: in the app, and when the tab is closed or reloaded.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const pickSheet = (next: number) => {
    setSheet(next);
    setSelection([]);
  };
  const problemIds = new Set(problems.flatMap((problem) => (problem.elementId === undefined ? [] : [problem.elementId])));
  const pageProblems = problemsOf(undefined);

  return (
    <CanvasImagesContext.Provider value={canvasImages}>
      {breadcrumb(saved.name)}
      <PageHeader
        title={saved.name}
        subtitle={saved.description ?? t('documents.canvas.subtitle')}
        actions={
          canEdit ? (
            <div className={styles.toolbarGroup}>
              <span className={styles.note} role="status">
                {save.isPending ? t('saving') : dirty ? t('builder.dirty') : t('documents.designer.saved')}
              </span>
              <Button onClick={() => setSettings(true)}>{t('documents.designer.settings.open')}</Button>
              <Button variant="brand" disabled={!canSave} onClick={() => save.mutate(design)}>
                {t('save')}
              </Button>
            </div>
          ) : undefined
        }
      />
      {!saved.isActive && <Alert tone="warn">{t('documents.designer.inactive')}</Alert>}
      {blocking.length > 0 && <Alert tone="warn">{t('documents.canvas.cannotSave', { count: blocking.length })}</Alert>}
      <DocumentError error={save.error} />

      <div className={styles.workspace}>
        <div className={styles.side}>
          <CanvasPalette document={current} disabled={readOnly} onAdd={(droppable) => add(droppable)} />
          <LayersPanel
            design={design}
            sheet={sheet}
            selection={selection}
            problems={problemIds}
            disabled={readOnly}
            onSelect={setSelection}
            onLayer={(id, to) => history.change((previous) => moveLayer(previous, id, to))}
            onToggleLock={(id) => history.change((previous) => updateElements(previous, new Set([id]), (element) => ({ ...element, locked: !element.locked })))}
          />
        </div>

        <div className={styles.stage}>
          <SheetTabs design={design} sheet={sheet} disabled={readOnly} onPick={pickSheet} onAdd={() => (history.change(addSheet), pickSheet(design.sheets.length))} />
          <div className={styles.toolbar} role="toolbar" aria-label={t('documents.canvas.toolbar')}>
            <div className={styles.toolbarGroup}>
              <button type="button" className={styles.iconButton} disabled={readOnly || !history.canUndo} aria-label={t('documents.canvas.undo')} title={t('documents.canvas.undo')} onClick={history.undo}>
                ↶
              </button>
              <button type="button" className={styles.iconButton} disabled={readOnly || !history.canRedo} aria-label={t('documents.canvas.redo')} title={t('documents.canvas.redo')} onClick={history.redo}>
                ↷
              </button>
            </div>
            <div className={styles.toolbarGroup}>
              <Select label={t('documents.canvas.zoom')} options={ZOOMS.map((value) => ({ value: String(value), label: `${Math.round(value * 100)} %` }))} value={String(zoom)} onChange={(event) => setZoom(Number(event.target.value))} />
              <Select label={t('documents.canvas.grid')} options={GRIDS.map((value) => ({ value, label: value === '0' ? t('documents.canvas.gridOff') : `${value} mm` }))} value={grid === null ? '0' : String(grid)} onChange={(event) => setGrid(event.target.value === '0' ? null : Number(event.target.value))} />
              <Checkbox label={t('documents.canvas.showGrid')} checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
            </div>
            {selection.length > 1 && !readOnly && (
              <div className={styles.toolbarGroup} role="group" aria-label={t('documents.canvas.align')}>
                {ALIGNMENTS.map((alignment) => (
                  <button key={alignment} type="button" className={styles.iconButton} aria-label={t(`documents.canvas.alignments.${alignment}`)} title={t(`documents.canvas.alignments.${alignment}`)} onClick={() => history.change((previous) => alignElements(previous, selectedSet, alignment))}>
                    {t(`documents.canvas.alignmentIcons.${alignment}`)}
                  </button>
                ))}
              </div>
            )}
            {!readOnly && (selection.length > 0 || canPaste) && (
              <div className={styles.toolbarGroup}>
                {selection.length > 0 && (
                  <Button variant="ghost" title={t('documents.canvas.copyHint')} onClick={copySelected}>
                    {t('documents.canvas.copy')}
                  </Button>
                )}
                {canPaste && (
                  <Button variant="ghost" title={t('documents.canvas.pasteHint')} onClick={paste}>
                    {t('documents.canvas.paste')}
                  </Button>
                )}
              </div>
            )}
            {selection.length > 0 && !readOnly && (
              <div className={styles.toolbarGroup}>
                <Button variant="ghost" onClick={duplicateSelected}>
                  {t('documents.canvas.duplicate')}
                </Button>
                <Button variant="ghost" onClick={removeSelected}>
                  {t('remove')}
                </Button>
              </div>
            )}
          </div>
          <div ref={scroller} className={styles.scroller}>
            <CanvasSheet
              design={design}
              sheet={sheet}
              zoom={zoom}
              selection={selection}
              onSelect={setSelection}
              grid={grid}
              showGrid={showGrid}
              readOnly={readOnly}
              onPreview={history.preview}
              onCommit={history.commit}
              onChange={history.change}
              onDrop={(droppable, x, y) => add(droppable, x, y)}
            />
          </div>
          <p className={styles.note}>{t('documents.canvas.keysHint')}</p>
        </div>

        <div className={styles.side}>
          {single === undefined ? (
            <PageProperties design={design} sheet={sheet} problems={pageProblems} disabled={readOnly} onChange={(next, key) => history.change(() => next, key)} onSheet={pickSheet} />
          ) : (
            <ElementProperties
              key={single.id}
              element={single}
              design={design}
              document={current}
              problems={problemsOf(single.id)}
              disabled={readOnly}
              onChange={(next, key) => history.change((previous) => ({ ...previous, elements: previous.elements.map((element) => (element.id === next.id ? next : element)) }), key)}
              onDuplicate={duplicateSelected}
              onRemove={removeSelected}
            />
          )}
        </div>
      </div>

      <PreviewPane workflowId={workflowId} formatId={format.id} savedAt={saved.updatedAt} dirty={dirty} />
      {settings && <FormatSettingsDialog workflowId={workflowId} format={saved} document={current} onSaved={remember} onClose={() => setSettings(false)} />}
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
          <p className={styles.note}>{t('documents.designer.leave')}</p>
        </Dialog>
      )}
    </CanvasImagesContext.Provider>
  );
}
