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
import { listDiagrams, saveDiagram } from './library';
import { fromFile, toFile } from '../platform/serialize';
import type { DiagramFile } from '../platform/types';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const canImportFromCloud = Boolean(URL && KEY);

export interface ImportResult {
  imported: number;
  /** Already in the library under the same name, so left alone. */
  alreadyHere: number;
  /** Could not be read, named so it is obvious what is missing. */
  unreadable: string[];
}

/**
 * Signs in, copies every diagram the account can read, and signs out again.
 *
 * The password is used for exactly one request and never stored; the session
 * is ended before this returns, so nothing is left signed in afterwards.
 *
 * Running it twice is safe and useful: anything already in the library under
 * the same name is left alone, so a second run brings back only what is
 * missing — which is what you want after deleting one by mistake. A diagram
 * you have since renamed locally will come back under its old name rather
 * than overwrite your version, because losing an edit is worse than gaining a
 * duplicate.
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
    const have = new Set((await listDiagrams()).map((d) => d.title.trim().toLowerCase()));
    const unreadable: string[] = [];
    let imported = 0;
    let alreadyHere = 0;

    for (const row of rows) {
      try {
        // Round-trip through the file reader so anything malformed is caught
        // here, one diagram at a time, instead of failing the whole import.
        const parsed = fromFile(row.data);
        const title = parsed.title || row.title;
        if (have.has(title.trim().toLowerCase())) {
          alreadyHere += 1;
          continue;
        }
        const file: DiagramFile = toFile(parsed.diagram, title, parsed.model);
        await saveDiagram(null, file);
        have.add(title.trim().toLowerCase());
        imported += 1;
      } catch {
        unreadable.push(row.title || row.id);
      }
    }

    return { imported, alreadyHere, unreadable };
  } finally {
    await client.auth.signOut();
  }
}
