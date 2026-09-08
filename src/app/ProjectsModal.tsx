import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../platform/Modal';
import { useAuth } from '../cloud/auth';
import {
  canEdit,
  createInvite,
  createProject,
  deleteProject,
  inviteLinkFor,
  leaveProject,
  listActivity,
  listInvites,
  listMembers,
  removeMember,
  renameProject,
  revokeInvite,
  setMemberRole,
  describeActivity,
  type ActivityEntry,
  type InviteLink,
  type Member,
  type Project,
  type ProjectRole,
} from '../cloud/projects';

interface Props {
  onClose: () => void;
  projects: Project[];
  activeProjectId: string | null;
  onRefresh: () => Promise<void>;
  onOpenProject: (project: Project | null) => void;
  notify: (message: string) => void;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString();
};

const ROLE_BLURB: Record<ProjectRole, string> = {
  owner: 'manages members and can delete the project',
  editor: 'can change diagrams',
  viewer: 'read-only',
};

export function ProjectsModal({
  onClose,
  projects,
  activeProjectId,
  onRefresh,
  onOpenProject,
  notify,
}: Props) {
  const auth = useAuth();
  const [selected, setSelected] = useState<string | null>(activeProjectId);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<InviteLink[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const project = projects.find((p) => p.id === selected) ?? null;
  const isOwner = project?.role === 'owner';

  const loadDetail = useCallback(
    async (id: string, owner: boolean) => {
      try {
        const [m, a] = await Promise.all([listMembers(id), listActivity({ projectId: id })]);
        setMembers(m);
        setActivity(a);
        setInvites(owner ? await listInvites(id) : []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the project.');
      }
    },
    [],
  );

  useEffect(() => {
    if (!selected || !project) {
      setMembers(null);
      setInvites([]);
      setActivity([]);
      return;
    }
    void loadDetail(selected, project.role === 'owner');
  }, [selected, project, loadDetail]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (!auth.user) {
    return (
      <Modal title="Projects" onClose={onClose}>
        <p>Sign in to create a project and work on diagrams with your team.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Projects" onClose={onClose} wide>
      {error && <p className="auth-error">{error}</p>}

      <div className="projects-layout">
        <div className="projects-list">
          <button
            type="button"
            className={`project-row${selected === null ? ' current' : ''}`}
            onClick={() => setSelected(null)}
          >
            <strong>My diagrams</strong>
            <span className="panel-hint">Private to you</span>
          </button>

          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`project-row${selected === p.id ? ' current' : ''}`}
              onClick={() => setSelected(p.id)}
            >
              <strong>{p.name}</strong>
              <span className="panel-hint">
                you are {p.role} · updated {when(p.updatedAt)}
              </span>
            </button>
          ))}

          <form
            className="new-project"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              void guard(async () => {
                const p = await createProject(newName.trim());
                setNewName('');
                await onRefresh();
                setSelected(p.id);
                notify(`Created “${p.name}”.`);
              });
            }}
          >
            <input
              value={newName}
              placeholder="New project name"
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" disabled={busy || !newName.trim()}>
              Create
            </button>
          </form>
        </div>

        <div className="project-detail">
          {selected === null && (
            <>
              <h3>My diagrams</h3>
              <p className="panel-hint">
                Diagrams that belong to you alone. Move one into a project from the library to share
                it with your team.
              </p>
              <button type="button" className="primary" onClick={() => { onOpenProject(null); onClose(); }}>
                Show my diagrams
              </button>
            </>
          )}

          {project && (
            <>
              <h3>{project.name}</h3>
              <p className="panel-hint">
                You are <strong>{project.role}</strong> — {ROLE_BLURB[project.role]}.
              </p>

              <div className="detail-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    onOpenProject(project);
                    onClose();
                  }}
                >
                  Show this project's diagrams
                </button>
                {isOwner && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      guard(async () => {
                        const next = window.prompt('Rename project', project.name);
                        if (!next?.trim()) return;
                        await renameProject(project.id, next.trim());
                        await onRefresh();
                      })
                    }
                  >
                    Rename
                  </button>
                )}
              </div>

              {/* ---- members ---- */}
              <section className="sublist">
                <h3>Members</h3>
                {!members && <p className="panel-hint">Loading…</p>}
                {members && (
                  <ul className="member-list">
                    {members.map((m) => (
                      <li key={m.userId}>
                        <div>
                          <strong>{m.name}</strong>
                          {m.userId === auth.user?.id && <span className="tag">you</span>}
                          <span className="panel-hint">
                            {m.email ?? 'member'} · joined {when(m.joinedAt)}
                          </span>
                        </div>
                        <div className="member-actions">
                          {isOwner && m.userId !== auth.user?.id ? (
                            <>
                              <select
                                value={m.role}
                                disabled={busy}
                                onChange={(e) =>
                                  guard(async () => {
                                    await setMemberRole(
                                      project.id,
                                      m.userId,
                                      e.target.value as ProjectRole,
                                    );
                                    await loadDetail(project.id, true);
                                  })
                                }
                              >
                                <option value="owner">owner</option>
                                <option value="editor">editor</option>
                                <option value="viewer">viewer</option>
                              </select>
                              <button
                                type="button"
                                className="danger"
                                disabled={busy}
                                onClick={() =>
                                  guard(async () => {
                                    if (!window.confirm(`Remove ${m.name} from this project?`)) return;
                                    await removeMember(project.id, m.userId);
                                    await loadDetail(project.id, true);
                                  })
                                }
                              >
                                Remove
                              </button>
                            </>
                          ) : (
                            <span className="tag">{m.role}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* ---- invite links ---- */}
              {isOwner && (
                <section className="sublist">
                  <h3>Invite links</h3>
                  <p className="panel-hint">
                    Anyone signed in who opens the link joins with that role. Revoke a link and it
                    stops working immediately; people who already joined stay.
                  </p>
                  <div className="detail-actions">
                    {(['editor', 'viewer'] as const).map((role) => (
                      <button
                        key={role}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          guard(async () => {
                            const code = await createInvite(project.id, role, 14);
                            await navigator.clipboard
                              .writeText(inviteLinkFor(code))
                              .catch(() => undefined);
                            await loadDetail(project.id, true);
                            notify(`${role} invite link copied — expires in 14 days.`);
                          })
                        }
                      >
                        New {role} link
                      </button>
                    ))}
                  </div>
                  {invites.length > 0 && (
                    <ul className="invite-list">
                      {invites.map((inv) => (
                        <li key={inv.id}>
                          <div>
                            <span className="tag">{inv.role}</span>
                            <span className="panel-hint">
                              created {when(inv.createdAt)}
                              {inv.expiresAt
                                ? ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}`
                                : ' · no expiry'}
                            </span>
                          </div>
                          <div className="member-actions">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                void navigator.clipboard.writeText(inviteLinkFor(inv.code));
                                notify('Invite link copied.');
                              }}
                            >
                              Copy
                            </button>
                            <button
                              type="button"
                              className="danger"
                              disabled={busy}
                              onClick={() =>
                                guard(async () => {
                                  await revokeInvite(inv.id);
                                  await loadDetail(project.id, true);
                                  notify('Link revoked.');
                                })
                              }
                            >
                              Revoke
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* ---- activity ---- */}
              <section className="sublist">
                <h3>Activity</h3>
                {activity.length === 0 ? (
                  <p className="panel-hint">Nothing has happened in this project yet.</p>
                ) : (
                  <ul className="activity-list">
                    {activity.map((entry) => (
                      <li key={entry.id}>
                        <strong>{entry.actorName}</strong> {describeActivity(entry)}
                        <span className="panel-hint">{when(entry.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* ---- danger zone ---- */}
              <section className="sublist">
                {isOwner ? (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      guard(async () => {
                        if (
                          !window.confirm(
                            `Delete “${project.name}” and every diagram in it? This cannot be undone.`,
                          )
                        ) {
                          return;
                        }
                        await deleteProject(project.id);
                        await onRefresh();
                        setSelected(null);
                        onOpenProject(null);
                        notify('Project deleted.');
                      })
                    }
                  >
                    Delete project
                  </button>
                ) : (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      guard(async () => {
                        if (!window.confirm(`Leave “${project.name}”?`)) return;
                        await leaveProject(project.id, auth.user!.id);
                        await onRefresh();
                        setSelected(null);
                        onOpenProject(null);
                        notify('You left the project.');
                      })
                    }
                  >
                    Leave project
                  </button>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export { canEdit };
