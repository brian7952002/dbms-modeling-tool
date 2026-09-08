import { useEffect, useState } from 'react';
import { Modal } from '../platform/Modal';
import {
  describeActivity,
  listActivity,
  listVersions,
  restoreVersion,
  type ActivityEntry,
  type VersionEntry,
} from '../cloud/projects';

interface Props {
  diagramId: string;
  diagramTitle: string;
  canEdit: boolean;
  onClose: () => void;
  onRestored: () => Promise<void>;
  notify: (message: string) => void;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleString();
};

/**
 * History for one diagram: the restorable snapshots, and the actions that
 * snapshots cannot show — renames, publishing, restores.
 */
export function HistoryModal({
  diagramId,
  diagramTitle,
  canEdit,
  onClose,
  onRestored,
  notify,
}: Props) {
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [v, a] = await Promise.all([
        listVersions(diagramId),
        listActivity({ diagramId }),
      ]);
      setVersions(v);
      setActivity(a);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the history.');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId]);

  return (
    <Modal title={`History — ${diagramTitle}`} onClose={onClose} wide>
      {error && <p className="auth-error">{error}</p>}

      <div className="history-layout">
        <section className="sublist">
          <h3>Versions</h3>
          {!versions && <p className="panel-hint">Loading…</p>}
          {versions?.length === 0 && (
            <p className="panel-hint">
              No snapshots yet. One is kept each time the diagram is saved, coalesced so a single
              editing session is a single entry.
            </p>
          )}
          {versions && versions.length > 0 && (
            <ul className="version-list">
              {versions.map((v, i) => (
                <li key={v.id}>
                  <div>
                    <strong>
                      v{v.version}
                      {i === 0 && <span className="tag">current</span>}
                    </strong>
                    <span className="panel-hint">
                      {v.authorName} · {when(v.createdAt)}
                      {v.title !== diagramTitle ? ` · titled “${v.title}”` : ''}
                    </span>
                  </div>
                  {canEdit && i > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const nv = await restoreVersion(v.id);
                          await onRestored();
                          await load();
                          notify(`Restored v${v.version} — saved as v${nv}.`);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Restore failed.');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && versions && versions.length > 1 && (
            <p className="panel-hint">
              Restoring does not erase anything — the old version is saved on top as a new one, so
              the trail stays intact.
            </p>
          )}
        </section>

        <section className="sublist">
          <h3>Activity</h3>
          {activity.length === 0 ? (
            <p className="panel-hint">Nothing recorded for this diagram yet.</p>
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
      </div>
    </Modal>
  );
}
