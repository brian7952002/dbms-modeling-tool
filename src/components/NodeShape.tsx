import { memo } from 'react';
import type { DiagramNode } from '../model/types';
import { measureText } from '../model/measure';

interface Props {
  node: DiagramNode;
  selected: boolean;
  /** Degrees to rotate an ISA triangle so its apex points at the superclass. */
  isaAngle?: number;
  issue?: 'error' | 'warning';
  onPointerDown?: (e: React.PointerEvent, node: DiagramNode) => void;
  onDoubleClick?: (e: React.MouseEvent, node: DiagramNode) => void;
}

function diamondPoints(x: number, y: number, w: number, h: number, inset = 0) {
  const hw = w / 2 - inset;
  const hh = h / 2 - inset;
  return `${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}`;
}

function trianglePoints(x: number, y: number, w: number, h: number) {
  const hw = w / 2;
  const hh = h / 2;
  return `${x},${y - hh} ${x + hw},${y + hh} ${x - hw},${y + hh}`;
}

/** One EER shape, drawn from its centre point. */
function NodeShapeImpl({
  node,
  selected,
  isaAngle = 0,
  issue,
  onPointerDown,
  onDoubleClick,
}: Props) {
  const { x, y, w, h } = node;
  const classes = ['node', `n-${node.kind}`];
  if (selected) classes.push('selected');
  if (node.kind === 'attribute' && node.derived) classes.push('derived');

  let shape: React.ReactNode = null;
  let label = node.name;
  let labelDy = 0;

  switch (node.kind) {
    case 'entity':
      shape = (
        <>
          <rect className="shape" x={x - w / 2} y={y - h / 2} width={w} height={h} rx={3} />
          {node.weak && (
            <rect
              className="shape-inner"
              x={x - w / 2 + 5}
              y={y - h / 2 + 5}
              width={w - 10}
              height={h - 10}
              rx={2}
            />
          )}
        </>
      );
      break;

    case 'relationship':
      shape = (
        <>
          <polygon className="shape" points={diamondPoints(x, y, w, h)} />
          {node.identifying && (
            <polygon className="shape-inner" points={diamondPoints(x, y, w, h, 7)} />
          )}
        </>
      );
      break;

    case 'attribute':
      shape = (
        <>
          <ellipse className="shape" cx={x} cy={y} rx={w / 2} ry={h / 2} />
          {node.multivalued && (
            <ellipse className="shape-inner" cx={x} cy={y} rx={w / 2 - 5} ry={h / 2 - 5} />
          )}
        </>
      );
      break;

    case 'isa':
      shape = (
        <g transform={`rotate(${isaAngle} ${x} ${y})`}>
          <polygon className="shape" points={trianglePoints(x, y, w, h)} />
        </g>
      );
      label = node.disjoint ? 'd' : 'o';
      labelDy = 8; // sits inside the wide part of the triangle
      break;

    case 'union':
      shape = <circle className="shape" cx={x} cy={y} r={w / 2} />;
      label = '∪';
      break;
  }

  const textWidth = measureText(label);
  const underline =
    node.kind === 'attribute' && (node.key || node.partialKey) ? (
      <line
        className={`key-underline${node.partialKey ? ' partial' : ''}`}
        x1={x - textWidth / 2}
        x2={x + textWidth / 2}
        y1={y + 9}
        y2={y + 9}
      />
    ) : null;

  return (
    <g
      className={classes.join(' ')}
      data-id={node.id}
      onPointerDown={(e) => onPointerDown?.(e, node)}
      onDoubleClick={(e) => onDoubleClick?.(e, node)}
    >
      {shape}
      <text x={x} y={y + labelDy} textAnchor="middle" dominantBaseline="central">
        {label}
      </text>
      {underline}
      {node.kind === 'isa' && (
        <title>
          {node.disjoint ? 'Disjoint' : 'Overlapping'} ·{' '}
          {node.total ? 'total' : 'partial'} specialisation
        </title>
      )}
      {node.kind === 'union' && (
        <title>Union / category type ({node.total ? 'total' : 'partial'})</title>
      )}
      {selected && (
        <rect
          className="sel-halo"
          x={x - w / 2 - 7}
          y={y - h / 2 - 7}
          width={w + 14}
          height={h + 14}
          rx={6}
        />
      )}
      {issue && (
        <g className={`issue-badge ${issue}`} transform={`translate(${x + w / 2 - 2} ${y - h / 2 + 2})`}>
          <circle r={7} />
          <text textAnchor="middle" dominantBaseline="central" y={0.5}>
            !
          </text>
        </g>
      )}
    </g>
  );
}

export const NodeShape = memo(NodeShapeImpl);
