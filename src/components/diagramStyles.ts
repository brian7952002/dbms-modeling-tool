export type Theme = 'light' | 'dark';

const PALETTE: Record<Theme, Record<string, string>> = {
  light: {
    bg: '#ffffff',
    grid: '#e6ebf2',
    ink: '#0f172a',
    line: '#475569',
    entityFill: '#eef4ff',
    entityLine: '#1d4ed8',
    relFill: '#eefbf3',
    relLine: '#0f766e',
    attrFill: '#fffaeb',
    attrLine: '#b45309',
    isaFill: '#fbf0ff',
    isaLine: '#9333ea',
    unionFill: '#fff1f2',
    unionLine: '#be123c',
    accent: '#ea580c',
    muted: '#64748b',
  },
  dark: {
    bg: '#0f1522',
    grid: '#1c2536',
    ink: '#e8eefc',
    line: '#93a4bd',
    entityFill: '#14243f',
    entityLine: '#7aa5ff',
    relFill: '#0f2b26',
    relLine: '#5fd3b6',
    attrFill: '#2c2411',
    attrLine: '#e0b155',
    isaFill: '#26173a',
    isaLine: '#c98bff',
    unionFill: '#331420',
    unionLine: '#ff8098',
    accent: '#fb923c',
    muted: '#94a3b8',
  },
};

/**
 * All diagram styling lives here as a string so it can be embedded inside the
 * <svg> element itself. That single decision is what makes SVG export produce a
 * file that looks identical outside the app, with no style rewriting step.
 */
export function diagramCss(theme: Theme): string {
  const c = PALETTE[theme];
  return `
.eer-svg {
  --bg: ${c.bg};
  --grid: ${c.grid};
  --ink: ${c.ink};
  --line: ${c.line};
  --entity-fill: ${c.entityFill};
  --entity-line: ${c.entityLine};
  --rel-fill: ${c.relFill};
  --rel-line: ${c.relLine};
  --attr-fill: ${c.attrFill};
  --attr-line: ${c.attrLine};
  --isa-fill: ${c.isaFill};
  --isa-line: ${c.isaLine};
  --union-fill: ${c.unionFill};
  --union-line: ${c.unionLine};
  --accent: ${c.accent};
  --muted: ${c.muted};
  background: var(--bg);
  font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
}
.eer-svg text { fill: var(--ink); font-size: 13px; font-weight: 600; }
.eer-svg .shape { stroke-width: 2; }
.eer-svg .shape-inner { fill: none; stroke-width: 1.4; }
.eer-svg .n-entity .shape { fill: var(--entity-fill); stroke: var(--entity-line); }
.eer-svg .n-entity .shape-inner { stroke: var(--entity-line); }
.eer-svg .n-relationship .shape { fill: var(--rel-fill); stroke: var(--rel-line); }
.eer-svg .n-relationship .shape-inner { stroke: var(--rel-line); }
.eer-svg .n-attribute .shape { fill: var(--attr-fill); stroke: var(--attr-line); }
.eer-svg .n-attribute .shape-inner { stroke: var(--attr-line); }
.eer-svg .n-attribute.derived .shape { stroke-dasharray: 6 4; }
.eer-svg .n-isa .shape { fill: var(--isa-fill); stroke: var(--isa-line); }
.eer-svg .n-union .shape { fill: var(--union-fill); stroke: var(--union-line); }
.eer-svg .n-isa text, .eer-svg .n-union text { font-size: 15px; font-weight: 700; }
.eer-svg .key-underline { stroke: var(--ink); stroke-width: 1.4; }
.eer-svg .key-underline.partial { stroke-dasharray: 3 2.5; }

.eer-svg .edge-line { fill: none; stroke: var(--line); stroke-width: 1.8; }
.eer-svg .edge-line.faint { stroke-width: 1.4; }
.eer-svg .edge-hit { fill: none; stroke: transparent; stroke-width: 14; cursor: pointer; }
.eer-svg .edge-label {
  font-size: 12px;
  font-weight: 700;
  fill: var(--ink);
  stroke: var(--bg);
  stroke-width: 3.5px;
  paint-order: stroke fill;
  text-anchor: middle;
  dominant-baseline: central;
}
.eer-svg .edge-label.role { font-size: 11px; font-weight: 600; fill: var(--muted); font-style: italic; }

.eer-svg .selected .shape { stroke: var(--accent); }
.eer-svg .selected .edge-line { stroke: var(--accent); stroke-width: 2.6; }
.eer-svg .sel-halo {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  opacity: 0.9;
}
.eer-svg .node { cursor: grab; }
.eer-svg .node.dragging { cursor: grabbing; }
.eer-svg text { user-select: none; -webkit-user-select: none; }
.eer-svg .issue-badge circle { fill: #dc2626; stroke: var(--bg); stroke-width: 1.5; }
.eer-svg .issue-badge.warning circle { fill: #d97706; }
.eer-svg .issue-badge text { fill: #ffffff; font-size: 10px; font-weight: 800; stroke: none; }
`;
}
