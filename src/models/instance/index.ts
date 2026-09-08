import type { Decorations, ModelTool } from '../../ecosystem/registry';
import type { Diagram, DiagramNode, Edge, Id } from './types';
import { emptyDiagram } from './types';
import { createEdge, createNode, inferEdge, instanceOutline, sizeFor } from './factory';
import { validate } from './validate';
import { worksForSample } from './samples';
import { diagramCss } from './styles';
import { NodeShape } from './NodeShape';
import { EdgeShape } from './EdgeShape';
import { Inspector } from './Inspector';
import { Help } from './Help';
import { PALETTE } from './palette';

/**
 * Names each relationship link — but only when there is more than one
 * relationship set to tell apart. With a single set the legend already says
 * it, and repeating the name on every line is noise.
 */
function decorate(diagram: Diagram): Decorations {
  const relSets = diagram.nodes.filter(
    (n): n is Extract<DiagramNode, { kind: 'rel-set' }> => n.kind === 'rel-set',
  );
  const edges = new Map<Id, Record<string, unknown>>();
  if (relSets.length < 2) return { nodes: new Map(), edges };

  const relNames = new Map<Id, string>(
    relSets.map((n) => [n.id, n.relationshipName || n.name]),
  );
  for (const e of diagram.edges) {
    if (e.kind === 'instance-link' && e.relSetId) {
      const name = relNames.get(e.relSetId);
      if (name) edges.set(e.id, { relationshipName: name });
    }
  }
  return { nodes: new Map(), edges };
}

export const instanceModel: ModelTool<DiagramNode, Edge> = {
  id: 'instance',
  label: 'Conceptual — instance diagram',
  blurb:
    'Sample rows for a schema. The fastest way to find out whether a constraint says what you meant it to say.',
  glyph: '⁘',
  stage: 'conceptual',
  derivesFrom: 'eer',

  createEmpty: emptyDiagram,
  samples: [
    {
      id: 'works-for',
      title: 'WORKS_FOR as data',
      blurb: 'Four employees across two departments — a legal instance of a 1:N relationship.',
      build: worksForSample,
    },
  ],
  palette: PALETTE,

  css: diagramCss,
  outline: instanceOutline,
  decorate,

  NodeShape,
  EdgeShape,
  Inspector,
  Help,

  inferEdge: (a, b, diagram) => inferEdge(a, b, diagram),
  createEdge: (source, target, kind) => createEdge(source, target, kind as Edge['kind']),
  createNode: (kind, x, y) => createNode(kind as DiagramNode['kind'], x, y),
  // An instance dot is a fixed size; the other two grow to fit their label.
  sizeFor: (node, name) =>
    node.kind === 'instance' ? null : sizeFor(node.kind as DiagramNode['kind'], name),

  validate,
};
