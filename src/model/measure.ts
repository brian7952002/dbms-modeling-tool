import type { NodeKind } from './types';

export const LABEL_FONT =
  '600 13px "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

/**
 * Text width in the label font. Shapes are sized from this so a renamed entity
 * grows to fit instead of overflowing its box.
 */
export function measureText(text: string, font = LABEL_FONT): number {
  const key = `${font}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (!ctx) {
    const canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
  }
  let width: number;
  if (ctx) {
    ctx.font = font;
    width = ctx.measureText(text).width;
  } else {
    width = text.length * 7.2; // headless fallback
  }
  cache.set(key, width);
  return width;
}

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
      return { w: 74, h: 54 };
    case 'union':
      return { w: 44, h: 44 };
  }
}
