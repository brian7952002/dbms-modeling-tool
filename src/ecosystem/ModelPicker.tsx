import { Modal } from '../platform/Modal';
import { allModels, type ModelId } from './registry';

interface Props {
  activeId: ModelId;
  onChoose: (id: ModelId) => void;
  onClose: () => void;
}

const STAGE_LABEL: Record<string, string> = {
  conceptual: 'Conceptual',
  logical: 'Logical / implementation',
  physical: 'Physical',
};

/**
 * The way into the ecosystem: pick which model you are building. The three
 * stages follow the design process — what the data means, how it becomes
 * tables, and how those tables are stored.
 */
export function ModelPicker({ activeId, onChoose, onClose }: Props) {
  const models = allModels();

  return (
    <Modal title="Choose a model" onClose={onClose} wide>
      <p className="panel-hint">
        Each model is a separate design. They live together in a project, so a schema and the
        diagrams that explain it stay in one place.
      </p>
      <ul className="model-list">
        {models.map((m) => (
          <li key={m.id} className={m.id === activeId ? 'current' : ''}>
            <button type="button" onClick={() => onChoose(m.id)}>
              <span className="model-glyph" aria-hidden>
                {m.glyph}
              </span>
              <span className="model-text">
                <strong>
                  {m.label}
                  {m.id === activeId && <span className="tag">open</span>}
                </strong>
                <em>{m.blurb}</em>
                <span className="panel-hint">
                  {STAGE_LABEL[m.stage] ?? m.stage}
                  {m.derivesFrom ? ` · checked against your ${m.derivesFrom.toUpperCase()} diagram` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="panel-hint">
        Choosing a model starts a new, empty diagram of that kind. Your current one is saved
        already if it belongs to a project.
      </p>
    </Modal>
  );
}
