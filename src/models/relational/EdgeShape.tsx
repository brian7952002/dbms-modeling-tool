import { memo } from 'react';
import type { EdgeShapeProps } from '../../ecosystem/registry';
import { edgeGeometry } from '../../platform/geometry';
import { relationalOutline } from './factory';
import type { DiagramNode, Edge } from './types';

type Props = EdgeShapeProps<DiagramNode, Edge>;

function EdgeShapeImpl({ edge, from, to, bow, selected, decoration, onPointerDown }: Props) {
  const g = edgeGeometry(from, to, bow, relationalOutline);
  const label = decoration?.label as string | undefined;
  const incomplete = decoration?.incomplete === true;

  // The arrow points from the referencing table to the one it references,
  // which is the direction referential integrity actually constrains.
  const dx = g.end.x - g.start.x;
  const dy = g.end.y - g.start.y;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  return (
    <g
      className={`edge e-foreign-key${selected ? ' selected' : ''}${incomplete ? ' incomplete' : ''}`}
      data-id={edge.id}
      onPointerDown={(e) => onPointerDown?.(e, edge)}
    >
      <path className="edge-line" d={g.path} />
      <path className="edge-hit" d={g.path} />
      <g transform={`translate(${g.end.x} ${g.end.y}) rotate(${angle})`}>
        <path className="fk-arrow" d="M 0 0 L -9 -4.5 L -9 4.5 Z" />
      </g>
      {label && (
        <text
          className="edge-label"
          x={g.mid.x + g.normal.x * 11}
          y={g.mid.y + g.normal.y * 11}
        >
          {label}
        </text>
      )}
    </g>
  );
}

export const EdgeShape = memo(EdgeShapeImpl);
