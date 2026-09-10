import { describe, expect, it } from 'vitest';
import { orbitSlot } from './geometry';
import type { BaseNode } from './types';

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
