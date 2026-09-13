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
/** A table-level UNIQUE constraint: one candidate key, over one or more columns. */
export interface UniqueConstraint {
  id: string;
  /** Column ids, in the order they appear in the constraint. */
  columns: string[];
}

export interface TableNode extends BaseNode {
  kind: 'table';
  columnOrder: string[];
  /**
   * Display order of the table's UNIQUE constraints, which are stored one per
   * key — `uniq:<id>` — for the same reason the columns are. Read them with
   * `readUniques`.
   */
  uniqueOrder?: string[];
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

export const uniqueKey = (id: string) => `uniq:${id}`;

/**
 * The table's UNIQUE constraints.
 *
 * Column ids that no longer name a column of this table are dropped, so
 * deleting a column shrinks the constraint rather than leaving it pointing at
 * nothing; a constraint emptied that way is reported by the checker.
 */
export function readUniques(node: TableNode): UniqueConstraint[] {
  const record = node as unknown as Record<string, UniqueConstraint | undefined>;
  return (node.uniqueOrder ?? [])
    .map((id) => record[uniqueKey(id)])
    .filter((u): u is UniqueConstraint => !!u && Array.isArray(u.columns))
    .map((u) => ({ ...u, columns: u.columns.filter((c) => !!readColumn(node, c)) }));
}

/** A constraint's columns as names, in constraint order. */
export const uniqueColumnNames = (node: TableNode, u: UniqueConstraint): string[] =>
  u.columns.map((id) => readColumn(node, id)?.name).filter((n): n is string => !!n);

/**
 * The constraint block exactly as the table shape draws it. The same strings
 * size the box, so what is measured is always what is rendered.
 */
export const uniqueLines = (node: TableNode): string[] =>
  readUniques(node)
    .filter((u) => u.columns.length > 0)
    .map((u) => `UNIQUE (${uniqueColumnNames(node, u).join(', ')})`);

export const primaryKeyOf = (node: TableNode) => readColumns(node).filter((c) => c.pk);
