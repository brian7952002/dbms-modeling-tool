import type { Decorations, ModelTool } from '../../ecosystem/registry';
import { companySample } from '../eer/samples';
import { relationalFromEer } from '../relational/fromEer';
import { physicalFromRelational } from './fromRelational';
import { estimateIndex, estimateStore } from './estimates';
import { validate } from './validate';
import {
  createEdge,
  createNode,
  inferEdge,
  physicalOutline,
  sizeForIndex,
  sizeForStore,
} from './factory';
import { diagramCss } from './styles';
import { NodeShape } from './NodeShape';
import { EdgeShape } from './EdgeShape';
import { Inspector } from './Inspector';
import { Help } from './Help';
import { PALETTE } from './palette';
import { emptyDiagram, storeOf, type Diagram, type DiagramNode, type Edge, type Id } from './types';

/**
 * Works out the sizing and cost figures once per diagram. They depend on the
 * store an index sits on, so no shape can compute its own.
 */
function decorate(diagram: Diagram): Decorations {
  const nodes = new Map<Id, Record<string, unknown>>();
  const edges = new Map<Id, Record<string, unknown>>();

  for (const n of diagram.nodes) {
    if (n.kind === 'store') {
      nodes.set(n.id, { estimate: estimateStore(n) });
    } else {
      const store = storeOf(diagram, n.id);
      nodes.set(n.id, { estimate: store ? estimateIndex(n, store) : null });
    }
  }

  for (const e of diagram.edges) {
    const index = diagram.nodes.find((n) => n.id === e.source);
    edges.set(e.id, { clustering: index?.kind === 'index' && index.clustering });
  }

  return { nodes, edges };
}

export const physicalModel: ModelTool<DiagramNode, Edge> = {
  id: 'physical',
  label: 'Physical — storage and access',
  blurb:
    'How each relation is stored and reached: file organisation, indexes, and the block-access cost of finding a record.',
  glyph: '⛁',
  stage: 'physical',
  derivesFrom: 'relational',

  createEmpty: emptyDiagram,
  samples: [
    {
      id: 'company',
      title: 'Company schema, stored',
      blurb: 'The company tables as files, each with a clustering key and foreign-key indexes.',
      build: () => physicalFromRelational(relationalFromEer(companySample()).diagram).diagram,
    },
  ],
  palette: PALETTE,

  css: diagramCss,
  outline: physicalOutline,
  decorate,

  NodeShape,
  EdgeShape,
  Inspector,
  Help,

  inferEdge: (a, b, diagram) => inferEdge(a, b, diagram),
  createNode: (kind, x, y) => createNode(kind as DiagramNode['kind'], x, y),
  createEdge: (source, target, kind) => createEdge(source, target, kind as Edge['kind']),
  sizeFor: (node, name) =>
    node.kind === 'store' ? sizeForStore(name) : sizeForIndex(name, node.columns),

  validate,
};

export { physicalFromRelational };
