import type { BaseEdge, BaseNode, Diagram, Id } from './types';
import { newId } from './ids';
import { orbitSlot } from './geometry';

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

/**
 * Where each owner's attributes should sit so they overlap neither each other
 * nor anything else on the canvas.
 *
 * Owners are laid out in turn against a working copy of the diagram, so a later
 * entity sees where an earlier one's attributes ended up. A composite
 * attribute's components travel with their parent, keeping whatever shape the
 * user gave them. Returns the moves to apply, so the caller decides how they
 * land on the undo stack.
 */
export function tidyAttributePlan(
  diagram: Diagram,
  ownerIds: Id[],
): { id: Id; x: number; y: number }[] {
  const live = new Map(diagram.nodes.map((n) => [n.id, { ...n }]));
  const childrenOf = (id: Id) =>
    diagram.edges
      .filter((e) => e.kind === 'attribute' && e.target === id)
      .map((e) => live.get(e.source))
      .filter((n): n is BaseNode => !!n);

  const moves: { id: Id; x: number; y: number }[] = [];
  for (const ownerId of ownerIds) {
    const owner = live.get(ownerId);
    if (!owner) continue;
    const attrs = childrenOf(ownerId);
    if (attrs.length === 0) continue;

    const seen = new Set<Id>([ownerId]);
    const groups = attrs.map((a) => {
      const group: BaseNode[] = [];
      const walk = (n: BaseNode) => {
        if (seen.has(n.id)) return;
        seen.add(n.id);
        group.push(n);
        for (const c of childrenOf(n.id)) walk(c);
      };
      walk(a);
      return group;
    });

    const moving = new Set(groups.flat().map((n) => n.id));
    const obstacles = [...live.values()].filter((n) => !moving.has(n.id));
    const heads: BaseNode[] = [];
    for (const group of groups) {
      const head = group[0];
      if (!head) continue;
      const spot = orbitSlot(owner, head, obstacles, heads);
      const dx = spot.x - head.x;
      const dy = spot.y - head.y;
      for (const n of group) {
        // Mutating the working copy is what lets the next owner see this.
        n.x += dx;
        n.y += dy;
        moves.push({ id: n.id, x: n.x, y: n.y });
        obstacles.push(n);
      }
      heads.push(head);
    }
  }
  return moves;
}
