import { newId } from '../../platform/ids';
import { measureText } from '../../platform/measure';
import type { Diagram, DiagramNode, Edge, EdgeKind, Id, NodeKind, Point } from './types';
import type { BaseNode } from '../../platform/types';

export function sizeFor(kind: NodeKind, name: string): { w: number; h: number } {
  switch (kind) {
    case 'entity-set':
      // Roomy by default: instances are dropped inside it.
      return { w: Math.max(220, Math.round(measureText(name) + 80)), h: 180 };
    case 'instance':
      return { w: 18, h: 18 };
    case 'rel-set':
      return { w: Math.max(120, Math.round(measureText(name) + 34)), h: 34 };
  }
}

export function createNode(kind: NodeKind, x: number, y: number): DiagramNode {
  const base = { id: newId(kind[0]), x, y };
  switch (kind) {
    case 'entity-set':
      return { ...base, ...sizeFor(kind, 'ENTITY'), kind, name: 'ENTITY', entityName: 'ENTITY', weak: false };
    case 'instance':
      return { ...base, ...sizeFor(kind, 'e1'), kind, name: 'e1', label: 'e1' };
    case 'rel-set':
      return { ...base, ...sizeFor(kind, 'RELATES'), kind, name: 'RELATES', relationshipName: 'RELATES' };
  }
}

export function createEdge(source: Id, target: Id, kind: EdgeKind): Edge {
  return { id: newId('e'), kind, source, target };
}

/** Outline: sets are rectangles, instances and legends are ellipses/rounded. */
export function instanceOutline(node: BaseNode): Point[] | null {
  const n = node as DiagramNode;
  if (n.kind === 'instance') return null;
  const hw = n.w / 2;
  const hh = n.h / 2;
  return [
    { x: n.x - hw, y: n.y - hh },
    { x: n.x + hw, y: n.y - hh },
    { x: n.x + hw, y: n.y + hh },
    { x: n.x - hw, y: n.y + hh },
  ];
}

/**
 * What it means to join two shapes here: an instance belongs to exactly one
 * entity set, and two instances may be linked to record one relationship
 * instance. Anything else is refused.
 */
export function inferEdge(
  a: DiagramNode,
  b: DiagramNode,
  _diagram: Diagram,
): { source: Id; target: Id; kind: EdgeKind } | null {
  const pair = (k1: NodeKind, k2: NodeKind) =>
    (a.kind === k1 && b.kind === k2) || (a.kind === k2 && b.kind === k1);
  const of = (k: NodeKind) => (a.kind === k ? a : b);

  if (pair('instance', 'entity-set')) {
    return { source: of('instance').id, target: of('entity-set').id, kind: 'member-of' };
  }
  if (a.kind === 'instance' && b.kind === 'instance') {
    return { source: a.id, target: b.id, kind: 'instance-link' };
  }
  return null;
}
