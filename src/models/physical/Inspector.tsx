import type { InspectorProps } from '../../ecosystem/registry';
import { estimateIndex, estimateStore, formatBytes, formatCount } from './estimates';
import { sizeForIndex, sizeForStore } from './factory';
import {
  INDEX_TYPES,
  ORGANISATIONS,
  indexesOf,
  isStore,
  storeOf,
  type DiagramNode,
  type Edge,
  type IndexType,
  type Organisation,
} from './types';

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
  const patch = (id: string, value: Record<string, unknown>) =>
    dispatch({ type: 'updateNode', id, patch: value });

  if (selection.length === 0) {
    const stores = diagram.nodes.filter(isStore);
    const totalBytes = stores.reduce((sum, s) => {
      const est = estimateStore(s);
      return sum + (est?.bytes ?? 0);
    }, 0);

    return (
      <div className="inspector">
        <h2>Physical design</h2>
        <Field label="Title">
          <input value={title} onChange={(e) => dispatch({ type: 'setTitle', title: e.target.value })} />
        </Field>

        {sourceLink && (
          <Field
            label="Relational schema"
            hint={
              sourceLink.currentId
                ? 'Column names and key coverage are checked against it.'
                : 'Link the logical model to check this design against the tables it stores.'
            }
          >
            {sourceLink.unavailable ? (
              <p className="panel-hint">{sourceLink.unavailable}</p>
            ) : (
              <select
                value={sourceLink.currentId ?? ''}
                onChange={(e) => sourceLink.onChange(e.target.value || null)}
              >
                <option value="">{sourceLink.loading ? 'Loading…' : 'Not linked'}</option>
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
          How each relation is stored and what it costs to reach. Select a file to set its
          organisation and size, or press <strong>C</strong> and click an index then the file it
          sits on.
        </p>
        <dl className="stats">
          <div>
            <dt>Stored files</dt>
            <dd>{stores.length}</dd>
          </div>
          <div>
            <dt>Indexes</dt>
            <dd>{diagram.nodes.length - stores.length}</dd>
          </div>
          <div>
            <dt>Estimated data</dt>
            <dd>{formatBytes(totalBytes)}</dd>
          </div>
          <div>
            <dt>Rows</dt>
            <dd>{formatCount(stores.reduce((n, s) => n + s.estimatedRows, 0))}</dd>
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
  const node = diagram.nodes.find((n) => n.id === id);
  const edge = diagram.edges.find((e) => e.id === id);

  if (edge) {
    const index = diagram.nodes.find((n) => n.id === edge.source);
    const store = diagram.nodes.find((n) => n.id === edge.target);
    return (
      <div className="inspector">
        <h2>Access path</h2>
        <p className="panel-hint">
          {index?.name ?? '?'} on {store?.name ?? '?'}
        </p>
        <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
          Detach index
        </button>
      </div>
    );
  }

  if (!node) return <div className="inspector"><h2>Nothing selected</h2></div>;

  /* ---- stored file ------------------------------------------------------ */

  if (node.kind === 'store') {
    const est = estimateStore(node);
    const attached = indexesOf(diagram, node.id);

    return (
      <div className="inspector">
        <h2>Stored file</h2>

        <Field label="Table" hint="Name it as it is in the relational schema.">
          <input
            value={node.tableName}
            onChange={(e) =>
              patch(node.id, {
                tableName: e.target.value,
                name: e.target.value,
                ...sizeForStore(e.target.value),
              })
            }
          />
        </Field>

        <Field
          label="Organisation"
          hint={ORGANISATIONS.find((o) => o.id === node.organisation)?.blurb}
        >
          <select
            value={node.organisation}
            onChange={(e) => patch(node.id, { organisation: e.target.value as Organisation })}
          >
            {ORGANISATIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {node.organisation !== 'heap' && (
          <Field
            label={node.organisation === 'hash' ? 'Hash key' : 'Ordering key'}
            hint="Comma-separated column names."
          >
            <input
              value={node.keyColumns.join(', ')}
              onChange={(e) =>
                patch(node.id, {
                  keyColumns: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
        )}

        <div className="row">
          <Field label="Rows">
            <input
              type="number"
              min={0}
              value={node.estimatedRows}
              onChange={(e) => patch(node.id, { estimatedRows: Number(e.target.value) })}
            />
          </Field>
          <Field label="Record bytes">
            <input
              type="number"
              min={1}
              value={node.avgRowBytes}
              onChange={(e) => patch(node.id, { avgRowBytes: Number(e.target.value) })}
            />
          </Field>
        </div>

        <div className="row">
          <Field label="Block bytes">
            <input
              type="number"
              min={1}
              value={node.blockSize}
              onChange={(e) => patch(node.id, { blockSize: Number(e.target.value) })}
            />
          </Field>
          <Field label="Fill factor" hint="0–1.">
            <input
              type="number"
              min={0.05}
              max={1}
              step={0.05}
              value={node.fillFactor}
              onChange={(e) => patch(node.id, { fillFactor: Number(e.target.value) })}
            />
          </Field>
        </div>

        {est && (
          <section className="sublist">
            <h3>Estimate</h3>
            <dl className="stats">
              <div>
                <dt>Blocking factor</dt>
                <dd>{est.blockingFactor}</dd>
              </div>
              <div>
                <dt>Blocks</dt>
                <dd>{formatCount(est.blocks)}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{formatBytes(est.bytes)}</dd>
              </div>
              <div>
                <dt>Full scan</dt>
                <dd>{formatCount(est.fullScan)}</dd>
              </div>
            </dl>
            <p className="panel-hint">
              A lookup on the file’s own key costs about <strong>{est.keyLookup}</strong> block
              access{est.keyLookup === 1 ? '' : 'es'} — {est.lookupBasis}.
            </p>
          </section>
        )}

        <section className="sublist">
          <h3>Indexes</h3>
          {attached.length === 0 ? (
            <p className="panel-hint">No index on this file.</p>
          ) : (
            <ul>
              {attached.map((i) => {
                const ie = estimateIndex(i, node);
                return (
                  <li key={i.id}>
                    <button type="button" onClick={() => dispatch({ type: 'select', ids: [i.id] })}>
                      <span>{i.indexName}</span>
                      <em>
                        {i.type}
                        {i.clustering ? ' · clustering' : ''}
                        {ie ? ` · ${ie.lookup} blocks` : ''}
                      </em>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Field label="Tablespace">
          <input
            value={node.tablespace ?? ''}
            placeholder="optional"
            onChange={(e) => patch(node.id, { tablespace: e.target.value })}
          />
        </Field>

        <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
          Delete stored file
        </button>
      </div>
    );
  }

  /* ---- index ------------------------------------------------------------ */

  const store = storeOf(diagram, node.id);
  const est = store ? estimateIndex(node, store) : null;

  return (
    <div className="inspector">
      <h2>Index</h2>

      <Field label="Name">
        <input
          value={node.indexName}
          onChange={(e) =>
            patch(node.id, {
              indexName: e.target.value,
              name: e.target.value,
              ...sizeForIndex(e.target.value, node.columns),
            })
          }
        />
      </Field>

      <Field label="Columns" hint="Comma-separated, in index order — the order decides what it can serve.">
        <input
          value={node.columns.join(', ')}
          onChange={(e) => {
            const columns = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            patch(node.id, { columns, ...sizeForIndex(node.indexName, columns) });
          }}
        />
      </Field>

      <Field label="Type" hint={INDEX_TYPES.find((t) => t.id === node.type)?.blurb}>
        <select
          value={node.type}
          onChange={(e) => patch(node.id, { type: e.target.value as IndexType })}
        >
          {INDEX_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="check-grid">
        <label className="check">
          <input
            type="checkbox"
            checked={node.unique}
            onChange={(e) => patch(node.id, { unique: e.target.checked })}
          />
          <span>Unique</span>
        </label>
        <label className="check" title="Determines the file's physical order; only one per file.">
          <input
            type="checkbox"
            checked={node.clustering}
            onChange={(e) => patch(node.id, { clustering: e.target.checked })}
          />
          <span>Clustering</span>
        </label>
      </div>

      <Field label="Average key bytes">
        <input
          type="number"
          min={1}
          value={node.avgKeyBytes}
          onChange={(e) => patch(node.id, { avgKeyBytes: Number(e.target.value) })}
        />
      </Field>

      {est && store && (
        <section className="sublist">
          <h3>Estimate</h3>
          <dl className="stats">
            <div>
              <dt>Fan-out</dt>
              <dd>{est.fanout}</dd>
            </div>
            <div>
              <dt>Levels</dt>
              <dd>{est.levels}</dd>
            </div>
            <div>
              <dt>Leaf blocks</dt>
              <dd>{formatCount(est.leafBlocks)}</dd>
            </div>
            <div>
              <dt>Lookup</dt>
              <dd>{est.lookup}</dd>
            </div>
          </dl>
          <p className="panel-hint">
            {est.basis}. A full scan of {store.name} is{' '}
            {formatCount(estimateStore(store)?.fullScan ?? 0)} blocks.
          </p>
        </section>
      )}

      {!store && (
        <p className="callout">
          Not attached to a file. Press <strong>C</strong>, click this index, then the file it
          belongs on.
        </p>
      )}

      <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
        Delete index
      </button>
    </div>
  );
}
