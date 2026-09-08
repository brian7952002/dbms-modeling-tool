import { memo } from 'react';
import type { NodeShapeProps } from '../../ecosystem/registry';
import type { DiagramNode } from './types';

type Props = NodeShapeProps<DiagramNode>;

function NodeShapeImpl({ node, selected, issue, onPointerDown, onDoubleClick }: Props) {
  const { x, y, w, h } = node;
  const classes = ['node', `n-${node.kind}`];
  if (selected) classes.push('selected');

  let body: React.ReactNode = null;

  switch (node.kind) {
    case 'entity-set':
      body = (
        <>
          <rect className="shape" x={x - w / 2} y={y - h / 2} width={w} height={h} rx={10} />
          {node.weak && (
            <rect
              className="shape-inner"
              x={x - w / 2 + 5}
              y={y - h / 2 + 5}
              width={w - 10}
              height={h - 10}
              rx={8}
            />
          )}
          {/* The name sits on the top edge so the interior stays free for dots. */}
          <text className="set-label" x={x} y={y - h / 2 + 16} textAnchor="middle">
            {node.entityName || node.name}
          </text>
        </>
      );
      break;

    case 'instance':
      body = (
        <>
          <circle className="shape" cx={x} cy={y} r={5.5} />
          <text x={x + 9} y={y} dominantBaseline="central">
            {node.label || node.name}
          </text>
        </>
      );
      break;

    case 'rel-set':
      body = (
        <>
          <rect className="shape" x={x - w / 2} y={y - h / 2} width={w} height={h} rx={17} />
          <text x={x} y={y} textAnchor="middle" dominantBaseline="central">
            {node.relationshipName || node.name}
          </text>
        </>
      );
      break;
  }

  return (
    <g
      className={classes.join(' ')}
      data-id={node.id}
      onPointerDown={(e) => onPointerDown?.(e, node)}
      onDoubleClick={(e) => onDoubleClick?.(e, node)}
    >
      {body}
      {selected && (
        <rect
          className="sel-halo"
          x={x - w / 2 - 7}
          y={y - h / 2 - 7}
          width={w + 14}
          height={h + 14}
          rx={8}
        />
      )}
      {issue && (
        <g className={`issue-badge ${issue}`} transform={`translate(${x + w / 2 - 2} ${y - h / 2 + 2})`}>
          <circle r={7} />
          <text textAnchor="middle" dominantBaseline="central" y={0.5}>!</text>
        </g>
      )}
    </g>
  );
}

export const NodeShape = memo(NodeShapeImpl);
