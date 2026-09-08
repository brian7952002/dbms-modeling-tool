import type { PaletteItem } from '../../ecosystem/registry';

const stroke = { fill: 'none', strokeWidth: 2 } as const;

export const PALETTE: PaletteItem[] = [
  {
    kind: 'entity-set',
    label: 'Entity set',
    hint: 'All the rows of one entity type. Drop instances inside it.',
    glyph: (
      <rect x={4} y={7} width={40} height={26} rx={7} {...stroke} stroke="#475569" fill="#f5f7fb" />
    ),
  },
  {
    kind: 'instance',
    label: 'Instance',
    hint: 'One row, labelled with its key value.',
    glyph: (
      <>
        <circle cx={16} cy={20} r={5} fill="#1d4ed8" />
        <text x={26} y={24} fontSize={11} fontWeight={600} fill="#64748b">
          e1
        </text>
      </>
    ),
  },
  {
    kind: 'rel-set',
    label: 'Relationship set',
    hint: 'A legend naming the links drawn between instances.',
    glyph: (
      <rect x={4} y={12} width={40} height={16} rx={8} {...stroke} stroke="#0f766e" fill="#eefbf3" />
    ),
  },
];
