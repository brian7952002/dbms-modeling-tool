import { memo } from 'react';
import type { NodeShapeProps } from '../../ecosystem/registry';
import { STORE_HEADER_H, STORE_ROW_H } from './factory';
import { formatBytes, formatCount, type IndexEstimate, type StoreEstimate } from './estimates';
import type { DiagramNode } from './types';

type Props = NodeShapeProps<DiagramNode>;

const ORG_LABEL: Record<string, string> = {
  heap: 'Heap',
  sequential: 'Sequential',
  hash: 'Hash',
  clustered: 'Clustered',
};

function NodeShapeImpl({ node, selected, decoration, issue, onPointerDown, onDoubleClick }: Props) {
  const { x, y, w, h } = node;
  const left = x - w / 2;
  const top = y - h / 2;

  let body: React.ReactNode = null;

  if (node.kind === 'store') {
    const est = decoration?.estimate as StoreEstimate | null | undefined;
    // Five figures, in the order a physical design is argued: how it is
    // organised, how much there is, and what it costs to reach one record.
    const rows: [string, string][] = [
      ['organisation', ORG_LABEL[node.organisation] ?? node.organisation],
      ['rows', formatCount(node.estimatedRows)],
      ['record', `${node.avgRowBytes} B`],
      ['blocks', est ? `${formatCount(est.blocks)} · ${formatBytes(est.bytes)}` : '—'],
      ['key lookup', est ? `${est.keyLookup} block${est.keyLookup === 1 ? '' : 's'}` : '—'],
    ];

    body = (
      <>
        <rect className="shape" x={left} y={top} width={w} height={h} rx={5} />
        <path className="header-rule" d={`M ${left} ${top + STORE_HEADER_H} H ${left + w}`} />
        <text className="store-name" x={x} y={top + STORE_HEADER_H / 2} textAnchor="middle" dominantBaseline="central">
          {node.tableName || node.name}
        </text>
        {rows.map(([label, value], i) => {
          const rowY = top + STORE_HEADER_H + i * STORE_ROW_H + STORE_ROW_H / 2 + 4;
          return (
            <g key={label}>
              <text className="stat-label" x={left + 12} y={rowY} dominantBaseline="central">
                {label}
              </text>
              <text className="stat-value" x={left + w - 12} y={rowY} textAnchor="end" dominantBaseline="central">
                {value}
              </text>
            </g>
          );
        })}
      </>
    );
  } else {
    const est = decoration?.estimate as IndexEstimate | null | undefined;
    body = (
      <>
        <rect className="shape index" x={left} y={top} width={w} height={h} rx={14} />
        <text className="index-name" x={x} y={top + 17} textAnchor="middle" dominantBaseline="central">
          {node.unique ? '⚿ ' : ''}
          {node.indexName || node.name}
        </text>
        <text className="index-columns" x={x} y={top + 34} textAnchor="middle" dominantBaseline="central">
          ({node.columns.join(', ') || 'no columns'})
        </text>
        <text className="index-meta" x={x} y={top + 50} textAnchor="middle" dominantBaseline="central">
          {node.type}
          {node.clustering ? ' · clustering' : ''}
          {est ? ` · ${est.lookup} blocks` : ''}
        </text>
      </>
    );
  }

  return (
    <g
      className={`node n-${node.kind}${selected ? ' selected' : ''}`}
      data-id={node.id}
      onPointerDown={(e) => onPointerDown?.(e, node)}
      onDoubleClick={(e) => onDoubleClick?.(e, node)}
    >
      {body}
      {selected && (
        <rect className="sel-halo" x={left - 7} y={top - 7} width={w + 14} height={h + 14} rx={9} />
      )}
      {issue && (
        <g className={`issue-badge ${issue}`} transform={`translate(${left + w - 2} ${top + 2})`}>
          <circle r={7} />
          <text textAnchor="middle" dominantBaseline="central" y={0.5}>!</text>
        </g>
      )}
    </g>
  );
}

export const NodeShape = memo(NodeShapeImpl);
