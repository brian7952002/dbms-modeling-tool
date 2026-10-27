import { describe, expect, it } from 'vitest';
import { boundaryPoint, edgeGeometry, orbitSlot } from './geometry';
import type { BaseNode, Point } from './types';

let seq = 0;
const node = (x: number, y: number, w = 140, h = 60): BaseNode => ({
  id: `n${++seq}`,
  kind: 'entity',
  name: 'n',
  x,
  y,
  w,
  h,
});

const ATTR = { w: 120, h: 48 };

/** True when two boxes overlap once the placement padding is taken off. */
const overlaps = (p: { x: number; y: number }, n: BaseNode) =>
  Math.abs(n.x - p.x) < (n.w + ATTR.w) / 2 && Math.abs(n.y - p.y) < (n.h + ATTR.h) / 2;

describe('orbitSlot', () => {
  // The old placement only looked at sibling attributes, so the first one
  // always went straight up — on top of whatever was already sitting there.
  it('keeps clear of a node parked in the default direction', () => {
    const owner = node(0, 0);
    const inTheWay = node(-180, 0);
    const spot = orbitSlot(owner, ATTR, [owner, inTheWay], []);
    expect(overlaps(spot, inTheWay)).toBe(false);
  });

  it('keeps clear of every other node on the canvas', () => {
    const owner = node(0, 0);
    // Entities crowding the owner from all four sides.
    const others = [node(0, -180), node(180, 0), node(0, 180), node(-180, 0)];
    const spot = orbitSlot(owner, ATTR, [owner, ...others], []);
    for (const n of others) expect(overlaps(spot, n)).toBe(false);
  });

  it('does not treat the owner as an obstacle', () => {
    const owner = node(0, 0);
    const spot = orbitSlot(owner, ATTR, [owner], []);
    // Close enough for a short leg: the first ring, not pushed outwards.
    expect(Math.hypot(spot.x, spot.y)).toBeLessThan(190);
  });

  it('fans siblings out instead of stacking them', () => {
    const owner = node(0, 0);
    const canvas: BaseNode[] = [owner];
    const siblings: BaseNode[] = [];
    for (let i = 0; i < 6; i++) {
      const spot = orbitSlot(owner, ATTR, canvas, siblings);
      const placed = { ...node(spot.x, spot.y, ATTR.w, ATTR.h) };
      for (const s of siblings) expect(overlaps(spot, s)).toBe(false);
      siblings.push(placed);
      canvas.push(placed);
    }
  });

  it('still returns a spot when the owner is hemmed in', () => {
    const owner = node(0, 0);
    const wall: BaseNode[] = [owner];
    for (let x = -600; x <= 600; x += 120) {
      for (let y = -600; y <= 600; y += 60) {
        if (x === 0 && y === 0) continue;
        wall.push(node(x, y));
      }
    }
    const spot = orbitSlot(owner, ATTR, wall, []);
    expect(Number.isFinite(spot.x) && Number.isFinite(spot.y)).toBe(true);
  });
});

describe('a node with no outline', () => {
  const joint = (): BaseNode => ({ id: 'j', kind: 'isa', name: '', x: 100, y: 100, w: 18, h: 18 });
  const box = (id: string, x: number, y: number): BaseNode => ({
    id,
    kind: 'entity',
    name: id,
    x,
    y,
    w: 100,
    h: 50,
  });

  // A joint stands in for a marker that is not drawn. Clipping to its boundary
  // would leave a gap in the middle of a line that should look continuous.
  const none = () => [] as Point[];

  it('runs a connector to its centre rather than its boundary', () => {
    const j = joint();
    const p = boundaryPoint(j, { x: 500, y: 100 }, none);
    expect(p).toEqual({ x: j.x, y: j.y });
  });

  it('does the same whatever direction the connector comes from', () => {
    const j = joint();
    for (const towards of [
      { x: 0, y: 100 },
      { x: 100, y: 0 },
      { x: 240, y: 380 },
    ]) {
      expect(boundaryPoint(j, towards, none)).toEqual({ x: j.x, y: j.y });
    }
  });

  // The two halves of a specialisation drawn as plain inheritance.
  it('leaves no gap where two edges meet at it', () => {
    const j = joint();
    const above = box('USER', 100, 0);
    const below = box('DIRECTOR', 100, 200);
    const pick = (n: BaseNode) => (n.kind === 'isa' ? none() : null);

    const upper = edgeGeometry(above, j, 0, pick);
    const lower = edgeGeometry(j, below, 0, pick);

    expect(upper.end).toEqual({ x: j.x, y: j.y });
    expect(lower.start).toEqual({ x: j.x, y: j.y });
    // Where one ends the next begins: one line, not two with a hole in it.
    expect(upper.end).toEqual(lower.start);
  });

  it('still clips to the boundary of a shape that is drawn', () => {
    const b = box('USER', 100, 0);
    const p = boundaryPoint(b, { x: 100, y: 500 }, () => null);
    expect(p.y).toBeGreaterThan(b.y);
    expect(p.y).toBeLessThan(b.y + b.h);
  });
});
