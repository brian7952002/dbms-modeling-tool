import { requireClient } from './supabase';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export interface Project {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  /** The signed-in user's role in this project. */
  role: ProjectRole;
}

export interface Member {
  userId: string;
  role: ProjectRole;
  joinedAt: string;
  name: string;
  email: string | null;
}

export interface InviteLink {
  id: string;
  code: string;
  role: ProjectRole;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ActivityEntry {
  id: number;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
  actorName: string;
  diagramId: string | null;
}

export interface VersionEntry {
  id: string;
  version: number;
  title: string;
  createdAt: string;
  authorName: string;
}

export const canEdit = (role: ProjectRole | null | undefined) =>
  role === 'owner' || role === 'editor';

/**
 * Display names for a set of user ids. Row-level security only returns
 * profiles of people you share a project with, so anyone else resolves to a
 * neutral placeholder rather than an error.
 */
async function namesFor(ids: string[]): Promise<Map<string, { name: string; email: string | null }>> {
  const out = new Map<string, { name: string; email: string | null }>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;
  const { data } = await requireClient()
    .from('profiles')
    .select('id,display_name,email')
    .in('id', unique);
  for (const row of data ?? []) {
    out.set(row.id as string, {
      name: (row.display_name as string) || (row.email as string) || 'Someone',
      email: (row.email as string) ?? null,
    });
  }
  return out;
}

const nameOf = (
  map: Map<string, { name: string; email: string | null }>,
  id: string | null,
) => (id ? (map.get(id)?.name ?? 'Someone') : 'Someone');

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

export async function listProjects(userId: string): Promise<Project[]> {
  const client = requireClient();
  const [projects, memberships] = await Promise.all([
    client.from('projects').select('id,name,owner,created_at,updated_at'),
    client.from('project_members').select('project_id,role').eq('user_id', userId),
  ]);
  if (projects.error) throw new Error(projects.error.message);
  if (memberships.error) throw new Error(memberships.error.message);

  const roles = new Map<string, ProjectRole>(
    (memberships.data ?? []).map((m) => [m.project_id as string, m.role as ProjectRole]),
  );
  return (projects.data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    owner: p.owner as string,
    createdAt: p.created_at as string,
    updatedAt: p.updated_at as string,
    role: roles.get(p.id as string) ?? (p.owner === userId ? 'owner' : 'viewer'),
  }));
}

export async function createProject(name: string): Promise<Project> {
  const { data, error } = await requireClient().rpc('create_project', { p_name: name });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: 'owner',
  };
}

export async function renameProject(id: string, name: string): Promise<void> {
  const { error } = await requireClient().from('projects').update({ name }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await requireClient().from('projects').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function leaveProject(id: string, userId: string): Promise<void> {
  const { error } = await requireClient()
    .from('project_members')
    .delete()
    .eq('project_id', id)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

export async function listMembers(projectId: string): Promise<Member[]> {
  const { data, error } = await requireClient()
    .from('project_members')
    .select('user_id,role,joined_at')
    .eq('project_id', projectId)
    .order('joined_at');
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const names = await namesFor(rows.map((r) => r.user_id as string));
  return rows.map((r) => ({
    userId: r.user_id as string,
    role: r.role as ProjectRole,
    joinedAt: r.joined_at as string,
    name: nameOf(names, r.user_id as string),
    email: names.get(r.user_id as string)?.email ?? null,
  }));
}

export async function setMemberRole(
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<void> {
  const { error } = await requireClient()
    .from('project_members')
    .update({ role })
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  const { error } = await requireClient()
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------------------- */
/* Invite links                                                               */
/* -------------------------------------------------------------------------- */

export async function listInvites(projectId: string): Promise<InviteLink[]> {
  const { data, error } = await requireClient()
    .from('project_invites')
    .select('id,code,role,created_at,expires_at,revoked_at')
    .eq('project_id', projectId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    role: r.role as ProjectRole,
    createdAt: r.created_at as string,
    expiresAt: (r.expires_at as string) ?? null,
    revokedAt: (r.revoked_at as string) ?? null,
  }));
}

export async function createInvite(
  projectId: string,
  role: Exclude<ProjectRole, 'owner'>,
  days = 14,
): Promise<string> {
  const { data, error } = await requireClient().rpc('create_invite', {
    p_project: projectId,
    p_role: role,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await requireClient().rpc('revoke_invite', { p_invite: inviteId });
  if (error) throw new Error(error.message);
}

export interface Redemption {
  projectId: string;
  projectName: string;
  role: ProjectRole;
  alreadyMember: boolean;
}

export async function redeemInvite(code: string): Promise<Redemption> {
  const { data, error } = await requireClient().rpc('redeem_invite', { p_code: code });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    role: row.role,
    alreadyMember: row.already_member,
  };
}

export const inviteLinkFor = (code: string) =>
  `${window.location.origin}${window.location.pathname}#join=${code}`;

/* -------------------------------------------------------------------------- */
/* History                                                                    */
/* -------------------------------------------------------------------------- */

export async function listVersions(diagramId: string, limit = 50): Promise<VersionEntry[]> {
  const { data, error } = await requireClient()
    .from('diagram_versions')
    .select('id,version,title,created_at,author')
    .eq('diagram_id', diagramId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const names = await namesFor(rows.map((r) => r.author as string));
  return rows.map((r) => ({
    id: r.id as string,
    version: r.version as number,
    title: r.title as string,
    createdAt: r.created_at as string,
    authorName: nameOf(names, (r.author as string) ?? null),
  }));
}

export async function restoreVersion(versionId: string): Promise<number> {
  const { data, error } = await requireClient().rpc('restore_diagram_version', {
    p_version: versionId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row.version as number;
}

export async function listActivity(
  scope: { projectId?: string; diagramId?: string },
  limit = 60,
): Promise<ActivityEntry[]> {
  let query = requireClient()
    .from('activity')
    .select('id,action,detail,created_at,actor,diagram_id')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (scope.projectId) query = query.eq('project_id', scope.projectId);
  if (scope.diagramId) query = query.eq('diagram_id', scope.diagramId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const names = await namesFor(rows.map((r) => r.actor as string));
  return rows.map((r) => ({
    id: r.id as number,
    action: r.action as string,
    detail: (r.detail as Record<string, unknown>) ?? {},
    createdAt: r.created_at as string,
    actorName: nameOf(names, (r.actor as string) ?? null),
    diagramId: (r.diagram_id as string) ?? null,
  }));
}

/** Human phrasing for an activity row. */
export function describeActivity(entry: ActivityEntry): string {
  const d = entry.detail as Record<string, string | undefined>;
  switch (entry.action) {
    case 'project_created':
      return `created the project${d.name ? ` “${d.name}”` : ''}`;
    case 'joined':
      return `joined as ${d.role ?? 'a member'}`;
    case 'invite_created':
      return `created a ${d.role ?? ''} invite link`.replace('  ', ' ');
    case 'invite_revoked':
      return 'revoked an invite link';
    case 'edited':
      return `edited ${d.title ? `“${d.title}”` : 'a diagram'}`;
    case 'renamed':
      return `renamed “${d.from ?? '?'}” to “${d.to ?? '?'}”`;
    case 'published':
      return 'published a read-only link';
    case 'unpublished':
      return 'removed the read-only link';
    case 'restored':
      return `restored version ${d.from_version ?? '?'}`;
    case 'added_to_project':
      return `added ${d.title ? `“${d.title}”` : 'a diagram'} to the project`;
    case 'removed_from_project':
      return `removed ${d.title ? `“${d.title}”` : 'a diagram'} from the project`;
    default:
      return entry.action.replace(/_/g, ' ');
  }
}
