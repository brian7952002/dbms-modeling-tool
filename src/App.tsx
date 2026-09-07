import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Canvas, type Tool, type Viewport } from './components/Canvas';
import { Toolbar, type ToolbarAction } from './components/Toolbar';
import { Palette } from './components/Palette';
import { Inspector } from './components/Inspector';
import { IssuesPanel } from './components/IssuesPanel';
import { Modal } from './components/Modal';
import { HelpContent } from './components/HelpContent';
import { cloneSelection, initialState, reducer } from './state/store';
import type { Diagram, Id, NodeKind, Point } from './model/types';
import { emptyDiagram } from './model/types';
import { createNode, newId } from './model/factory';
import { nodeBounds } from './model/geometry';
import { validate } from './model/validate';
import { generateDdl } from './model/ddl';
import { companySample, categorySample } from './model/samples';
import {
  decodeShare,
  downloadBlob,
  encodeShare,
  fromFile,
  slugify,
  toFile,
} from './model/serialize';
import { toPngBlob, toSvgString } from './export/image';
import { useAuth } from './cloud/auth';
import { AccountModal } from './components/AccountModal';
import { LibraryModal } from './components/LibraryModal';
import {
  createDiagram,
  openDiagram,
  updateDiagram,
  type CloudDiagram,
} from './cloud/diagrams';

const STORAGE_KEY = 'eer-designer:autosave:v1';
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

function loadAutosave(): { diagram: Diagram; title: string } | null {
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
  const [state, dispatch] = useReducer(
    reducer,
    restored.current ?? { diagram: companySample(), title: 'Company schema' },
    initialState,
  );

  const auth = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [tool, setTool] = useState<Tool>('select');
  const [viewport, setViewport] = useState<Viewport>({ x: 40, y: 40, k: 0.75 });
  const [modal, setModal] = useState<
    null | 'help' | 'sql' | 'share' | 'account' | 'library'
  >(null);
  /** The cloud row this canvas is currently bound to, if any. */
  const [cloudDoc, setCloudDoc] = useState<CloudDiagram | null>(null);
  const [cloudState, setCloudState] = useState<
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

  const issues = useMemo(() => validate(state.diagram), [state.diagram]);
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
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(toFile(state.diagram, state.title)),
        );
      } catch {
        /* private mode or quota — autosave is a convenience, not a guarantee */
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [state.diagram, state.title]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs]);

  /* ---- open a shared link --------------------------------------------- */

  useEffect(() => {
    const hash = window.location.hash;
    const clearHash = () =>
      history.replaceState(null, '', window.location.pathname + window.location.search);

    if (hash.startsWith('#d=')) {
      decodeShare(hash.slice(3))
        .then((file) => {
          const { diagram, title } = fromFile(file);
          dispatch({ type: 'load', diagram, title, resetHistory: true });
          notify(`Opened “${title}” from the link.`);
          clearHash();
        })
        .catch(() => notify('That share link could not be read.'));
      return;
    }

    // A published cloud diagram opens as an editable copy bound to nothing, so
    // editing it can never overwrite the original.
    if (hash.startsWith('#c=')) {
      openDiagram(hash.slice(3))
        .then(({ diagram, title }) => {
          dispatch({ type: 'load', diagram, title, resetHistory: true });
          setCloudDoc(null);
          notify(`Opened a shared copy of “${title}”.`);
          clearHash();
        })
        .catch(() => notify('That diagram is not published, or the link has expired.'));
    }
    // Runs once on mount, deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- cloud sync ------------------------------------------------------ */

  // Once a diagram is bound to a row, edits are pushed back automatically; the
  // delay keeps a burst of dragging from turning into a burst of requests.
  useEffect(() => {
    if (!auth.user || !cloudDoc) return;
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    setCloudState('pending');
    const timer = window.setTimeout(async () => {
      setCloudState('saving');
      try {
        const meta = await updateDiagram(cloudDoc.id, state.diagram, state.title);
        setCloudDoc(meta);
        setCloudState('saved');
      } catch (err) {
        setCloudState('error');
        notify(err instanceof Error ? err.message : 'Could not save to your account.');
      }
    }, 2000);
    return () => window.clearTimeout(timer);
    // cloudDoc.id is the identity that matters; the object itself is replaced
    // on every successful save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.diagram, state.title, auth.user, cloudDoc?.id]);

  /** Binds the canvas to a cloud row without triggering an immediate re-save. */
  const bindCloudDoc = useCallback((meta: CloudDiagram | null) => {
    skipAutosave.current = true;
    setCloudDoc(meta);
    setCloudState(meta ? 'saved' : 'idle');
  }, []);

  const saveToCloud = useCallback(async () => {
    if (!auth.enabled || !auth.user) {
      setModal('account');
      return;
    }
    setCloudState('saving');
    try {
      const meta = cloudDoc
        ? await updateDiagram(cloudDoc.id, state.diagram, state.title)
        : await createDiagram(auth.user.id, state.diagram, state.title);
      bindCloudDoc(meta);
      notify(
        cloudDoc ? 'Saved to your account.' : `Saved “${meta.title}” to your account.`,
      );
    } catch (err) {
      setCloudState('error');
      notify(err instanceof Error ? err.message : 'Could not save to your account.');
    }
  }, [auth.enabled, auth.user, bindCloudDoc, cloudDoc, notify, state.diagram, state.title]);

  /* ---- viewport helpers ------------------------------------------------ */

  const fitToView = useCallback(
    (diagram: Diagram = state.diagram) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const b = nodeBounds(diagram.nodes, 60);
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
    [state.diagram],
  );

  // Frame whatever was restored or bundled once the layout has a size.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => fitToView());
    return () => window.cancelAnimationFrame(id);
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
    (kind: NodeKind, p: Point) => {
      let { x, y } = p;
      for (let i = 0; i < 40; i++) {
        const clash = state.diagram.nodes.some(
          (n) => Math.abs(n.x - x) < n.w / 2 + 40 && Math.abs(n.y - y) < n.h / 2 + 30,
        );
        if (!clash) break;
        x += 36;
        y += 30;
      }
      dispatch({ type: 'addNode', kind, x, y });
    },
    [state.diagram.nodes],
  );

  /**
   * Places a new attribute in the emptiest direction around its owner and wires
   * it up, so building out an entity never requires manual dragging.
   */
  const addAttribute = useCallback(
    (ownerId: Id) => {
      const owner = state.diagram.nodes.find((n) => n.id === ownerId);
      if (!owner) return;
      const siblings = state.diagram.edges
        .filter((e) => e.kind === 'attribute' && e.target === ownerId)
        .map((e) => state.diagram.nodes.find((n) => n.id === e.source))
        .filter((n): n is NonNullable<typeof n> => !!n);

      const used = siblings.map((s) => Math.atan2(s.y - owner.y, s.x - owner.x));
      let best = -Math.PI / 2;
      let bestGap = -1;
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2 - Math.PI;
        const gap = used.length
          ? Math.min(...used.map((u) => Math.abs(Math.atan2(Math.sin(angle - u), Math.cos(angle - u)))))
          : Infinity;
        if (gap > bestGap) {
          bestGap = gap;
          best = angle;
        }
      }
      const radius = Math.max(owner.w, owner.h) / 2 + 110;
      const node = createNode('attribute', owner.x + Math.cos(best) * radius, owner.y + Math.sin(best) * radius);
      dispatch({
        type: 'insertNodes',
        nodes: [node],
        edges: [{ id: newId('e'), kind: 'attribute', source: node.id, target: ownerId }],
      });
    },
    [state.diagram],
  );

  const align = useCallback(
    (axis: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => {
      const nodes = state.diagram.nodes.filter((n) => state.selection.includes(n.id));
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
    [state.diagram.nodes, state.selection],
  );

  const distribute = useCallback(
    (axis: 'x' | 'y') => {
      const nodes = state.diagram.nodes
        .filter((n) => state.selection.includes(n.id))
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
    [state.diagram.nodes, state.selection],
  );

  /* ---- file / export actions ------------------------------------------ */

  const saveJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(toFile(state.diagram, state.title), null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, `${slugify(state.title)}.eer.json`);
  }, [state.diagram, state.title]);

  const openJson = useCallback(
    async (file: File) => {
      try {
        const parsed = fromFile(JSON.parse(await file.text()));
        dispatch({ type: 'load', ...parsed, resetHistory: true });
        bindCloudDoc(null);
        window.requestAnimationFrame(() => fitToView(parsed.diagram));
        notify(`Opened “${parsed.title}”.`);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'That file could not be opened.');
      }
    },
    [bindCloudDoc, fitToView, notify],
  );

  const exportSvg = useCallback(() => {
    if (!svgRef.current) return;
    const source = toSvgString(svgRef.current, state.diagram);
    downloadBlob(new Blob([source], { type: 'image/svg+xml' }), `${slugify(state.title)}.svg`);
  }, [state.diagram, state.title]);

  const exportPng = useCallback(async () => {
    if (!svgRef.current) return;
    try {
      const blob = await toPngBlob(svgRef.current, state.diagram, 2);
      downloadBlob(blob, `${slugify(state.title)}.png`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'PNG export failed.');
    }
  }, [state.diagram, state.title, notify]);

  const makeShareLink = useCallback(async () => {
    const payload = await encodeShare(toFile(state.diagram, state.title));
    const url = `${window.location.origin}${window.location.pathname}#d=${payload}`;
    setShareUrl(url);
    setModal('share');
  }, [state.diagram, state.title]);

  const loadSample = useCallback(
    (which: 'company' | 'category') => {
      const diagram = which === 'company' ? companySample() : categorySample();
      const title = which === 'company' ? 'Company schema' : 'Union / category example';
      dispatch({ type: 'load', diagram, title, resetHistory: true });
      bindCloudDoc(null);
      window.requestAnimationFrame(() => fitToView(diagram));
    },
    [bindCloudDoc, fitToView],
  );

  const onToolbarAction = useCallback(
    (action: ToolbarAction) => {
      switch (action) {
        case 'new':
          dispatch({ type: 'load', diagram: emptyDiagram(), title: 'Untitled diagram', resetHistory: true });
          bindCloudDoc(null);
          setViewport({ x: 40, y: 40, k: 1 });
          break;
        case 'open':
          fileInput.current?.click();
          break;
        case 'save':
          saveJson();
          break;
        case 'sample:company':
          loadSample('company');
          break;
        case 'sample:category':
          loadSample('category');
          break;
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
          setModal(auth.user ? 'library' : 'account');
          break;
        case 'cloud-save':
          void saveToCloud();
          break;
        case 'account':
          setModal('account');
          break;
        case 'help':
          setModal('help');
          break;
      }
    },
    [
      auth.user,
      bindCloudDoc,
      exportPng,
      exportSvg,
      fitToView,
      loadSample,
      makeShareLink,
      saveJson,
      saveToCloud,
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
        const copy = cloneSelection(state.diagram, state.selection);
        if (copy.nodes.length > 0) dispatch({ type: 'insertNodes', ...copy });
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        dispatch({ type: 'select', ids: state.diagram.nodes.map((n) => n.id) });
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

      if (e.key.startsWith('Arrow') && state.selection.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        dispatch({ type: 'begin' });
        dispatch({ type: 'moveNodes', ids: state.selection, dx, dy });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitToView, saveJson, state.diagram, state.selection]);

  /* ---- render ---------------------------------------------------------- */

  const cloudStatus = useMemo(() => {
    if (!auth.enabled || !auth.user) return null;
    if (!cloudDoc) return 'Not in your account';
    switch (cloudState) {
      case 'saving':
        return 'Saving…';
      case 'pending':
        return 'Unsaved changes';
      case 'error':
        return 'Save failed';
      default:
        return `Saved · ${cloudDoc.title}`;
    }
  }, [auth.enabled, auth.user, cloudDoc, cloudState]);

  const ddl = useMemo(
    () => (modal === 'sql' ? generateDdl(state.diagram, state.title) : null),
    [modal, state.diagram, state.title],
  );

  return (
    <div className="app" data-theme={prefs.theme}>
      <Toolbar
        title={state.title}
        tool={tool}
        setTool={setTool}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        errorCount={errorCount}
        warningCount={warningCount}
        showGrid={prefs.showGrid}
        snapOn={prefs.snapOn}
        theme={prefs.theme}
        cloudEnabled={auth.enabled}
        userEmail={auth.user?.email ?? null}
        cloudStatus={cloudStatus}
        onAction={onToolbarAction}
      />

      <div className="workspace">
        <div className="left-rail">
          <Palette onAdd={(kind) => addNodeAt(kind, centerOfView())} />
        </div>

        <div className="canvas-wrap" ref={wrapRef}>
          <Canvas
            diagram={state.diagram}
            selection={state.selection}
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
          <Inspector
            diagram={state.diagram}
            selection={state.selection}
            title={state.title}
            dispatch={dispatch}
            onAddAttribute={addAttribute}
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
        <Modal title="EER Diagram Designer — guide" onClose={() => setModal(null)} wide>
          <HelpContent />
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
                    `${slugify(state.title)}.sql`,
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

      {modal === 'account' && <AccountModal onClose={() => setModal(null)} />}

      {modal === 'library' && (
        <LibraryModal
          onClose={() => setModal(null)}
          diagram={state.diagram}
          title={state.title}
          currentId={cloudDoc?.id ?? null}
          onOpened={(meta, diagram, title) => {
            dispatch({ type: 'load', diagram, title, resetHistory: true });
            bindCloudDoc(meta);
            window.requestAnimationFrame(() => fitToView(diagram));
          }}
          onSaved={bindCloudDoc}
          notify={notify}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
