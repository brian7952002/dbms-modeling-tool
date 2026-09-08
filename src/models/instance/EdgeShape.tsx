import { memo } from 'react';
import type { EdgeShapeProps } from '../../ecosystem/registry';
import type { DiagramNode, Edge } from './types';
import { edgeGeometry } from '../../platform/geometry';
import { instanceOutline } from './factory';

type Props = EdgeShapeProps<DiagramNode, Edge>;

function EdgeShapeImpl({ edge, from, to, bow, selected, decoration, onPointerDown }: Props) {
  const g = edgeGeometry(from, to, bow, instanceOutline);
  // Membership is structural rather than meaningful, so it is drawn faintly and
  // stays out of the way of the relationship links.
  const member = edge.kind === 'member-of';
  const label = decoration?.relationshipName as string | undefined;

  return (
    <g
      className={`edge e-${edge.kind}${selected ? ' selected' : ''}`}
      data-id={edge.id}
      onPointerDown={(e) => onPointerDown?.(e, edge)}
    >
      <path className={`edge-line${member ? ' member' : ''}`} d={g.path} />
      <path className="edge-hit" d={g.path} />
      {label && (
        <text className="edge-label" x={g.mid.x + g.normal.x * 10} y={g.mid.y + g.normal.y * 10}>
          {label}
        </text>
      )}
    </g>
  );
}

export const EdgeShape = memo(EdgeShapeImpl);
