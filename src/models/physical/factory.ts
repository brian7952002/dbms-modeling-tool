import { newId } from '../../platform/ids';
import { measureText } from '../../platform/measure';
import type { BaseNode } from '../../platform/types';
import type {
  Diagram,
  DiagramNode,
  Edge,
  EdgeKind,
  Id,
  IndexNode,
  NodeKind,
  Point,
  StoreNode,
} from './types';

export const STORE_HEADER_H = 30;
export const STORE_ROW_H = 20;
/** Organisation, rows, row size, blocks, lookup cost. */
export const STORE_ROWS = 5;

const LABEL_FONT = '600 13px "Segoe UI", system-ui, sans-serif';

export function sizeForStore(name: string): { w: number; h: number } {
  return {
    w: Math.max(230, Math.round(measureText(name, LABEL_FONT) + 60)),
    h: STORE_HEADER_H + STORE_ROWS * STORE_ROW_H + 10,
  };
}

export function sizeForIndex(name: string, columns: string[]): { w: number; h: number } {
  const line = columns.join(', ') || 'no columns';
  return {
    w: Math.max(
      170,
      Math.round(Math.max(measureText(name, LABEL_FONT), measureText(line, LABEL_FONT)) + 44),
    ),
    h: 62,
  };
}

export function makeStore(tableName: string, x: number, y: number): StoreNode {
  return {
    id: newId('s'),
    kind: 'store',
    name: tableName,
    tableName,
    organisation: 'heap',
    keyColumns: [],
    estimatedRows: 10000,
    avgRowBytes: 120,
    blockSize: 4096,
    fillFactor: 0.7,
    x,
    y,
    ...sizeForStore(tableName),
  };
}

export function makeIndex(
  indexName: string,
  columns: string[],
  x: number,
  y: number,
  extra: Partial<IndexNode> = {},
): IndexNode {
  return {
    id: newId('x'),
    kind: 'index',
    name: indexName,
    indexName,
    columns,
    type: 'btree',
    unique: false,
    clustering: false,
    avgKeyBytes: 12,
    x,
    y,
    ...sizeForIndex(indexName, columns),
    ...extra,
  };
}

export function createNode(kind: NodeKind, x: number, y: number): DiagramNode {
  return kind === 'store' ? makeStore('table', x, y) : makeIndex('idx', ['column'], x, y);
}

export function createEdge(source: Id, target: Id, kind: EdgeKind): Edge {
  return { id: newId('e'), kind, source, target };
}

/** Stores are rectangles; indexes are rounded but clip the same way. */
export function physicalOutline(node: BaseNode): Point[] | null {
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
 * The only connection here is an index sitting on a stored file. An index
 * belongs to exactly one store, so a second attempt is refused rather than
 * silently moving it.
 */
export function inferEdge(
  a: DiagramNode,
  b: DiagramNode,
  diagram: Diagram,
): { source: Id; target: Id; kind: EdgeKind } | null {
  const index = a.kind === 'index' ? a : b.kind === 'index' ? b : null;
  const store = a.kind === 'store' ? a : b.kind === 'store' ? b : null;
  if (!index || !store) return null;
  if (diagram.edges.some((e) => e.kind === 'indexes' && e.source === index.id)) return null;
  return { source: index.id, target: store.id, kind: 'indexes' };
}
