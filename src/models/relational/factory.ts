import { newId } from '../../platform/ids';
import { measureText } from '../../platform/measure';
import type { BaseNode } from '../../platform/types';
import {
  columnKey,
  readColumns,
  type Column,
  type Diagram,
  type DiagramNode,
  type Edge,
  type EdgeKind,
  type Id,
  type Point,
  type TableNode,
} from './types';

export const HEADER_H = 30;
export const ROW_H = 22;
const PAD_X = 28;

const ROW_FONT = '400 12px "Cascadia Mono", ui-monospace, Consolas, monospace';
const TYPE_FONT = '400 11px "Cascadia Mono", ui-monospace, Consolas, monospace';

// A row is drawn as the name on the left and the type hard right, so the box
// has to fit both plus the markers that may sit between them.
const MARKER_ALLOWANCE = 34; // "FK " prefix and the NOT NULL dot
const COLUMN_GAP = 16;

/** A table is exactly as tall as its columns and as wide as its widest row. */
export function sizeForTable(name: string, columns: Column[]): { w: number; h: number } {
  const widest = columns.reduce(
    (m, c) =>
      Math.max(
        m,
        measureText(c.name, ROW_FONT) + measureText(c.dataType, TYPE_FONT) + COLUMN_GAP + MARKER_ALLOWANCE,
      ),
    0,
  );
  return {
    w: Math.max(200, Math.round(Math.max(widest + PAD_X, measureText(name) + PAD_X))),
    h: HEADER_H + Math.max(1, columns.length) * ROW_H + 8,
  };
}

export function makeColumn(partial: Partial<Column> = {}): Column {
  return {
    id: newId('c'),
    name: 'column',
    dataType: 'VARCHAR(255)',
    notNull: false,
    pk: false,
    unique: false,
    ...partial,
  };
}

/**
 * Builds a table node with its columns already in place. Columns live under
 * `col:<id>` keys, so this assembles the object rather than nesting an array.
 */
export function makeTable(
  name: string,
  x: number,
  y: number,
  columns: Column[] = [],
): TableNode {
  const node = {
    id: newId('t'),
    kind: 'table' as const,
    name,
    x,
    y,
    columnOrder: columns.map((c) => c.id),
    ...sizeForTable(name, columns),
  } as TableNode;
  const record = node as unknown as Record<string, unknown>;
  for (const c of columns) record[columnKey(c.id)] = c;
  return node;
}

export function createNode(_kind: 'table', x: number, y: number): DiagramNode {
  return makeTable('table', x, y, [
    makeColumn({ name: 'id', dataType: 'INTEGER', pk: true, notNull: true }),
  ]);
}

export function createEdge(source: Id, target: Id, kind: EdgeKind): Edge {
  return { id: newId('e'), kind, source, target, columns: [], references: [] };
}

/** Tables are rectangles. */
export function relationalOutline(node: BaseNode): Point[] | null {
  const hw = node.w / 2;
  const hh = node.h / 2;
  return [
    { x: node.x - hw, y: node.y - hh },
    { x: node.x + hw, y: node.y - hh },
    { x: node.x + hw, y: node.y + hh },
    { x: node.x - hw, y: node.y + hh },
  ];
}

/**
 * Joining two tables means declaring a foreign key. The child is whichever was
 * clicked first; the referenced columns default to the parent's primary key,
 * which is what a foreign key almost always points at.
 */
export function inferEdge(
  a: DiagramNode,
  b: DiagramNode,
  _diagram: Diagram,
): { source: Id; target: Id; kind: EdgeKind } | null {
  if (a.kind !== 'table' || b.kind !== 'table') return null;
  return { source: a.id, target: b.id, kind: 'foreign-key' };
}

/** Default column mapping for a new foreign key: match the parent's key. */
export function defaultReferences(child: TableNode, parent: TableNode): {
  columns: string[];
  references: string[];
} {
  const parentKey = readColumns(parent).filter((c) => c.pk);
  const childColumns = readColumns(child);
  const columns: string[] = [];
  const references: string[] = [];

  for (const key of parentKey) {
    // Prefer a column that already looks like it was meant to reference this.
    const match =
      childColumns.find((c) => c.name === `${parent.name}_${key.name}`) ??
      childColumns.find((c) => c.name === key.name && !c.pk) ??
      childColumns.find((c) => c.name === key.name);
    if (match) {
      columns.push(match.id);
      references.push(key.id);
    }
  }
  return { columns, references };
}
