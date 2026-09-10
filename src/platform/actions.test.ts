import { describe, expect, it } from 'vitest';
import { tidyAttributePlan } from './actions';
import type { BaseEdge, BaseNode, Diagram } from './types';

let seq = 0;
const node = (id: string, x: number, y: number, kind = 'entity'): BaseNode => ({
  id,
  kind,
  name: id,
  x,
  y,
  w: kind === 'attribute' ? 120 : 140,
  h: kind === 'attribute' ? 48 : 60,
});
const attr = (id: string, x: number, y: number) => node(id, x, y, 'attribute');
const hangs = (child: string, owner: string): BaseEdge => ({
  id: `e${++seq}`,
  kind: 'attribute',
  source: child,
  target: owner,
});

/** Boxes overlap once the placement padding is discounted. */
const collide = (a: BaseNode, b: BaseNode) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

/** The diagram as it stands once a plan is applied. */
const applied = (d: Diagram, moves: { id: string; x: number; y: number }[]): BaseNode[] => {
  const by = new Map(moves.map((m) => [m.id, m]));
  return d.nodes.map((n) => (by.has(n.id) ? { ...n, ...by.get(n.id)! } : n));
};

describe('tidyAttributePlan', () => {
  it('separates attributes that were piled on one spot', () => {
    const d: Diagram = {
      nodes: [node('E', 0, 0), attr('a1', 10, 10), attr('a2', 12, 12), attr('a3', 8, 14)],
      edges: [hangs('a1', 'E'), hangs('a2', 'E'), hangs('a3', 'E')],
    };
    const after = applied(d, tidyAttributePlan(d, ['E']));
    const attrs = after.filter((n) => n.kind === 'attribute');
    for (let i = 0; i < attrs.length; i++) {
      for (let j = i + 1; j < attrs.length; j++) {
        expect(collide(attrs[i], attrs[j])).toBe(false);
      }
    }
  });

  it('keeps attributes off neighbouring entities', () => {
    const neighbour = node('Other', -180, 0);
    const d: Diagram = {
      nodes: [node('E', 0, 0), neighbour, attr('a1', 0, 0), attr('a2', 0, 0)],
      edges: [hangs('a1', 'E'), hangs('a2', 'E')],
    };
    const after = applied(d, tidyAttributePlan(d, ['E']));
    for (const a of after.filter((n) => n.kind === 'attribute')) {
      expect(collide(a, neighbour)).toBe(false);
    }
  });

  it('moves a composite attribute and its components together', () => {
    const d: Diagram = {
      nodes: [node('E', 0, 0), attr('name', 0, 0), attr('first', 40, 30), attr('last', 40, -30)],
      edges: [hangs('name', 'E'), hangs('first', 'name'), hangs('last', 'name')],
    };
    const moves = tidyAttributePlan(d, ['E']);
    const by = new Map(moves.map((m) => [m.id, m]));
    const dx = by.get('name')!.x - 0;
    const dy = by.get('name')!.y - 0;
    // The components shift by exactly the parent's delta, so the shape holds.
    expect(by.get('first')).toMatchObject({ x: 40 + dx, y: 30 + dy });
    expect(by.get('last')).toMatchObject({ x: 40 + dx, y: -30 + dy });
  });

  it('lays out several owners without colliding across them', () => {
    const d: Diagram = {
      nodes: [
        node('A', 0, 0),
        node('B', 420, 0),
        attr('a1', 0, 0),
        attr('a2', 0, 0),
        attr('b1', 420, 0),
        attr('b2', 420, 0),
      ],
      edges: [hangs('a1', 'A'), hangs('a2', 'A'), hangs('b1', 'B'), hangs('b2', 'B')],
    };
    const after = applied(d, tidyAttributePlan(d, ['A', 'B']));
    const attrs = after.filter((n) => n.kind === 'attribute');
    for (let i = 0; i < attrs.length; i++) {
      for (let j = i + 1; j < attrs.length; j++) {
        expect(collide(attrs[i], attrs[j])).toBe(false);
      }
    }
  });

  it('leaves owners with no attributes alone', () => {
    const d: Diagram = { nodes: [node('E', 0, 0)], edges: [] };
    expect(tidyAttributePlan(d, ['E', 'missing'])).toEqual([]);
  });
});
