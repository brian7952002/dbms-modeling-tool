// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagramDoc } from './doc';
import type { BaseNode } from '../types';

/**
 * The real provider, over a stand-in for the Supabase broadcast channel.
 *
 * `session.test.ts` reasons about the protocol; this exercises the code that
 * speaks it, so a change to `provider.ts` cannot quietly stop matching the
 * protocol the tests describe.
 */

const fake = vi.hoisted(() => {
  type Handler = { event: string; cb: (msg: { payload: Record<string, unknown> }) => void };
  const buses = new Map<string, Set<FakeChannel>>();

  class FakeChannel {
    handlers: Handler[] = [];
    constructor(readonly name: string) {}

    on(_type: string, filter: { event: string }, cb: Handler['cb']) {
      this.handlers.push({ event: filter.event, cb });
      return this;
    }

    subscribe(cb: (status: string) => void) {
      const bus = buses.get(this.name) ?? new Set<FakeChannel>();
      bus.add(this);
      buses.set(this.name, bus);
      // Real subscription is asynchronous; joining synchronously would hide
      // ordering bugs the browser would hit.
      queueMicrotask(() => cb('SUBSCRIBED'));
      return this;
    }

    send({ event, payload }: { event: string; payload: Record<string, unknown> }) {
      for (const peer of buses.get(this.name) ?? []) {
        if (peer === this) continue; // broadcast: { self: false }
        for (const handler of peer.handlers) {
          if (handler.event === event) handler.cb({ payload });
        }
      }
      return Promise.resolve('ok');
    }

    leave() {
      buses.get(this.name)?.delete(this);
    }
  }

  return { buses, FakeChannel };
});

vi.mock('../../cloud/supabase', () => ({
  supabase: {
    channel: (name: string) => new fake.FakeChannel(name),
    removeChannel: (channel: { leave: () => void }) => {
      channel.leave();
      return Promise.resolve('ok');
    },
  },
}));

const { RealtimeProvider } = await import('./provider');

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

const names = (doc: DiagramDoc) =>
  doc
    .snapshot()
    .nodes.map((n) => n.name)
    .sort();

/** Lets the subscription callbacks and the sync round trip run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = new Set<{ destroy: () => void }>();

function join(doc: DiagramDoc, diagramId: string, who: string) {
  const provider = new RealtimeProvider(
    doc,
    diagramId,
    { clientId: who, name: who, color: '#000' },
    () => undefined,
    () => undefined,
  );
  open.add(provider);
  return provider;
}

afterEach(() => {
  for (const provider of open) provider.destroy();
  open.clear();
  fake.buses.clear();
});

/* -------------------------------------------------------------------------- */

describe('the realtime provider', () => {
  it('gives a joiner what is already in the room', async () => {
    const a = new DiagramDoc();
    a.replace({ nodes: [node('n1', 'STUDENT')], edges: [] }, 'Practice');
    join(a, 'd1', 'a');
    await settle();

    const b = new DiagramDoc();
    join(b, 'd1', 'b');
    await settle();

    expect(names(b)).toEqual(['STUDENT']);
  });

  // The half that was missing. Each client holds structs the others have never
  // seen, so without this the joiner's work is unintegrable for everyone else.
  it('gives the room what the joiner brought with it', async () => {
    const a = new DiagramDoc();
    a.replace({ nodes: [node('n1', 'STUDENT')], edges: [] }, 'Practice');
    join(a, 'd1', 'a');
    await settle();

    const b = new DiagramDoc();
    b.replace({ nodes: [node('n2', 'COURSE')], edges: [] }, 'Practice');
    join(b, 'd1', 'b');
    await settle();

    expect(names(a)).toContain('COURSE');
    expect(names(b)).toContain('STUDENT');
  });

  // The symptom that took two browsers to find: user two's edits never showed
  // up for user one, because Yjs parked them as pending forever.
  it('carries the joiner’s later edits, with nothing left pending', async () => {
    const a = new DiagramDoc();
    a.replace({ nodes: [node('n1', 'STUDENT')], edges: [] }, 'Practice');
    join(a, 'd1', 'a');
    await settle();

    const b = new DiagramDoc();
    b.replace({ nodes: [node('n1', 'STUDENT')], edges: [] }, 'Practice');
    join(b, 'd1', 'b');
    await settle();

    b.addNode(node('n3', 'ENROLLS'));
    await settle();

    expect(names(a)).toContain('ENROLLS');
    // An update that cannot be integrated is queued rather than dropped, so a
    // clean pending queue is the real proof the exchange was complete.
    expect(a.ydoc.store.pendingStructs).toBeNull();
  });

  it('keeps two rooms apart', async () => {
    const a = new DiagramDoc();
    a.replace({ nodes: [node('n1', 'STUDENT')], edges: [] }, 'First');
    join(a, 'd1', 'a');

    const other = new DiagramDoc();
    other.replace({ nodes: [node('m1', 'INVOICE')], edges: [] }, 'Second');
    join(other, 'd2', 'a-elsewhere');
    await settle();

    expect(names(a)).toEqual(['STUDENT']);
    expect(names(other)).toEqual(['INVOICE']);
  });

  it('stops forwarding once destroyed', async () => {
    const a = new DiagramDoc();
    a.replace({ nodes: [], edges: [] }, 'Practice');
    const provider = join(a, 'd1', 'a');

    const b = new DiagramDoc();
    join(b, 'd1', 'b');
    await settle();

    provider.destroy();
    open.delete(provider);

    a.addNode(node('n9', 'GHOST'));
    await settle();

    expect(names(b)).toEqual([]);
  });
});
