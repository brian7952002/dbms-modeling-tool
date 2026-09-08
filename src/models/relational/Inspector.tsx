import type { InspectorProps } from '../../ecosystem/registry';
import { COMMON_TYPES } from '../eer/ddl';
import { makeColumn, sizeForTable } from './factory';
import { columnKey, readColumn, readColumns, type Column, type DiagramNode, type Edge, type Id } from './types';

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

export function Inspector({ diagram, selection, title, dispatch }: Props) {
  /**
   * Any change to a table's columns also changes its size, so the two are
   * written together — the box must always be as tall as its contents.
   */
  const writeColumns = (table: DiagramNode, columns: Column[]) => {
    const patch: Record<string, unknown> = {
      columnOrder: columns.map((c) => c.id),
      ...sizeForTable(table.name, columns),
    };
    for (const c of columns) patch[columnKey(c.id)] = c;
    dispatch({ type: 'updateNode', id: table.id, patch });
  };

  const editColumn = (table: DiagramNode, columnId: string, change: Partial<Column>) => {
    const current = readColumn(table, columnId);
    if (!current) return;
    const next = { ...current, ...change };
    // Only this column's key is written, so a teammate editing another column
    // of the same table is untouched.
    dispatch({
      type: 'updateNode',
      id: table.id,
      patch: {
        [columnKey(columnId)]: next,
        ...sizeForTable(
          table.name,
          readColumns(table).map((c) => (c.id === columnId ? next : c)),
        ),
      },
    });
  };

  if (selection.length === 0) {
    return (
      <div className="inspector">
        <h2>Relational schema</h2>
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => dispatch({ type: 'setTitle', title: e.target.value })}
          />
        </Field>
        <p className="panel-hint">
          Tables, columns and foreign keys. Select a table to edit its columns, or press{' '}
          <strong>C</strong> and click the referencing table then the one it references.
        </p>
        <dl className="stats">
          <div>
            <dt>Tables</dt>
            <dd>{diagram.nodes.length}</dd>
          </div>
          <div>
            <dt>Columns</dt>
            <dd>{diagram.nodes.reduce((n, t) => n + readColumns(t).length, 0)}</dd>
          </div>
          <div>
            <dt>Foreign keys</dt>
            <dd>{diagram.edges.length}</dd>
          </div>
          <div>
            <dt>Keyed tables</dt>
            <dd>{diagram.nodes.filter((t) => readColumns(t).some((c) => c.pk)).length}</dd>
          </div>
        </dl>
      </div>
    );
  }

  if (selection.length > 1) {
    return (
      <div className="inspector">
        <h2>{selection.length} selected</h2>
        <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
          Delete selection
        </button>
      </div>
    );
  }

  const id = selection[0];
  const table = diagram.nodes.find((n) => n.id === id);
  const edge = diagram.edges.find((e) => e.id === id);

  /* ---- foreign key ------------------------------------------------------ */

  if (edge) {
    const child = diagram.nodes.find((n) => n.id === edge.source);
    const parent = diagram.nodes.find((n) => n.id === edge.target);
    if (!child || !parent) {
      return <div className="inspector"><h2>Foreign key</h2></div>;
    }
    const childColumns = readColumns(child);
    const parentColumns = readColumns(parent);
    const pairs = edge.columns.map((c, i) => ({ from: c, to: edge.references[i] }));

    const setPair = (index: number, from: string, to: string) => {
      const columns = [...edge.columns];
      const references = [...edge.references];
      columns[index] = from;
      references[index] = to;
      dispatch({ type: 'updateEdge', id: edge.id, patch: { columns, references } });
    };

    return (
      <div className="inspector">
        <h2>Foreign key</h2>
        <p className="panel-hint">
          {child.name} references {parent.name}
        </p>

        {pairs.length === 0 && (
          <p className="callout">
            No columns chosen yet. Add a pair to say which column references which.
          </p>
        )}

        {pairs.map((pair, i) => (
          <div className="row" key={i}>
            <Field label={`${child.name} column`}>
              <select value={pair.from ?? ''} onChange={(e) => setPair(i, e.target.value, pair.to)}>
                <option value="">Choose…</option>
                {childColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`${parent.name} column`}>
              <select value={pair.to ?? ''} onChange={(e) => setPair(i, pair.from, e.target.value)}>
                <option value="">Choose…</option>
                {parentColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.pk ? ' (key)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ))}

        <button
          type="button"
          className="subtle"
          onClick={() =>
            dispatch({
              type: 'updateEdge',
              id: edge.id,
              patch: {
                columns: [...edge.columns, childColumns[0]?.id ?? ''],
                references: [...edge.references, parentColumns.find((c) => c.pk)?.id ?? ''],
              },
            })
          }
        >
          + Add column pair
        </button>

        <Field label="On delete" hint="What happens to referencing rows when the referenced row goes.">
          <select
            value={edge.onDelete ?? 'NO ACTION'}
            onChange={(e) =>
              dispatch({ type: 'updateEdge', id: edge.id, patch: { onDelete: e.target.value } })
            }
          >
            <option value="NO ACTION">NO ACTION</option>
            <option value="CASCADE">CASCADE</option>
            <option value="SET NULL">SET NULL</option>
            <option value="RESTRICT">RESTRICT</option>
          </select>
        </Field>

        <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
          Delete foreign key
        </button>
      </div>
    );
  }

  /* ---- table ------------------------------------------------------------ */

  if (!table) {
    return <div className="inspector"><h2>Nothing selected</h2></div>;
  }

  const columns = readColumns(table);

  return (
    <div className="inspector">
      <h2>Table</h2>

      <Field label="Name">
        <input
          value={table.name}
          onChange={(e) =>
            dispatch({
              type: 'updateNode',
              id: table.id,
              patch: { name: e.target.value, ...sizeForTable(e.target.value, columns) },
            })
          }
        />
      </Field>

      <section className="sublist">
        <h3>Columns</h3>
        {columns.length === 0 && <p className="panel-hint">No columns yet.</p>}
        <ul className="column-list">
          {columns.map((c, i) => (
            <li key={c.id}>
              <div className="column-head">
                <input
                  className="column-input"
                  value={c.name}
                  onChange={(e) => editColumn(table, c.id, { name: e.target.value })}
                />
                <input
                  className="column-input type"
                  list="rel-types"
                  value={c.dataType}
                  onChange={(e) => editColumn(table, c.id, { dataType: e.target.value })}
                />
              </div>
              <div className="column-flags">
                <label className="check" title="Part of the primary key">
                  <input
                    type="checkbox"
                    checked={c.pk}
                    onChange={(e) =>
                      editColumn(table, c.id, {
                        pk: e.target.checked,
                        notNull: e.target.checked ? true : c.notNull,
                      })
                    }
                  />
                  <span>PK</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={c.notNull}
                    onChange={(e) => editColumn(table, c.id, { notNull: e.target.checked })}
                  />
                  <span>NOT NULL</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={c.unique}
                    onChange={(e) => editColumn(table, c.id, { unique: e.target.checked })}
                  />
                  <span>UNIQUE</span>
                </label>
                <button
                  type="button"
                  className="link danger"
                  onClick={() => writeColumns(table, columns.filter((x) => x.id !== c.id))}
                  aria-label={`Remove ${c.name}`}
                >
                  Remove
                </button>
                {i > 0 && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      const next = [...columns];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      writeColumns(table, next);
                    }}
                  >
                    Move up
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <datalist id="rel-types">
          {COMMON_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <button
          type="button"
          className="subtle"
          onClick={() => writeColumns(table, [...columns, makeColumn()])}
        >
          + Add column
        </button>
      </section>

      <Field label="Note">
        <textarea
          rows={2}
          value={table.note ?? ''}
          placeholder="What this relation holds…"
          onChange={(e) => dispatch({ type: 'updateNode', id: table.id, patch: { note: e.target.value } })}
        />
      </Field>

      <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
        Delete table
      </button>
    </div>
  );
}

export type { Id };
