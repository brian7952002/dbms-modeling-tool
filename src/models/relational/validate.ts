import type { Issue, Severity } from '../../ecosystem/registry';
import { readColumn, readColumns, type Diagram, type Id } from './types';

/**
 * Checks a relational schema is well formed: every relation keyed, every
 * foreign key pointing at something it can actually reference, no duplicate
 * names. These are the mistakes that make a schema fail at `CREATE TABLE`
 * time rather than at design time.
 */
export function validate(d: Diagram): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, message: string, targets: Id[]) =>
    issues.push({ id: `${severity}:${targets.join(',')}:${message}`, severity, message, targets });

  const byName = new Map<string, Id[]>();
  for (const t of d.nodes) {
    const key = t.name.trim().toLowerCase();
    if (!key) {
      add('error', 'A table needs a name.', [t.id]);
      continue;
    }
    byName.set(key, [...(byName.get(key) ?? []), t.id]);
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) add('error', `${ids.length} tables are named “${name}”.`, ids);
  }

  for (const t of d.nodes) {
    const columns = readColumns(t);

    if (columns.length === 0) {
      add('error', `Table “${t.name}” has no columns.`, [t.id]);
      continue;
    }

    if (columns.every((c) => !c.pk)) {
      add(
        'error',
        `Table “${t.name}” has no primary key. Every relation needs one.`,
        [t.id],
      );
    }

    const seen = new Map<string, number>();
    for (const c of columns) {
      if (!c.name.trim()) {
        add('error', `A column in “${t.name}” has no name.`, [t.id]);
        continue;
      }
      const key = c.name.trim().toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (!c.dataType.trim()) {
        add('warning', `Column “${t.name}.${c.name}” has no data type.`, [t.id]);
      }
      // A key column that admits nulls cannot identify anything.
      if (c.pk && !c.notNull) {
        add(
          'warning',
          `Primary key column “${t.name}.${c.name}” is nullable; key columns are implicitly NOT NULL.`,
          [t.id],
        );
      }
    }
    for (const [name, count] of seen) {
      if (count > 1) {
        add('error', `Table “${t.name}” has ${count} columns named “${name}”.`, [t.id]);
      }
    }
  }

  for (const e of d.edges) {
    const child = d.nodes.find((n) => n.id === e.source);
    const parent = d.nodes.find((n) => n.id === e.target);
    if (!child || !parent) continue;
    const where = `${child.name} → ${parent.name}`;

    if (e.columns.length === 0) {
      add(
        'error',
        `The foreign key ${where} has no columns. Choose which columns reference which.`,
        [e.id],
      );
      continue;
    }
    if (e.columns.length !== e.references.length) {
      add(
        'error',
        `The foreign key ${where} maps ${e.columns.length} columns onto ${e.references.length}.`,
        [e.id],
      );
      continue;
    }

    const parentKey = readColumns(parent).filter((c) => c.pk);
    const referenced = e.references.map((id) => readColumn(parent, id));
    if (referenced.some((c) => !c)) {
      add('error', `The foreign key ${where} references a column that no longer exists.`, [e.id]);
      continue;
    }

    // Referencing something that is not unique cannot identify one row.
    const allKeyed = referenced.every((c) => c?.pk || c?.unique);
    if (!allKeyed) {
      add(
        'error',
        `The foreign key ${where} references ${referenced.map((c) => c?.name).join(', ')}, which is neither a primary key nor unique.`,
        [e.id],
      );
    } else if (
      referenced.every((c) => c?.pk) &&
      referenced.length !== parentKey.length
    ) {
      add(
        'warning',
        `The foreign key ${where} references part of ${parent.name}’s key, not all of it.`,
        [e.id],
      );
    }

    for (let i = 0; i < e.columns.length; i++) {
      const from = readColumn(child, e.columns[i]);
      const to = referenced[i];
      if (!from) {
        add('error', `The foreign key ${where} uses a column that no longer exists.`, [e.id]);
        continue;
      }
      if (to && from.dataType.trim().toLowerCase() !== to.dataType.trim().toLowerCase()) {
        add(
          'warning',
          `${child.name}.${from.name} is ${from.dataType} but ${parent.name}.${to.name} is ${to.dataType}; a foreign key should match its referenced type.`,
          [e.id],
        );
      }
    }
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const uniq = new Map<string, Issue>();
  for (const i of issues) uniq.set(i.id, i);
  return [...uniq.values()].sort((a, b) => order[a.severity] - order[b.severity]);
}
