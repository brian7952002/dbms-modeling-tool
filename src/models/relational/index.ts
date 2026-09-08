import type { Decorations, ModelTool } from '../../ecosystem/registry';
import { companySample } from '../eer/samples';
import { relationalFromEer } from './fromEer';
import { generateDdl } from './ddl';
import { validate } from './validate';
import {
  createEdge,
  createNode,
  defaultReferences,
  inferEdge,
  relationalOutline,
  sizeForTable,
} from './factory';
import { diagramCss } from './styles';
import { NodeShape } from './NodeShape';
import { EdgeShape } from './EdgeShape';
import { Inspector } from './Inspector';
import { Help } from './Help';
import { PALETTE } from './palette';
import { readColumn, readColumns, type Diagram, type DiagramNode, type Edge, type Id } from './types';

/**
 * Marks which columns take part in a foreign key, and labels each arrow with
 * the columns it maps. Both are properties of the diagram rather than of any
 * one shape, so they are worked out once here.
 */
function decorate(diagram: Diagram): Decorations {
  const nodes = new Map<Id, Record<string, unknown>>();
  const edges = new Map<Id, Record<string, unknown>>();
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const fkColumnsByTable = new Map<Id, Set<string>>();

  for (const e of diagram.edges) {
    const child = byId.get(e.source);
    const parent = byId.get(e.target);
    if (!child || !parent) continue;

    const set = fkColumnsByTable.get(child.id) ?? new Set<string>();
    for (const c of e.columns) set.add(c);
    fkColumnsByTable.set(child.id, set);

    const names = e.columns
      .map((id) => readColumn(child, id)?.name)
      .filter((n): n is string => !!n);
    edges.set(e.id, {
      label: names.length > 0 ? names.join(', ') : undefined,
      incomplete: e.columns.length === 0,
    });
  }

  for (const [tableId, columns] of fkColumnsByTable) {
    nodes.set(tableId, { fkColumns: columns });
  }
  return { nodes, edges };
}

export const relationalModel: ModelTool<DiagramNode, Edge> = {
  id: 'relational',
  label: 'Logical — relational schema',
  blurb:
    'The tables an EER model becomes: relations, columns, keys and referential integrity. Generate it from a conceptual diagram, then refine it.',
  glyph: '▤',
  stage: 'logical',
  derivesFrom: 'eer',

  createEmpty: () => ({ nodes: [], edges: [] }),
  samples: [
    {
      id: 'company',
      title: 'Company schema, mapped',
      blurb: 'The company EER diagram put through the standard mapping.',
      build: () => relationalFromEer(companySample()).diagram,
    },
  ],
  palette: PALETTE,

  css: diagramCss,
  outline: relationalOutline,
  decorate,

  NodeShape,
  EdgeShape,
  Inspector,
  Help,

  inferEdge: (a, b, diagram) => inferEdge(a, b, diagram),
  createNode: (kind, x, y) => createNode(kind as 'table', x, y),
  createEdge: (source, target, kind) => createEdge(source, target, kind as Edge['kind']),
  // A table's box is sized by its columns, not only its name.
  sizeFor: (node, name) => sizeForTable(name, readColumns(node)),

  validate: (diagram) => validate(diagram),

  exports: {
    sql: (diagram, title) => generateDdl(diagram, title),
  },
};

export { defaultReferences, relationalFromEer };
