import type { Diagram, DiagramNode, Edge, Id, NodeKind } from '../model/types';
import { createEdge, createNode, inferEdge, newId } from '../model/factory';
import { fitSize } from '../model/measure';

export interface Snapshot {
  title: string;
  diagram: Diagram;
}

export interface AppState extends Snapshot {
  past: Snapshot[];
  future: Snapshot[];
  selection: Id[];
}

export type Action =
  /** Push the current state onto the undo stack before a burst of edits. */
  | { type: 'begin' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; diagram: Diagram; title: string; resetHistory?: boolean }
  | { type: 'setTitle'; title: string }
  | { type: 'addNode'; kind: NodeKind; x: number; y: number; select?: boolean }
  | { type: 'insertNodes'; nodes: DiagramNode[]; edges: Edge[] }
  | { type: 'updateNode'; id: Id; patch: Partial<DiagramNode>; transient?: boolean }
  | { type: 'updateEdge'; id: Id; patch: Partial<Edge> }
  | { type: 'moveNodes'; ids: Id[]; dx: number; dy: number }
  | { type: 'connect'; a: Id; b: Id }
  | { type: 'deleteSelection' }
  | { type: 'select'; ids: Id[]; mode?: 'replace' | 'add' | 'toggle' };

export const initialState = (snap: Snapshot): AppState => ({
  ...snap,
  past: [],
  future: [],
  selection: [],
});

const snapshotOf = (s: AppState): Snapshot => ({ title: s.title, diagram: s.diagram });

/** Applies an edit and records the previous state for undo. */
function commit(s: AppState, next: Partial<AppState>): AppState {
  return {
    ...s,
    ...next,
    past: [...s.past.slice(-99), snapshotOf(s)],
    future: [],
  };
}

/** Applies an edit without a new undo entry (used during a drag). */
const amend = (s: AppState, next: Partial<AppState>): AppState => ({ ...s, ...next });

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'begin':
      return { ...s, past: [...s.past.slice(-99), snapshotOf(s)], future: [] };

    case 'undo': {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return {
        ...s,
        ...prev,
        past: s.past.slice(0, -1),
        future: [snapshotOf(s), ...s.future].slice(0, 100),
        selection: s.selection.filter((id) =>
          prev.diagram.nodes.some((n) => n.id === id) ||
          prev.diagram.edges.some((e) => e.id === id),
        ),
      };
    }

    case 'redo': {
      const next = s.future[0];
      if (!next) return s;
      return {
        ...s,
        ...next,
        past: [...s.past, snapshotOf(s)],
        future: s.future.slice(1),
        selection: [],
      };
    }

    case 'load':
      return a.resetHistory
        ? { ...s, title: a.title, diagram: a.diagram, past: [], future: [], selection: [] }
        : commit(s, { title: a.title, diagram: a.diagram, selection: [] });

    case 'setTitle':
      return commit(s, { title: a.title });

    case 'addNode': {
      const node = createNode(a.kind, a.x, a.y);
      return commit(s, {
        diagram: { ...s.diagram, nodes: [...s.diagram.nodes, node] },
        selection: a.select === false ? s.selection : [node.id],
      });
    }

    case 'insertNodes':
      return commit(s, {
        diagram: {
          nodes: [...s.diagram.nodes, ...a.nodes],
          edges: [...s.diagram.edges, ...a.edges],
        },
        selection: a.nodes.map((n) => n.id),
      });

    case 'updateNode': {
      const nodes = s.diagram.nodes.map((n) => {
        if (n.id !== a.id) return n;
        const merged = { ...n, ...a.patch } as DiagramNode;
        // Keep the shape big enough for its label as the user types.
        return a.patch.name !== undefined
          ? { ...merged, ...fitSize(merged.kind, merged.name) }
          : merged;
      });
      const next = { diagram: { ...s.diagram, nodes } };
      return a.transient ? amend(s, next) : commit(s, next);
    }

    case 'updateEdge': {
      const edges = s.diagram.edges.map((e) =>
        e.id === a.id ? { ...e, ...a.patch } : e,
      );
      return commit(s, { diagram: { ...s.diagram, edges } });
    }

    case 'moveNodes': {
      const ids = new Set(a.ids);
      const nodes = s.diagram.nodes.map((n) =>
        ids.has(n.id) ? { ...n, x: n.x + a.dx, y: n.y + a.dy } : n,
      );
      return amend(s, { diagram: { ...s.diagram, nodes } });
    }

    case 'connect': {
      if (a.a === a.b) return s;
      const na = s.diagram.nodes.find((n) => n.id === a.a);
      const nb = s.diagram.nodes.find((n) => n.id === a.b);
      if (!na || !nb) return s;
      const spec = inferEdge(na, nb, s.diagram);
      if (!spec) return s;
      // Attributes and ISA/union legs may only be attached once.
      const singleUse =
        spec.kind === 'attribute' || spec.kind === 'isa-sub' || spec.kind === 'union-sub';
      if (
        singleUse &&
        s.diagram.edges.some((e) => e.kind === spec.kind && e.source === spec.source)
      ) {
        return s;
      }
      if (
        spec.kind === 'isa-super' &&
        s.diagram.edges.some((e) => e.kind === 'isa-super' && e.target === spec.target)
      ) {
        return s;
      }
      const dup = s.diagram.edges.some(
        (e) =>
          e.kind === spec.kind &&
          e.source === spec.source &&
          e.target === spec.target &&
          e.kind !== 'participation',
      );
      if (dup) return s;
      const edge = createEdge(spec.source, spec.target, spec.kind);
      return commit(s, {
        diagram: { ...s.diagram, edges: [...s.diagram.edges, edge] },
        selection: [edge.id],
      });
    }

    case 'deleteSelection': {
      if (s.selection.length === 0) return s;
      const dead = new Set(s.selection);
      // Deleting an attribute takes its component attributes with it.
      let grew = true;
      while (grew) {
        grew = false;
        for (const e of s.diagram.edges) {
          if (e.kind === 'attribute' && dead.has(e.target) && !dead.has(e.source)) {
            dead.add(e.source);
            grew = true;
          }
        }
      }
      const nodes = s.diagram.nodes.filter((n) => !dead.has(n.id));
      const alive = new Set(nodes.map((n) => n.id));
      const edges = s.diagram.edges.filter(
        (e) => !dead.has(e.id) && alive.has(e.source) && alive.has(e.target),
      );
      return commit(s, { diagram: { nodes, edges }, selection: [] });
    }

    case 'select': {
      const mode = a.mode ?? 'replace';
      if (mode === 'replace') return { ...s, selection: a.ids };
      if (mode === 'add') return { ...s, selection: [...new Set([...s.selection, ...a.ids])] };
      const set = new Set(s.selection);
      for (const id of a.ids) (set.has(id) ? set.delete(id) : set.add(id));
      return { ...s, selection: [...set] };
    }
  }
}

/** Deep-copies a subgraph so it can be pasted with fresh ids. */
export function cloneSelection(
  diagram: Diagram,
  selection: Id[],
  offset = 40,
): { nodes: DiagramNode[]; edges: Edge[] } {
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
