/**
 * The relational (logical) model: tables, columns, keys and referential
 * integrity — the schema an EER diagram maps onto.
 */

import type { BaseEdge, BaseNode, Id, Point } from '../../platform/types';

export type { Id, Point };

export type NodeKind = 'table';

export interface Column {
  id: string;
  name: string;
  dataType: string;
  notNull: boolean;
  /** Part of the primary key. */
  pk: boolean;
  unique: boolean;
}

/**
 * A relation.
 *
 * Columns are stored one per key — `col:<id>` — rather than as a single array,
 * so two people renaming different columns of the same table do not overwrite
 * each other. `columnOrder` holds the display sequence. Read them with
 * `readColumns`; never reach for the keys directly.
 */
export interface TableNode extends BaseNode {
  kind: 'table';
  columnOrder: string[];
}

export type DiagramNode = TableNode;

export type EdgeKind = 'foreign-key';

export interface Edge extends BaseEdge {
  kind: 'foreign-key';
  /** Column ids on the referencing (child) table. */
  columns: string[];
  /** Column ids on the referenced (parent) table. */
  references: string[];
  onDelete?: 'NO ACTION' | 'CASCADE' | 'SET NULL' | 'RESTRICT';
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: Edge[];
}

export const emptyDiagram = (): Diagram => ({ nodes: [], edges: [] });

/* -------------------------------------------------------------------------- */
/* Column storage                                                             */
/* -------------------------------------------------------------------------- */

export const columnKey = (id: string) => `col:${id}`;

export function readColumns(node: TableNode): Column[] {
  const record = node as unknown as Record<string, Column | undefined>;
  return (node.columnOrder ?? [])
    .map((id) => record[columnKey(id)])
    .filter((c): c is Column => !!c && typeof c.name === 'string');
}

export function readColumn(node: TableNode, columnId: string): Column | undefined {
  return (node as unknown as Record<string, Column | undefined>)[columnKey(columnId)];
}

export const primaryKeyOf = (node: TableNode) => readColumns(node).filter((c) => c.pk);
