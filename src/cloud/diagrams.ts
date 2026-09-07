import type { Diagram, DiagramFile } from '../model/types';
import { fromFile, toFile } from '../model/serialize';
import { requireClient } from './supabase';

export interface CloudDiagram {
  id: string;
  title: string;
  isPublic: boolean;
  updatedAt: string;
  createdAt: string;
}

const TABLE = 'diagrams';

interface Row {
  id: string;
  title: string;
  data: DiagramFile;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

const toMeta = (r: Pick<Row, 'id' | 'title' | 'is_public' | 'created_at' | 'updated_at'>): CloudDiagram => ({
  id: r.id,
  title: r.title,
  isPublic: r.is_public,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Row-level security limits this to the signed-in user's own diagrams. */
export async function listDiagrams(): Promise<CloudDiagram[]> {
  const { data, error } = await requireClient()
    .from(TABLE)
    .select('id,title,is_public,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toMeta);
}

export async function createDiagram(
  ownerId: string,
  diagram: Diagram,
  title: string,
): Promise<CloudDiagram> {
  const { data, error } = await requireClient()
    .from(TABLE)
    .insert({ owner: ownerId, title, data: toFile(diagram, title) })
    .select('id,title,is_public,created_at,updated_at')
    .single();
  if (error) throw new Error(error.message);
  return toMeta(data as Row);
}

export async function updateDiagram(
  id: string,
  diagram: Diagram,
  title: string,
): Promise<CloudDiagram> {
  const { data, error } = await requireClient()
    .from(TABLE)
    .update({ title, data: toFile(diagram, title) })
    .eq('id', id)
    .select('id,title,is_public,created_at,updated_at')
    .single();
  if (error) throw new Error(error.message);
  return toMeta(data as Row);
}

export async function openDiagram(
  id: string,
): Promise<{ meta: CloudDiagram; diagram: Diagram; title: string }> {
  const { data, error } = await requireClient()
    .from(TABLE)
    .select('id,title,data,is_public,created_at,updated_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  const row = data as Row;
  const parsed = fromFile(row.data);
  return { meta: toMeta(row), ...parsed };
}

export async function renameDiagram(id: string, title: string): Promise<void> {
  const { error } = await requireClient().from(TABLE).update({ title }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteDiagram(id: string): Promise<void> {
  const { error } = await requireClient().from(TABLE).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Publishing flips a single flag. The read policy on the table lets anyone —
 * signed in or not — select rows where `is_public` is true, so the share link
 * needs no token of its own.
 */
export async function setPublished(id: string, isPublic: boolean): Promise<void> {
  const { error } = await requireClient().from(TABLE).update({ is_public: isPublic }).eq('id', id);
  if (error) throw new Error(error.message);
}

export function shareLinkFor(id: string): string {
  return `${window.location.origin}${window.location.pathname}#c=${id}`;
}
