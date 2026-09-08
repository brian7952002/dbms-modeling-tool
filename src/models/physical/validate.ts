import type { Issue, Severity, ValidationContext } from '../../ecosystem/registry';
import type { Diagram as RelationalDiagram } from '../relational/types';
import { readColumns } from '../relational/types';
import { indexesOf, isIndex, isStore, storeOf, type Diagram, type Id } from './types';

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Checks a physical design for the mistakes that make it either impossible or
 * pointless: two clustering indexes on one file, a hash file asked to serve
 * ranges, an index on a column the table does not have.
 */
export function validate(d: Diagram, context: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, message: string, targets: Id[]) =>
    issues.push({ id: `${severity}:${targets.join(',')}:${message}`, severity, message, targets });

  const stores = d.nodes.filter(isStore);
  const indexes = d.nodes.filter(isIndex);
  const schema = (context.source ?? null) as RelationalDiagram | null;

  const byName = new Map<string, Id[]>();
  for (const s of stores) {
    const key = norm(s.tableName || s.name);
    if (!key) {
      add('error', 'A stored file needs a table name.', [s.id]);
      continue;
    }
    byName.set(key, [...(byName.get(key) ?? []), s.id]);
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) add('error', `${ids.length} stored files are named “${name}”.`, ids);
  }

  for (const s of stores) {
    if (s.estimatedRows <= 0) {
      add('info', `“${s.name}” has no row estimate, so its cost cannot be worked out.`, [s.id]);
    }
    if (s.avgRowBytes <= 0) {
      add('error', `“${s.name}” needs an average record size above zero.`, [s.id]);
    }
    if (s.avgRowBytes > s.blockSize) {
      add(
        'error',
        `A record of “${s.name}” is ${s.avgRowBytes} B but a block is ${s.blockSize} B; records must fit inside a block or be spanned.`,
        [s.id],
      );
    }
    if (s.fillFactor <= 0 || s.fillFactor > 1) {
      add('error', `The fill factor of “${s.name}” must be between 0 and 1.`, [s.id]);
    }
    if (s.organisation !== 'heap' && s.keyColumns.length === 0) {
      add(
        'error',
        `“${s.name}” is ${s.organisation} but no key columns are given; ${s.organisation === 'hash' ? 'a hash file needs a hash key' : 'an ordered file needs an ordering key'}.`,
        [s.id],
      );
    }

    const attached = indexesOf(d, s.id);
    const clustering = attached.filter((i) => i.clustering);
    // Only one physical order is possible, so only one index can define it.
    if (clustering.length > 1) {
      add(
        'error',
        `“${s.name}” has ${clustering.length} clustering indexes. A file has one physical order, so only one index can determine it.`,
        [s.id, ...clustering.map((i) => i.id)],
      );
    }
    if (s.organisation === 'hash' && clustering.length > 0) {
      add(
        'warning',
        `“${s.name}” is hashed, so its order is already fixed by the hash; a clustering index on it does nothing.`,
        [s.id, ...clustering.map((i) => i.id)],
      );
    }
    if (attached.length === 0 && s.organisation === 'heap' && s.estimatedRows > 1000) {
      add(
        'warning',
        `“${s.name}” is a heap with no index, so every lookup is a full scan of about ${Math.max(1, Math.round(s.estimatedRows / 100))} blocks.`,
        [s.id],
      );
    }

    const seen = new Map<string, Id[]>();
    for (const i of attached) {
      const key = `${i.type}:${i.columns.map(norm).join(',')}`;
      seen.set(key, [...(seen.get(key) ?? []), i.id]);
    }
    for (const [, ids] of seen) {
      if (ids.length > 1) {
        add(
          'warning',
          `“${s.name}” has ${ids.length} identical indexes; each one costs storage and slows every write.`,
          ids,
        );
      }
    }
  }

  for (const i of indexes) {
    if (!i.indexName.trim()) add('error', 'An index needs a name.', [i.id]);
    if (i.columns.length === 0) {
      add('error', `Index “${i.name}” has no columns.`, [i.id]);
    }
    const store = storeOf(d, i.id);
    if (!store) {
      add('error', `Index “${i.name}” is not attached to a stored file.`, [i.id]);
      continue;
    }
    if (i.type === 'hash' && i.clustering) {
      add(
        'warning',
        `“${i.name}” is a hash index, which has no order to cluster by.`,
        [i.id],
      );
    }
    if (i.type === 'bitmap' && i.unique) {
      add(
        'warning',
        `“${i.name}” is a bitmap index marked unique; bitmaps suit low-cardinality columns, which unique ones are not.`,
        [i.id],
      );
    }
    if (i.avgKeyBytes <= 0) {
      add('error', `Index “${i.name}” needs an average key size above zero.`, [i.id]);
    }
  }

  /* ---- against the logical model ---------------------------------------- */

  if (schema) {
    const tables = new Map(schema.nodes.map((t) => [norm(t.name), t]));

    for (const s of stores) {
      const table = tables.get(norm(s.tableName || s.name));
      if (!table) {
        add(
          'error',
          `No table named “${s.tableName || s.name}” exists in the linked relational schema.`,
          [s.id],
        );
        continue;
      }
      const columnNames = new Set(readColumns(table).map((c) => norm(c.name)));

      for (const key of s.keyColumns) {
        if (!columnNames.has(norm(key))) {
          add('error', `“${s.name}” is keyed on “${key}”, which is not a column of ${table.name}.`, [s.id]);
        }
      }

      for (const i of indexesOf(d, s.id)) {
        for (const column of i.columns) {
          if (!columnNames.has(norm(column))) {
            add(
              'error',
              `Index “${i.name}” is on “${column}”, which is not a column of ${table.name}.`,
              [i.id],
            );
          }
        }
      }

      // A primary key with no access path means every lookup is a scan.
      const pk = readColumns(table).filter((c) => c.pk).map((c) => norm(c.name));
      if (pk.length > 0) {
        const covered = indexesOf(d, s.id).some((i) => {
          const cols = i.columns.map(norm);
          return pk.every((c, n) => cols[n] === c);
        });
        const keyed = s.organisation !== 'heap' && pk.every((c, n) => norm(s.keyColumns[n] ?? '') === c);
        if (!covered && !keyed) {
          add(
            'warning',
            `Nothing gives fast access to ${table.name}’s primary key (${pk.join(', ')}), so key lookups and referential-integrity checks scan the file.`,
            [s.id],
          );
        }
      }
    }

    const drawn = new Set(stores.map((s) => norm(s.tableName || s.name)));
    const missing = schema.nodes.filter((t) => !drawn.has(norm(t.name)));
    if (missing.length > 0 && stores.length > 0) {
      add(
        'info',
        `Not stored anywhere: ${missing.map((t) => t.name).join(', ')}.`,
        [],
      );
    }
  } else if (d.nodes.length > 0) {
    add(
      'info',
      'No relational schema is linked, so column names and coverage are not being checked. Link one to check the design against the tables it stores.',
      [],
    );
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const uniq = new Map<string, Issue>();
  for (const i of issues) uniq.set(i.id, i);
  return [...uniq.values()].sort((a, b) => order[a.severity] - order[b.severity]);
}
