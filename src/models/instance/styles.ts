const PALETTE = {
  light: {
    bg: '#ffffff', grid: '#e6ebf2', ink: '#0f172a', line: '#475569',
    setFill: '#f5f7fb', setLine: '#475569', dot: '#1d4ed8',
    relFill: '#eefbf3', relLine: '#0f766e', accent: '#ea580c', muted: '#64748b',
  },
  dark: {
    bg: '#0f1522', grid: '#1c2536', ink: '#e8eefc', line: '#93a4bd',
    setFill: '#141b28', setLine: '#8296b3', dot: '#7aa5ff',
    relFill: '#0f2b26', relLine: '#5fd3b6', accent: '#fb923c', muted: '#94a3b8',
  },
};

/** Diagram styling, embedded in the SVG so exports stand alone. */
export function diagramCss(theme: 'light' | 'dark'): string {
  const c = PALETTE[theme];
  return `
.eer-svg {
  --bg: ${c.bg}; --grid: ${c.grid}; --ink: ${c.ink}; --line: ${c.line};
  --set-fill: ${c.setFill}; --set-line: ${c.setLine}; --dot: ${c.dot};
  --rel-fill: ${c.relFill}; --rel-line: ${c.relLine};
  --accent: ${c.accent}; --muted: ${c.muted};
  background: var(--bg);
  font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
}
.eer-svg text { fill: var(--ink); font-size: 13px; font-weight: 600; }
.eer-svg .shape { stroke-width: 2; }
.eer-svg .shape-inner { fill: none; stroke-width: 1.4; }
.eer-svg .n-entity-set .shape { fill: var(--set-fill); stroke: var(--set-line); }
.eer-svg .n-entity-set .shape-inner { stroke: var(--set-line); }
.eer-svg .n-entity-set .set-label { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; }
.eer-svg .n-instance .shape { fill: var(--dot); stroke: var(--dot); }
.eer-svg .n-instance text { font-size: 10.5px; font-weight: 600; fill: var(--muted); }
.eer-svg .n-rel-set .shape { fill: var(--rel-fill); stroke: var(--rel-line); }

.eer-svg .edge-line { fill: none; stroke: var(--line); stroke-width: 1.8; }
.eer-svg .edge-line.member { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
.eer-svg .edge-hit { fill: none; stroke: transparent; stroke-width: 14; cursor: pointer; }
.eer-svg .edge-label {
  font-size: 11px; font-weight: 700; fill: var(--ink);
  stroke: var(--bg); stroke-width: 3.5px; paint-order: stroke fill;
  text-anchor: middle; dominant-baseline: central;
}

.eer-svg .selected .shape { stroke: var(--accent); }
.eer-svg .selected .edge-line { stroke: var(--accent); stroke-width: 2.6; }
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
