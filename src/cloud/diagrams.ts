import type { Diagram, DiagramFile } from '../model/types';
import { fromFile, toFile } from '../model/serialize';
import { requireClient } from './supabase';

export interface CloudDiagram {
  id: string;
  title: string;
  isPublic: boolean;
  updatedAt: string;
  createdAt: string;
  /** Bumped on every save; shown in the history list. */
  version: number;
  projectId: string | null;
  updatedBy: string | null;
  kind: 'eer' | 'instance';
  sourceDiagramId: string | null;
  /** Base64 CRDT state, when the row has been saved by a live session. */
  ydoc: string | null;
}

const TABLE = 'diagrams';
const META =
  'id,title,is_public,created_at,updated_at,version,project_id,updated_by,kind,source_diagram_id';

interface Row {
  id: string;
  title: string;
  data: DiagramFile;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  version: number;
  project_id: string | null;
  updated_by: string | null;
  kind: 'eer' | 'instance';
  source_diagram_id: string | null;
  ydoc: string | null;
}

const toMeta = (r: Omit<Row, 'data'>): CloudDiagram => ({
  id: r.id,
  title: r.title,
  isPublic: r.is_public,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  version: r.version,
  projectId: r.project_id,
  updatedBy: r.updated_by,
  kind: r.kind ?? 'eer',
  sourceDiagramId: r.source_diagram_id ?? null,
  ydoc: (r as { ydoc?: string | null }).ydoc ?? null,
});

/**
 * Everything the signed-in user may open: their own diagrams plus every
 * diagram in a project they belong to. Row-level security decides; this only
 * asks.
 */
export async function listDiagrams(): Promise<CloudDiagram[]> {
  const { data, error } = await requireClient()
    .from(TABLE)
    .select(META)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toMeta(r as Omit<Row, 'data'>));
}

export async function createDiagram(
  ownerId: string,
  diagram: Diagram,
  title: string,
  projectId: string | null = null,
  kind: 'eer' | 'instance' = 'eer',
  sourceDiagramId: string | null = null,
): Promise<CloudDiagram> {
  const { data, error } = await requireClient()
    .from(TABLE)
    .insert({
      owner: ownerId,
      title,
      data: toFile(diagram, title),
      project_id: projectId,
      kind,
      source_diagram_id: sourceDiagramId,
    })
    .select(META)
    .single();
  if (error) throw new Error(error.message);
  return toMeta(data as Omit<Row, 'data'>);
}

/**
 * Persists a live document: the merged CRDT state plus the plain JSON that
 * exports, published links and the SQL generator read.
 *
 * There is no expected-version check. Under a CRDT concurrent writes are
 * normal rather than exceptional — the document has already been reconciled
 * before it gets here, so whoever writes last writes the same thing.
 */
export async function persistRealtime(
  id: string,
  diagram: Diagram,
  title: string,
  ydoc: string,
): Promise<{ version: number; updatedAt: string }> {
  const { data, error } = await requireClient().rpc('persist_realtime_diagram', {
    p_id: id,
    p_title: title,
    p_data: toFile(diagram, title),
    p_ydoc: ydoc,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return { version: row.version as number, updatedAt: row.updated_at as string };
}

export async function openDiagram(
  id: string,
): Promise<{ meta: CloudDiagram; diagram: Diagram; title: string }> {
  const { data, error } = await requireClient()
    .from(TABLE)
    .select(`${META},data,ydoc`)
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
 * Publishing flips a single flag. The read policy lets anyone — signed in or
 * not — select rows where `is_public` is true, so the share link needs no
 * token of its own. Going through the function records who did it.
 */
export async function setPublished(id: string, isPublic: boolean): Promise<void> {
  const { error } = await requireClient().rpc('set_diagram_published', {
    p_id: id,
    p_public: isPublic,
  });
  if (error) throw new Error(error.message);
}

export async function moveToProject(id: string, projectId: string | null): Promise<void> {
  const { error } = await requireClient().rpc('move_diagram_to_project', {
    p_id: id,
    p_project: projectId,
  });
  if (error) throw new Error(error.message);
}

export function shareLinkFor(id: string): string {
  return `${window.location.origin}${window.location.pathname}#c=${id}`;
}
