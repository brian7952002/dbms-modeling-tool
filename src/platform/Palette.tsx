import type { PaletteItem } from '../ecosystem/registry';

interface Props {
  items: PaletteItem[];
  onAdd: (kind: string) => void;
}

/**
 * Shape palette. The platform draws the tray; which shapes are in it, and what
 * they look like, comes from whichever model is open.
 */
export function Palette({ items, onAdd }: Props) {
  return (
    <div className="palette">
      <h2>Shapes</h2>
      <p className="panel-hint">Drag onto the canvas, or click to place one.</p>
      {items.map((item) => (
        <button
          key={item.kind}
          type="button"
          className="palette-item"
          title={item.hint}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-eer-node', item.kind);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => onAdd(item.kind)}
        >
          <svg viewBox="0 0 48 40" width={48} height={40} aria-hidden>
            {item.glyph}
          </svg>
          <span>
            <strong>{item.label}</strong>
            <em>{item.hint}</em>
          </span>
        </button>
      ))}
    </div>
  );
}
