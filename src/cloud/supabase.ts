import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/**
 * The app is fully usable without a backend: without credentials it runs in
 * local-only mode and every cloud affordance explains what is missing rather
 * than failing at the point of use.
 *
 * The anon key is designed to ship in client bundles — every table it can reach
 * is guarded by row-level security, so a signed-in user only ever sees their own
 * rows plus anything explicitly published.
 */
export const cloudEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** Narrows the nullable client at call sites that already checked availability. */
export function requireClient(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Cloud sync is not configured for this build. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  }
  return supabase;
}
