/**
 * What jsdom is missing before the canvas will run in it.
 *
 * The canvas is driven entirely by pointer events and pointer capture, and
 * jsdom implements neither. These are the smallest shims that let the real
 * component run unmodified rather than a test-only variant of it: a
 * `PointerEvent` carrying the coordinates and buttons React reads, and capture
 * calls that record instead of throwing.
 *
 * Deliberately not shimmed: `getBoundingClientRect`. jsdom returns an all-zero
 * rect, which is exactly what the coordinate maths wants — with the origin at
 * zero and the viewport unscaled, client coordinates *are* diagram
 * coordinates, so the arithmetic under test stays legible in the assertions.
 */

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly width: number;
  readonly height: number;
  readonly pressure: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
    this.width = init.width ?? 1;
    this.height = init.height ?? 1;
    this.pressure = init.pressure ?? 0.5;
  }
}

/**
 * jsdom has no `DragEvent` either, so a dropped palette item arrives as a bare
 * `Event` with no coordinates and no payload. This carries both.
 */
class TestDragEvent extends MouseEvent {
  readonly dataTransfer: DataTransfer | null;

  constructor(type: string, init: (MouseEventInit & { dataTransfer?: unknown }) = {}) {
    super(type, init);
    this.dataTransfer = (init.dataTransfer as DataTransfer) ?? null;
  }
}

/** Ids currently captured, so `hasPointerCapture` can answer honestly. */
const captured = new WeakMap<Element, Set<number>>();

export function installPointerEvents() {
  if (typeof window === 'undefined') {
    throw new Error('installPointerEvents needs a DOM; add // @vitest-environment jsdom');
  }

  if (!('PointerEvent' in window)) {
    (window as unknown as Record<string, unknown>).PointerEvent = TestPointerEvent;
    (globalThis as unknown as Record<string, unknown>).PointerEvent = TestPointerEvent;
  }

  if (!('DragEvent' in window)) {
    (window as unknown as Record<string, unknown>).DragEvent = TestDragEvent;
    (globalThis as unknown as Record<string, unknown>).DragEvent = TestDragEvent;
  }

  // jsdom has no canvas backend and logs a failure the first time one is asked
  // for. Answering `null` outright silences that and, more usefully, pins text
  // measurement to `measure.ts`'s deterministic fallback, so shape geometry in
  // assertions does not depend on whether a font happens to be installed.
  HTMLCanvasElement.prototype.getContext = () => null;

  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function (pointerId: number) {
      const ids = captured.get(this) ?? new Set<number>();
      ids.add(pointerId);
      captured.set(this, ids);
    };
    Element.prototype.releasePointerCapture = function (pointerId: number) {
      captured.get(this)?.delete(pointerId);
    };
    Element.prototype.hasPointerCapture = function (pointerId: number) {
      return captured.get(this)?.has(pointerId) ?? false;
    };
  }
}
