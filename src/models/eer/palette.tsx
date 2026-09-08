import type { PaletteItem } from '../../ecosystem/registry';

const stroke = { fill: 'none', strokeWidth: 2 } as const;

export const PALETTE: PaletteItem[] = [
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
    hint: 'Superclass–subclass hierarchy: disjoint or overlapping, total or partial. Subclass lines carry the ⊂ subset symbol.',
    glyph: (
      <>
        <circle cx={24} cy={20} r={13} {...stroke} stroke="#9333ea" fill="#fbf0ff" />
        <text x={24} y={25} textAnchor="middle" fontSize={13} fontWeight={700} fill="#9333ea">
          d
        </text>
      </>
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
