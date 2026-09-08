/**
 * The vocabulary the platform shares with every model.
 *
 * The canvas, the CRDT, persistence and export all work in terms of these and
 * nothing more: a node is something with an id, a kind, a name and a box; an
 * edge joins two nodes. Everything that makes a diagram an *EER* diagram — or
 * a relational one, or a physical one — belongs to that model's own package.
 */

export type Id = string;

export interface Point {
  x: number;
  y: number;
}

export interface BaseNode {
  id: Id;
  /** Discriminator owned by the model, e.g. 'entity' or 'table'. */
  kind: string;
  name: string;
  /** Centre point, in diagram coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  note?: string;
}

export interface BaseEdge {
  id: Id;
  kind: string;
  source: Id;
  target: Id;
  /** Manual perpendicular offset, used to fan out parallel connectors. */
  bow?: number;
}

export interface Diagram<N extends BaseNode = BaseNode, E extends BaseEdge = BaseEdge> {
  nodes: N[];
  edges: E[];
}

export interface DiagramFile<D extends Diagram = Diagram> {
  format: 'eer-diagram-designer';
  version: 1;
  title: string;
  /** Which model this diagram belongs to. Absent in files written before models existed. */
  model?: string;
  diagram: D;
}

export const emptyDiagram = (): Diagram => ({ nodes: [], edges: [] });
