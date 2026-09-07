import { useCallback, useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useAuth } from '../cloud/auth';
import {
  createDiagram,
  deleteDiagram,
  listDiagrams,
  openDiagram,
  renameDiagram,
  setPublished,
  shareLinkFor,
  type CloudDiagram,
} from '../cloud/diagrams';
import type { Diagram } from '../model/types';

interface Props {
  onClose: () => void;
  diagram: Diagram;
  title: string;
  currentId: string | null;
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
      <Modal title="Your diagrams" onClose={onClose}>
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

  return (
    <Modal
      title="Your diagrams"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="panel-hint">
            {items ? `${items.length} saved · signed in as ${auth.user.email}` : 'Loading…'}
          </span>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              guard(async () => {
                const meta = await createDiagram(auth.user!.id, diagram, title);
                onSaved(meta);
                await refresh();
                notify(`Saved “${meta.title}” as a new diagram.`);
              })
            }
          >
            Save current as new
          </button>
        </>
      }
    >
      {error && <p className="auth-error">{error}</p>}

      {!items && <p className="panel-hint">Loading your library…</p>}

      {items && items.length === 0 && (
        <p className="panel-hint">
          Nothing saved yet. Use <strong>Save current as new</strong> to put the diagram on the
          canvas into your account.
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="library">
          {items.map((item) => (
            <li key={item.id} className={item.id === currentId ? 'current' : ''}>
              <div className="library-main">
                <strong>{item.title}</strong>
                <span className="panel-hint">
                  edited {when(item.updatedAt)}
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
                <button
                  type="button"
                  disabled={busy}
                  title={
                    item.isPublic
                      ? 'Anyone with the link can open a read-only copy'
                      : 'Publish a read-only link for your team'
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
