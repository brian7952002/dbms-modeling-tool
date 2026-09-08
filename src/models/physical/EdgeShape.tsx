import { memo } from 'react';
import type { EdgeShapeProps } from '../../ecosystem/registry';
import { edgeGeometry } from '../../platform/geometry';
import { physicalOutline } from './factory';
import type { DiagramNode, Edge } from './types';

type Props = EdgeShapeProps<DiagramNode, Edge>;

function EdgeShapeImpl({ edge, from, to, bow, selected, decoration, onPointerDown }: Props) {
  const g = edgeGeometry(from, to, bow, physicalOutline);
  // A clustering index sets the file's physical order, so its line is solid
  // and heavier; a secondary index is a lighter, dashed access path.
  const clustering = decoration?.clustering === true;

  return (
    <g
      className={`edge e-indexes${selected ? ' selected' : ''}${clustering ? ' clustering' : ''}`}
      data-id={edge.id}
      onPointerDown={(e) => onPointerDown?.(e, edge)}
    >
      <path className="edge-line" d={g.path} />
      <path className="edge-hit" d={g.path} />
    </g>
  );
}

export const EdgeShape = memo(EdgeShapeImpl);
