import * as Y from 'yjs';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../cloud/supabase';
import type { DiagramDoc } from './doc';

const REMOTE_ORIGIN = 'remote';
const HEARTBEAT_MS = 5000;
const PEER_TIMEOUT_MS = 15000;
const CURSOR_THROTTLE_MS = 60;

export interface PeerState {
  clientId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: string[];
  lastSeen: number;
}

export interface Me {
  clientId: string;
  name: string;
  color: string;
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const fromBase64 = (encoded: string) => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * Carries a Yjs document over a Supabase Realtime channel.
 *
 * There is no server component: peers broadcast their own updates and answer
 * each other's sync requests directly. That is what keeps the app deployable
 * as static files while still being genuinely multiplayer.
 *
 * Awareness — cursors and selections — rides the same channel but is never
 * merged into the document. It is transient by nature, and keeping it out of
 * the CRDT means a cursor moving does not become an undoable edit.
 */
export class RealtimeProvider {
  private channel: RealtimeChannel | null = null;
  private peers = new Map<string, PeerState>();
  private cursor: { x: number; y: number } | null = null;
  private selection: string[] = [];
  private lastCursorSend = 0;
  private cursorTimer: number | null = null;
  private heartbeat: number | null = null;
  private sweeper: number | null = null;
  private unbindUpdate: (() => void) | null = null;
  private connected = false;

  constructor(
    private doc: DiagramDoc,
    private diagramId: string,
    private me: Me,
    private onPeers: (peers: PeerState[]) => void,
    private onStatus: (connected: boolean) => void,
  ) {
    this.connect();
  }

  private connect() {
    if (!supabase) return;

    const channel = supabase.channel(`doc:${this.diagramId}`, {
      config: { broadcast: { self: false } },
    });
    this.channel = channel;

    channel.on('broadcast', { event: 'update' }, ({ payload }) => {
      if (!payload?.update) return;
      Y.applyUpdate(this.doc.ydoc, fromBase64(payload.update), REMOTE_ORIGIN);
    });

    // A joining peer asks for whatever it is missing; everyone already here
    // answers with just the difference, so a late arrival costs one round trip
    // rather than a full copy from each of them.
    channel.on('broadcast', { event: 'sync-request' }, ({ payload }) => {
      if (!payload?.from || payload.from === this.me.clientId) return;
      const diff = Y.encodeStateAsUpdate(this.doc.ydoc, fromBase64(payload.sv));
      void channel.send({
        type: 'broadcast',
        event: 'sync-reply',
        payload: { to: payload.from, update: toBase64(diff) },
      });
    });

    channel.on('broadcast', { event: 'sync-reply' }, ({ payload }) => {
      if (payload?.to !== this.me.clientId || !payload.update) return;
      Y.applyUpdate(this.doc.ydoc, fromBase64(payload.update), REMOTE_ORIGIN);
    });

    channel.on('broadcast', { event: 'awareness' }, ({ payload }) => {
      if (!payload?.clientId || payload.clientId === this.me.clientId) return;
      if (payload.gone) {
        this.peers.delete(payload.clientId);
      } else {
        this.peers.set(payload.clientId, {
          clientId: payload.clientId,
          name: payload.name ?? 'Someone',
          color: payload.color ?? '#888',
          cursor: payload.cursor ?? null,
          selection: payload.selection ?? [],
          lastSeen: Date.now(),
        });
      }
      this.emit();
    });

    channel.subscribe((status) => {
      const up = status === 'SUBSCRIBED';
      if (up !== this.connected) {
        this.connected = up;
        this.onStatus(up);
      }
      if (!up) return;

      void channel.send({
        type: 'broadcast',
        event: 'sync-request',
        payload: {
          from: this.me.clientId,
          sv: toBase64(Y.encodeStateVector(this.doc.ydoc)),
        },
      });
      this.sendAwareness(true);
    });

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      // Only forward what this client authored; echoing a received update
      // would bounce it around the room forever.
      if (origin === REMOTE_ORIGIN) return;
      void channel.send({
        type: 'broadcast',
        event: 'update',
        payload: { update: toBase64(update) },
      });
    };
    this.doc.ydoc.on('update', onUpdate);
    this.unbindUpdate = () => this.doc.ydoc.off('update', onUpdate);

    this.heartbeat = window.setInterval(() => this.sendAwareness(true), HEARTBEAT_MS);
    this.sweeper = window.setInterval(() => {
      const cutoff = Date.now() - PEER_TIMEOUT_MS;
      let changed = false;
      for (const [id, peer] of this.peers) {
        if (peer.lastSeen < cutoff) {
          this.peers.delete(id);
          changed = true;
        }
      }
      if (changed) this.emit();
    }, HEARTBEAT_MS);
  }

  private emit() {
    this.onPeers([...this.peers.values()]);
  }

  private sendAwareness(force = false) {
    if (!this.channel || !this.connected) return;
    const now = Date.now();
    if (!force && now - this.lastCursorSend < CURSOR_THROTTLE_MS) {
      // Coalesce a burst of pointer moves into one trailing send.
      if (this.cursorTimer === null) {
        this.cursorTimer = window.setTimeout(() => {
          this.cursorTimer = null;
          this.sendAwareness(true);
        }, CURSOR_THROTTLE_MS);
      }
      return;
    }
    this.lastCursorSend = now;
    void this.channel.send({
      type: 'broadcast',
      event: 'awareness',
      payload: {
        clientId: this.me.clientId,
        name: this.me.name,
        color: this.me.color,
        cursor: this.cursor,
        selection: this.selection,
      },
    });
  }

  setCursor(point: { x: number; y: number } | null) {
    this.cursor = point;
    this.sendAwareness();
  }

  setSelection(ids: string[]) {
    const same =
      ids.length === this.selection.length && ids.every((id, i) => id === this.selection[i]);
    if (same) return;
    this.selection = ids;
    this.sendAwareness(true);
  }

  destroy() {
    if (this.cursorTimer !== null) window.clearTimeout(this.cursorTimer);
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    if (this.sweeper !== null) window.clearInterval(this.sweeper);
    this.unbindUpdate?.();
    if (this.channel) {
      void this.channel.send({
        type: 'broadcast',
        event: 'awareness',
        payload: { clientId: this.me.clientId, gone: true },
      });
      void supabase?.removeChannel(this.channel);
    }
    this.channel = null;
    this.peers.clear();
  }
}
