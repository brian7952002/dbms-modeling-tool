import type { DiagramNode, Edge, EdgeKind, Id, NodeKind, Diagram } from './types';
import { newId } from '../../platform/ids';
import { fitSize } from './sizing';

export { newId };

export const DEFAULT_SIZE: Record<NodeKind, { w: number; h: number }> = {
  entity: { w: 140, h: 60 },
  relationship: { w: 130, h: 74 },
  attribute: { w: 120, h: 48 },
  isa: { w: 74, h: 54 },
  union: { w: 44, h: 44 },
};

const DEFAULT_NAME: Record<NodeKind, string> = {
  entity: 'Entity',
  relationship: 'relates',
  attribute: 'attribute',
  isa: 'ISA',
  union: 'U',
};

export function createNode(kind: NodeKind, x: number, y: number): DiagramNode {
  const size = fitSize(kind, DEFAULT_NAME[kind]);
  const base = { id: newId(kind[0]), x, y, w: size.w, h: size.h };
  switch (kind) {
    case 'entity':
      return { ...base, kind, name: 'Entity', weak: false };
    case 'relationship':
      return { ...base, kind, name: 'relates', identifying: false };
    case 'attribute':
      return {
        ...base,
        kind,
        name: 'attribute',
        key: false,
        partialKey: false,
        multivalued: false,
        derived: false,
        dataType: 'VARCHAR(255)',
        nullable: true,
      };
    case 'isa':
      return { ...base, kind, name: 'ISA', disjoint: true, total: false };
    case 'union':
      return { ...base, kind, name: 'U', total: false };
  }
}

/**
 * Works out what kind of edge should connect two nodes, or returns null when
 * the pair is not a legal EER connection.
 *
 * The direction is normalised so the caller can click the two endpoints in
 * either order: the returned edge always stores the "owner" end in the way the
 * renderer and DDL generator expect.
 */
export function inferEdge(
  a: DiagramNode,
  b: DiagramNode,
  diagram: Diagram,
): { source: Id; target: Id; kind: EdgeKind } | null {
  const pair = (k1: NodeKind, k2: NodeKind) =>
    (a.kind === k1 && b.kind === k2) || (a.kind === k2 && b.kind === k1);
  const of = (k: NodeKind) => (a.kind === k ? a : b);
  const notOf = (k: NodeKind) => (a.kind === k ? b : a);

  // An attribute hangs off an entity, a relationship, or a parent attribute.
  if (a.kind === 'attribute' || b.kind === 'attribute') {
    if (pair('attribute', 'isa') || pair('attribute', 'union')) return null;
    if (a.kind === 'attribute' && b.kind === 'attribute') {
      // Composite attribute: the first-clicked node is the parent.
      return { source: b.id, target: a.id, kind: 'attribute' };
    }
    return { source: of('attribute').id, target: notOf('attribute').id, kind: 'attribute' };
  }

  if (pair('entity', 'relationship')) {
    return { source: of('entity').id, target: of('relationship').id, kind: 'participation' };
  }

  if (pair('entity', 'isa')) {
    const isa = of('isa');
    const entity = of('entity');
    const hasSuper = diagram.edges.some(
      (e) => e.kind === 'isa-super' && e.target === isa.id,
    );
    // The first entity attached to a fresh triangle becomes the superclass.
    return {
      source: entity.id,
      target: isa.id,
      kind: hasSuper ? 'isa-sub' : 'isa-super',
    };
  }

  if (pair('entity', 'union')) {
    const union = of('union');
    const entity = of('entity');
    const hasSub = diagram.edges.some(
      (e) => e.kind === 'union-sub' && e.target === union.id,
    );
    // The first entity attached is the category (subclass) itself; every entity
    // attached afterwards is one of its superclasses. Either can be flipped in
    // the inspector.
    return {
      source: entity.id,
      target: union.id,
      kind: hasSub ? 'union-super' : 'union-sub',
    };
  }

  return null;
}

export function createEdge(
  source: Id,
  target: Id,
  kind: EdgeKind,
): Edge {
  const edge: Edge = { id: newId('e'), kind, source, target };
  if (kind === 'participation') {
    edge.cardinality = 'N';
    edge.total = false;
    edge.min = 0;
    edge.max = null;
  }
  return edge;
}
