import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DiagramDoc } from './doc';
import type { Diagram, DiagramNode } from '../model/types';

const entity = (id: string, name: string, x = 100, y = 100): DiagramNode => ({
  id,
  kind: 'entity',
  name,
  x,
  y,
  w: 140,
  h: 58,
  weak: false,
});

const seed = (nodes: DiagramNode[] = [entity('e1', 'STUDENT')]): Diagram => ({
  nodes,
  edges: [],
});

/** Two documents that have seen each other, ready to be edited apart. */
function pair(diagram: Diagram = seed()) {
  const a = new DiagramDoc();
  const b = new DiagramDoc();
  a.replace(diagram, 'Shared');
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc), 'remote');
  return { a, b };
}

/**
 * Reconciles two diverged documents the way the provider does on reconnect.
 * Both diffs are computed before either is applied — computing the second
 * against a document that has already absorbed the first is not a concurrent
 * merge, and would not exercise the case that matters.
 */
function reconcile(a: DiagramDoc, b: DiagramDoc) {
  const forB = Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc));
  const forA = Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc));
  Y.applyUpdate(b.ydoc, forB, 'remote');
  Y.applyUpdate(a.ydoc, forA, 'remote');
}

const agree = (a: DiagramDoc, b: DiagramDoc) =>
  expect(a.snapshot()).toEqual(b.snapshot());

describe('DiagramDoc convergence', () => {
  it('carries a document to a peer', () => {
    const { a, b } = pair();
    agree(a, b);
    expect(b.snapshot().nodes[0].name).toBe('STUDENT');
    expect(b.title).toBe('Shared');
  });

  // The case that motivated storing each node as a Y.Map of fields rather than
  // as one blob: a blob would let the last writer silently discard the other.
  it('keeps a rename and a move made concurrently to the same shape', () => {
    const { a, b } = pair();
    a.updateNode('e1', { name: 'ENROLLEE' });
    b.moveNodes(['e1'], 60, 40);
    reconcile(a, b);

    const node = a.snapshot().nodes[0];
    expect(node.name).toBe('ENROLLEE');
    expect(node.x).toBe(160);
    expect(node.y).toBe(140);
    agree(a, b);
  });

  it('converges when both sides write the same field', () => {
    const { a, b } = pair();
    a.updateNode('e1', { name: 'FROM_A' });
    b.updateNode('e1', { name: 'FROM_B' });
    reconcile(a, b);

    agree(a, b);
    expect(['FROM_A', 'FROM_B']).toContain(a.snapshot().nodes[0].name);
  });

  it('keeps an edit made while another shape was being deleted', () => {
    const { a, b } = pair(seed([entity('e1', 'STUDENT'), entity('e2', 'COURSE', 400, 100)]));
    a.remove(['e2']);
    b.updateNode('e1', { name: 'KEPT' });
    reconcile(a, b);

    agree(a, b);
    expect(a.snapshot().nodes).toHaveLength(1);
    expect(a.snapshot().nodes[0].name).toBe('KEPT');
  });

  it('drops edges left dangling by a concurrent node deletion', () => {
    const nodes = [entity('e1', 'STUDENT'), entity('e2', 'COURSE', 400, 100)];
    const attribute: DiagramNode = {
      id: 'a1',
      kind: 'attribute',
      name: 'sid',
      x: 60,
      y: 200,
      w: 100,
      h: 46,
      key: true,
      partialKey: false,
      multivalued: false,
      derived: false,
      dataType: 'INTEGER',
      nullable: false,
    };
    const { a, b } = pair({
      nodes: [...nodes, attribute],
      edges: [{ id: 'x1', kind: 'attribute', source: 'a1', target: 'e1' }],
    });

    a.remove(['e1']);
    reconcile(a, b);

    agree(a, b);
    // Deleting an entity takes its attribute and the connector with it.
    expect(a.snapshot().edges).toHaveLength(0);
    expect(a.snapshot().nodes.map((n) => n.id)).toEqual(['e2']);
  });

  it('converges when three people edit at once', () => {
    const a = new DiagramDoc();
    const b = new DiagramDoc();
    const c = new DiagramDoc();
    a.replace(seed(), 'Shared');
    const initial = Y.encodeStateAsUpdate(a.ydoc);
    Y.applyUpdate(b.ydoc, initial, 'remote');
    Y.applyUpdate(c.ydoc, initial, 'remote');

    a.updateNode('e1', { name: 'A_NAME' });
    b.moveNodes(['e1'], 10, 0);
    c.updateNode('e1', { weak: true });

    // Everyone broadcasts; everyone applies everyone else's state.
    const states = [a, b, c].map((d) => Y.encodeStateAsUpdate(d.ydoc));
    for (const doc of [a, b, c]) {
      for (const state of states) Y.applyUpdate(doc.ydoc, state, 'remote');
    }

    expect(a.snapshot()).toEqual(b.snapshot());
    expect(b.snapshot()).toEqual(c.snapshot());
    const node = a.snapshot().nodes[0];
    expect(node.x).toBe(110);
    // `weak` only exists on an entity; narrow before reading it.
    expect(node.kind === 'entity' && node.weak).toBe(true);
  });
});

describe('DiagramDoc undo', () => {
  /** Connected pair, so each edit reaches the other as it happens. */
  function live() {
    const a = new DiagramDoc();
    const b = new DiagramDoc();
    a.ydoc.on('update', (u, origin) => {
      if (origin !== 'remote') Y.applyUpdate(b.ydoc, u, 'remote');
    });
    b.ydoc.on('update', (u, origin) => {
      if (origin !== 'remote') Y.applyUpdate(a.ydoc, u, 'remote');
    });
    a.replace(seed(), 'Shared');
    return { a, b };
  }

  it('reverts only your own work, never a teammate’s', () => {
    const { a, b } = live();
    a.updateNode('e1', { name: 'MINE' });
    a.breakUndoGroup();
    b.moveNodes(['e1'], 5, 5);

    a.undoManager.undo();

    const node = a.snapshot().nodes[0];
    expect(node.name).toBe('STUDENT');
    expect(node.x).toBe(105);
    expect(node.y).toBe(105);
    agree(a, b);
  });

  it('treats a finished drag as one step', () => {
    const { a } = live();
    for (let i = 0; i < 10; i++) a.moveNodes(['e1'], 1, 1);
    a.breakUndoGroup();

    expect(a.snapshot().nodes[0].x).toBe(110);
    a.undoManager.undo();
    expect(a.snapshot().nodes[0].x).toBe(100);
  });

  it('does not undo past a freshly loaded document', () => {
    const { a } = live();
    a.replace(seed([entity('z1', 'OTHER')]), 'Replaced');
    expect(a.undoManager.undoStack).toHaveLength(0);
    a.undoManager.undo();
    expect(a.snapshot().nodes[0].name).toBe('OTHER');
  });
});
