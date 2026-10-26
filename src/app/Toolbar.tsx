import { useEffect, useRef, useState } from 'react';
import type { Tool } from '../platform/Canvas';

interface Props {
  title: string;
  /** Which modelling tool is open, shown next to the document name. */
  modelLabel: string;
  /** Worked examples offered by the open model. */
  samples: { id: string; title: string }[];
  /** Label for producing the next model from this one, when it can. */
  deriveLabel: string | null;
  tool: Tool;
  setTool: (t: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  errorCount: number;
  warningCount: number;
  showGrid: boolean;
  snapOn: boolean;
  theme: 'light' | 'dark';
  /** Where the diagram on screen stands, e.g. "Saved" or "Unsaved changes". */
  saveStatus: string | null;
  onAction: (action: ToolbarAction) => void;
}

export type ToolbarAction =
  | 'new'
  | 'open'
  | 'save'
  | `sample:${string}`
  | 'export-svg'
  | 'export-png'
  | 'sql'
  | 'share'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'fit'
  | 'toggle-grid'
  | 'toggle-snap'
  | 'toggle-theme'
  | 'toggle-issues'
  | 'models'
  | 'derive'
  | 'library'
  | 'save-to-library'
  | 'help';

function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label} <span className="caret">▾</span>
      </button>
      {open && (
        <div className="menu-pop" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function Toolbar({
  title,
  modelLabel,
  samples,
  deriveLabel,
  tool,
  setTool,
  canUndo,
  canRedo,
  errorCount,
  warningCount,
  showGrid,
  snapOn,
  theme,
  saveStatus,
  onAction,
}: Props) {
  const act = (a: ToolbarAction) => () => onAction(a);

  return (
    <header className="toolbar">
      <div className="brand">
        <svg viewBox="0 0 32 32" width={22} height={22} aria-hidden>
          <rect width="32" height="32" rx="6" fill="#2563eb" />
          <rect x="5" y="11" width="10" height="7" fill="white" />
          <path d="M23 10.5l4.5 4.5-4.5 4.5-4.5-4.5z" fill="white" />
        </svg>
        <strong>DBMS Modeling</strong>
        <button
          type="button"
          className="model-chip"
          onClick={act('models')}
          title="Switch modelling tool"
        >
          {modelLabel.split('—').pop()?.trim() ?? modelLabel}
        </button>
        <span className="doc-title" title={title}>
          {title}
        </span>
      </div>

      <Menu label="File">
        <button type="button" onClick={act('models')}>Choose a model…</button>
        {deriveLabel && (
          <button type="button" onClick={act('derive')}>
            {deriveLabel}
          </button>
        )}
        <hr />
        <button type="button" onClick={act('new')}>New diagram</button>
        <button type="button" onClick={act('open')}>Open .eer.json…</button>
        <button type="button" onClick={act('save')}>Save .eer.json</button>
        <hr />
        {samples.map((s) => (
          <button key={s.id} type="button" onClick={act(`sample:${s.id}`)}>
            Example: {s.title}
          </button>
        ))}
      </Menu>

      <Menu label="My diagrams">
        <button type="button" onClick={act('save-to-library')}>Save to my diagrams</button>
        <button type="button" onClick={act('library')}>Open, rename, back up…</button>
      </Menu>

      <Menu label="Export">
        <button type="button" onClick={act('export-svg')}>SVG (vector)</button>
        <button type="button" onClick={act('export-png')}>PNG (2×)</button>
        <hr />
        <button type="button" onClick={act('sql')}>SQL schema…</button>
        <button type="button" onClick={act('share')}>Shareable link…</button>
      </Menu>

      <div className="group">
        <button type="button" onClick={act('undo')} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button type="button" onClick={act('redo')} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
      </div>

      <div className="group segmented">
        <button
          type="button"
          className={tool === 'select' ? 'on' : ''}
          onClick={() => setTool('select')}
          title="Select and move (V)"
        >
          ⬚ Select
        </button>
        <button
          type="button"
          className={tool === 'connect' ? 'on' : ''}
          onClick={() => setTool('connect')}
          title="Connect two shapes (C)"
        >
          ⇢ Connect
        </button>
      </div>

      <div className="group">
        <button type="button" onClick={act('zoom-out')} title="Zoom out">−</button>
        <button type="button" onClick={act('zoom-reset')} title="Reset zoom to 100%">100%</button>
        <button type="button" onClick={act('zoom-in')} title="Zoom in">+</button>
        <button type="button" onClick={act('fit')} title="Fit diagram to the window (F)">Fit</button>
      </div>

      <div className="group">
        <button
          type="button"
          className={showGrid ? 'on' : ''}
          onClick={act('toggle-grid')}
          title="Show grid"
        >
          Grid
        </button>
        <button
          type="button"
          className={snapOn ? 'on' : ''}
          onClick={act('toggle-snap')}
          title="Snap shapes to the grid"
        >
          Snap
        </button>
      </div>

      <div className="spacer" />

      {saveStatus && <span className="cloud-status">{saveStatus}</span>}

      <button
        type="button"
        className={`issues-chip${errorCount ? ' has-errors' : warningCount ? ' has-warnings' : ''}`}
        onClick={act('toggle-issues')}
        title="Show the model checker"
      >
        {errorCount > 0 && <span className="dot error" />}
        {errorCount === 0 && warningCount > 0 && <span className="dot warning" />}
        {errorCount === 0 && warningCount === 0 && <span className="dot ok" />}
        {errorCount > 0
          ? `${errorCount} error${errorCount === 1 ? '' : 's'}`
          : warningCount > 0
            ? `${warningCount} warning${warningCount === 1 ? '' : 's'}`
            : 'Model OK'}
      </button>

      <button type="button" onClick={act('toggle-theme')} title="Switch light / dark">
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
      <button type="button" onClick={act('help')} title="Notation guide and shortcuts">
        ?
      </button>
    </header>
  );
}
