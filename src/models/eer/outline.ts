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
