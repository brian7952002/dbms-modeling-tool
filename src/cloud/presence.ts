import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface Peer {
  userId: string;
  name: string;
}

/** Stable, readable colour per person, so the same teammate looks the same. */
export function colorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 62% 45%)`;
}

/**
 * Who else has this diagram open right now.
 *
 * Presence is the warning half of the single-writer design: the stale-write
 * check in the database stops work being lost, and this stops people walking
 * into the collision in the first place.
 */
export function usePresence(
  diagramId: string | null,
  me: { id: string; name: string } | null,
): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    if (!supabase || !diagramId || !me) {
      setPeers([]);
      return;
    }

    const channel = supabase.channel(`diagram:${diagramId}`, {
      config: { presence: { key: me.id } },
    });

    const sync = () => {
      const state = channel.presenceState<{ name: string }>();
      const others: Peer[] = [];
      for (const [userId, entries] of Object.entries(state)) {
        if (userId === me.id) continue;
        others.push({ userId, name: entries[0]?.name ?? 'Someone' });
      }
      setPeers(others);
    };

    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void channel.track({ name: me.name });
      });

    return () => {
      void supabase?.removeChannel(channel);
      setPeers([]);
    };
  }, [diagramId, me?.id, me?.name]);

  return peers;
}
