const PALETTE = {
  light: {
    bg: '#ffffff', grid: '#e6ebf2', ink: '#0f172a', muted: '#64748b',
    line: '#475569', tableFill: '#ffffff', tableLine: '#334155',
    headerInk: '#0f172a', accent: '#ea580c', type: '#7c3aed',
  },
  dark: {
    bg: '#0f1522', grid: '#1c2536', ink: '#e8eefc', muted: '#94a3b8',
    line: '#93a4bd', tableFill: '#141b28', tableLine: '#8296b3',
    headerInk: '#e8eefc', accent: '#fb923c', type: '#c4b5fd',
  },
};

/** Diagram styling, embedded in the SVG so exports stand alone. */
export function diagramCss(theme: 'light' | 'dark'): string {
  const c = PALETTE[theme];
  return `
.eer-svg {
  --bg: ${c.bg}; --grid: ${c.grid}; --ink: ${c.ink}; --muted: ${c.muted};
  --line: ${c.line}; --table-fill: ${c.tableFill}; --table-line: ${c.tableLine};
  --accent: ${c.accent}; --type: ${c.type};
  background: var(--bg);
  font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
}
.eer-svg text { fill: var(--ink); }
.eer-svg .shape { fill: var(--table-fill); stroke: var(--table-line); stroke-width: 1.8; }
.eer-svg .header-rule { stroke: var(--table-line); stroke-width: 1.4; fill: none; }
.eer-svg .table-name { font-size: 13px; font-weight: 700; letter-spacing: 0.01em; }
.eer-svg .column-name {
  font-family: "Cascadia Mono", ui-monospace, Consolas, monospace;
  font-size: 12px;
}
.eer-svg .column-type {
  font-family: "Cascadia Mono", ui-monospace, Consolas, monospace;
  font-size: 11px;
  fill: var(--type);
}
.eer-svg .column-empty { font-size: 11.5px; fill: var(--muted); font-style: italic; }
.eer-svg .pk-underline { stroke: var(--ink); stroke-width: 1.3; }

.eer-svg .edge-line { fill: none; stroke: var(--line); stroke-width: 1.6; }
.eer-svg .fk-arrow { fill: var(--line); stroke: none; }
.eer-svg .edge-hit { fill: none; stroke: transparent; stroke-width: 14; cursor: pointer; }
.eer-svg .e-foreign-key.incomplete .edge-line { stroke-dasharray: 5 4; }
.eer-svg .edge-label {
  font-size: 11px; font-weight: 600; fill: var(--muted);
  stroke: var(--bg); stroke-width: 3.5px; paint-order: stroke fill;
  text-anchor: middle; dominant-baseline: central;
  font-family: "Cascadia Mono", ui-monospace, Consolas, monospace;
}

.eer-svg .selected .shape { stroke: var(--accent); stroke-width: 2.4; }
.eer-svg .selected .edge-line { stroke: var(--accent); stroke-width: 2.4; }
.eer-svg .selected .fk-arrow { fill: var(--accent); }
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
