import { measureText } from '../../platform/measure';
import type { NodeKind } from './types';

/** Size of a specialisation marker, which depends on which form it takes. */
export const isaSize = (symbol?: 'circle' | 'triangle') =>
  symbol === 'triangle' ? { w: 74, h: 54 } : { w: 46, h: 46 };

/** Shape size that comfortably contains the label, per shape geometry. */
export function fitSize(kind: NodeKind, name: string): { w: number; h: number } {
  const t = measureText(name || ' ');
  switch (kind) {
    case 'entity':
      return { w: Math.max(120, Math.round(t + 44)), h: 58 };
    case 'relationship':
      // Only the middle band of a diamond is usable, hence the extra factor.
      return { w: Math.max(120, Math.round(t * 1.45 + 34)), h: 74 };
    case 'attribute':
      return { w: Math.max(96, Math.round(t + 30)), h: 46 };
    case 'isa':
      return isaSize();
    case 'union':
      return { w: 44, h: 44 };
  }
}
