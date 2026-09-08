export const LABEL_FONT =
  '600 13px "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

let ctx: CanvasRenderingContext2D | null = null;
/**
 * Whether the lookup has been attempted. Without it, an environment that has a
 * `document` but no canvas implementation — jsdom, most notably — retries on
 * every single measurement and logs a failure each time.
 */
let triedContext = false;
const cache = new Map<string, number>();

/**
 * Text width in the label font. Shapes are sized from this so a renamed entity
 * grows to fit instead of overflowing its box.
 */
export function measureText(text: string, font = LABEL_FONT): number {
  const key = `${font}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // Guard the DOM access itself: this runs under Node in tests, where the
  // fallback below is the whole point.
  if (!triedContext && typeof document !== 'undefined') {
    triedContext = true;
    try {
      ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  }
  let width: number;
  if (ctx) {
    ctx.font = font;
    width = ctx.measureText(text).width;
  } else {
    // Rough but stable, so headless layout stays deterministic.
    width = text.length * 7.2;
  }
  cache.set(key, width);
  return width;
}
