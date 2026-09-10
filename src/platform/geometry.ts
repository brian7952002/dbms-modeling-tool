import type { BaseNode, Point } from './types';

/**
 * How a model describes a shape's edge. Returning null means an ellipse
 * inscribed in the node's box, which is solved analytically.
 */
export type Outline = (node: BaseNode) => Point[] | null;

export const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export const centerOf = (n: BaseNode): Point => ({ x: n.x, y: n.y });

/**
 * A free spot orbiting `owner` for a new satellite shape of `size`.
 *
 * Directions already taken by `siblings` are avoided so satellites fan out
 * evenly, and any candidate landing on an `obstacles` box is skipped outright
 * — a new attribute should never spawn underneath an existing node. The search
 * widens ring by ring, so the connecting leg stays as short as the canvas
 * allows; if everything within reach is crowded it steps away diagonally
 * rather than giving up.
 */
export function orbitSlot(
  owner: BaseNode,
  size: { w: number; h: number },
  obstacles: BaseNode[],
  siblings: BaseNode[],
): Point {
  const STEPS = 36;
  const RINGS = 4;
  const baseRadius = Math.max(owner.w, owner.h) / 2 + 110;

  const used = siblings.map((s) => Math.atan2(s.y - owner.y, s.x - owner.x));
  // How far a candidate angle sits from the nearest sibling, wrapping at ±π.
  const gapAt = (angle: number) =>
    used.length
      ? Math.min(
          ...used.map((u) => Math.abs(Math.atan2(Math.sin(angle - u), Math.cos(angle - u)))),
        )
      : Math.PI;

  const clashes = (p: Point) =>
    obstacles.some(
      (n) =>
        n.id !== owner.id &&
        Math.abs(n.x - p.x) < (n.w + size.w) / 2 + 24 &&
        Math.abs(n.y - p.y) < (n.h + size.h) / 2 + 18,
    );

  const at = (angle: number, radius: number): Point => ({
    x: owner.x + Math.cos(angle) * radius,
    y: owner.y + Math.sin(angle) * radius,
  });
  const angleAt = (i: number) => (i / STEPS) * Math.PI * 2 - Math.PI;

  for (let ring = 0; ring < RINGS; ring++) {
    let best: Point | null = null;
    let bestGap = -1;
    for (let i = 0; i < STEPS; i++) {
      const angle = angleAt(i);
      const p = at(angle, baseRadius + ring * 70);
      if (clashes(p)) continue;
      const gap = gapAt(angle);
      if (gap > bestGap) {
        bestGap = gap;
        best = p;
      }
    }
    if (best) return best;
  }

  // Crowded in every direction: take the emptiest one and walk out of the pile.
  let bestAngle = -Math.PI / 2;
  let bestGap = -1;
  for (let i = 0; i < STEPS; i++) {
    const angle = angleAt(i);
    const gap = gapAt(angle);
    if (gap > bestGap) {
      bestGap = gap;
      bestAngle = angle;
    }
  }
  let p = at(bestAngle, baseRadius);
  for (let i = 0; i < 40 && clashes(p); i++) p = { x: p.x + 36, y: p.y + 30 };
  return p;
}

/**
 * Point where a ray leaving the node's centre towards `towards` crosses the
 * node's outline. Used to clip connector lines so they touch the shape rather
 * than the centre point.
 */
export function boundaryPoint(
  n: BaseNode,
  towards: Point,
  outline: Outline,
  pad = 0,
): Point {
  const dx = towards.x - n.x;
  const dy = towards.y - n.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return { x: n.x, y: n.y };
  const ux = dx / len;
  const uy = dy / len;

  const poly = outline(n);
  let t: number;
  if (poly) {
    t = rayPolygonDistance(poly, { x: n.x, y: n.y }, ux, uy) ?? 0;
  } else {
    // Ellipse: solve (t*ux/a)^2 + (t*uy/b)^2 = 1
    const a = n.w / 2;
    const b = n.h / 2;
    t = 1 / Math.hypot(ux / a, uy / b);
  }
  const d = Math.max(0, t + pad);
  return { x: n.x + ux * d, y: n.y + uy * d };
}

function rayPolygonDistance(
  poly: Point[],
  origin: Point,
  ux: number,
  uy: number,
): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    const ex = p2.x - p1.x;
    const ey = p2.y - p1.y;
    const denom = ux * ey - uy * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = ((p1.x - origin.x) * ey - (p1.y - origin.y) * ex) / denom;
    const s = ((p1.x - origin.x) * uy - (p1.y - origin.y) * ux) / denom;
    if (t >= 0 && s >= 0 && s <= 1) {
      if (best === null || t < best) best = t;
    }
  }
  return best;
}

export function hitTest(n: BaseNode, p: Point, outline: Outline): boolean {
  const poly = outline(n);
  if (poly) return pointInPolygon(poly, p);
  const a = n.w / 2;
  const b = n.h / 2;
  const dx = (p.x - n.x) / a;
  const dy = (p.y - n.y) / b;
  return dx * dx + dy * dy <= 1;
}

function pointInPolygon(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export interface EdgeGeometry {
  /** SVG path for the connector. */
  path: string;
  /** Parallel path used to draw the second stroke of a double line. */
  path2: string | null;
  start: Point;
  end: Point;
  mid: Point;
  /** Unit normal at the midpoint; label offsets are placed along it. */
  normal: Point;
}

/**
 * Builds the geometry for one connector. Edges that share the same pair of
 * nodes (recursive relationships, most commonly) are bowed apart so both legs
 * stay visible and individually clickable.
 */
export function edgeGeometry(
  from: BaseNode,
  to: BaseNode,
  bow: number,
  outline: Outline,
): EdgeGeometry {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  if (Math.abs(bow) < 0.5) {
    const start = boundaryPoint(from, b, outline);
    const end = boundaryPoint(to, a, outline);
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return {
      path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      path2: null,
      start,
      end,
      mid,
      normal: { x: nx, y: ny },
    };
  }

  // Quadratic bow: aim each endpoint at the control point so the curve leaves
  // the shape at a sensible angle.
  const ctrl = {
    x: (a.x + b.x) / 2 + nx * bow * 2,
    y: (a.y + b.y) / 2 + ny * bow * 2,
  };
  const start = boundaryPoint(from, ctrl, outline);
  const end = boundaryPoint(to, ctrl, outline);
  const mid = {
    x: 0.25 * start.x + 0.5 * ctrl.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * ctrl.y + 0.25 * end.y,
  };
  return {
    path: `M ${start.x} ${start.y} Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`,
    path2: null,
    start,
    end,
    mid,
    normal: { x: nx, y: ny },
  };
}

/** Offsets a path's control points to produce the second line of a double line. */
export function offsetPath(g: EdgeGeometry, amount: number): string {
  const ox = g.normal.x * amount;
  const oy = g.normal.y * amount;
  return g.path.replace(
    /(-?[\d.]+) (-?[\d.]+)/g,
    (_m, x: string, y: string) =>
      `${(parseFloat(x) + ox).toFixed(2)} ${(parseFloat(y) + oy).toFixed(2)}`,
  );
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function nodeBounds(nodes: BaseNode[], pad = 0): Bounds | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** Shortest distance from a point to a line segment; used for edge hit-testing. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return dist(p, a);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return dist(p, b);
  const t = c1 / c2;
  return dist(p, { x: a.x + t * vx, y: a.y + t * vy });
}
