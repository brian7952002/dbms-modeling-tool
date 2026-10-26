import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../platform/Modal';
import {
  deleteDiagram,
  duplicateDiagram,
  exportAll,
  importBundle,
  isAvailable,
  listDiagrams,
  loadDiagram,
  renameDiagram,
  saveDiagram,
  type LocalDiagram,
} from '../local/library';
import { canImportFromCloud, importFromCloud } from '../local/importFromCloud';
import { downloadBlob, fromFile, slugify, toFile } from '../platform/serialize';
import type { Diagram } from '../platform/types';

interface Props {
  onClose: () => void;
  diagram: Diagram;
  title: string;
  model: string;
  /** The library entry currently open on the canvas, if any. */
  currentId: string | null;
  onOpened: (meta: LocalDiagram, diagram: Diagram, title: string, model: string) => void;
  onSaved: (meta: LocalDiagram) => void;
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

const MODEL_LABEL: Record<string, string> = {
  eer: 'EER',
  instance: 'Instance data',
  relational: 'Relational',
  physical: 'Physical',
};

export function LibraryModal({
  onClose,
  diagram,
  title,
  model,
  currentId,
  onOpened,
  onSaved,
  notify,
}: Props) {
  const [items, setItems] = useState<LocalDiagram[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listDiagrams());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read your diagrams.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  if (!isAvailable()) {
    return (
      <Modal title="My diagrams" onClose={onClose}>
        <p>
          This browser will not let the app keep diagrams — usually a private window, or site data
          blocked for this address.
        </p>
        <p className="panel-hint">
          Everything else still works. Use <strong>File ▸ Save .eer.json</strong> to keep your work
          as a file, and <strong>Open .eer.json</strong> to bring it back.
        </p>
      </Modal>
    );
  }

  const list = items ?? [];

  return (
    <Modal
      title="My diagrams"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="panel-hint">
            {items ? `${list.length} saved in this browser` : 'Loading…'}
          </span>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              guard(async () => {
                const meta = await saveDiagram(currentId, toFile(diagram, title, model));
                onSaved(meta);
                await refresh();
                notify(`Saved “${meta.title}”.`);
              })
            }
          >
            {currentId ? 'Save changes' : 'Save current diagram'}
          </button>
        </>
      }
    >
      {error && <p className="auth-error">{error}</p>}

      {items && list.length === 0 && (
        <p className="panel-hint">
          Nothing saved yet. Use “Save current diagram” to put the one on your canvas here.
        </p>
      )}

      {list.length > 0 && (
        <ul className="library">
          {list.map((item) => (
            <li key={item.id} className={item.id === currentId ? 'current' : ''}>
              <div className="library-main">
                <strong>{item.title}</strong>
                <span className="panel-hint">
                  {MODEL_LABEL[item.model] ?? item.model} · edited {when(item.updatedAt)}
                  {item.id === currentId ? ' · open now' : ''}
                </span>
              </div>
              <div className="library-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    guard(async () => {
                      const stored = await loadDiagram(item.id);
                      if (!stored) throw new Error('That diagram is no longer here.');
                      const parsed = fromFile(stored.file);
                      onOpened(item, parsed.diagram, parsed.title, parsed.model);
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
                      const meta = await renameDiagram(item.id, next.trim());
                      if (item.id === currentId) onSaved(meta);
                      await refresh();
                    })
                  }
                >
                  Rename
                </button>

                <button
                  type="button"
                  disabled={busy}
                  title="Make a separate copy to experiment on"
                  onClick={() =>
                    guard(async () => {
                      await duplicateDiagram(item.id);
                      await refresh();
                      notify('Duplicated.');
                    })
                  }
                >
                  Duplicate
                </button>

                <button
                  type="button"
                  disabled={busy}
                  title="Save this diagram as a file on your computer"
                  onClick={() =>
                    guard(async () => {
                      const stored = await loadDiagram(item.id);
                      if (!stored) throw new Error('That diagram is no longer here.');
                      downloadBlob(
                        new Blob([JSON.stringify(stored.file, null, 2)], {
                          type: 'application/json',
                        }),
                        `${slugify(item.title)}.eer.json`,
                      );
                    })
                  }
                >
                  Export
                </button>

                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    guard(async () => {
                      const sure = window.confirm(
                        `Delete “${item.title}”? This cannot be undone, and it is only stored in this browser.`,
                      );
                      if (!sure) return;
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

      {canImportFromCloud && (
        <section className="sublist">
          <h3>Bring over your old account</h3>
          <p className="panel-hint">
            Diagrams you saved before this app went offline-only are still on the old server. This
            copies them all into this browser once, after which the account is finished with.
          </p>
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void guard(async () => {
                const result = await importFromCloud(
                  String(form.get('email') ?? '').trim(),
                  String(form.get('password') ?? ''),
                );
                await refresh();
                notify(
                  result.skipped.length > 0
                    ? `Brought over ${result.imported}. Could not read: ${result.skipped.join(', ')}.`
                    : `Brought over ${result.imported} diagram${result.imported === 1 ? '' : 's'}.`,
                );
              });
            }}
          >
            <label className="field">
              <span className="field-label">Email</span>
              <input name="email" type="email" required autoComplete="username" />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Bringing them over…' : 'Import my old diagrams'}
            </button>
          </form>
        </section>
      )}

      <section className="sublist">
        <h3>Backup</h3>
        <p className="panel-hint">
          These diagrams live in this browser only. Clearing site data removes them, and they will
          not appear in another browser or on another machine. A backup file is the way to keep a
          copy somewhere this app does not control.
        </p>
        <div className="library-actions">
          <button
            type="button"
            disabled={busy || list.length === 0}
            onClick={() =>
              guard(async () => {
                const bundle = await exportAll();
                downloadBlob(
                  new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
                  `dbms-diagrams-${new Date().toISOString().slice(0, 10)}.json`,
                );
                notify(`Backed up ${bundle.diagrams.length} diagrams.`);
              })
            }
          >
            Back up all diagrams
          </button>
          <button type="button" disabled={busy} onClick={() => importInput.current?.click()}>
            Restore from a backup
          </button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void guard(async () => {
                const added = await importBundle(JSON.parse(await file.text()));
                await refresh();
                notify(`Restored ${added} diagram${added === 1 ? '' : 's'}.`);
              });
            }}
          />
        </div>
      </section>
    </Modal>
  );
}
