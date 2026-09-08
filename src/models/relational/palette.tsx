import type { PaletteItem } from '../../ecosystem/registry';

export const PALETTE: PaletteItem[] = [
  {
    kind: 'table',
    label: 'Table',
    hint: 'A relation. Add its columns and mark the primary key in the inspector.',
    glyph: (
      <>
        <rect
          x={4}
          y={6}
          width={40}
          height={28}
          rx={3}
          fill="#ffffff"
          stroke="#334155"
          strokeWidth={1.8}
        />
        <line x1={4} y1={15} x2={44} y2={15} stroke="#334155" strokeWidth={1.4} />
        <line x1={9} y1={21} x2={24} y2={21} stroke="#0f172a" strokeWidth={1.4} />
        <line x1={9} y1={27} x2={30} y2={27} stroke="#94a3b8" strokeWidth={1.4} />
      </>
    ),
  },
];
