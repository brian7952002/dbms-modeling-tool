import { memo } from 'react';
import type { EdgeShapeProps } from '../../ecosystem/registry';
import type { DiagramNode, Edge, Point } from './types';
import { edgeGeometry, offsetPath } from '../../platform/geometry';
import { eerOutline } from './outline';

type Props = EdgeShapeProps<DiagramNode, Edge>;

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

function cardinalityLabel(edge: Edge): string | null {
  if (edge.kind !== 'participation') return null;
  const parts: string[] = [];
  if (edge.cardinality) parts.push(edge.cardinality);
  if (edge.showMinMax) {
    parts.push(`(${edge.min ?? 0},${edge.max === null || edge.max === undefined ? 'N' : edge.max})`);
  }
  return parts.join(' ') || null;
}

/**
 * The subset symbol (⊂) EER puts on the line from a specialisation marker to
 * each subclass, and from a category to its union circle. It is built from the
 * line's own direction rather than drawn as a text glyph: the opening has to
 * face the superclass whatever angle the line sits at, and a rotated ⊂
 * character cannot be relied on once the SVG is exported away from the app's
 * fonts.
 */
function subsetPath(at: Point, ux: number, uy: number, r = 9): string {
  // Perpendicular, so the arc can be swept in the line's own frame.
  const px = -uy;
  const py = ux;
  const points: string[] = [];
  // 60° through 300° traces a C whose opening faces +u.
  for (let deg = 60; deg <= 300; deg += 20) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    points.push(
      `${(at.x + r * (c * ux + s * px)).toFixed(2)} ${(at.y + r * (c * uy + s * py)).toFixed(2)}`,
    );
  }
  return `M ${points.join(' L ')}`;
}

function EdgeShapeImpl({ edge, from, to, bow, selected, decoration, onPointerDown }: Props) {
  // Total participation and total specialisation both draw a double line; the
  // model decides which connectors qualify.
  const double = decoration?.double === true;
  const definingAttribute = decoration?.definingAttribute as string | undefined;
  const g = edgeGeometry(from, to, bow, eerOutline);
  const faint = edge.kind === 'attribute';

  const lines = double ? (
    <>
      <path className={`edge-line${faint ? ' faint' : ''}`} d={offsetPath(g, 2.6)} />
      <path className={`edge-line${faint ? ' faint' : ''}`} d={offsetPath(g, -2.6)} />
    </>
  ) : (
    <path className={`edge-line${faint ? ' faint' : ''}`} d={g.path} />
  );

  const card = cardinalityLabel(edge);
  const cardAt = lerp(g.mid, g.end, 0.3);
  const roleAt = lerp(g.start, g.mid, 0.45);
  const off = 12;
  // Push a role label to the outside of its own curve, so the two legs of a
  // recursive relationship do not stack their labels on top of each other.
  const roleOff = bow === 0 ? -off : Math.sign(bow) * (off + 4);

  // A subclass line and a category line both carry ⊂, opening towards the
  // marker at the target end — the superclass side in both cases.
  let subset: string | null = null;
  if (edge.kind === 'isa-sub' || edge.kind === 'union-sub') {
    const dx = g.end.x - g.start.x;
    const dy = g.end.y - g.start.y;
    const len = Math.hypot(dx, dy) || 1;
    // Nearer the subclass than the marker: that is where textbooks put it, and
    // it keeps the glyph clear of the marker on short lines.
    subset = subsetPath(lerp(g.start, g.end, 0.42), dx / len, dy / len);
  }

  const midAt = lerp(g.start, g.end, 0.5);

  return (
    <g
      className={`edge e-${edge.kind}${selected ? ' selected' : ''}`}
      data-id={edge.id}
      onPointerDown={(e) => onPointerDown?.(e, edge)}
    >
      {lines}
      {subset && <path className="subset-symbol" d={subset} />}
      <path className="edge-hit" d={g.path} />
      {card && (
        <text
          className="edge-label"
          x={cardAt.x + g.normal.x * off}
          y={cardAt.y + g.normal.y * off}
        >
          {card}
        </text>
      )}
      {edge.role && (
        <text
          className="edge-label role"
          x={roleAt.x + g.normal.x * roleOff}
          y={roleAt.y + g.normal.y * roleOff}
        >
          {edge.role}
        </text>
      )}
      {definingAttribute && (
        <text
          className="edge-label defining"
          x={midAt.x + g.normal.x * (off + 2)}
          y={midAt.y + g.normal.y * (off + 2)}
        >
          {definingAttribute}
        </text>
      )}
    </g>
  );
}

export const EdgeShape = memo(EdgeShapeImpl);
