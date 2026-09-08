import type { PaletteItem } from '../../ecosystem/registry';

export const PALETTE: PaletteItem[] = [
  {
    kind: 'store',
    label: 'Stored file',
    hint: 'One relation on disk: its organisation, size and access cost.',
    glyph: (
      <>
        <rect x={4} y={7} width={40} height={26} rx={3} fill="#ffffff" stroke="#334155" strokeWidth={1.8} />
        <line x1={4} y1={16} x2={44} y2={16} stroke="#334155" strokeWidth={1.4} />
        <line x1={9} y1={22} x2={22} y2={22} stroke="#94a3b8" strokeWidth={1.3} />
        <line x1={9} y1={28} x2={27} y2={28} stroke="#94a3b8" strokeWidth={1.3} />
      </>
    ),
  },
  {
    kind: 'index',
    label: 'Index',
    hint: 'An access path into a file. B+-tree, hash or bitmap; clustering or secondary.',
    glyph: (
      <>
        <rect x={5} y={11} width={38} height={18} rx={9} fill="#fff7ed" stroke="#c2410c" strokeWidth={1.8} />
        <circle cx={15} cy={20} r={2.2} fill="#c2410c" />
        <line x1={21} y1={20} x2={36} y2={20} stroke="#c2410c" strokeWidth={1.4} />
      </>
    ),
  },
];
