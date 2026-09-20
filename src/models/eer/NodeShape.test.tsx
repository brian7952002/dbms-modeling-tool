// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { NodeShape } from './NodeShape';
import { pinTextMeasurement } from '../../test/dom';
import type { AttributeNode } from './types';

// The wrapping test asserts on measured widths, so measurement is pinned.
beforeAll(pinTextMeasurement);
afterEach(cleanup);

/* -------------------------------------------------------------------------- */

const attribute = (extra: Partial<AttributeNode> = {}): AttributeNode => ({
  id: 'a1',
  kind: 'attribute',
  name: 'age',
  x: 200,
  y: 100,
  w: 120,
  h: 48,
  key: false,
  partialKey: false,
  multivalued: false,
  derived: false,
  dataType: 'INTEGER',
  nullable: true,
  ...extra,
});

/** One shape, rendered into an SVG root as the canvas would. */
function draw(node: AttributeNode, selected = false) {
  render(
    <svg className="eer-svg">
      <NodeShape node={node} selected={selected} />
    </svg>,
  );
  const flyout = document.querySelector('g.derivation');
  return {
    flyout,
    box: document.querySelector('rect.derivation-box') as SVGRectElement | null,
    leader: document.querySelector('line.derivation-leader') as SVGLineElement | null,
    text: () => document.querySelector('text.derivation-text')?.textContent ?? null,
  };
}

const num = (el: Element | null, attr: string) => Number(el?.getAttribute(attr));

/* -------------------------------------------------------------------------- */

describe('the derivation flyout', () => {
  it('shows the formula beside a derived attribute', () => {
    const { flyout, text } = draw(attribute({ derived: true, derivation: 'today - birth_date' }));
    expect(flyout).not.toBeNull();
    expect(text()).toBe('today - birth_date');
  });

  // A derivation is written down to be read, so it shows unless asked not to.
  it('shows by default, without the flag being set', () => {
    const node = attribute({ derived: true, derivation: 'COUNT(employees)' });
    expect(node.showDerivation).toBeUndefined();
    expect(draw(node).flyout).not.toBeNull();
  });

  it('hides when switched off', () => {
    const { flyout } = draw(
      attribute({ derived: true, derivation: 'today - birth_date', showDerivation: false }),
    );
    expect(flyout).toBeNull();
  });

  it('comes back when switched on again', () => {
    const { flyout } = draw(
      attribute({ derived: true, derivation: 'today - birth_date', showDerivation: true }),
    );
    expect(flyout).not.toBeNull();
  });

  it('draws nothing when there is no formula to show', () => {
    expect(draw(attribute({ derived: true })).flyout).toBeNull();
    expect(draw(attribute({ derived: true, derivation: '   ' })).flyout).toBeNull();
  });

  // The oval is only dashed when the attribute is derived; a stored attribute
  // with a stale formula on it should not sprout a flyout.
  it('draws nothing for an attribute that is not derived', () => {
    expect(draw(attribute({ derived: false, derivation: 'today - birth_date' })).flyout).toBeNull();
  });

  it('sits to the right of the oval by default', () => {
    const node = attribute({ derived: true, derivation: 'x + 1' });
    const { box, leader } = draw(node);
    const rightEdge = node.x + node.w / 2;

    expect(num(box, 'x')).toBeGreaterThan(rightEdge);
    // The leader runs from the oval out to the box, level with the centre.
    expect(num(leader, 'x1')).toBe(rightEdge);
    expect(num(leader, 'x2')).toBe(num(box, 'x'));
    expect(num(leader, 'y1')).toBe(node.y);
  });

  it('moves across when put on the left', () => {
    const node = attribute({ derived: true, derivation: 'x + 1', derivationSide: 'left' });
    const { box, leader } = draw(node);
    const leftEdge = node.x - node.w / 2;

    expect(num(box, 'x') + num(box, 'width')).toBeLessThan(leftEdge);
    expect(num(leader, 'x1')).toBe(leftEdge);
    expect(num(leader, 'x2')).toBe(num(box, 'x') + num(box, 'width'));
  });

  it('centres the box on the oval', () => {
    const node = attribute({ derived: true, derivation: 'x + 1' });
    const { box } = draw(node);
    expect(num(box, 'y') + num(box, 'height') / 2).toBe(node.y);
  });

  // Long formulas wrap rather than running off the page.
  it('wraps a long formula and grows the box to fit', () => {
    const short = draw(attribute({ derived: true, derivation: 'x + 1' })).box;
    const shortHeight = num(short, 'height');
    cleanup();

    const long = draw(
      attribute({
        derived: true,
        derivation:
          'total_salary = SUM(salary) over every employee currently assigned to the department',
      }),
    ).box;

    expect(num(long, 'height')).toBeGreaterThan(shortHeight);
    expect(document.querySelectorAll('text.derivation-text tspan').length).toBeGreaterThan(1);
  });

  // Edges attach to the oval's outline, which is computed from w and h. A
  // flyout that changed either would drag every connected line with it.
  it('leaves the attribute’s own size alone', () => {
    const node = attribute({ derived: true, derivation: 'a very long formula indeed, truly' });
    draw(node);
    expect(node.w).toBe(120);
    expect(node.h).toBe(48);

    const ellipse = document.querySelector('ellipse.shape') as SVGEllipseElement;
    expect(Number(ellipse.getAttribute('rx'))).toBe(60);
  });

  // It belongs to the diagram, not to the editing chrome, so it exports with
  // everything else rather than being stripped as an overlay.
  it('is part of the exported drawing', () => {
    const { flyout } = draw(attribute({ derived: true, derivation: 'x + 1' }));
    expect(flyout!.closest('.no-export')).toBeNull();
    expect(flyout!.getAttribute('class')).not.toContain('no-export');
  });
});
