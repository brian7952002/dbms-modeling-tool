import * as Y from 'yjs';
import type { BaseEdge, BaseNode, Diagram, Id } from '../types';

/**
 * The diagram as a CRDT.
 *
 * Nodes and edges are each a Y.Map keyed by id, and every node is itself a
 * Y.Map of its fields. Storing fields individually rather than as one blob is
 * the whole point: two people editing the same entity — one dragging it, one
 * renaming it — touch different keys and both changes survive. A blob would
 * make the last writer win and silently discard the other.
 */
export class DiagramDoc {
  readonly ydoc: Y.Doc;
  readonly nodes: Y.Map<Y.Map<unknown>>;
  readonly edges: Y.Map<Y.Map<unknown>>;
  readonly meta: Y.Map<unknown>;
  readonly undoManager: Y.UndoManager;

  constructor(ydoc = new Y.Doc()) {
    this.ydoc = ydoc;
    this.nodes = ydoc.getMap('nodes');
    this.edges = ydoc.getMap('edges');
    this.meta = ydoc.getMap('meta');

    // Scoped to this client's own origin, so undo never reaches into a
    // teammate's work — the behaviour people expect from multiplayer editors.
    this.undoManager = new Y.UndoManager([this.nodes, this.edges, this.meta], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 400,
    });
  }

  /** Groups everything in `fn` into one undo step and one network update. */
  transact(fn: () => void) {
    this.ydoc.transact(fn, LOCAL_ORIGIN);
  }

  /** Ends the current undo group, so a finished drag is one step. */
  breakUndoGroup() {
    this.undoManager.stopCapturing();
  }

  get title(): string {
    return (this.meta.get('title') as string) ?? 'Untitled diagram';
  }

  get kind(): DiagramKind {
    return ((this.meta.get('kind') as DiagramKind) ?? 'eer');
  }

  /** For an instance diagram, the EER diagram it illustrates. */
  get sourceDiagramId(): string | null {
    return (this.meta.get('sourceDiagramId') as string) ?? null;
  }

  setTitle(title: string) {
    this.transact(() => this.meta.set('title', title));
  }

  setSourceDiagramId(id: string | null) {
    this.transact(() => this.meta.set('sourceDiagramId', id));
  }

  /** Plain snapshot for rendering, export, validation and persistence. */
  snapshot(): Diagram {
    const nodes: BaseNode[] = [];
    for (const entry of this.nodes.values()) {
      nodes.push(entry.toJSON() as BaseNode);
    }
    const edges: BaseEdge[] = [];
    for (const entry of this.edges.values()) {
      edges.push(entry.toJSON() as BaseEdge);
    }
    // Ids are unordered in a Y.Map; a stable order keeps React keys and the
    // z-order of overlapping shapes from shuffling between renders.
    nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { nodes, edges };
  }

  /** Replaces the whole document — opening a file, or loading a sample. */
  replace(diagram: Diagram, title: string, kind: DiagramKind = 'eer') {
    this.transact(() => {
      this.nodes.clear();
      this.edges.clear();
      for (const n of diagram.nodes) this.nodes.set(n.id, toYMap(n));
      for (const e of diagram.edges) this.edges.set(e.id, toYMap(e));
      this.meta.set('title', title);
      this.meta.set('kind', kind);
    });
    // A fresh document should not be undoable back to the previous one.
    this.undoManager.clear();
  }

  /* ---- element operations --------------------------------------------- */

  addNode(node: BaseNode) {
    this.transact(() => this.nodes.set(node.id, toYMap(node)));
  }

  insert(nodes: BaseNode[], edges: BaseEdge[]) {
    this.transact(() => {
      for (const n of nodes) this.nodes.set(n.id, toYMap(n));
      for (const e of edges) this.edges.set(e.id, toYMap(e));
    });
  }

  updateNode(id: Id, patch: Record<string, unknown>) {
    const entry = this.nodes.get(id);
    if (!entry) return;
    this.transact(() => {
      for (const [key, value] of Object.entries(patch)) {
        entry.set(key, value as unknown);
      }
    });
  }

  updateEdge(id: Id, patch: Record<string, unknown>) {
    const entry = this.edges.get(id);
    if (!entry) return;
    this.transact(() => {
      for (const [key, value] of Object.entries(patch)) {
        entry.set(key, value as unknown);
      }
    });
  }

  addEdge(edge: BaseEdge) {
    this.transact(() => this.edges.set(edge.id, toYMap(edge)));
  }

  moveNodes(ids: Id[], dx: number, dy: number) {
    this.transact(() => {
      for (const id of ids) {
        const entry = this.nodes.get(id);
        if (!entry) continue;
        entry.set('x', (entry.get('x') as number) + dx);
        entry.set('y', (entry.get('y') as number) + dy);
      }
    });
  }

  /** Removes nodes and edges, dropping any edge left dangling. */
  remove(ids: Id[]) {
    const dead = new Set(ids);
    this.transact(() => {
      // Deleting an attribute takes its component attributes with it.
      let grew = true;
      while (grew) {
        grew = false;
        for (const entry of this.edges.values()) {
          const kind = entry.get('kind');
          const target = entry.get('target') as Id;
          const source = entry.get('source') as Id;
          if (kind === 'attribute' && dead.has(target) && !dead.has(source)) {
            dead.add(source);
            grew = true;
          }
        }
      }
      for (const id of dead) {
        this.nodes.delete(id);
        this.edges.delete(id);
      }
      for (const [id, entry] of this.edges.entries()) {
        const source = entry.get('source') as Id;
        const target = entry.get('target') as Id;
        if (!this.nodes.has(source) || !this.nodes.has(target)) this.edges.delete(id);
      }
    });
  }

  hasNode(id: Id) {
    return this.nodes.has(id);
  }
}

export type DiagramKind = 'eer' | 'instance';

/** Marks changes made by this client, so undo and echo-suppression can tell. */
export const LOCAL_ORIGIN = Symbol('local');

function toYMap(value: object): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined) map.set(key, v);
  }
  return map;
}

/** Restores a document from the base64 state stored alongside the diagram. */
export function applyEncodedState(doc: DiagramDoc, encoded: string) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  Y.applyUpdate(doc.ydoc, bytes);
}

export function encodeState(doc: DiagramDoc): string {
  const bytes = Y.encodeStateAsUpdate(doc.ydoc);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
