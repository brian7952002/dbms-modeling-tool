import { memo } from 'react';
import type { DiagramNode, Edge, Point } from '../model/types';
import { edgeGeometry, offsetPath } from '../model/geometry';

interface Props {
  edge: Edge;
  from: DiagramNode;
  to: DiagramNode;
  /** Perpendicular offset used to fan apart the legs of a recursive relationship. */
  bow: number;
  selected: boolean;
  /** Draw as a double line (total participation, or total specialisation). */
  double: boolean;
  onPointerDown?: (e: React.PointerEvent, edge: Edge) => void;
}

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

function EdgeShapeImpl({ edge, from, to, bow, selected, double, onPointerDown }: Props) {
  const g = edgeGeometry(from, to, bow);
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

  return (
    <g
      className={`edge e-${edge.kind}${selected ? ' selected' : ''}`}
      data-id={edge.id}
      onPointerDown={(e) => onPointerDown?.(e, edge)}
    >
      {lines}
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
    </g>
  );
}

export const EdgeShape = memo(EdgeShapeImpl);
