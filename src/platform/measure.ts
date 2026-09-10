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

/**
 * Greedy word wrap to a pixel width, honouring the newlines the author typed.
 * A word too long to fit on a line of its own is broken mid-word rather than
 * left to overflow its shape.
 */
export function wrapText(text: string, maxWidth: number, font = LABEL_FONT): string[] {
  const out: string[] = [];
  const breakWord = (word: string): string[] => {
    const parts: string[] = [];
    let part = '';
    for (const ch of word) {
      if (part && measureText(part + ch, font) > maxWidth) {
        parts.push(part);
        part = ch;
      } else {
        part += ch;
      }
    }
    if (part) parts.push(part);
    return parts;
  };

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measureText(next, font) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // The word alone may still be too wide, in which case it is split.
      const parts = measureText(word, font) > maxWidth ? breakWord(word) : [word];
      out.push(...parts.slice(0, -1));
      line = parts[parts.length - 1] ?? '';
    }
    out.push(line);
  }
  return out;
}
