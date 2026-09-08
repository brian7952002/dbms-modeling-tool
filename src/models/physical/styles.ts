const PALETTE = {
  light: {
    bg: '#ffffff', grid: '#e6ebf2', ink: '#0f172a', muted: '#64748b',
    line: '#475569', storeFill: '#ffffff', storeLine: '#334155',
    indexFill: '#fff7ed', indexLine: '#c2410c', accent: '#ea580c', value: '#0f766e',
  },
  dark: {
    bg: '#0f1522', grid: '#1c2536', ink: '#e8eefc', muted: '#94a3b8',
    line: '#93a4bd', storeFill: '#141b28', storeLine: '#8296b3',
    indexFill: '#2b1a10', indexLine: '#fb923c', accent: '#fb923c', value: '#5fd3b6',
  },
};

/** Diagram styling, embedded in the SVG so exports stand alone. */
export function diagramCss(theme: 'light' | 'dark'): string {
  const c = PALETTE[theme];
  return `
.eer-svg {
  --bg: ${c.bg}; --grid: ${c.grid}; --ink: ${c.ink}; --muted: ${c.muted};
  --line: ${c.line}; --store-fill: ${c.storeFill}; --store-line: ${c.storeLine};
  --index-fill: ${c.indexFill}; --index-line: ${c.indexLine};
  --accent: ${c.accent}; --value: ${c.value};
  background: var(--bg);
  font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
}
.eer-svg text { fill: var(--ink); }
.eer-svg .shape { fill: var(--store-fill); stroke: var(--store-line); stroke-width: 1.8; }
.eer-svg .shape.index { fill: var(--index-fill); stroke: var(--index-line); }
.eer-svg .header-rule { stroke: var(--store-line); stroke-width: 1.4; fill: none; }
.eer-svg .store-name { font-size: 13px; font-weight: 700; }
.eer-svg .stat-label { font-size: 11px; fill: var(--muted); }
.eer-svg .stat-value {
  font-size: 11px; fill: var(--value);
  font-family: "Cascadia Mono", ui-monospace, Consolas, monospace;
}
.eer-svg .index-name { font-size: 12px; font-weight: 700; fill: var(--index-line); }
.eer-svg .index-columns {
  font-size: 11px; fill: var(--ink);
  font-family: "Cascadia Mono", ui-monospace, Consolas, monospace;
}
.eer-svg .index-meta { font-size: 10.5px; fill: var(--muted); }

.eer-svg .edge-line { fill: none; stroke: var(--line); stroke-width: 1.3; stroke-dasharray: 5 4; }
.eer-svg .e-indexes.clustering .edge-line { stroke-width: 2; stroke-dasharray: none; }
.eer-svg .edge-hit { fill: none; stroke: transparent; stroke-width: 14; cursor: pointer; }

.eer-svg .selected .shape { stroke: var(--accent); stroke-width: 2.4; }
.eer-svg .selected .edge-line { stroke: var(--accent); stroke-width: 2.4; }
.eer-svg .sel-halo {
  fill: none; stroke: var(--accent); stroke-width: 1.5;
  stroke-dasharray: 4 3; opacity: 0.9;
}
.eer-svg .node { cursor: grab; }
.eer-svg text { user-select: none; -webkit-user-select: none; }
.eer-svg .issue-badge circle { fill: #dc2626; stroke: var(--bg); stroke-width: 1.5; }
.eer-svg .issue-badge.warning circle { fill: #d97706; }
.eer-svg .issue-badge text { fill: #ffffff; font-size: 10px; font-weight: 800; stroke: none; }
`;
}
