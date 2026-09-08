// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { DiagramDoc, applyEncodedState, encodeState } from './doc';
import type { BaseNode, Diagram } from '../types';
import { useDiagramDoc } from './useDiagramDoc';
import { eerModel } from '../../models/eer';

/**
 * Two people in one diagram, over the protocol `provider.ts` actually speaks.
 *
 * The convergence tests in `doc.test.ts` wire two documents straight together.
 * That proves the CRDT merges, which was never really in doubt; it says
 * nothing about the session around it — who asks whom for what on join, and
 * what a client broadcasts while it is still in a room it is about to leave.
 * These are the failures that only show up with two real browsers.
 */

const REMOTE = 'remote';

/** A stand-in for the Supabase broadcast channel, faithful to the real one. */
class Room {
  private members = new Map<string, { doc: DiagramDoc; off: () => void }>();

  join(id: string, doc: DiagramDoc) {
    // Only what this client authored is forwarded; echoing a received update
    // would bounce it around the room forever. Mirrors provider.ts.
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      for (const [other, peer] of this.members) {
        if (other === id) continue; // broadcast: { self: false }
        Y.applyUpdate(peer.doc.ydoc, update, REMOTE);
      }
    };
    doc.ydoc.on('update', onUpdate);
    this.members.set(id, { doc, off: () => doc.ydoc.off('update', onUpdate) });

    // The joiner asks for whatever it is missing; everyone already here answers
    // with the difference *and* a state vector of their own, and the joiner
    // answers that in turn. Both halves matter — see the tests below.
    const joinerSv = Y.encodeStateVector(doc.ydoc);
    for (const [other, peer] of this.members) {
      if (other === id) continue;
      const peerSv = Y.encodeStateVector(peer.doc.ydoc);
      Y.applyUpdate(doc.ydoc, Y.encodeStateAsUpdate(peer.doc.ydoc, joinerSv), REMOTE);
      Y.applyUpdate(peer.doc.ydoc, Y.encodeStateAsUpdate(doc.ydoc, peerSv), REMOTE);
    }
  }

  leave(id: string) {
    this.members.get(id)?.off();
    this.members.delete(id);
  }
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const node = (id: string, name: string): BaseNode => ({
  id,
  kind: 'entity',
  name,
  x: 0,
  y: 0,
  w: 140,
  h: 60,
});

/** What a stored row's `ydoc` column holds: a document, encoded. */
function stored(nodes: BaseNode[], title: string): string {
  const doc = new DiagramDoc();
  doc.replace({ nodes, edges: [] }, title);
  return encodeState(doc);
}

/**
 * Opening a diagram, as App.tsx does it: a *new* document restored from the
 * stored state, never the current one emptied and refilled.
 */
function open(encoded: string, title: string): DiagramDoc {
  const doc = new DiagramDoc();
  applyEncodedState(doc, encoded);
  if (doc.title !== title) doc.setTitle(title);
  return doc;
}

const names = (doc: DiagramDoc) =>
  doc
    .snapshot()
    .nodes.map((n) => n.name)
    .sort();

/* -------------------------------------------------------------------------- */

describe('two people in one diagram', () => {
  it('shows a joiner what is already there', () => {
    const schema = stored([node('n1', 'STUDENT'), node('n2', 'COURSE')], 'Practice');
    const room = new Room();

    const a = open(schema, 'Practice');
    room.join('a', a);

    const b = open(schema, 'Practice');
    room.join('b', b);

    expect(names(b)).toEqual(['COURSE', 'STUDENT']);
  });

  it('carries an edit made after the other joined', () => {
    const schema = stored([node('n1', 'STUDENT')], 'Practice');
    const room = new Room();

    const a = open(schema, 'Practice');
    room.join('a', a);

    const b = open(schema, 'Practice');
    room.join('b', b);

    a.addNode(node('n2', 'COURSE'));
    expect(names(b)).toEqual(['COURSE', 'STUDENT']);

    b.addNode(node('n3', 'ENROLLS'));
    expect(names(a)).toEqual(['COURSE', 'ENROLLS', 'STUDENT']);
  });

  // The joiner asks the room for what it lacks. Nobody asks the joiner.
  it('gives the room what the joiner has and it lacks', () => {
    const room = new Room();

    // A is in the diagram as it was saved earlier.
    const a = open(stored([node('n1', 'STUDENT')], 'Practice'), 'Practice');
    room.join('a', a);

    // B opens the same diagram, but from a newer save that A has never seen.
    const b = open(stored([node('n1', 'STUDENT'), node('n2', 'COURSE')], 'Practice'), 'Practice');
    room.join('b', b);

    expect(names(b)).toContain('COURSE');
    expect(names(a)).toContain('COURSE');
  });

  // Leaving is not an edit. Whatever the departing client does to its own
  // document on the way out must not reach the people still working.
  it('does not wipe the room when someone opens a different diagram', () => {
    const first = stored([node('n1', 'STUDENT'), node('n2', 'COURSE')], 'First');
    const second = stored([node('m1', 'INVOICE')], 'Second');
    const room = new Room();

    const a = open(first, 'First');
    room.join('a', a);

    const b = open(first, 'First');
    room.join('b', b);
    expect(names(b)).toEqual(['COURSE', 'STUDENT']);

    // A switches to another diagram. A is deliberately still in the room: in
    // App.tsx the switch happens synchronously, before React tears the
    // provider down, so anything done to the old document still goes out.
    const aSecond = open(second, 'Second');

    expect(names(aSecond)).toEqual(['INVOICE']);
    expect(names(b)).toEqual(['COURSE', 'STUDENT']);
  });

  // The tests above work on documents directly. This one goes through the hook
  // the app actually calls, which is where the mistake would come back.
  it('starts a new document when the hook is reset, leaving the room alone', () => {
    const firstDiagram: Diagram = {
      nodes: [node('n1', 'STUDENT'), node('n2', 'COURSE')],
      edges: [],
    };
    const room = new Room();

    const { result } = renderHook(() =>
      useDiagramDoc({ diagram: firstDiagram, title: 'First' }, eerModel as never),
    );
    const before = result.current.doc;
    room.join('a', before);

    const b = open(encodeState(before), 'First');
    room.join('b', b);
    expect(names(b)).toEqual(['COURSE', 'STUDENT']);

    act(() =>
      result.current.reset({
        diagram: { nodes: [node('m1', 'INVOICE')], edges: [] },
        title: 'Second',
      }),
    );

    // A different document, not this one emptied.
    expect(result.current.doc).not.toBe(before);
    expect(names(result.current.doc)).toEqual(['INVOICE']);
    // And the person still working in the old room never noticed.
    expect(names(b)).toEqual(['COURSE', 'STUDENT']);
  });

  it('does not leak the newly opened diagram into the room being left', () => {
    const first = stored([node('n1', 'STUDENT')], 'First');
    const second = stored([node('m1', 'INVOICE')], 'Second');
    const room = new Room();

    const a = open(first, 'First');
    room.join('a', a);

    const b = open(first, 'First');
    room.join('b', b);

    open(second, 'Second');

    expect(names(b)).not.toContain('INVOICE');
    expect(names(b)).toEqual(['STUDENT']);
  });
});
