import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../platform/Modal';
import { useAuth } from '../cloud/auth';
import {
  createDiagram,
  deleteDiagram,
  listDiagrams,
  moveToProject,
  openDiagram,
  renameDiagram,
  setPublished,
  shareLinkFor,
  type CloudDiagram,
} from '../cloud/diagrams';
import { canEdit, type Project } from '../cloud/projects';
import type { Diagram } from '../platform/types';

interface Props {
  onClose: () => void;
  diagram: Diagram;
  title: string;
  currentId: string | null;
  projects: Project[];
  activeProject: Project | null;
  onChangeProject: (project: Project | null) => void;
  onOpened: (meta: CloudDiagram, diagram: Diagram, title: string) => void;
  onSaved: (meta: CloudDiagram) => void;
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

export function LibraryModal({
  onClose,
  diagram,
  title,
  currentId,
  projects,
  activeProject,
  onChangeProject,
  onOpened,
  onSaved,
  notify,
}: Props) {
  const auth = useAuth();
  const [items, setItems] = useState<CloudDiagram[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await listDiagrams());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your diagrams.');
    }
  }, []);

  useEffect(() => {
    if (auth.user) void refresh();
  }, [auth.user, refresh]);

  if (!auth.user) {
    return (
      <Modal title="Diagrams" onClose={onClose}>
        <p>Sign in to keep diagrams in your account and open them from any device.</p>
      </Modal>
    );
  }

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

  const scopeId = activeProject?.id ?? null;
  const visible = (items ?? []).filter((d) => (d.projectId ?? null) === scopeId);
  // Viewers see the project but may not change anything in it.
  const mayWrite = activeProject ? canEdit(activeProject.role) : true;

  return (
    <Modal
      title={activeProject ? `Diagrams — ${activeProject.name}` : 'My diagrams'}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="panel-hint">
            {items ? `${visible.length} here · signed in as ${auth.user.email}` : 'Loading…'}
          </span>
          <button
            type="button"
            className="primary"
            disabled={busy || !mayWrite}
            title={mayWrite ? undefined : 'You have view-only access to this project.'}
            onClick={() =>
              guard(async () => {
                const meta = await createDiagram(auth.user!.id, diagram, title, scopeId);
                onSaved(meta);
                await refresh();
                notify(
                  activeProject
                    ? `Saved “${meta.title}” into ${activeProject.name}.`
                    : `Saved “${meta.title}” to your account.`,
                );
              })
            }
          >
            Save current here
          </button>
        </>
      }
    >
      {error && <p className="auth-error">{error}</p>}

      <label className="field scope-picker">
        <span className="field-label">Showing</span>
        <select
          value={scopeId ?? ''}
          onChange={(e) =>
            onChangeProject(projects.find((p) => p.id === e.target.value) ?? null)
          }
        >
          <option value="">My diagrams (private)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — you are {p.role}
            </option>
          ))}
        </select>
      </label>

      {items && visible.length === 0 && (
        <p className="panel-hint">
          {activeProject
            ? 'This project has no diagrams yet. Use “Save current here” to add the one on your canvas.'
            : 'Nothing saved yet. Use “Save current here” to put the diagram on your canvas into your account.'}
        </p>
      )}

      {visible.length > 0 && (
        <ul className="library">
          {visible.map((item) => {
            const mine = item.projectId === null;
            return (
              <li key={item.id} className={item.id === currentId ? 'current' : ''}>
                <div className="library-main">
                  <strong>{item.title}</strong>
                  <span className="panel-hint">
                    v{item.version} · edited {when(item.updatedAt)}
                    {item.id === currentId ? ' · open now' : ''}
                    {item.isPublic ? ' · published' : ''}
                  </span>
                </div>
                <div className="library-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      guard(async () => {
                        const loaded = await openDiagram(item.id);
                        onOpened(loaded.meta, loaded.diagram, loaded.title);
                        onClose();
                      })
                    }
                  >
                    Open
                  </button>

                  {mayWrite && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        guard(async () => {
                          const next = window.prompt('Rename diagram', item.title);
                          if (!next?.trim()) return;
                          await renameDiagram(item.id, next.trim());
                          await refresh();
                        })
                      }
                    >
                      Rename
                    </button>
                  )}

                  {mayWrite && projects.length > 0 && mine && (
                    <select
                      value=""
                      disabled={busy}
                      title="Move this diagram into a project"
                      onChange={(e) =>
                        guard(async () => {
                          if (!e.target.value) return;
                          await moveToProject(item.id, e.target.value);
                          await refresh();
                          notify('Moved into the project.');
                        })
                      }
                    >
                      <option value="">Move to…</option>
                      {projects
                        .filter((p) => canEdit(p.role))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  )}

                  {mayWrite && !mine && (
                    <button
                      type="button"
                      disabled={busy}
                      title="Move back to your private diagrams"
                      onClick={() =>
                        guard(async () => {
                          await moveToProject(item.id, null);
                          await refresh();
                          notify('Moved to your private diagrams.');
                        })
                      }
                    >
                      Make private
                    </button>
                  )}

                  {mayWrite && (
                    <button
                      type="button"
                      disabled={busy}
                      title={
                        item.isPublic
                          ? 'Anyone with the link can open a read-only copy'
                          : 'Publish a read-only link'
                      }
                      onClick={() =>
                        guard(async () => {
                          await setPublished(item.id, !item.isPublic);
                          await refresh();
                          if (!item.isPublic) {
                            await navigator.clipboard
                              .writeText(shareLinkFor(item.id))
                              .catch(() => undefined);
                            notify('Published — share link copied to the clipboard.');
                          } else {
                            notify('Unpublished. The old link no longer opens it.');
                          }
                        })
                      }
                    >
                      {item.isPublic ? 'Unpublish' : 'Publish link'}
                    </button>
                  )}

                  {mayWrite && (
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        guard(async () => {
                          if (!window.confirm(`Delete “${item.title}” permanently?`)) return;
                          await deleteDiagram(item.id);
                          await refresh();
                          notify(`Deleted “${item.title}”.`);
                        })
                      }
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {activeProject && !mayWrite && (
        <p className="callout">
          You have view-only access to {activeProject.name}. You can open and export these diagrams,
          and save your own copy, but not change them.
        </p>
      )}
    </Modal>
  );
}
