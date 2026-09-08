import { newId } from '../../platform/ids';
import type { Diagram as RelationalDiagram } from '../relational/types';
import { readColumn, readColumns } from '../relational/types';
import { makeIndex, makeStore, sizeForIndex } from './factory';
import type { Diagram, DiagramNode, Edge } from './types';

const COL_GAP = 80;
const ROW_GAP = 150;
const INDEX_GAP = 26;

/**
 * Builds a physical model from a relational one.
 *
 * The starting point is the one a DBA would actually begin from: every relation
 * becomes a heap file, its primary key gets a unique clustering index, and each
 * foreign key gets a secondary index, because joins and referential-integrity
 * checks both read through them. Row counts are placeholders — the estimates
 * only mean something once real ones are entered.
 */
export function physicalFromRelational(schema: RelationalDiagram): {
  diagram: Diagram;
  notes: string[];
} {
  const nodes: DiagramNode[] = [];
  const edges: Edge[] = [];
  const notes: string[] = [];

  const perRow = Math.max(1, Math.ceil(Math.sqrt(schema.nodes.length)));
  let cursorX = 0;
  let cursorY = 0;
  let inRow = 0;

  for (const table of schema.nodes) {
    const columns = readColumns(table);
    const store = makeStore(table.name, 0, 0);
    store.x = cursorX + store.w / 2;
    store.y = cursorY + store.h / 2;
    nodes.push(store);

    let indexY = store.y + store.h / 2 + INDEX_GAP + 20;

    const pk = columns.filter((c) => c.pk);
    const keyNames = pk.map((c) => c.name);
    if (pk.length > 0) {
      const names = keyNames;
      const index = makeIndex(`${table.name}_pkey`, names, store.x, indexY, {
        unique: true,
        clustering: true,
        avgKeyBytes: Math.max(4, names.join('').length),
      });
      Object.assign(index, sizeForIndex(index.indexName, names));
      nodes.push(index);
      edges.push({ id: newId('e'), kind: 'indexes', source: index.id, target: store.id });
      indexY += index.h + INDEX_GAP;

      // The key already orders the file, so say so rather than leaving it heap.
      store.organisation = 'clustered';
      store.keyColumns = names;
    } else {
      notes.push(`“${table.name}” has no primary key, so it was left as a heap with no index.`);
    }

    // One secondary index per foreign key: joins and integrity checks read it.
    for (const e of schema.edges) {
      if (e.source !== table.id) continue;
      const names = e.columns
        .map((id) => readColumn(table, id)?.name)
        .filter((n): n is string => !!n);
      if (names.length === 0) continue;
      // A subclass table's foreign key is its primary key, so the clustering
      // index already serves it. A second identical index would cost storage
      // and slow every write for nothing.
      if (
        names.length === keyNames.length &&
        names.every((n, i) => n === keyNames[i])
      ) {
        continue;
      }
      const index = makeIndex(
        `${table.name}_${names.join('_')}_idx`,
        names,
        store.x,
        indexY,
        { avgKeyBytes: Math.max(4, names.join('').length) },
      );
      Object.assign(index, sizeForIndex(index.indexName, names));
      nodes.push(index);
      edges.push({ id: newId('e'), kind: 'indexes', source: index.id, target: store.id });
      indexY += index.h + INDEX_GAP;
    }

    cursorX += Math.max(store.w, 260) + COL_GAP;
    inRow += 1;
    if (inRow >= perRow) {
      inRow = 0;
      cursorX = 0;
      cursorY += ROW_GAP + 3 * 90;
    }
  }

  notes.push(
    'Row counts and record sizes are placeholders. The cost estimates only mean anything once you replace them with figures from the real data.',
  );

  return { diagram: { nodes, edges }, notes };
}
