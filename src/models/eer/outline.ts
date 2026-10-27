import type { DiagramNode, Point } from './types';
import type { BaseNode } from '../../platform/types';

/**
 * Outline of an EER shape, used to clip connectors and to hit-test.
 * `null` means an ellipse inscribed in the node's box.
 */
export function eerOutline(node: BaseNode): Point[] | null {
  const n = node as DiagramNode;
  const hw = n.w / 2;
  const hh = n.h / 2;
  switch (n.kind) {
    case 'entity':
    case 'note':
      return [
        { x: n.x - hw, y: n.y - hh },
        { x: n.x + hw, y: n.y - hh },
        { x: n.x + hw, y: n.y + hh },
        { x: n.x - hw, y: n.y + hh },
      ];
    case 'relationship':
      return [
        { x: n.x, y: n.y - hh },
        { x: n.x + hw, y: n.y },
        { x: n.x, y: n.y + hh },
        { x: n.x - hw, y: n.y },
      ];
    case 'isa':
      // An unconstrained marker is drawn as nothing, so it is a joint rather
      // than a shape: connectors run all the way to its centre and the
      // superclass and subclass lines join into one unbroken line. Clipping
      // to a boundary would leave a gap the width of a marker nobody can see.
      if (n.constrained === false) return [];
      // The circle form is an ellipse; only the triangle form is a polygon.
      if (n.symbol !== 'triangle') return null;
      return [
        { x: n.x, y: n.y - hh },
        { x: n.x + hw, y: n.y + hh },
        { x: n.x - hw, y: n.y + hh },
      ];
    default:
      return null; // attribute and union are ellipses
  }
}
