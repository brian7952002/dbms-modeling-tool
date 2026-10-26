import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type Tool, type Viewport } from './platform/Canvas';
import { Toolbar, type ToolbarAction } from './app/Toolbar';
import { Palette } from './platform/Palette';
import { IssuesPanel } from './platform/IssuesPanel';
import { Modal } from './platform/Modal';
import { cloneSelection, tidyAttributePlan } from './platform/actions';
import { useDiagramDoc } from './platform/collab/useDiagramDoc';
import type { Diagram, Id, Point } from './platform/types';
import { newId } from './platform/ids';
import { nodeBounds, orbitSlot } from './platform/geometry';
import {
  decodeShare,
  downloadBlob,
  encodeShare,
  fromFile,
  slugify,
  toFile,
} from './platform/serialize';
import { toPngBlob, toSvgString } from './platform/export/image';
import { getModel, type ModelId } from './ecosystem/registry';
import { ModelPicker } from './ecosystem/ModelPicker';
import { LibraryModal } from './app/LibraryModal';
import { listDiagrams, loadDiagram, saveDiagram, type LocalDiagram } from './local/library';

const STORAGE_KEY = 'eer-designer:autosave:v1';
/**
 * Which library entry the canvas was bound to when the tab was last open.
 *
 * Without this a reload restores the drawing but forgets where it came from,
 * so the diagram reads "Not saved yet" and every edit after that quietly stops
 * reaching the entry it belongs to — which is exactly how work gets lost.
 */
const CURRENT_KEY = 'eer-designer:current:v1';
const PREFS_KEY = 'eer-designer:prefs:v1';

interface Prefs {
  theme: 'light' | 'dark';
  showGrid: boolean;
  snapOn: boolean;
  showIssues: boolean;
}

const DEFAULT_PREFS: Prefs = {
  theme: 'light',
  showGrid: true,
  snapOn: true,
  showIssues: true,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function loadAutosave(): { diagram: Diagram; title: string; model: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return fromFile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export default function App() {
  const restored = useRef(loadAutosave());
  // Which modelling tool is open. Everything model-specific — shapes, palette,
  // inspector, checks, exports — is reached through it.
  const [modelId, setModelId] = useState<ModelId>(
    (restored.current?.model as ModelId) ?? 'eer',
  );
  const model = useMemo(() => getModel(modelId), [modelId]);
  const {
    diagram,
    title,
    selection,
    dispatch,
    canUndo,
    canRedo,
    sourceDiagramId,
    setSourceDiagramId,
    revision,
    reset: resetDoc,
  } = useDiagramDoc(
    restored.current ?? { diagram: getModel('eer').samples[0].build(), title: 'Company schema' },
    model,
  );

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [tool, setTool] = useState<Tool>('select');
  const [viewport, setViewport] = useState<Viewport>({ x: 40, y: 40, k: 0.75 });
  const [modal, setModal] = useState<
    null | 'help' | 'sql' | 'share' | 'library' | 'models'
  >(null);
  /** The library entry this canvas is bound to, once it has been saved. */
  const [savedAs, setSavedAs] = useState<LocalDiagram | null>(null);
  const [saveState, setSaveState] = useState<
    'idle' | 'pending' | 'saving' | 'saved' | 'error'
  >('idle');
  const skipAutosave = useRef(true);
  const [shareUrl, setShareUrl] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 3200);
  }, []);

  /* ---- validation ------------------------------------------------------ */

  /**
   * A derived model — an instance diagram — is checked against another
   * diagram. The options come from the library, because a schema you can check
   * against has to be one you can actually open.
   */
  const [sourceOptions, setSourceOptions] = useState<{ id: string; title: string }[]>([]);
  const [sourceDiagram, setSourceDiagram] = useState<Diagram | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  useEffect(() => {
    if (!model.derivesFrom) {
      setSourceOptions([]);
      return;
    }
    let live = true;
    listDiagrams()
      .then((rows) => {
        if (!live) return;
        setSourceOptions(
          rows
            .filter((r) => r.model === model.derivesFrom)
            .map((r) => ({ id: r.id, title: r.title })),
        );
      })
      .catch(() => setSourceOptions([]));
    return () => {
      live = false;
    };
    // Re-read after a save, so a schema saved a moment ago is offered here.
  }, [model.derivesFrom, savedAs?.updatedAt]);

  useEffect(() => {
    if (!model.derivesFrom || !sourceDiagramId) {
      setSourceDiagram(null);
      return;
    }
    let live = true;
    setSourceLoading(true);
    loadDiagram(sourceDiagramId)
      .then((stored) => {
        if (live) setSourceDiagram(stored ? fromFile(stored.file).diagram : null);
      })
      .catch(() => {
        if (live) setSourceDiagram(null);
      })
      .finally(() => {
        if (live) setSourceLoading(false);
      });
    return () => {
      live = false;
    };
  }, [model.derivesFrom, sourceDiagramId]);

  const sourceLink = useMemo(
    () =>
      model.derivesFrom
        ? {
            options: sourceOptions,
            currentId: sourceDiagramId,
            onChange: (id: string | null) => setSourceDiagramId(id),
            loading: sourceLoading,
            unavailable:
              sourceOptions.length === 0
                ? 'Save the schema to your diagrams first, then link it here.'
                : undefined,
          }
        : undefined,
    [model.derivesFrom, sourceOptions, sourceDiagramId, setSourceDiagramId, sourceLoading],
  );

  const issues = useMemo(
    () => model.validate(diagram, { source: sourceDiagram }),
    [model, diagram, sourceDiagram],
  );
  const issueByNode = useMemo(() => {
    const map = new Map<Id, 'error' | 'warning'>();
    for (const i of issues) {
      if (i.severity === 'info') continue;
      for (const t of i.targets) {
        if (i.severity === 'error' || !map.has(t)) map.set(t, i.severity);
      }
    }
    return map;
  }, [issues]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  /* ---- persistence ----------------------------------------------------- */

  useEffect(() => {
    void revision;
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(toFile(diagram, title, modelId)),
        );
      } catch {
        /* private mode or quota — autosave is a convenience, not a guarantee */
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [diagram, title, modelId]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs]);

  /* ---- saving to this browser ------------------------------------------ */

  /** Binds the canvas to a library entry without provoking an immediate re-save. */
  const bindSaved = useCallback((meta: LocalDiagram | null) => {
    skipAutosave.current = true;
    setSavedAs(meta);
    setSaveState(meta ? 'saved' : 'idle');
    try {
      if (meta) localStorage.setItem(CURRENT_KEY, meta.id);
      else localStorage.removeItem(CURRENT_KEY);
    } catch {
      /* private mode — the binding is a convenience, not a guarantee */
    }
  }, []);

  // Re-bind to the entry this tab was last editing, so a reload picks up where
  // it left off instead of silently detaching from the library.
  useEffect(() => {
    let id: string | null = null;
    try {
      id = localStorage.getItem(CURRENT_KEY);
    } catch {
      return;
    }
    if (!id) return;
    let live = true;
    loadDiagram(id)
      .then((stored) => {
        if (!live || !stored) return;
        skipAutosave.current = true;
        setSavedAs(stored);
        setSaveState('saved');
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Runs once on mount, against whatever the autosave restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once a diagram has been saved once, every later edit goes back to the same
  // entry on its own. The delay keeps a burst of dragging from writing to the
  // store on every frame.
  useEffect(() => {
    if (!savedAs) return;
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    setSaveState('pending');
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        const meta = await saveDiagram(savedAs.id, toFile(diagram, title, modelId));
        setSavedAs(meta);
        setSaveState('saved');
      } catch (err) {
        setSaveState('error');
        notify(err instanceof Error ? err.message : 'Could not save that.');
      }
    }, 1200);
    return () => window.clearTimeout(timer);
    // savedAs.id is the identity that matters; the object itself is replaced on
    // every successful save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram, title, modelId, savedAs?.id]);

  /** Opens a stored diagram, replacing whatever is on the canvas. */
  const openFromLibrary = useCallback(
    (meta: LocalDiagram, loaded: Diagram, loadedTitle: string, loadedModel: string) => {
      setModelId((loadedModel as ModelId) ?? 'eer');
      resetDoc({
        diagram: loaded,
        title: loadedTitle,
        kind: loadedModel === 'instance' ? 'instance' : 'eer',
      });
      bindSaved(meta);
    },
    [bindSaved, resetDoc],
  );

  /** Saves the canvas, creating a library entry the first time. */
  const saveToLibrary = useCallback(async () => {
    setSaveState('saving');
    try {
      const existing = savedAs;
      const meta = await saveDiagram(existing?.id ?? null, toFile(diagram, title, modelId));
      bindSaved(meta);
      notify(existing ? 'Saved.' : `Saved “${meta.title}” to this browser.`);
    } catch (err) {
      setSaveState('error');
      notify(err instanceof Error ? err.message : 'Could not save that.');
    }
  }, [bindSaved, diagram, modelId, notify, savedAs, title]);

  /* ---- viewport helpers ------------------------------------------------ */

  const fitToView = useCallback(
    (target: Diagram = diagram) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const b = nodeBounds(target.nodes, 60);
      if (!rect || !b) {
        setViewport({ x: 40, y: 40, k: 1 });
        return;
      }
      const k = Math.min(
        2,
        Math.max(0.15, Math.min(rect.width / (b.maxX - b.minX), rect.height / (b.maxY - b.minY))),
      );
      setViewport({
        k,
        x: rect.width / 2 - ((b.minX + b.maxX) / 2) * k,
        y: rect.height / 2 - ((b.minY + b.maxY) / 2) * k,
      });
    },
    [diagram],
  );

  // Frame whatever was restored or bundled once the layout has a size.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => fitToView());
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- open a shared link --------------------------------------------- */

  // Sits below fitToView so a diagram arriving from a link can be framed. The
  // mount-time fit above has already run against whatever was restored, and a
  // link's diagram lands one round trip later, so each load refits explicitly.
  useEffect(() => {
    const hash = window.location.hash;
    const clearHash = () =>
      history.replaceState(null, '', window.location.pathname + window.location.search);
    const show = (diagram: Diagram, title: string, message: string) => {
      dispatch({ type: 'load', diagram, title, resetHistory: true });
      notify(message);
      clearHash();
      window.requestAnimationFrame(() => fitToView(diagram));
    };

    // The link carries the whole diagram, so it needs nothing from a server
    // and opens as an unsaved copy.
    if (hash.startsWith('#d=')) {
      decodeShare(hash.slice(3))
        .then((file) => {
          const { diagram, title } = fromFile(file);
          show(diagram, title, `Opened “${title}” from the link.`);
        })
        .catch(() => notify('That share link could not be read.'));
      return;
    }

    // Runs once on mount, deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const centerOfView = useCallback((): Point => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (rect.width / 2 - viewport.x) / viewport.k,
      y: (rect.height / 2 - viewport.y) / viewport.k,
    };
  }, [viewport]);

  const zoomBy = (factor: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const cx = (rect?.width ?? 0) / 2;
    const cy = (rect?.height ?? 0) / 2;
    setViewport((v) => {
      const k = Math.min(4, Math.max(0.15, v.k * factor));
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  };

  /* ---- editing helpers ------------------------------------------------- */

  /**
   * Drops a shape at `p`, stepping diagonally away if something is already
   * there — clicking the palette twice should never stack two shapes.
   */
  const addNodeAt = useCallback(
    (kind: string, p: Point) => {
      let { x, y } = p;
      for (let i = 0; i < 40; i++) {
        const clash = diagram.nodes.some(
          (n) => Math.abs(n.x - x) < n.w / 2 + 40 && Math.abs(n.y - y) < n.h / 2 + 30,
        );
        if (!clash) break;
        x += 36;
        y += 30;
      }
      dispatch({ type: 'addNode', kind, x, y });
    },
    [diagram.nodes],
  );

  /**
   * Places a new attribute in clear space around its owner and wires it up, so
   * building out an entity never requires manual dragging.
   */
  const addAttribute = useCallback(
    (ownerId: Id) => {
      const owner = diagram.nodes.find((n) => n.id === ownerId);
      if (!owner) return;
      const siblings = diagram.edges
        .filter((e) => e.kind === 'attribute' && e.target === ownerId)
        .map((e) => diagram.nodes.find((n) => n.id === e.source))
        .filter((n): n is NonNullable<typeof n> => !!n);

      const node = model.createNode('attribute', owner.x, owner.y);
      const spot = orbitSlot(owner, node, diagram.nodes, siblings);
      node.x = spot.x;
      node.y = spot.y;
      dispatch({
        type: 'insertNodes',
        nodes: [node],
        edges: [{ id: newId('e'), kind: 'attribute', source: node.id, target: ownerId }],
      });
    },
    [diagram, model],
  );

  /**
   * Re-orbits the attributes of each owner into clear space, in one undo step.
   */
  const tidyAttributes = useCallback(
    (ownerIds: Id[]) => {
      const moves = tidyAttributePlan(diagram, ownerIds);
      if (moves.length === 0) return;
      dispatch({ type: 'begin' });
      for (const m of moves) {
        dispatch({ type: 'updateNode', id: m.id, patch: { x: m.x, y: m.y }, transient: true });
      }
    },
    [diagram],
  );

  const align = useCallback(
    (axis: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => {
      const nodes = diagram.nodes.filter((n) => selection.includes(n.id));
      if (nodes.length < 2) return;
      const b = nodeBounds(nodes)!;
      dispatch({ type: 'begin' });
      for (const n of nodes) {
        const patch: { x?: number; y?: number } = {};
        if (axis === 'left') patch.x = b.minX + n.w / 2;
        if (axis === 'right') patch.x = b.maxX - n.w / 2;
        if (axis === 'centerX') patch.x = (b.minX + b.maxX) / 2;
        if (axis === 'top') patch.y = b.minY + n.h / 2;
        if (axis === 'bottom') patch.y = b.maxY - n.h / 2;
        if (axis === 'centerY') patch.y = (b.minY + b.maxY) / 2;
        dispatch({ type: 'updateNode', id: n.id, patch, transient: true });
      }
    },
    [diagram.nodes, selection],
  );

  const distribute = useCallback(
    (axis: 'x' | 'y') => {
      const nodes = diagram.nodes
        .filter((n) => selection.includes(n.id))
        .sort((a, b) => a[axis] - b[axis]);
      if (nodes.length < 3) return;
      const first = nodes[0][axis];
      const last = nodes[nodes.length - 1][axis];
      const step = (last - first) / (nodes.length - 1);
      dispatch({ type: 'begin' });
      nodes.forEach((n, i) => {
        dispatch({
          type: 'updateNode',
          id: n.id,
          patch: { [axis]: first + step * i } as { x: number } | { y: number },
          transient: true,
        });
      });
    },
    [diagram.nodes, selection],
  );

  /* ---- file / export actions ------------------------------------------ */

  const saveJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(toFile(diagram, title), null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, `${slugify(title)}.eer.json`);
  }, [diagram, title]);

  const openJson = useCallback(
    async (file: File) => {
      try {
        const parsed = fromFile(JSON.parse(await file.text()));
        dispatch({ type: 'load', ...parsed, resetHistory: true });
        bindSaved(null);
        window.requestAnimationFrame(() => fitToView(parsed.diagram));
        notify(`Opened “${parsed.title}”.`);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'That file could not be opened.');
      }
    },
    [bindSaved, fitToView, notify],
  );

  const exportSvg = useCallback(() => {
    if (!svgRef.current) return;
    const source = toSvgString(svgRef.current, diagram);
    downloadBlob(new Blob([source], { type: 'image/svg+xml' }), `${slugify(title)}.svg`);
  }, [diagram, title]);

  const exportPng = useCallback(async () => {
    if (!svgRef.current) return;
    try {
      const blob = await toPngBlob(svgRef.current, diagram, 2);
      downloadBlob(blob, `${slugify(title)}.png`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'PNG export failed.');
    }
  }, [diagram, title, notify]);

  const makeShareLink = useCallback(async () => {
    const payload = await encodeShare(toFile(diagram, title));
    const url = `${window.location.origin}${window.location.pathname}#d=${payload}`;
    setShareUrl(url);
    setModal('share');
  }, [diagram, title]);

  const loadSample = useCallback(
    (sampleId: string) => {
      const sample = model.samples.find((x) => x.id === sampleId) ?? model.samples[0];
      if (!sample) return;
      const diagram = sample.build();
      const title = sample.title;
      dispatch({ type: 'load', diagram, title, resetHistory: true });
      bindSaved(null);
      window.requestAnimationFrame(() => fitToView(diagram));
    },
    [bindSaved, fitToView, model, dispatch],
  );

  const onToolbarAction = useCallback(
    (action: ToolbarAction) => {
      if (action.startsWith('sample:')) {
        loadSample(action.slice('sample:'.length));
        return;
      }
      switch (action) {
        case 'new':
          dispatch({
            type: 'load',
            diagram: model.createEmpty(),
            title: 'Untitled diagram',
            resetHistory: true,
          });
          bindSaved(null);
          setViewport({ x: 40, y: 40, k: 1 });
          break;
        case 'open':
          fileInput.current?.click();
          break;
        case 'save':
          saveJson();
          break;
        case 'models':
          setModal('models');
          break;
        case 'derive': {
          // Producing the next model in the process: the result opens as a new
          // diagram of that kind, leaving the source untouched.
          const recipe = model.derive;
          if (!recipe) break;
          const produced = recipe.build(diagram);
          const tool = getModel(recipe.to);
          setModelId(recipe.to);
          dispatch({
            type: 'load',
            diagram: produced.diagram,
            title: `${title} — ${tool.label.split('—').pop()?.trim() ?? 'derived'}`,
            resetHistory: true,
          });
          bindSaved(null);
          window.requestAnimationFrame(() => fitToView(produced.diagram));
          const warned = produced.warnings?.length ?? 0;
          notify(
            warned > 0
              ? `Generated ${produced.diagram.nodes.length} tables · ${warned} mapping warning${warned === 1 ? '' : 's'} in the SQL view.`
              : `Generated ${produced.diagram.nodes.length} tables from “${title}”.`,
          );
          break;
        }
        case 'export-svg':
          exportSvg();
          break;
        case 'export-png':
          void exportPng();
          break;
        case 'sql':
          setModal('sql');
          break;
        case 'share':
          void makeShareLink();
          break;
        case 'undo':
          dispatch({ type: 'undo' });
          break;
        case 'redo':
          dispatch({ type: 'redo' });
          break;
        case 'zoom-in':
          zoomBy(1.25);
          break;
        case 'zoom-out':
          zoomBy(0.8);
          break;
        case 'zoom-reset':
          setViewport((v) => ({ ...v, k: 1 }));
          break;
        case 'fit':
          fitToView();
          break;
        case 'toggle-grid':
          setPrefs((p) => ({ ...p, showGrid: !p.showGrid }));
          break;
        case 'toggle-snap':
          setPrefs((p) => ({ ...p, snapOn: !p.snapOn }));
          break;
        case 'toggle-theme':
          setPrefs((p) => ({ ...p, theme: p.theme === 'light' ? 'dark' : 'light' }));
          break;
        case 'toggle-issues':
          setPrefs((p) => ({ ...p, showIssues: !p.showIssues }));
          break;
        case 'library':
          setModal('library');
          break;
        case 'save-to-library':
          void saveToLibrary();
          break;
        case 'help':
          setModal('help');
          break;
      }
    },
    [
      bindSaved,
      notify,
      exportPng,
      exportSvg,
      fitToView,
      loadSample,
      makeShareLink,
      model,
      saveJson,
      saveToLibrary,
    ],
  );

  /* ---- keyboard -------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveJson();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const copy = cloneSelection(diagram, selection);
        if (copy.nodes.length > 0) dispatch({ type: 'insertNodes', ...copy });
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        dispatch({ type: 'select', ids: diagram.nodes.map((n) => n.id) });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        dispatch({ type: 'deleteSelection' });
        return;
      }
      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'c' || e.key === 'C') setTool('connect');
      if (e.key === 'f' || e.key === 'F') fitToView();

      if (e.key.startsWith('Arrow') && selection.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        dispatch({ type: 'begin' });
        dispatch({ type: 'moveNodes', ids: selection, dx, dy });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitToView, saveJson, diagram, selection]);

  /* ---- render ---------------------------------------------------------- */

  const saveStatus = useMemo(() => {
    if (!savedAs) return 'Not saved yet';
    switch (saveState) {
      case 'saving':
        return 'Saving…';
      case 'pending':
        return 'Unsaved changes';
      case 'error':
        return 'Save failed';
      default:
        return `Saved · ${savedAs.title}`;
    }
  }, [savedAs, saveState]);

  const ddl = useMemo(
    () => (modal === 'sql' ? (model.exports?.sql?.(diagram, title) ?? null) : null),
    [modal, model, diagram, title],
  );

  return (
    <div className="app" data-theme={prefs.theme}>
      <Toolbar
        title={title}
        modelLabel={model.label}
        samples={model.samples.map((s) => ({ id: s.id, title: s.title }))}
        deriveLabel={model.derive?.label ?? null}
        tool={tool}
        setTool={setTool}
        canUndo={canUndo}
        canRedo={canRedo}
        errorCount={errorCount}
        warningCount={warningCount}
        showGrid={prefs.showGrid}
        snapOn={prefs.snapOn}
        theme={prefs.theme}
        saveStatus={saveStatus}
        onAction={onToolbarAction}
      />

      <div className="workspace">
        <div className="left-rail">
          <Palette items={model.palette} onAdd={(kind) => addNodeAt(kind, centerOfView())} />
        </div>

        <div className="canvas-wrap" ref={wrapRef}>
          <Canvas
            model={model}
            diagram={diagram}
            selection={selection}
            dispatch={dispatch}
            tool={tool}
            viewport={viewport}
            setViewport={setViewport}
            theme={prefs.theme}
            showGrid={prefs.showGrid}
            snap={prefs.snapOn ? 10 : 0}
            issues={issueByNode}
            onAddNodeAt={addNodeAt}
            svgRef={svgRef}
          />
          {prefs.showIssues && (
            <IssuesPanel
              issues={issues}
              onSelect={(ids) => dispatch({ type: 'select', ids })}
              onClose={() => setPrefs((p) => ({ ...p, showIssues: false }))}
            />
          )}
        </div>

        <div className="right-rail">
          <model.Inspector
            sourceLink={sourceLink}
            diagram={diagram}
            selection={selection}
            title={title}
            dispatch={dispatch}
            onAddAttribute={addAttribute}
            onTidyAttributes={tidyAttributes}
            onAlign={align}
            onDistribute={distribute}
          />
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openJson(file);
          e.target.value = '';
        }}
      />

      {modal === 'help' && (
        <Modal title={`${model.label} — guide`} onClose={() => setModal(null)} wide>
          <model.Help />
        </Modal>
      )}

      {modal === 'sql' && ddl && (
        <Modal
          title="Generated relational schema"
          onClose={() => setModal(null)}
          wide
          footer={
            <>
              <span className="panel-hint">
                {ddl.warnings.length > 0
                  ? `${ddl.warnings.length} mapping warning${ddl.warnings.length === 1 ? '' : 's'} — see the comments at the end.`
                  : 'Mapped with no warnings.'}
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(ddl.sql);
                  notify('SQL copied to the clipboard.');
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="primary"
                onClick={() =>
                  downloadBlob(
                    new Blob([ddl.sql], { type: 'application/sql' }),
                    `${slugify(title)}.sql`,
                  )
                }
              >
                Download .sql
              </button>
            </>
          }
        >
          <pre className="code">{ddl.sql}</pre>
        </Modal>
      )}

      {modal === 'share' && (
        <Modal
          title="Shareable link"
          onClose={() => setModal(null)}
          footer={
            <>
              <span className="panel-hint">
                {shareUrl.length > 8000
                  ? 'This link is very long and some tools may truncate it — send the .eer.json file instead.'
                  : `${shareUrl.length} characters.`}
              </span>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl);
                  notify('Link copied to the clipboard.');
                }}
              >
                Copy link
              </button>
            </>
          }
        >
          <p>
            The whole diagram is compressed into the link itself, so anyone who opens it gets an
            editable copy. Nothing is uploaded anywhere.
          </p>
          <textarea className="share-box" readOnly value={shareUrl} rows={5} onFocus={(e) => e.target.select()} />
        </Modal>
      )}

      {modal === 'models' && (
        <ModelPicker
          activeId={modelId}
          onClose={() => setModal(null)}
          onChoose={(chosen) => {
            const tool = getModel(chosen);
            setModelId(chosen);
            dispatch({
              type: 'load',
              diagram: tool.createEmpty(),
              title: `Untitled ${tool.label.split('—').pop()?.trim() ?? 'diagram'}`,
              resetHistory: true,
            });
            bindSaved(null);
            setViewport({ x: 40, y: 40, k: 1 });
            setModal(null);
          }}
        />
      )}

      {modal === 'library' && (
        <LibraryModal
          onClose={() => setModal(null)}
          diagram={diagram}
          title={title}
          model={modelId}
          currentId={savedAs?.id ?? null}
          onOpened={(meta, loadedDiagram, loadedTitle, loadedModel) => {
            openFromLibrary(meta, loadedDiagram, loadedTitle, loadedModel);
            window.requestAnimationFrame(() => fitToView(loadedDiagram));
          }}
          onSaved={bindSaved}
          notify={notify}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
