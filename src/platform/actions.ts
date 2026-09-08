import type { BaseEdge, BaseNode, Diagram, Id } from './types';
import { newId } from './ids';

export type Action =
  /** Push the current state onto the undo stack before a burst of edits. */
  | { type: 'begin' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; diagram: Diagram; title: string; resetHistory?: boolean }
  | { type: 'setTitle'; title: string }
  | { type: 'addNode'; kind: string; x: number; y: number; select?: boolean }
  | { type: 'insertNodes'; nodes: BaseNode[]; edges: BaseEdge[] }
  | { type: 'updateNode'; id: Id; patch: Record<string, unknown>; transient?: boolean }
  | { type: 'updateEdge'; id: Id; patch: Record<string, unknown> }
  | { type: 'moveNodes'; ids: Id[]; dx: number; dy: number }
  | { type: 'connect'; a: Id; b: Id }
  | { type: 'deleteSelection' }
  | { type: 'select'; ids: Id[]; mode?: 'replace' | 'add' | 'toggle' };

/** Deep-copies a subgraph so it can be pasted with fresh ids. */
export function cloneSelection(
  diagram: Diagram,
  selection: Id[],
  offset = 40,
): { nodes: BaseNode[]; edges: BaseEdge[] } {
  const picked = new Set(selection);
  const nodes = diagram.nodes.filter((n) => picked.has(n.id));
  const map = new Map<Id, Id>();
  const copies = nodes.map((n) => {
    const id = newId(n.kind[0]);
    map.set(n.id, id);
    return { ...n, id, x: n.x + offset, y: n.y + offset };
  });
  const edges = diagram.edges
    .filter((e) => map.has(e.source) && map.has(e.target))
    .map((e) => ({ ...e, id: newId('e'), source: map.get(e.source)!, target: map.get(e.target)! }));
  return { nodes: copies, edges };
}
