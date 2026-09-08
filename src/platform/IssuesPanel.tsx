import type { Issue } from '../ecosystem/registry';
import type { Id } from './types';

interface Props {
  issues: Issue[];
  onSelect: (ids: Id[]) => void;
  onClose: () => void;
}

const ICON: Record<Issue['severity'], string> = {
  error: '✕',
  warning: '!',
  info: 'i',
};

/**
 * Live model checker. Clicking an issue selects the shapes it refers to, which
 * is the fastest way to find the one unnamed attribute in a large diagram.
 */
export function IssuesPanel({ issues, onSelect, onClose }: Props) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return (
    <aside className="issues-panel">
      <header>
        <h2>Model checker</h2>
        <button type="button" className="icon" onClick={onClose} aria-label="Hide the model checker">
          ✕
        </button>
      </header>
      <p className="panel-hint">
        {issues.length === 0
          ? 'No problems found — the diagram satisfies every structural rule this tool checks.'
          : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${
              warnings === 1 ? '' : 's'
            }. Click an item to select what it refers to.`}
      </p>
      <ul>
        {issues.map((issue) => (
          <li key={issue.id} className={issue.severity}>
            <button type="button" onClick={() => onSelect(issue.targets)}>
              <span className={`badge ${issue.severity}`}>{ICON[issue.severity]}</span>
              <span>{issue.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
