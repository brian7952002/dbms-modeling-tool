import type { NodeKind } from '../model/types';

interface Item {
  kind: NodeKind;
  label: string;
  hint: string;
  glyph: React.ReactNode;
}

const stroke = { fill: 'none', strokeWidth: 2 } as const;

const ITEMS: Item[] = [
  {
    kind: 'entity',
    label: 'Entity',
    hint: 'A thing you store data about. Tick "weak" for one that depends on an owner.',
    glyph: (
      <rect x={4} y={9} width={40} height={22} rx={2} {...stroke} stroke="#1d4ed8" fill="#eef4ff" />
    ),
  },
  {
    kind: 'relationship',
    label: 'Relationship',
    hint: 'Connects two or more entities. Tick "identifying" for a weak entity owner.',
    glyph: (
      <polygon points="24,6 46,20 24,34 2,20" {...stroke} stroke="#0f766e" fill="#eefbf3" />
    ),
  },
  {
    kind: 'attribute',
    label: 'Attribute',
    hint: 'A property. Can be key, partial key, multivalued, derived, or composite.',
    glyph: (
      <ellipse cx={24} cy={20} rx={21} ry={12} {...stroke} stroke="#b45309" fill="#fffaeb" />
    ),
  },
  {
    kind: 'isa',
    label: 'ISA / specialisation',
    hint: 'Superclass–subclass hierarchy with disjoint/overlapping and total/partial.',
    glyph: (
      <polygon points="24,6 40,33 8,33" {...stroke} stroke="#9333ea" fill="#fbf0ff" />
    ),
  },
  {
    kind: 'union',
    label: 'Union / category',
    hint: 'A subclass whose members come from several unrelated superclasses.',
    glyph: (
      <>
        <circle cx={24} cy={20} r={13} {...stroke} stroke="#be123c" fill="#fff1f2" />
        <text x={24} y={25} textAnchor="middle" fontSize={14} fontWeight={700} fill="#be123c">
          ∪
        </text>
      </>
    ),
  },
];

interface Props {
  onAdd: (kind: NodeKind) => void;
}

/** Shapes are added by dragging onto the canvas, or by clicking to drop one in the middle. */
export function Palette({ onAdd }: Props) {
  return (
    <div className="palette">
      <h2>Shapes</h2>
      <p className="panel-hint">Drag onto the canvas, or click to place one.</p>
      {ITEMS.map((item) => (
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
