/**
 * The physical model: how the relations are actually stored and reached.
 *
 * Where the logical model says what the tables are, this says how each one is
 * organised on disk and which access paths exist into it — the stage where a
 * design stops being a drawing and starts having a cost.
 */

import type { BaseEdge, BaseNode, Id, Point } from '../../platform/types';

export type { Id, Point };

export type NodeKind = 'store' | 'index';

/** How the records of one relation are arranged in its file. */
export type Organisation = 'heap' | 'sequential' | 'hash' | 'clustered';

export const ORGANISATIONS: { id: Organisation; label: string; blurb: string }[] = [
  { id: 'heap', label: 'Heap', blurb: 'Unordered. Cheap to insert, linear to search.' },
  { id: 'sequential', label: 'Sequential', blurb: 'Ordered by a key. Binary search, costly inserts.' },
  { id: 'hash', label: 'Hash', blurb: 'Hashed on a key. Near-constant equality lookup, no range scans.' },
  { id: 'clustered', label: 'Clustered', blurb: 'Physically grouped by a key, often shared with a related file.' },
];

export interface StoreNode extends BaseNode {
  kind: 'store';
  /** The relation this file holds, named as in the logical model. */
  tableName: string;
  organisation: Organisation;
  /** Ordering or hash key, for every organisation but heap. */
  keyColumns: string[];
  estimatedRows: number;
  avgRowBytes: number;
  blockSize: number;
  /** Proportion of each block actually filled, 0–1. */
  fillFactor: number;
  tablespace?: string;
}

export type IndexType = 'btree' | 'hash' | 'bitmap';

export const INDEX_TYPES: { id: IndexType; label: string; blurb: string }[] = [
  { id: 'btree', label: 'B+-tree', blurb: 'Equality and range. The default for a reason.' },
  { id: 'hash', label: 'Hash', blurb: 'Equality only. No help for ranges or ordering.' },
  { id: 'bitmap', label: 'Bitmap', blurb: 'Low-cardinality columns; cheap to combine, costly to update.' },
];

export interface IndexNode extends BaseNode {
  kind: 'index';
  indexName: string;
  columns: string[];
  type: IndexType;
  unique: boolean;
  /**
   * A clustering index determines the physical order of the file, so a store
   * can have at most one.
   */
  clustering: boolean;
  avgKeyBytes: number;
}

export type DiagramNode = StoreNode | IndexNode;

export type EdgeKind = 'indexes';

export interface Edge extends BaseEdge {
  kind: 'indexes';
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: Edge[];
}

export const emptyDiagram = (): Diagram => ({ nodes: [], edges: [] });

export const isStore = (n: DiagramNode): n is StoreNode => n.kind === 'store';
export const isIndex = (n: DiagramNode): n is IndexNode => n.kind === 'index';

/** The indexes attached to one store. */
export function indexesOf(d: Diagram, storeId: Id): IndexNode[] {
  return d.edges
    .filter((e) => e.kind === 'indexes' && e.target === storeId)
    .map((e) => d.nodes.find((n) => n.id === e.source))
    .filter(isIndexNode);
}

const isIndexNode = (n: DiagramNode | undefined): n is IndexNode => !!n && n.kind === 'index';

/** The store an index sits on, if it is attached to one. */
export function storeOf(d: Diagram, indexId: Id): StoreNode | undefined {
  const edge = d.edges.find((e) => e.kind === 'indexes' && e.source === indexId);
  if (!edge) return undefined;
  const node = d.nodes.find((n) => n.id === edge.target);
  return node && node.kind === 'store' ? node : undefined;
}
