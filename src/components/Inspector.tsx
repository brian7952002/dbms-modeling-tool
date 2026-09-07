import type {
  AttributeNode,
  Cardinality,
  Diagram,
  DiagramNode,
  Edge,
  Id,
} from '../model/types';
import type { Action } from '../state/store';
import { COMMON_TYPES } from '../model/ddl';
import { isaSize } from '../model/measure';
import {
  attributesOf,
  isRecursive,
  isaParentsOf,
  nodeById,
  participantsOf,
  subclassesOf,
  superclassOf,
  unionCategory,
  unionSuperclasses,
} from '../model/graph';

interface Props {
  diagram: Diagram;
  selection: Id[];
  title: string;
  dispatch: React.Dispatch<Action>;
  onAddAttribute: (ownerId: Id) => void;
  onAlign: (axis: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => void;
  onDistribute: (axis: 'x' | 'y') => void;
}

const CARDINALITIES: Cardinality[] = ['1', 'N', 'M', 'P', 'Q'];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="check" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function attrBadges(a: AttributeNode): string {
  const b: string[] = [];
  if (a.key) b.push('PK');
  if (a.partialKey) b.push('partial');
  if (a.multivalued) b.push('multi');
  if (a.derived) b.push('derived');
  return b.join(' · ');
}

export function Inspector({
  diagram,
  selection,
  title,
  dispatch,
  onAddAttribute,
  onAlign,
  onDistribute,
}: Props) {
  const select = (id: Id) => dispatch({ type: 'select', ids: [id] });
  const patchNode = (id: Id, patch: Partial<DiagramNode>) =>
    dispatch({ type: 'updateNode', id, patch });
  const patchEdge = (id: Id, patch: Partial<Edge>) =>
    dispatch({ type: 'updateEdge', id, patch });

  /* ---- empty / multi selection ----------------------------------------- */

  if (selection.length === 0) {
    return (
      <div className="inspector">
        <h2>Diagram</h2>
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => dispatch({ type: 'setTitle', title: e.target.value })}
          />
        </Field>
        <p className="panel-hint">
          Select a shape or a line to edit it. Double-click a shape to rename it in place.
        </p>
        <dl className="stats">
          <div>
            <dt>Entities</dt>
            <dd>{diagram.nodes.filter((n) => n.kind === 'entity').length}</dd>
          </div>
          <div>
            <dt>Relationships</dt>
            <dd>{diagram.nodes.filter((n) => n.kind === 'relationship').length}</dd>
          </div>
          <div>
            <dt>Attributes</dt>
            <dd>{diagram.nodes.filter((n) => n.kind === 'attribute').length}</dd>
          </div>
          <div>
            <dt>Connections</dt>
            <dd>{diagram.edges.length}</dd>
          </div>
        </dl>
      </div>
    );
  }

  if (selection.length > 1) {
    return (
      <div className="inspector">
        <h2>{selection.length} selected</h2>
        <div className="button-grid">
          <button type="button" onClick={() => onAlign('left')}>Align left</button>
          <button type="button" onClick={() => onAlign('centerX')}>Centre ↕</button>
          <button type="button" onClick={() => onAlign('right')}>Align right</button>
          <button type="button" onClick={() => onAlign('top')}>Align top</button>
          <button type="button" onClick={() => onAlign('centerY')}>Centre ↔</button>
          <button type="button" onClick={() => onAlign('bottom')}>Align bottom</button>
          <button type="button" onClick={() => onDistribute('x')}>Space across</button>
          <button type="button" onClick={() => onDistribute('y')}>Space down</button>
        </div>
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
  const node = nodeById(diagram, id);
  const edge = diagram.edges.find((e) => e.id === id);

  /* ---- edge ------------------------------------------------------------- */

  if (edge) {
    const from = nodeById(diagram, edge.source);
    const to = nodeById(diagram, edge.target);
    const rel = edge.kind === 'participation' ? to : undefined;
    const recursive = rel ? isRecursive(diagram, rel.id) : false;

    return (
      <div className="inspector">
        <h2>Connection</h2>
        <p className="panel-hint">
          {from?.name ?? '?'} → {to?.name ?? '?'}
          <br />
          <span className="tag">{edge.kind.replace('-', ' ')}</span>
        </p>

        {edge.kind === 'participation' && (
          <>
            <Field label="Cardinality ratio" hint="The Chen label: one “1” side and one “N” side make a 1:N.">
              <select
                value={edge.cardinality ?? 'N'}
                onChange={(e) =>
                  patchEdge(edge.id, { cardinality: e.target.value as Cardinality })
                }
              >
                {CARDINALITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Check
              label="Total participation (double line)"
              checked={!!edge.total}
              onChange={(v) => patchEdge(edge.id, { total: v, min: v ? Math.max(1, edge.min ?? 1) : 0 })}
              hint="Every instance of this entity must take part in the relationship."
            />

            <Check
              label="Show (min,max) constraint"
              checked={!!edge.showMinMax}
              onChange={(v) => patchEdge(edge.id, { showMinMax: v })}
            />

            {edge.showMinMax && (
              <div className="row">
                <Field label="min">
                  <input
                    type="number"
                    min={0}
                    value={edge.min ?? 0}
                    onChange={(e) => patchEdge(edge.id, { min: Number(e.target.value) })}
                  />
                </Field>
                <Field label="max" hint="Leave empty for N (unbounded).">
                  <input
                    type="number"
                    min={1}
                    value={edge.max === null || edge.max === undefined ? '' : edge.max}
                    onChange={(e) =>
                      patchEdge(edge.id, {
                        max: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
            )}

            <Field
              label="Role name"
              hint={
                recursive
                  ? 'Required: this relationship is recursive, so each leg needs a role.'
                  : 'Optional. Used as the column prefix in generated SQL.'
              }
            >
              <input
                value={edge.role ?? ''}
                placeholder={recursive ? 'e.g. supervisor' : ''}
                onChange={(e) => patchEdge(edge.id, { role: e.target.value })}
              />
            </Field>
          </>
        )}

        {(edge.kind === 'isa-super' || edge.kind === 'isa-sub') && (
          <Field label="This entity is the" hint="Each triangle has one superclass and any number of subclasses.">
            <select
              value={edge.kind}
              onChange={(e) => patchEdge(edge.id, { kind: e.target.value as Edge['kind'] })}
            >
              <option value="isa-super">superclass</option>
              <option value="isa-sub">subclass</option>
            </select>
          </Field>
        )}

        {(edge.kind === 'union-super' || edge.kind === 'union-sub') && (
          <Field label="This entity is the" hint="A category has one subclass and two or more superclasses.">
            <select
              value={edge.kind}
              onChange={(e) => patchEdge(edge.id, { kind: e.target.value as Edge['kind'] })}
            >
              <option value="union-super">superclass</option>
              <option value="union-sub">category (subclass)</option>
            </select>
          </Field>
        )}

        <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
          Delete connection
        </button>
      </div>
    );
  }

  if (!node) return <div className="inspector"><h2>Nothing selected</h2></div>;

  /* ---- node ------------------------------------------------------------- */

  const owned = attributesOf(diagram, node.id);

  return (
    <div className="inspector">
      <h2>{node.kind === 'isa' ? 'Specialisation' : node.kind === 'union' ? 'Union type' : node.kind}</h2>

      {node.kind !== 'isa' && node.kind !== 'union' && (
        <Field label="Name">
          <input
            value={node.name}
            onChange={(e) => patchNode(node.id, { name: e.target.value })}
          />
        </Field>
      )}

      {node.kind === 'entity' && (
        <>
          <Check
            label="Weak entity (double box)"
            checked={node.weak}
            onChange={(v) => patchNode(node.id, { weak: v })}
            hint="Has no key of its own; identified by an owner plus a partial key."
          />
          <SubList
            title="Attributes"
            empty="No attributes yet."
            items={owned.map((a) => ({ id: a.id, label: a.name, note: attrBadges(a) }))}
            onSelect={select}
            onAdd={() => onAddAttribute(node.id)}
            addLabel="Add attribute"
          />
          <SubList
            title="Specialisation"
            empty="Not part of any ISA hierarchy."
            items={[
              ...diagram.edges
                .filter((e) => e.kind === 'isa-super' && e.source === node.id)
                .map((e) => ({ id: e.id, label: 'superclass of this hierarchy', note: '' })),
              ...isaParentsOf(diagram, node.id).map((isa) => ({
                id: isa.id,
                label: `subclass · ${isa.disjoint ? 'disjoint' : 'overlapping'}`,
                note: isa.total ? 'total' : 'partial',
              })),
            ]}
            onSelect={select}
          />
          <SubList
            title="Relationships"
            empty="Not connected to any relationship."
            items={diagram.edges
              .filter((e) => e.kind === 'participation' && e.source === node.id)
              .map((e) => {
                const r = nodeById(diagram, e.target);
                return {
                  id: e.id,
                  label: r?.name ?? '?',
                  note: [e.cardinality, e.role, e.total ? 'total' : null]
                    .filter(Boolean)
                    .join(' · '),
                };
              })}
            onSelect={select}
          />
        </>
      )}

      {node.kind === 'relationship' && (
        <>
          <Check
            label="Identifying (double diamond)"
            checked={node.identifying}
            onChange={(v) => patchNode(node.id, { identifying: v })}
            hint="Supplies the borrowed part of a weak entity's key."
          />
          {isRecursive(diagram, node.id) && (
            <p className="callout">
              Recursive relationship — give every leg a role name so the two sides can be told apart.
            </p>
          )}
          <SubList
            title="Participants"
            empty="Connect this diamond to at least two entities."
            items={participantsOf(diagram, node.id).map((p) => ({
              id: p.edge.id,
              label: p.entity.name,
              note: [p.edge.cardinality, p.edge.role, p.edge.total ? 'total' : null]
                .filter(Boolean)
                .join(' · '),
            }))}
            onSelect={select}
          />
          <SubList
            title="Attributes"
            empty="No attributes on this relationship."
            items={owned.map((a) => ({ id: a.id, label: a.name, note: attrBadges(a) }))}
            onSelect={select}
            onAdd={() => onAddAttribute(node.id)}
            addLabel="Add attribute"
          />
        </>
      )}

      {node.kind === 'attribute' && (
        <>
          <div className="check-grid">
            <Check
              label="Key"
              checked={node.key}
              onChange={(v) => patchNode(node.id, { key: v, partialKey: v ? false : node.partialKey, nullable: v ? false : node.nullable })}
              hint="Primary key component — drawn with a solid underline."
            />
            <Check
              label="Partial key"
              checked={node.partialKey}
              onChange={(v) => patchNode(node.id, { partialKey: v, key: v ? false : node.key })}
              hint="Discriminator of a weak entity — dashed underline."
            />
            <Check
              label="Multivalued"
              checked={node.multivalued}
              onChange={(v) => patchNode(node.id, { multivalued: v })}
              hint="Double oval; becomes its own table in SQL."
            />
            <Check
              label="Derived"
              checked={node.derived}
              onChange={(v) => patchNode(node.id, { derived: v })}
              hint="Dashed oval; computed rather than stored."
            />
          </div>

          {node.derived && (
            <Field label="Derivation">
              <input
                value={node.derivation ?? ''}
                placeholder="e.g. today - birth_date"
                onChange={(e) => patchNode(node.id, { derivation: e.target.value })}
              />
            </Field>
          )}

          <Field label="SQL type">
            <input
              list="eer-types"
              value={node.dataType}
              onChange={(e) => patchNode(node.id, { dataType: e.target.value })}
            />
          </Field>
          <datalist id="eer-types">
            {COMMON_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          <Check
            label="Nullable"
            checked={node.nullable}
            onChange={(v) => patchNode(node.id, { nullable: v })}
          />

          <SubList
            title="Components"
            empty="Add components to make this a composite attribute."
            items={owned.map((a) => ({ id: a.id, label: a.name, note: attrBadges(a) }))}
            onSelect={select}
            onAdd={() => onAddAttribute(node.id)}
            addLabel="Add component"
          />
        </>
      )}

      {node.kind === 'isa' && (
        <>
          <Field label="Disjointness">
            <select
              value={node.disjoint ? 'd' : 'o'}
              onChange={(e) => patchNode(node.id, { disjoint: e.target.value === 'd' })}
            >
              <option value="d">Disjoint (d) — at most one subclass</option>
              <option value="o">Overlapping (o) — may belong to several</option>
            </select>
          </Field>
          <Field label="Completeness" hint="Total specialisation is drawn as a double line to the superclass.">
            <select
              value={node.total ? 'total' : 'partial'}
              onChange={(e) => patchNode(node.id, { total: e.target.value === 'total' })}
            >
              <option value="partial">Partial — a superclass member need not be in any subclass</option>
              <option value="total">Total — every superclass member is in some subclass</option>
            </select>
          </Field>
          <Field
            label="Symbol"
            hint="Elmasri & Navathe draw a circle; some texts use a triangle labelled ISA. Either way each subclass line carries the ⊂ subset symbol."
          >
            <select
              value={node.symbol ?? 'circle'}
              onChange={(e) => {
                const symbol = e.target.value as 'circle' | 'triangle';
                patchNode(node.id, { symbol, ...isaSize(symbol) });
              }}
            >
              <option value="circle">Circle with d / o</option>
              <option value="triangle">Triangle</option>
            </select>
          </Field>
          <Field
            label="Defining attribute"
            hint="For attribute-defined specialisation — shown on the line to the superclass, e.g. Job_type."
          >
            <input
              value={node.definingAttribute ?? ''}
              placeholder="optional"
              onChange={(e) => patchNode(node.id, { definingAttribute: e.target.value })}
            />
          </Field>
          <SubList
            title="Superclass"
            empty="Connect the triangle to its superclass."
            items={(() => {
              const s = superclassOf(diagram, node.id);
              return s ? [{ id: s.id, label: s.name, note: '' }] : [];
            })()}
            onSelect={select}
          />
          <SubList
            title="Subclasses"
            empty="Connect the triangle to its subclasses."
            items={subclassesOf(diagram, node.id).map((s) => ({ id: s.id, label: s.name, note: '' }))}
            onSelect={select}
          />
        </>
      )}

      {node.kind === 'union' && (
        <>
          <Field label="Completeness">
            <select
              value={node.total ? 'total' : 'partial'}
              onChange={(e) => patchNode(node.id, { total: e.target.value === 'total' })}
            >
              <option value="partial">Partial — some superclass members are not in the category</option>
              <option value="total">Total — every superclass member is in the category</option>
            </select>
          </Field>
          <SubList
            title="Category (subclass)"
            empty="Connect the circle to the category entity."
            items={(() => {
              const c = unionCategory(diagram, node.id);
              return c ? [{ id: c.id, label: c.name, note: '' }] : [];
            })()}
            onSelect={select}
          />
          <SubList
            title="Superclasses"
            empty="Connect two or more superclasses."
            items={unionSuperclasses(diagram, node.id).map((s) => ({
              id: s.id,
              label: s.name,
              note: '',
            }))}
            onSelect={select}
          />
        </>
      )}

      <Field label="Note">
        <textarea
          rows={2}
          value={node.note ?? ''}
          placeholder="Assumptions, business rules…"
          onChange={(e) => patchNode(node.id, { note: e.target.value })}
        />
      </Field>

      <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
        Delete {node.kind}
      </button>
    </div>
  );
}

function SubList({
  title,
  items,
  empty,
  onSelect,
  onAdd,
  addLabel,
}: {
  title: string;
  items: { id: Id; label: string; note: string }[];
  empty: string;
  onSelect: (id: Id) => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <section className="sublist">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="panel-hint">{empty}</p>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => onSelect(i.id)}>
                <span>{i.label}</span>
                {i.note && <em>{i.note}</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {onAdd && (
        <button type="button" className="subtle" onClick={onAdd}>
          + {addLabel}
        </button>
      )}
    </section>
  );
}
