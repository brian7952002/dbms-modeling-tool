import type { Diagram as EerDiagram } from '../eer/types';
import { mapToRelational } from '../eer/ddl';
import { makeColumn, makeTable } from './factory';
import type { Column, Diagram, Edge, TableNode } from './types';
import { newId } from '../../platform/ids';

const COL_GAP = 90;
const ROW_GAP = 70;

/**
 * Builds a relational diagram from an EER one.
 *
 * The mapping itself is not repeated here: `mapToRelational` already performs
 * the seven-step algorithm — weak entities borrowing their owner's key, 1:N
 * becoming a foreign key on the functional side, M:N and n-ary becoming
 * junction tables, multivalued attributes becoming their own tables,
 * specialisation becoming one table per subclass. This turns that result into
 * shapes and lays them out.
 */
export function relationalFromEer(schema: EerDiagram): {
  diagram: Diagram;
  notes: string[];
  warnings: string[];
} {
  const { tables, notes, warnings } = mapToRelational(schema);

  const nodes: TableNode[] = [];
  const columnIdByTable = new Map<string, Map<string, string>>();

  // Lay out in a grid, widest tables first so the shape of it reads well.
  const ordered = [...tables];
  const perRow = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let inRow = 0;

  for (const table of ordered) {
    const columns: Column[] = table.columns.map((c) =>
      makeColumn({
        name: c.name,
        dataType: c.type,
        notNull: c.notNull,
        pk: table.pk.includes(c.name),
        unique: table.uniques.some((u) => u.length === 1 && u[0] === c.name),
      }),
    );

    const node = makeTable(table.name, 0, 0, columns);
    node.x = cursorX + node.w / 2;
    node.y = cursorY + node.h / 2;
    nodes.push(node);

    const byName = new Map<string, string>();
    table.columns.forEach((c, i) => byName.set(c.name, columns[i].id));
    columnIdByTable.set(table.name, byName);

    rowHeight = Math.max(rowHeight, node.h);
    cursorX += node.w + COL_GAP;
    inRow += 1;
    if (inRow >= perRow) {
      inRow = 0;
      cursorX = 0;
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
  }

  const nodeByName = new Map(nodes.map((n) => [n.name, n]));
  const edges: Edge[] = [];

  for (const table of tables) {
    const child = nodeByName.get(table.name);
    if (!child) continue;
    for (const fk of table.fks) {
      const parent = nodeByName.get(fk.refTable);
      if (!parent) continue;
      const childCols = columnIdByTable.get(table.name);
      const parentCols = columnIdByTable.get(fk.refTable);
      if (!childCols || !parentCols) continue;

      const columns = fk.columns.map((c) => childCols.get(c)).filter((v): v is string => !!v);
      const references = fk.refColumns
        .map((c) => parentCols.get(c))
        .filter((v): v is string => !!v);
      if (columns.length === 0 || columns.length !== references.length) continue;

      edges.push({
        id: newId('e'),
        kind: 'foreign-key',
        source: child.id,
        target: parent.id,
        columns,
        references,
        onDelete: (fk.onDelete as Edge['onDelete']) ?? 'NO ACTION',
      });
    }
  }

  return { diagram: { nodes, edges }, notes, warnings };
}
