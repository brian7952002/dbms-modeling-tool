import { memo } from 'react';
import type { NodeShapeProps } from '../../ecosystem/registry';
import { measureText } from '../../platform/measure';
import { FOOTER_GAP, HEADER_H, ROW_H } from './factory';
import { readColumns, readUniques, uniqueColumnNames, type DiagramNode } from './types';

type Props = NodeShapeProps<DiagramNode>;

const ROW_FONT = '400 12px "Cascadia Mono", ui-monospace, Consolas, monospace';

function NodeShapeImpl({ node, selected, decoration, issue, onPointerDown, onDoubleClick }: Props) {
  const { x, y, w, h } = node;
  const left = x - w / 2;
  const top = y - h / 2;
  const columns = readColumns(node);
  // Shown as DDL lines rather than per-column badges: a composite key needs to
  // show which columns it spans and in what order, and a badge cannot.
  const uniques = readUniques(node).filter((u) => u.columns.length > 0);
  // Which columns take part in a foreign key, so they can be marked.
  const fkColumns = (decoration?.fkColumns as Set<string> | undefined) ?? new Set<string>();

  return (
    <g
      className={`node n-table${selected ? ' selected' : ''}`}
      data-id={node.id}
      onPointerDown={(e) => onPointerDown?.(e, node)}
      onDoubleClick={(e) => onDoubleClick?.(e, node)}
    >
      <rect className="shape" x={left} y={top} width={w} height={h} rx={6} />
      <path className="header-rule" d={`M ${left} ${top + HEADER_H} H ${left + w}`} />
      <text className="table-name" x={x} y={top + HEADER_H / 2} textAnchor="middle" dominantBaseline="central">
        {node.name}
      </text>

      {columns.map((c, i) => {
        const rowY = top + HEADER_H + i * ROW_H + ROW_H / 2 + 3;
        const label = `${c.name}`;
        const width = measureText(label, ROW_FONT);
        return (
          <g key={c.id} className="column-row">
            <text className="column-name" x={left + 12} y={rowY} dominantBaseline="central">
              {label}
            </text>
            {/* A primary key is underlined, as it is in the EER diagram. */}
            {c.pk && (
              <line
                className="pk-underline"
                x1={left + 12}
                x2={left + 12 + width}
                y1={rowY + 8}
                y2={rowY + 8}
              />
            )}
            <text className="column-type" x={left + w - 12} y={rowY} textAnchor="end" dominantBaseline="central">
              {fkColumns.has(c.id) ? 'FK ' : ''}
              {c.dataType}
              {c.notNull && !c.pk ? ' •' : ''}
            </text>
          </g>
        );
      })}

      {uniques.length > 0 && (
        <g className="table-constraints">
          <path
            className="header-rule"
            d={`M ${left} ${
              top + HEADER_H + Math.max(1, columns.length) * ROW_H + FOOTER_GAP / 2
            } H ${left + w}`}
          />
          {uniques.map((u, i) => (
            <text
              key={u.id}
              className="constraint-line"
              x={left + 12}
              y={
                top +
                HEADER_H +
                Math.max(1, columns.length) * ROW_H +
                FOOTER_GAP +
                i * ROW_H +
                ROW_H / 2 +
                3
              }
              dominantBaseline="central"
            >
              UNIQUE ({uniqueColumnNames(node, u).join(', ')})
            </text>
          ))}
        </g>
      )}

      {columns.length === 0 && (
        <text className="column-empty" x={x} y={top + HEADER_H + ROW_H / 2 + 3} textAnchor="middle" dominantBaseline="central">
          no columns
        </text>
      )}

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
