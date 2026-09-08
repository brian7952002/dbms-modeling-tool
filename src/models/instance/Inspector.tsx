import type { InspectorProps } from '../../ecosystem/registry';
import type { DiagramNode, Edge, Id } from './types';

type Props = InspectorProps<DiagramNode, Edge>;

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Inspector({ diagram, selection, title, dispatch, sourceLink }: Props) {
  const patch = (id: Id, value: Record<string, unknown>) =>
    dispatch({ type: 'updateNode', id, patch: value });

  if (selection.length === 0) {
    return (
      <div className="inspector">
        <h2>Instance diagram</h2>
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => dispatch({ type: 'setTitle', title: e.target.value })}
          />
        </Field>
        {sourceLink && (
          <Field
            label="Schema"
            hint={
              sourceLink.currentId
                ? 'Your rows are checked against this diagram’s constraints.'
                : 'Link an EER diagram to check this data against the constraints it illustrates.'
            }
          >
            {sourceLink.unavailable ? (
              <p className="panel-hint">{sourceLink.unavailable}</p>
            ) : (
              <select
                value={sourceLink.currentId ?? ''}
                onChange={(e) => sourceLink.onChange(e.target.value || null)}
              >
                <option value="">
                  {sourceLink.loading ? 'Loading…' : 'Not linked — no schema checks'}
                </option>
                {sourceLink.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <p className="panel-hint">
          Sample rows for a schema. Select a shape to edit it, or press <strong>C</strong> and click
          an instance then its set to record membership — or two instances to record a relationship.
        </p>
        <dl className="stats">
          <div>
            <dt>Entity sets</dt>
            <dd>{diagram.nodes.filter((n) => n.kind === 'entity-set').length}</dd>
          </div>
          <div>
            <dt>Instances</dt>
            <dd>{diagram.nodes.filter((n) => n.kind === 'instance').length}</dd>
          </div>
          <div>
            <dt>Links</dt>
            <dd>{diagram.edges.filter((e) => e.kind === 'instance-link').length}</dd>
          </div>
          <div>
            <dt>Relationship sets</dt>
            <dd>{diagram.nodes.filter((n) => n.kind === 'rel-set').length}</dd>
          </div>
        </dl>
      </div>
    );
  }

  if (selection.length > 1) {
    return (
      <div className="inspector">
        <h2>{selection.length} selected</h2>
        <button
          type="button"
          className="danger"
          onClick={() => dispatch({ type: 'deleteSelection' })}
        >
          Delete selection
        </button>
      </div>
    );
  }

  const id = selection[0];
  const node = diagram.nodes.find((n) => n.id === id);
  const edge = diagram.edges.find((e) => e.id === id);

  if (edge) {
    const from = diagram.nodes.find((n) => n.id === edge.source);
    const to = diagram.nodes.find((n) => n.id === edge.target);
    return (
      <div className="inspector">
        <h2>Connection</h2>
        <p className="panel-hint">
          {from?.name ?? '?'} → {to?.name ?? '?'}
          <br />
          <span className="tag">
            {edge.kind === 'member-of' ? 'membership' : 'relationship instance'}
          </span>
        </p>
        {edge.kind === 'instance-link' && (
          <Field
            label="Relationship set"
            hint="Which relationship type this link is an instance of."
          >
            <select
              value={edge.relSetId ?? ''}
              onChange={(e) =>
                dispatch({ type: 'updateEdge', id: edge.id, patch: { relSetId: e.target.value } })
              }
            >
              <option value="">Unassigned</option>
              {diagram.nodes
                .filter((n) => n.kind === 'rel-set')
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <button
          type="button"
          className="danger"
          onClick={() => dispatch({ type: 'deleteSelection' })}
        >
          Delete connection
        </button>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="inspector">
        <h2>Nothing selected</h2>
      </div>
    );
  }

  return (
    <div className="inspector">
      <h2>{node.kind.replace('-', ' ')}</h2>

      {node.kind === 'entity-set' && (
        <>
          <Field label="Entity type" hint="Match the name in the EER diagram this illustrates.">
            <input
              value={node.entityName}
              onChange={(e) => patch(node.id, { entityName: e.target.value, name: e.target.value })}
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={node.weak}
              onChange={(e) => patch(node.id, { weak: e.target.checked })}
            />
            <span>Weak entity type</span>
          </label>
        </>
      )}

      {node.kind === 'instance' && (
        <Field label="Label" hint="The key value of this row, e.g. e1 or 123-45-6789.">
          <input
            value={node.label}
            onChange={(e) => patch(node.id, { label: e.target.value, name: e.target.value })}
          />
        </Field>
      )}

      {node.kind === 'rel-set' && (
        <Field label="Relationship type" hint="Match the diamond in the EER diagram.">
          <input
            value={node.relationshipName}
            onChange={(e) =>
              patch(node.id, { relationshipName: e.target.value, name: e.target.value })
            }
          />
        </Field>
      )}

      <Field label="Note">
        <textarea
          rows={2}
          value={node.note ?? ''}
          placeholder="Why this row is interesting…"
          onChange={(e) => patch(node.id, { note: e.target.value })}
        />
      </Field>

      <button
        type="button"
        className="danger"
        onClick={() => dispatch({ type: 'deleteSelection' })}
      >
        Delete {node.kind.replace('-', ' ')}
      </button>
    </div>
  );
}
