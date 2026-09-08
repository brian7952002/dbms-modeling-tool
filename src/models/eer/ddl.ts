import type { AttributeNode, Diagram, Edge, EntityNode, Id } from './types';
import {
  attributesOf,
  entities,
  identifyingOwner,
  isaNodes,
  isaParentsOf,
  keyAttributes,
  leafColumns,
  participantsOf,
  partialKeyAttributes,
  relationships,
  subclassesOf,
  superclassOf,
  unionCategory,
  unionNodes,
  unionSuperclasses,
} from './graph';

/* -------------------------------------------------------------------------- */
/* Relational schema representation                                           */
/* -------------------------------------------------------------------------- */

interface Column {
  name: string;
  type: string;
  notNull: boolean;
  comment?: string;
}

interface ForeignKey {
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete?: string;
}

interface Table {
  name: string;
  columns: Column[];
  pk: string[];
  fks: ForeignKey[];
  uniques: string[][];
  checks: string[];
  comment?: string;
}

export interface DdlResult {
  sql: string;
  notes: string[];
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Naming                                                                     */
/* -------------------------------------------------------------------------- */

function ident(raw: string): string {
  const s = raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return s || 'unnamed';
}

const RESERVED = new Set([
  'order', 'group', 'user', 'table', 'select', 'from', 'where', 'index',
  'key', 'primary', 'foreign', 'check', 'default', 'column', 'view', 'grant',
  'end', 'start', 'date', 'time', 'value', 'values', 'level', 'natural',
]);

/** Adds a suffix rather than quoting, so the output pastes into any dialect. */
function safeIdent(raw: string): string {
  const s = ident(raw);
  return RESERVED.has(s) ? `${s}_` : s;
}

/**
 * Qualifies a borrowed key column with the table it came from, without
 * stuttering: OWNER's `owner_id` stays `owner_id` rather than becoming
 * `owner_owner_id`.
 */
function prefixed(prefix: string, column: string): string {
  const p = ident(prefix);
  return column === p || column.startsWith(`${p}_`) ? column : `${p}_${column}`;
}

/** "a employee" reads badly in a generated comment; this fixes the article. */
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

function uniqueName(taken: Set<string>, base: string): string {
  let name = base;
  let i = 2;
  while (taken.has(name)) name = `${base}_${i++}`;
  taken.add(name);
  return name;
}

/* -------------------------------------------------------------------------- */
/* Cardinality normalisation                                                  */
/* -------------------------------------------------------------------------- */

/**
 * "Functional" means one instance of this entity takes part in at most one
 * instance of the relationship, so the entity's own table can hold the foreign
 * key.
 *
 * Chen ratio labels and (min,max) constraints read in opposite directions, so
 * both notations are normalised here before anything downstream looks at them.
 * In `A --1-- R --N-- B`, one A has N Bs, so it is B that is functional; in
 * `A --(1,N)-- R --(1,1)-- B` the (1,1) sits on B and again marks B functional.
 */
export function functionalSides(e1: Edge, e2: Edge): [boolean, boolean] {
  const byMinMax = (e: Edge) => (e.max === null ? false : (e.max ?? 1) <= 1);
  if (e1.showMinMax && e2.showMinMax) return [byMinMax(e1), byMinMax(e2)];

  const c1 = e1.showMinMax ? (byMinMax(e1) ? 'N' : '1') : e1.cardinality ?? 'N';
  const c2 = e2.showMinMax ? (byMinMax(e2) ? 'N' : '1') : e2.cardinality ?? 'N';
  const ones = (c1 === '1' ? 1 : 0) + (c2 === '1' ? 1 : 0);
  if (ones === 2) return [true, true]; // 1:1
  if (ones === 0) return [false, false]; // M:N
  return [c1 !== '1', c2 !== '1']; // 1:N — the N-labelled side is functional
}

export const isTotal = (e: Edge) =>
  e.total === true || (e.showMinMax === true && (e.min ?? 0) >= 1);

/* -------------------------------------------------------------------------- */
/* Generator                                                                  */
/* -------------------------------------------------------------------------- */

export function generateDdl(d: Diagram, title = 'EER Model'): DdlResult {
  const notes: string[] = [];
  const warnings: string[] = [];
  const tables: Table[] = [];
  const tableNames = new Set<string>();
  /** entity id -> its table */
  const entityTable = new Map<Id, Table>();
  /** Extra superclass links, added once every primary key is resolved. */
  const sharedSubclasses: { entity: EntityNode; extraParents: { id: Id }[] }[] = [];

  const tableNameFor = (raw: string) => uniqueName(tableNames, safeIdent(raw));

  const newTable = (raw: string, comment?: string): Table => {
    const t: Table = {
      name: tableNameFor(raw),
      columns: [],
      pk: [],
      fks: [],
      uniques: [],
      checks: [],
      comment,
    };
    tables.push(t);
    return t;
  };

  const addColumn = (t: Table, col: Column): string => {
    const taken = new Set(t.columns.map((c) => c.name));
    const name = uniqueName(taken, safeIdent(col.name));
    t.columns.push({ ...col, name });
    return name;
  };

  /* ---- Pass 1: one table per entity ------------------------------------ */

  for (const e of entities(d)) {
    const t = newTable(e.name, e.weak ? 'weak entity' : undefined);
    entityTable.set(e.id, t);
  }

  /** Primary key columns of an entity, resolved through ISA / weak / category. */
  const pkCache = new Map<Id, { name: string; type: string }[]>();
  const resolving = new Set<Id>();

  function pkOf(entity: EntityNode): { name: string; type: string }[] {
    const cached = pkCache.get(entity.id);
    if (cached) return cached;
    if (resolving.has(entity.id)) {
      warnings.push(
        `Could not resolve the primary key of "${entity.name}" because its inheritance forms a cycle.`,
      );
      return [];
    }
    resolving.add(entity.id);
    const result = computePk(entity);
    resolving.delete(entity.id);
    pkCache.set(entity.id, result);
    return result;
  }

  function computePk(entity: EntityNode): { name: string; type: string }[] {
    const t = entityTable.get(entity.id)!;

    // Subclass: inherits the superclass key. A shared subclass has several
    // parents; the first supplies the key and the rest become plain foreign
    // keys, which is the usual mapping for multiple inheritance.
    const parents = isaParentsOf(d, entity.id);
    const isa = parents[0];
    if (isa) {
      const sup = superclassOf(d, isa.id);
      if (sup) {
        const supPk = pkOf(sup);
        const supTable = entityTable.get(sup.id)!;
        const cols = supPk.map((c) => ({
          name: addColumn(t, {
            name: c.name,
            type: c.type,
            notNull: true,
            comment: `inherited from ${supTable.name}`,
          }),
          type: c.type,
        }));
        if (cols.length > 0) {
          t.fks.push({
            columns: cols.map((c) => c.name),
            refTable: supTable.name,
            refColumns: supPk.map((c) => c.name),
            onDelete: 'CASCADE',
          });
        }
        if (parents.length > 1) {
          notes.push(
            `"${entity.name}" is a shared subclass of ${parents.length} specialisations; it takes its key from "${sup.name}" and references the other superclasses separately.`,
          );
          sharedSubclasses.push({ entity, extraParents: parents.slice(1) });
        }
        return cols;
      }
    }

    // Category (union type): a surrogate key plus optional links to superclasses.
    const union = unionNodes(d).find((u) => unionCategory(d, u.id)?.id === entity.id);
    if (union) {
      const own = keyAttributes(d, entity.id);
      if (own.length === 0) {
        const name = addColumn(t, {
          name: `${ident(entity.name)}_id`,
          type: 'INTEGER',
          notNull: true,
          comment: 'surrogate key for the category type',
        });
        notes.push(
          `"${entity.name}" is a union (category) type, so it was given the surrogate key ${t.name}.${name}; its superclass links are nullable and mutually exclusive.`,
        );
        return [{ name, type: 'INTEGER' }];
      }
    }

    // Weak entity: owner key + partial key.
    if (entity.weak) {
      const owner = identifyingOwner(d, entity.id);
      const cols: { name: string; type: string }[] = [];
      if (owner) {
        const ownerPk = pkOf(owner.owner);
        const ownerTable = entityTable.get(owner.owner.id)!;
        const fkCols = ownerPk.map((c) => ({
          name: addColumn(t, {
            name: prefixed(owner.owner.name, c.name),
            type: c.type,
            notNull: true,
            comment: `identifying owner (${owner.rel.name})`,
          }),
          type: c.type,
        }));
        if (fkCols.length > 0) {
          t.fks.push({
            columns: fkCols.map((c) => c.name),
            refTable: ownerTable.name,
            refColumns: ownerPk.map((c) => c.name),
            onDelete: 'CASCADE',
          });
        }
        cols.push(...fkCols);
      } else {
        warnings.push(
          `Weak entity "${entity.name}" has no identifying relationship, so its key is incomplete.`,
        );
      }
      for (const pk of partialKeyAttributes(d, entity.id)) {
        for (const leaf of leafColumns(d, pk)) {
          cols.push({
            name: addColumn(t, {
              name: leaf.column,
              type: leaf.attr.dataType,
              notNull: true,
              comment: 'partial key (discriminator)',
            }),
            type: leaf.attr.dataType,
          });
        }
      }
      return cols;
    }

    // Ordinary strong entity.
    const keys = keyAttributes(d, entity.id);
    if (keys.length === 0) {
      const name = addColumn(t, {
        name: `${ident(entity.name)}_id`,
        type: 'INTEGER',
        notNull: true,
        comment: 'surrogate key — no key attribute was declared',
      });
      warnings.push(
        `Entity "${entity.name}" has no key attribute; a surrogate key ${t.name}.${name} was generated.`,
      );
      return [{ name, type: 'INTEGER' }];
    }
    const cols: { name: string; type: string }[] = [];
    for (const k of keys) {
      for (const leaf of leafColumns(d, k)) {
        cols.push({
          name: addColumn(t, {
            name: leaf.column,
            type: leaf.attr.dataType,
            notNull: true,
          }),
          type: leaf.attr.dataType,
        });
      }
    }
    return cols;
  }

  // Resolve every primary key first so that later foreign keys can reference it.
  for (const e of entities(d)) {
    const t = entityTable.get(e.id)!;
    t.pk = pkOf(e).map((c) => c.name);
  }

  // Extra parents of a shared subclass, now that every key is known.
  for (const { entity, extraParents } of sharedSubclasses) {
    const t = entityTable.get(entity.id)!;
    for (const parent of extraParents) {
      const sup = superclassOf(d, parent.id);
      if (!sup) continue;
      const supPk = pkOf(sup);
      const supTable = entityTable.get(sup.id)!;
      const cols = supPk.map((c) =>
        addColumn(t, {
          name: prefixed(sup.name, c.name),
          type: c.type,
          notNull: true,
          comment: `also a subclass of ${supTable.name}`,
        }),
      );
      if (cols.length > 0) {
        t.fks.push({
          columns: cols,
          refTable: supTable.name,
          refColumns: supPk.map((c) => c.name),
          onDelete: 'CASCADE',
        });
      }
    }
  }

  /* ---- Pass 2: non-key attributes and multivalued attribute tables ------ */

  const multivaluedTables: Table[] = [];

  const emitOwnedAttributes = (
    ownerName: string,
    ownerId: Id,
    t: Table,
    ownerPk: { name: string; type: string }[],
  ) => {
    for (const a of attributesOf(d, ownerId)) {
      if (a.key || a.partialKey) continue; // already part of the key
      if (a.derived) {
        notes.push(
          `Derived attribute "${a.name}" on ${ownerName} was not stored${
            a.derivation ? ` (${a.derivation})` : ''
          }; compute it in a view or query.`,
        );
        continue;
      }
      if (a.multivalued) {
        const mv = newTable(`${ownerName}_${a.name}`, 'multivalued attribute');
        multivaluedTables.push(mv);
        const fkCols = ownerPk.map((c) => ({
          name: addColumn(mv, { name: prefixed(ownerName, c.name), type: c.type, notNull: true }),
          type: c.type,
        }));
        if (fkCols.length > 0) {
          mv.fks.push({
            columns: fkCols.map((c) => c.name),
            refTable: t.name,
            refColumns: ownerPk.map((c) => c.name),
            onDelete: 'CASCADE',
          });
        }
        const valueCols = leafColumns(d, a).map((leaf) =>
          addColumn(mv, { name: leaf.column, type: leaf.attr.dataType, notNull: true }),
        );
        mv.pk = [...fkCols.map((c) => c.name), ...valueCols];
        notes.push(
          `Multivalued attribute "${a.name}" became its own table ${mv.name}.`,
        );
        continue;
      }
      for (const leaf of leafColumns(d, a)) {
        addColumn(t, {
          name: leaf.column,
          type: leaf.attr.dataType,
          notNull: !leaf.attr.nullable,
          comment:
            leaf.column !== leaf.attr.name ? `component of composite attribute` : undefined,
        });
      }
    }
  };

  for (const e of entities(d)) {
    const t = entityTable.get(e.id)!;
    emitOwnedAttributes(e.name, e.id, t, pkOf(e));
  }

  /* ---- Pass 3: relationships ------------------------------------------- */

  /** Adds one participant's key to a table as a foreign key column group. */
  const addParticipantFk = (
    t: Table,
    entity: EntityNode,
    prefix: string,
    notNull: boolean,
    comment?: string,
  ): string[] => {
    const pk = pkOf(entity);
    const refTable = entityTable.get(entity.id)!;
    const cols = pk.map((c) =>
      addColumn(t, {
        name: prefixed(prefix, c.name),
        type: c.type,
        notNull,
        comment,
      }),
    );
    if (cols.length > 0) {
      t.fks.push({
        columns: cols,
        refTable: refTable.name,
        refColumns: pk.map((c) => c.name),
      });
    }
    return cols;
  };

  for (const r of relationships(d)) {
    const parts = participantsOf(d, r.id);
    if (parts.length < 2) {
      if (parts.length === 1) {
        warnings.push(
          `Relationship "${r.name}" has a single leg and was skipped.`,
        );
      }
      continue;
    }

    const relAttrs = attributesOf(d, r.id);

    // Identifying relationships are already represented by the weak entity's
    // borrowed key columns.
    if (r.identifying && parts.some((p) => p.entity.weak) && parts.length === 2) {
      if (relAttrs.length > 0) {
        warnings.push(
          `Attributes on identifying relationship "${r.name}" were not mapped; move them onto the weak entity.`,
        );
      }
      notes.push(
        `Identifying relationship "${r.name}" is represented by the borrowed key columns on the weak entity.`,
      );
      continue;
    }

    const recursive =
      new Set(parts.map((p) => p.entity.id)).size < parts.length;

    if (parts.length === 2) {
      const [p1, p2] = parts;
      const [f1, f2] = functionalSides(p1.edge, p2.edge);

      // ---- 1:1 -----------------------------------------------------------
      if (f1 && f2) {
        // Prefer the side with total participation, per the standard mapping.
        const holderIsFirst = isTotal(p1.edge) || !isTotal(p2.edge);
        const holder = holderIsFirst ? p1 : p2;
        const other = holderIsFirst ? p2 : p1;
        if (recursive) {
          warnings.push(
            `Recursive 1:1 relationship "${r.name}" was mapped as a self-referencing column; check the result.`,
          );
        }
        const t = entityTable.get(holder.entity.id)!;
        const prefix = other.edge.role?.trim() || `${other.entity.name}_${r.name}`;
        const cols = addParticipantFk(
          t,
          other.entity,
          prefix,
          isTotal(holder.edge),
          `1:1 "${r.name}"`,
        );
        if (cols.length > 0) t.uniques.push(cols);
        for (const a of relAttrs) {
          if (a.multivalued || a.derived) continue;
          for (const leaf of leafColumns(d, a)) {
            addColumn(t, {
              name: leaf.column,
              type: leaf.attr.dataType,
              notNull: false,
              comment: `attribute of "${r.name}"`,
            });
          }
        }
        notes.push(
          `1:1 relationship "${r.name}" became a unique foreign key on ${t.name}.`,
        );
        continue;
      }

      // ---- 1:N -----------------------------------------------------------
      if (f1 !== f2) {
        const many = f1 ? p1 : p2; // functional side holds the foreign key
        const one = f1 ? p2 : p1;
        const t = entityTable.get(many.entity.id)!;
        const prefix = one.edge.role?.trim() || (recursive ? `${r.name}` : one.entity.name);
        const cols = addParticipantFk(
          t,
          one.entity,
          prefix,
          isTotal(many.edge),
          recursive ? `recursive "${r.name}"` : `"${r.name}"`,
        );
        for (const a of relAttrs) {
          if (a.multivalued || a.derived) continue;
          for (const leaf of leafColumns(d, a)) {
            addColumn(t, {
              name: leaf.column,
              type: leaf.attr.dataType,
              notNull: false,
              comment: `attribute of "${r.name}"`,
            });
          }
        }
        notes.push(
          `1:N relationship "${r.name}" became foreign key ${t.name}.(${cols.join(', ')}) referencing ${
            entityTable.get(one.entity.id)!.name
          }.`,
        );
        continue;
      }
    }

    // ---- M:N and n-ary ---------------------------------------------------
    const t = newTable(
      recursive ? `${r.name}` : parts.map((p) => p.entity.name).join('_'),
      parts.length > 2 ? `${parts.length}-ary relationship` : 'M:N relationship',
    );
    const pkCols: string[] = [];
    const usedPrefixes = new Set<string>();
    parts.forEach((p, i) => {
      let prefix = p.edge.role?.trim() || p.entity.name;
      if (usedPrefixes.has(ident(prefix))) prefix = `${prefix}_${i + 1}`;
      usedPrefixes.add(ident(prefix));
      pkCols.push(...addParticipantFk(t, p.entity, prefix, true));
    });
    t.pk = pkCols;
    for (const a of relAttrs) {
      if (a.derived) {
        notes.push(`Derived attribute "${a.name}" on "${r.name}" was not stored.`);
        continue;
      }
      if (a.multivalued) {
        warnings.push(
          `Multivalued attribute "${a.name}" on relationship "${r.name}" needs its own table; add it manually.`,
        );
        continue;
      }
      for (const leaf of leafColumns(d, a)) {
        addColumn(t, {
          name: leaf.column,
          type: leaf.attr.dataType,
          notNull: !leaf.attr.nullable,
        });
      }
    }
    notes.push(
      `${parts.length > 2 ? `${parts.length}-ary` : 'M:N'} relationship "${r.name}" became the junction table ${t.name}.`,
    );
  }

  /* ---- Pass 4: specialisation and union constraints --------------------- */

  for (const isa of isaNodes(d)) {
    const sup = superclassOf(d, isa.id);
    const subs = subclassesOf(d, isa.id);
    if (!sup || subs.length === 0) continue;
    const supTable = entityTable.get(sup.id)!;
    const subNames = subs.map((s) => entityTable.get(s.id)!.name);
    notes.push(
      `Specialisation of "${sup.name}" (${isa.disjoint ? 'disjoint' : 'overlapping'}, ${
        isa.total ? 'total' : 'partial'
      }) mapped to one table per subclass: ${subNames.join(', ')}.`,
    );
    if (isa.total) {
      warnings.push(
        `Total specialisation of "${sup.name}" means every ${supTable.name} row must appear in at least one of ${subNames.join(
          ', ',
        )}. SQL cannot express that as a constraint — enforce it with a trigger or in application code.`,
      );
    }
    if (isa.disjoint && subs.length > 1) {
      warnings.push(
        `Disjoint specialisation of "${sup.name}" means ${article(supTable.name)} ${
          supTable.name
        } row may appear in at most one of ${subNames.join(
          ', ',
        )}. Enforce it with a trigger, or add a type discriminator column.`,
      );
    }
  }

  for (const u of unionNodes(d)) {
    const cat = unionCategory(d, u.id);
    const supers = unionSuperclasses(d, u.id);
    if (!cat || supers.length === 0) continue;
    const t = entityTable.get(cat.id)!;
    const linkCols: string[] = [];
    for (const s of supers) {
      const cols = addParticipantFk(t, s, s.name, false, 'union superclass link');
      linkCols.push(...cols);
    }
    if (linkCols.length > 0) {
      const terms = supers.map((s) => {
        const pk = pkOf(s);
        const first = prefixed(s.name, pk[0]?.name ?? 'id');
        const col = t.columns.find((c) => c.name.startsWith(first))?.name ?? first;
        return `(CASE WHEN ${col} IS NOT NULL THEN 1 ELSE 0 END)`;
      });
      t.checks.push(
        `${terms.join(' + ')} ${u.total ? '=' : '<='} 1`,
      );
      notes.push(
        `Union type "${cat.name}" links to ${supers
          .map((s) => entityTable.get(s.id)!.name)
          .join(', ')} through nullable foreign keys with a mutual-exclusion CHECK${
          u.total ? ' (total: exactly one must be set)' : ''
        }.`,
      );
    }
  }

  /* ---- Emit ------------------------------------------------------------- */

  const lines: string[] = [];
  lines.push(`-- ${title}`);
  lines.push(`-- Generated by EER Diagram Designer on ${new Date().toISOString().slice(0, 10)}`);
  lines.push('-- Generic ANSI SQL; adjust types for your target database.');
  lines.push('');

  if (tables.length === 0) {
    lines.push('-- Nothing to generate: the diagram has no entities yet.');
  }

  for (const t of tables) {
    const body: string[] = [];
    const width = Math.max(0, ...t.columns.map((c) => c.name.length));
    for (const c of t.columns) {
      const pad = ' '.repeat(width - c.name.length);
      body.push(
        `  ${c.name}${pad} ${c.type}${c.notNull ? ' NOT NULL' : ''}${
          c.comment ? `  -- ${c.comment}` : ''
        }`,
      );
    }
    if (t.pk.length > 0) body.push(`  PRIMARY KEY (${t.pk.join(', ')})`);
    for (const u of t.uniques) body.push(`  UNIQUE (${u.join(', ')})`);
    for (const fk of t.fks) {
      body.push(
        `  FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.refTable} (${fk.refColumns.join(
          ', ',
        )})${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ''}`,
      );
    }
    for (const c of t.checks) body.push(`  CHECK (${c})`);

    // Trailing commas go on every line except the last constraint.
    const joined = body
      .map((line, i) => {
        const isLast = i === body.length - 1;
        const commentAt = line.indexOf('  -- ');
        if (isLast) return line;
        if (commentAt >= 0) {
          return `${line.slice(0, commentAt)},${line.slice(commentAt)}`;
        }
        return `${line},`;
      })
      .join('\n');

    if (t.comment) lines.push(`-- ${t.comment}`);
    lines.push(`CREATE TABLE ${t.name} (`);
    lines.push(joined);
    lines.push(');');
    lines.push('');
  }

  if (notes.length > 0) {
    lines.push('-- ---------------------------------------------------------------');
    lines.push('-- Mapping notes');
    lines.push('-- ---------------------------------------------------------------');
    for (const n of notes) lines.push(`--  * ${n}`);
    lines.push('');
  }
  if (warnings.length > 0) {
    lines.push('-- ---------------------------------------------------------------');
    lines.push('-- Warnings');
    lines.push('-- ---------------------------------------------------------------');
    for (const w of warnings) lines.push(`--  ! ${w}`);
    lines.push('');
  }

  return { sql: lines.join('\n'), notes, warnings };
}

/** Exposed for the inspector's data-type dropdown. */
export const COMMON_TYPES = [
  'INTEGER',
  'BIGINT',
  'SMALLINT',
  'DECIMAL(10,2)',
  'NUMERIC(12,4)',
  'REAL',
  'VARCHAR(50)',
  'VARCHAR(255)',
  'CHAR(1)',
  'TEXT',
  'BOOLEAN',
  'DATE',
  'TIME',
  'TIMESTAMP',
  'UUID',
];

export type { AttributeNode };
