/**
 * A one-time rescue of the diagrams that were kept in the old hosted account.
 *
 * This is the only thing left that talks to a server, and it exists to empty
 * that server rather than to use it: sign in once, copy everything into this
 * browser, and never need the account again. It is meant to be deleted — along
 * with the Supabase dependency and the build's credentials — once the diagrams
 * are across.
 *
 * It writes with `saveDiagram`, so imported diagrams are ordinary local
 * diagrams with nothing cloud-shaped left on them.
 */

import { createClient } from '@supabase/supabase-js';
import { saveDiagram } from './library';
import { fromFile, toFile } from '../platform/serialize';
import type { DiagramFile } from '../platform/types';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const canImportFromCloud = Boolean(URL && KEY);

export interface ImportResult {
  imported: number;
  skipped: string[];
}

/**
 * Signs in, copies every diagram the account can read, and signs out again.
 *
 * The password is used for exactly one request and never stored; the session
 * is ended before this returns, so nothing is left signed in afterwards.
 */
export async function importFromCloud(email: string, password: string): Promise<ImportResult> {
  if (!URL || !KEY) {
    throw new Error('This build has no account credentials, so there is nothing to import from.');
  }

  const client = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error(
      signInError.message === 'Invalid login credentials'
        ? 'That email and password were not accepted.'
        : signInError.message,
    );
  }

  try {
    const { data, error } = await client
      .from('diagrams')
      .select('id,title,data,kind')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { id: string; title: string; data: unknown; kind: string }[];
    const skipped: string[] = [];
    let imported = 0;

    for (const row of rows) {
      try {
        // Round-trip through the file reader so anything malformed is caught
        // here, one diagram at a time, instead of failing the whole import.
        const parsed = fromFile(row.data);
        const file: DiagramFile = toFile(parsed.diagram, parsed.title || row.title, parsed.model);
        await saveDiagram(null, file);
        imported += 1;
      } catch {
        skipped.push(row.title || row.id);
      }
    }

    return { imported, skipped };
  } finally {
    await client.auth.signOut();
  }
}
