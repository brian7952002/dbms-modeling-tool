import type { ModelTool, Decorations, PaletteItem } from '../../ecosystem/registry';
import type { Diagram, DiagramNode, Edge, Id } from './types';
import { emptyDiagram } from './types';
import { createEdge, createNode, inferEdge } from './factory';
import { fitSize } from './sizing';
import { validate } from './validate';
import { generateDdl } from './ddl';
import { categorySample, companySample } from './samples';
import { diagramCss } from './styles';
import { NodeShape } from './NodeShape';
import { EdgeShape } from './EdgeShape';
import { Inspector } from './Inspector';
import { Help } from './Help';
import { PALETTE } from './palette';
import { eerOutline } from './outline';
import { relationalFromEer } from '../relational/fromEer';

/**
 * Everything the shapes need that cannot be read off a single element: which
 * way a specialisation marker points, which connectors are drawn doubled, and
 * the defining attribute of an attribute-defined specialisation.
 *
 * Computed once per diagram so the canvas stays model-agnostic and the shapes
 * stay cheap.
 */
function decorate(diagram: Diagram): Decorations {
  const byId = new Map<Id, DiagramNode>(diagram.nodes.map((n) => [n.id, n]));
  const nodes = new Map<Id, Record<string, unknown>>();
  const edges = new Map<Id, Record<string, unknown>>();

  for (const e of diagram.edges) {
    if (e.kind === 'isa-super') {
      const isa = byId.get(e.target);
      const sup = byId.get(e.source);
      if (isa && sup) {
        // Point a triangle's apex at its superclass.
        const deg = (Math.atan2(sup.y - isa.y, sup.x - isa.x) * 180) / Math.PI + 90;
        nodes.set(isa.id, { ...(nodes.get(isa.id) ?? {}), isaAngle: deg });
        if (isa.kind === 'isa' && isa.total) edges.set(e.id, { double: true });
        if (isa.kind === 'isa' && isa.definingAttribute?.trim()) {
          edges.set(e.id, {
            ...(edges.get(e.id) ?? {}),
            definingAttribute: isa.definingAttribute.trim(),
          });
        }
      }
    }
    if (e.kind === 'participation' && e.total) {
      edges.set(e.id, { ...(edges.get(e.id) ?? {}), double: true });
    }
    if (e.kind === 'union-sub') {
      const u = byId.get(e.target);
      if (u && u.kind === 'union' && u.total) {
        edges.set(e.id, { ...(edges.get(e.id) ?? {}), double: true });
      }
    }
  }

  return { nodes, edges };
}

export const eerModel: ModelTool<DiagramNode, Edge> = {
  id: 'eer',
  label: 'Conceptual — EER diagram',
  blurb:
    'Entities, relationships, attributes and specialisation in Chen notation. The model you design before any tables exist.',
  glyph: '◇',
  stage: 'conceptual',

  createEmpty: emptyDiagram,
  samples: [
    {
      id: 'company',
      title: 'Company schema',
      blurb: 'Weak entity, recursive relationship, ISA specialisation, M:N with attributes.',
      build: companySample,
    },
    {
      id: 'category',
      title: 'Union / category type',
      blurb: 'OWNER as a category drawn from PERSON and COMPANY.',
      build: categorySample,
    },
  ],
  palette: PALETTE as PaletteItem[],

  css: diagramCss,
  outline: eerOutline,
  decorate,

  NodeShape,
  EdgeShape,
  Inspector,
  Help,

  inferEdge: (a, b, diagram) => inferEdge(a, b, diagram),
  createEdge: (source, target, kind) => createEdge(source, target, kind as Edge['kind']),
  createNode: (kind, x, y) => createNode(kind as DiagramNode['kind'], x, y),

  // Marker shapes carry a fixed glyph, so their size never follows a label.
  sizeFor: (node, name) =>
    node.kind === 'isa' || node.kind === 'union' ? null : fitSize(node.kind, name),

  validate: (diagram) => validate(diagram),

  // The mapping is shared with the SQL generator, so the diagram you get is
  // the same schema the SQL describes.
  derive: {
    to: 'relational',
    label: 'Generate relational model',
    build: (diagram) => relationalFromEer(diagram),
  },

  exports: {
    sql: (diagram, title) => {
      const result = generateDdl(diagram, title);
      return { sql: result.sql, warnings: result.warnings };
    },
  },
};
