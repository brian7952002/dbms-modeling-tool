import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type Tool, type Viewport } from './platform/Canvas';
import { Toolbar, type ToolbarAction } from './app/Toolbar';
import { Palette } from './platform/Palette';
import { IssuesPanel } from './platform/IssuesPanel';
import { Modal } from './platform/Modal';
import { cloneSelection } from './platform/actions';
import { useDiagramDoc } from './platform/collab/useDiagramDoc';
import { applyEncodedState, encodeState } from './platform/collab/doc';
import { RealtimeProvider, type PeerState } from './platform/collab/provider';
import type { Diagram, Id, Point } from './platform/types';
import { newId } from './platform/ids';
import { nodeBounds } from './platform/geometry';
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
import { useAuth } from './cloud/auth';
import { AccountModal } from './app/AccountModal';
import { LibraryModal } from './app/LibraryModal';
import {
  createDiagram,
  openDiagram,
  persistRealtime,
  type CloudDiagram,
} from './cloud/diagrams';
import { ProjectsModal } from './app/ProjectsModal';
import { HistoryModal } from './app/HistoryModal';
import {
  canEdit,
  listProjects,
  redeemInvite,
  type Project,
} from './cloud/projects';
import { colorFor } from './cloud/presence';

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
    doc,
    diagram,
    title,
    selection,
    dispatch,
    canUndo,
    canRedo,
    revision,
  } = useDiagramDoc(
    restored.current ?? { diagram: getModel('eer').samples[0].build(), title: 'Company schema' },
    model,
  );

  const auth = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [tool, setTool] = useState<Tool>('select');
  const [viewport, setViewport] = useState<Viewport>({ x: 40, y: 40, k: 0.75 });
  const [modal, setModal] = useState<
    null | 'help' | 'sql' | 'share' | 'account' | 'library' | 'projects' | 'history' | 'models'
  >(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [peers, setPeers] = useState<PeerState[]>([]);
  const [liveConnected, setLiveConnected] = useState(false);
  const providerRef = useRef<RealtimeProvider | null>(null);
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

  const issues = useMemo(() => model.validate(diagram, {}), [model, diagram]);
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

  /* ---- cloud sync ------------------------------------------------------ */

  const refreshProjects = useCallback(async () => {
    if (!auth.user) {
      setProjects([]);
      setActiveProject(null);
      return;
    }
    try {
      const list = await listProjects(auth.user.id);
      setProjects(list);
      setActiveProject((current) =>
        current ? (list.find((p) => p.id === current.id) ?? null) : null,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not load your projects.');
    }
  }, [auth.user, notify]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  /** The role that governs the diagram currently on the canvas. */
  const currentProject = useMemo(
    () => (cloudDoc?.projectId ? projects.find((p) => p.id === cloudDoc.projectId) ?? null : null),
    [cloudDoc?.projectId, projects],
  );
  const readOnly = Boolean(currentProject && !canEdit(currentProject.role));


  // Once a diagram is bound to a row, edits are pushed back automatically; the
  // delay keeps a burst of dragging from turning into a burst of requests.
  useEffect(() => {
    if (!auth.user || !cloudDoc) return;
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    if (readOnly) return;
    setCloudState('pending');
    // Every editor persists the merged result. Concurrent writes are no longer
    // a hazard: the CRDT has already reconciled them, so whoever writes last
    // writes the same thing.
    const timer = window.setTimeout(async () => {
      setCloudState('saving');
      try {
        const saved = await persistRealtime(
          cloudDoc.id,
          diagram,
          title,
          encodeState(doc),
        );
        setCloudDoc({ ...cloudDoc, ...saved, title });
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
  }, [diagram, title, auth.user, cloudDoc?.id, readOnly, doc]);

  /** Binds the canvas to a cloud row without triggering an immediate re-save. */
  const bindCloudDoc = useCallback((meta: CloudDiagram | null) => {
    skipAutosave.current = true;
    setCloudDoc(meta);
    setCloudState(meta ? 'saved' : 'idle');
  }, []);

  /**
   * Loads a stored diagram into the live document. Where a CRDT state was
   * saved it is applied verbatim, so edit history and concurrent sessions stay
   * consistent; older rows fall back to their plain JSON.
   */
  const openIntoDoc = useCallback(
    (meta: CloudDiagram, loaded: Diagram, loadedTitle: string) => {
      if (meta.ydoc) {
        doc.replace({ nodes: [], edges: [] }, loadedTitle, meta.kind);
        try {
          applyEncodedState(doc, meta.ydoc);
        } catch {
          doc.replace(loaded, loadedTitle, meta.kind);
        }
      } else {
        doc.replace(loaded, loadedTitle, meta.kind);
      }
      bindCloudDoc(meta);
    },
    [bindCloudDoc, doc],
  );

  /** Discards local edits in favour of what is actually stored. */
  const reloadFromCloud = useCallback(async () => {
    if (!cloudDoc) return;
    try {
      const loaded = await openDiagram(cloudDoc.id);
      openIntoDoc(loaded.meta, loaded.diagram, loaded.title);
      window.requestAnimationFrame(() => fitToView(loaded.diagram));
      notify('Reloaded the latest version.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not reload.');
    }
    // fitToView is declared below; it is only read when this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudDoc, notify, openIntoDoc]);

  const saveToCloud = useCallback(async () => {
    if (!auth.enabled || !auth.user) {
      setModal('account');
      return;
    }
    if (readOnly) {
      notify('You have view-only access to this diagram.');
      return;
    }
    setCloudState('saving');
    try {
      if (cloudDoc) {
        const saved = await persistRealtime(cloudDoc.id, diagram, title, encodeState(doc));
        bindCloudDoc({ ...cloudDoc, ...saved, title });
        notify('Saved.');
      } else {
        const meta = await createDiagram(
          auth.user.id,
          diagram,
          title,
          activeProject && canEdit(activeProject.role) ? activeProject.id : null,
        );
        bindCloudDoc(meta);
        notify(`Saved “${meta.title}”.`);
      }
    } catch (err) {
      setCloudState('error');
      notify(err instanceof Error ? err.message : 'Could not save to your account.');
    }
  }, [
    activeProject,
    doc,
    auth.enabled,
    auth.user,
    bindCloudDoc,
    cloudDoc,
    notify,
    readOnly,
    diagram,
    title,
  ]);

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

    if (hash.startsWith('#d=')) {
      decodeShare(hash.slice(3))
        .then((file) => {
          const { diagram, title } = fromFile(file);
          show(diagram, title, `Opened “${title}” from the link.`);
        })
        .catch(() => notify('That share link could not be read.'));
      return;
    }

    // A published cloud diagram opens as an editable copy bound to nothing, so
    // editing it can never overwrite the original.
    if (hash.startsWith('#join=')) {
      const code = hash.slice(6);
      redeemInvite(code)
        .then(async (r) => {
          await refreshProjects();
          notify(
            r.alreadyMember
              ? `You are already a ${r.role} of “${r.projectName}”.`
              : `Joined “${r.projectName}” as ${r.role}.`,
          );
          clearHash();
          setModal('projects');
        })
        .catch((err) => {
          notify(err instanceof Error ? err.message : 'That invite link did not work.');
          clearHash();
        });
      return;
    }

    if (hash.startsWith('#c=')) {
      openDiagram(hash.slice(3))
        .then(({ diagram: shared, title: sharedTitle }) => {
          setCloudDoc(null);
          show(shared, sharedTitle, `Opened a shared copy of “${sharedTitle}”.`);
        })
        .catch(() => notify('That diagram is not published, or the link has expired.'));
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
   * Places a new attribute in the emptiest direction around its owner and wires
   * it up, so building out an entity never requires manual dragging.
   */
  const addAttribute = useCallback(
    (ownerId: Id) => {
      const owner = diagram.nodes.find((n) => n.id === ownerId);
      if (!owner) return;
      const siblings = diagram.edges
        .filter((e) => e.kind === 'attribute' && e.target === ownerId)
        .map((e) => diagram.nodes.find((n) => n.id === e.source))
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
      const node = model.createNode(
        'attribute',
        owner.x + Math.cos(best) * radius,
        owner.y + Math.sin(best) * radius,
      );
      dispatch({
        type: 'insertNodes',
        nodes: [node],
        edges: [{ id: newId('e'), kind: 'attribute', source: node.id, target: ownerId }],
      });
    },
    [diagram, model],
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
      bindCloudDoc(null);
      window.requestAnimationFrame(() => fitToView(diagram));
    },
    [bindCloudDoc, fitToView, model, dispatch],
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
          bindCloudDoc(null);
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
        case 'projects':
          setModal(auth.user ? 'projects' : 'account');
          break;
        case 'history':
          if (!cloudDoc) {
            notify('Save this diagram to your account first — history starts there.');
          } else {
            setModal('history');
          }
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
      cloudDoc,
      notify,
      exportPng,
      exportSvg,
      fitToView,
      loadSample,
      makeShareLink,
      model,
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

  // A live session exists for any diagram stored in the cloud. Alone in the
  // room it costs one idle subscription; shared, it is the whole feature.
  useEffect(() => {
    providerRef.current?.destroy();
    providerRef.current = null;
    setPeers([]);
    setLiveConnected(false);

    if (!auth.user || !cloudDoc) return;

    const me = {
      clientId: `${auth.user.id}:${Math.random().toString(36).slice(2, 8)}`,
      name: auth.user.email?.split('@')[0] ?? 'Someone',
      color: colorFor(auth.user.id),
    };
    const provider = new RealtimeProvider(
      doc,
      cloudDoc.id,
      me,
      setPeers,
      setLiveConnected,
    );
    providerRef.current = provider;
    return () => {
      provider.destroy();
      providerRef.current = null;
    };
  }, [auth.user, cloudDoc?.id, doc]);

  // Broadcast what this person has selected, so teammates see it outlined.
  useEffect(() => {
    providerRef.current?.setSelection(selection);
  }, [selection]);

  const cloudStatus = useMemo(() => {
    if (!auth.enabled || !auth.user) return null;
    if (!cloudDoc) return 'Not in your account';
    if (readOnly) return `View only · ${currentProject?.name ?? 'project'}`;
    if (peers.length > 0) return liveConnected ? 'Live · all changes shared' : 'Reconnecting…';
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
  }, [auth.enabled, auth.user, cloudDoc, cloudState, currentProject, readOnly, peers.length, liveConnected]);

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
        tool={tool}
        setTool={setTool}
        canUndo={canUndo}
        canRedo={canRedo}
        errorCount={errorCount}
        warningCount={warningCount}
        showGrid={prefs.showGrid}
        snapOn={prefs.snapOn}
        theme={prefs.theme}
        cloudEnabled={auth.enabled}
        userEmail={auth.user?.email ?? null}
        cloudStatus={cloudStatus}
        peers={peers.map((p) => ({ userId: p.clientId, name: p.name, color: p.color }))}
        projectName={currentProject?.name ?? null}
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
            peers={peers}
            onCursorMove={(p) => providerRef.current?.setCursor(p)}
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
            diagram={diagram}
            selection={selection}
            title={title}
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
            bindCloudDoc(null);
            setViewport({ x: 40, y: 40, k: 1 });
            setModal(null);
          }}
        />
      )}

      {modal === 'account' && <AccountModal onClose={() => setModal(null)} />}

      {modal === 'projects' && (
        <ProjectsModal
          onClose={() => setModal(null)}
          projects={projects}
          activeProjectId={activeProject?.id ?? null}
          onRefresh={refreshProjects}
          onOpenProject={(p) => {
            setActiveProject(p);
            setModal('library');
          }}
          notify={notify}
        />
      )}

      {modal === 'history' && cloudDoc && (
        <HistoryModal
          diagramId={cloudDoc.id}
          diagramTitle={title}
          canEdit={!readOnly}
          onClose={() => setModal(null)}
          onRestored={reloadFromCloud}
          notify={notify}
        />
      )}

      {modal === 'library' && (
        <LibraryModal
          onClose={() => setModal(null)}
          diagram={diagram}
          title={title}
          currentId={cloudDoc?.id ?? null}
          projects={projects}
          activeProject={activeProject}
          onChangeProject={setActiveProject}
          onOpened={(meta, loadedDiagram, loadedTitle) => {
            openIntoDoc(meta, loadedDiagram, loadedTitle);
            window.requestAnimationFrame(() => fitToView(loadedDiagram));
          }}
          onSaved={bindCloudDoc}
          notify={notify}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
