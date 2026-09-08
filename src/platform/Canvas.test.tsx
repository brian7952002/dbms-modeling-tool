// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { Canvas, type Tool, type Viewport } from './Canvas';
import { installPointerEvents } from '../test/dom';
import { eerModel } from '../models/eer';
import type { Action } from './actions';
import type { Diagram, Id, Point } from './types';
import type { DiagramNode, Edge } from '../models/eer/types';

beforeAll(installPointerEvents);
afterEach(cleanup);

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const entity = (id: Id, name: string, x: number, y: number): DiagramNode => ({
  id,
  kind: 'entity',
  name,
  x,
  y,
  w: 140,
  h: 60,
  weak: false,
});

const attribute = (id: Id, name: string, x: number, y: number): DiagramNode => ({
  id,
  kind: 'attribute',
  name,
  x,
  y,
  w: 120,
  h: 48,
  key: false,
  partialKey: false,
  multivalued: false,
  derived: false,
  dataType: 'VARCHAR(255)',
  nullable: true,
});

const isa = (id: Id, x: number, y: number): DiagramNode => ({
  id,
  kind: 'isa',
  name: 'ISA',
  x,
  y,
  w: 74,
  h: 54,
  disjoint: true,
  total: false,
});

/** Two entities far enough apart to be picked out by a marquee individually. */
const twoEntities = (): Diagram => ({
  nodes: [entity('a', 'STUDENT', 100, 100), entity('b', 'COURSE', 400, 300)],
  edges: [],
});

interface Options {
  diagram?: Diagram;
  selection?: Id[];
  tool?: Tool;
  snap?: number;
  viewport?: Viewport;
  peers?: React.ComponentProps<typeof Canvas>['peers'];
}

function setup(options: Options = {}) {
  const dispatch = vi.fn<(a: Action) => void>();
  const onAddNodeAt = vi.fn<(kind: string, p: Point) => void>();
  const setViewport = vi.fn();
  const diagram = options.diagram ?? twoEntities();

  render(
    <Canvas
      model={eerModel as never}
      diagram={diagram}
      selection={options.selection ?? []}
      dispatch={dispatch}
      tool={options.tool ?? 'select'}
      viewport={options.viewport ?? { x: 0, y: 0, k: 1 }}
      setViewport={setViewport}
      theme="light"
      showGrid={false}
      snap={options.snap ?? 0}
      issues={new Map()}
      onAddNodeAt={onAddNodeAt}
      peers={options.peers}
    />,
  );

  const svg = document.querySelector('svg.canvas') as SVGSVGElement;
  const node = (id: Id) => document.querySelector(`g.node[data-id="${id}"]`) as Element;
  const edge = (id: Id) => document.querySelector(`g.edge[data-id="${id}"]`) as Element;

  /** Everything dispatched of one kind, in order. */
  const sent = <T extends Action['type']>(type: T) =>
    dispatch.mock.calls
      .map(([a]) => a)
      .filter((a): a is Extract<Action, { type: T }> => a.type === type);

  return { svg, node, edge, dispatch, sent, onAddNodeAt, setViewport, diagram };
}

/** A press-move-release gesture, as the browser would deliver it. */
function drag(target: Element, svg: Element, from: Point, to: Point, init: object = {}) {
  fireEvent.pointerDown(target, { button: 0, clientX: from.x, clientY: from.y, ...init });
  fireEvent.pointerMove(svg, { clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(svg, { clientX: to.x, clientY: to.y });
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

describe('selecting', () => {
  it('selects the shape that was clicked', () => {
    const { node, sent } = setup();
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    expect(sent('select')).toEqual([{ type: 'select', ids: ['a'] }]);
  });

  it('toggles rather than replaces when shift is held', () => {
    const { node, sent } = setup({ selection: ['b'] });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100, shiftKey: true });
    expect(sent('select')).toEqual([{ type: 'select', ids: ['a'], mode: 'toggle' }]);
  });

  // Grabbing one shape of a multi-selection has to keep the rest, or dragging
  // a group apart becomes impossible.
  it('leaves an existing multi-selection alone when one of its shapes is grabbed', () => {
    const { node, sent } = setup({ selection: ['a', 'b'] });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    expect(sent('select')).toEqual([]);
  });

  it('selects an edge that is clicked', () => {
    const diagram: Diagram = {
      nodes: twoEntities().nodes,
      edges: [{ id: 'e1', kind: 'participation', source: 'a', target: 'b' } as Edge],
    };
    const { edge, sent } = setup({ diagram });
    fireEvent.pointerDown(edge('e1'), { button: 0, clientX: 250, clientY: 200 });
    expect(sent('select')).toEqual([{ type: 'select', ids: ['e1'], mode: 'replace' }]);
  });

  it('clears the selection when the background is clicked', () => {
    const { svg, sent } = setup({ selection: ['a'] });
    fireEvent.pointerDown(svg, { button: 0, clientX: 600, clientY: 500 });
    expect(sent('select')).toEqual([{ type: 'select', ids: [] }]);
  });

  it('keeps the selection when the background is shift-clicked', () => {
    const { svg, sent } = setup({ selection: ['a'] });
    fireEvent.pointerDown(svg, { button: 0, clientX: 600, clientY: 500, shiftKey: true });
    expect(sent('select')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Dragging                                                                   */
/* -------------------------------------------------------------------------- */

describe('dragging shapes', () => {
  it('moves the shape by the distance the pointer travelled', () => {
    const { svg, node, sent } = setup();
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 130, clientY: 145 });

    expect(sent('moveNodes')).toEqual([{ type: 'moveNodes', ids: ['a'], dx: 30, dy: 45 }]);
  });

  // One undo step per gesture, not one per pointermove.
  it('opens a single undo step however far the shape is dragged', () => {
    const { svg, node, sent } = setup();
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 110, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 120, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 130, clientY: 100 });

    expect(sent('begin')).toHaveLength(1);
    expect(sent('moveNodes')).toHaveLength(3);
  });

  it('reports each move relative to the last, not to the start', () => {
    const { svg, node, sent } = setup();
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 110, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 130, clientY: 100 });

    expect(sent('moveNodes').map((a) => a.dx)).toEqual([10, 20]);
  });

  it('drags every selected shape together', () => {
    const { svg, node, sent } = setup({ selection: ['a', 'b'] });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 110, clientY: 110 });

    expect(sent('moveNodes')[0].ids).toEqual(['a', 'b']);
  });

  it('does not open an undo step for a click that never moved', () => {
    const { svg, node, sent } = setup();
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });

    expect(sent('begin')).toEqual([]);
    expect(sent('moveNodes')).toEqual([]);
  });

  it('snaps to the grid once the drag ends', () => {
    const diagram: Diagram = { nodes: [entity('a', 'STUDENT', 103, 97)], edges: [] };
    const { svg, node, sent } = setup({ diagram, snap: 20 });
    drag(node('a'), svg, { x: 103, y: 97 }, { x: 120, y: 97 });

    expect(sent('updateNode')).toEqual([
      { type: 'updateNode', id: 'a', patch: { x: 100, y: 100 }, transient: true },
    ]);
  });

  it('leaves positions alone when snapping is off', () => {
    const diagram: Diagram = { nodes: [entity('a', 'STUDENT', 103, 97)], edges: [] };
    const { svg, node, sent } = setup({ diagram, snap: 0 });
    drag(node('a'), svg, { x: 103, y: 97 }, { x: 120, y: 97 });

    expect(sent('updateNode')).toEqual([]);
  });

  // A shape is dragged from wherever it was grabbed, so the delta has to be
  // divided by the zoom or shapes race the pointer.
  it('divides the travelled distance by the zoom level', () => {
    const { svg, node, sent } = setup({ viewport: { x: 0, y: 0, k: 2 } });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(svg, { clientX: 240, clientY: 200 });

    expect(sent('moveNodes')[0].dx).toBe(20);
  });
});

/* -------------------------------------------------------------------------- */
/* Marquee                                                                    */
/* -------------------------------------------------------------------------- */

describe('marquee selection', () => {
  it('selects the shapes it encloses', () => {
    const { svg, sent } = setup();
    drag(svg, svg, { x: 50, y: 50 }, { x: 500, y: 400 });

    const last = sent('select').at(-1);
    expect(last).toEqual({ type: 'select', ids: ['a', 'b'], mode: 'replace' });
  });

  it('leaves out the shapes it does not reach', () => {
    const { svg, sent } = setup();
    drag(svg, svg, { x: 50, y: 50 }, { x: 200, y: 200 });

    expect(sent('select').at(-1)).toEqual({ type: 'select', ids: ['a'], mode: 'replace' });
  });

  // Otherwise every click on the background would look like an empty marquee
  // and wipe the selection twice over.
  it('ignores a marquee too small to be deliberate', () => {
    const { svg, sent } = setup();
    drag(svg, svg, { x: 50, y: 50 }, { x: 52, y: 51 });

    // Only the clearing dispatch from the initial press.
    expect(sent('select')).toEqual([{ type: 'select', ids: [] }]);
  });

  it('adds to the selection when shift is held', () => {
    const { svg, sent } = setup({ selection: ['b'] });
    fireEvent.pointerDown(svg, { button: 0, clientX: 50, clientY: 50, shiftKey: true });
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(svg, { clientX: 200, clientY: 200 });

    expect(sent('select').at(-1)).toEqual({ type: 'select', ids: ['a'], mode: 'add' });
  });

  it('draws the marquee while the pointer is down', () => {
    const { svg } = setup();
    fireEvent.pointerDown(svg, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(svg, { clientX: 250, clientY: 150 });

    const rect = document.querySelector('g.overlay rect') as SVGRectElement;
    expect(rect).toBeTruthy();
    expect(rect.getAttribute('width')).toBe('200');
    expect(rect.getAttribute('height')).toBe('100');

    fireEvent.pointerUp(svg, { clientX: 250, clientY: 150 });
    expect(document.querySelector('g.overlay rect')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Connecting                                                                 */
/* -------------------------------------------------------------------------- */

describe('the connect tool', () => {
  const attributeAndEntity = (): Diagram => ({
    nodes: [entity('a', 'STUDENT', 100, 100), attribute('at', 'name', 300, 100)],
    edges: [],
  });

  it('joins two shapes that may legally be joined', () => {
    const { node, sent } = setup({ diagram: attributeAndEntity(), tool: 'connect' });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(node('at'), { button: 0, clientX: 300, clientY: 100 });

    expect(sent('connect')).toEqual([{ type: 'connect', a: 'a', b: 'at' }]);
  });

  it('never selects a shape while the connect tool is active', () => {
    const { node, sent } = setup({ diagram: attributeAndEntity(), tool: 'connect' });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });

    expect(sent('select')).toEqual([]);
  });

  // Two entities cannot be joined directly in EER; the click restarts from
  // the second shape rather than silently doing nothing.
  it('refuses a pair the model rejects, and starts again from the second', () => {
    const { node, sent } = setup({ tool: 'connect' });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(node('b'), { button: 0, clientX: 400, clientY: 300 });

    expect(sent('connect')).toEqual([]);
    // Still mid-connection, now anchored on the second shape.
    expect(document.body.textContent).toContain('Now click the shape to connect it to');
  });

  it('cancels when the same shape is clicked twice', () => {
    const { node } = setup({ diagram: attributeAndEntity(), tool: 'connect' });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    expect(document.body.textContent).toContain('Now click the shape to connect it to');

    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    expect(document.body.textContent).toContain('Click a shape to start a connection');
  });

  it('cancels on Escape', () => {
    const { node } = setup({ diagram: attributeAndEntity(), tool: 'connect' });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(document.body.textContent).toContain('Click a shape to start a connection');
  });

  it('cancels when the background is clicked', () => {
    const { svg, node } = setup({ diagram: attributeAndEntity(), tool: 'connect' });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 600, clientY: 500 });

    expect(document.body.textContent).toContain('Click a shape to start a connection');
  });

  it('trails a guide line from the anchored shape to the pointer', () => {
    const { svg, node } = setup({ diagram: attributeAndEntity(), tool: 'connect' });
    fireEvent.pointerDown(node('a'), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 260, clientY: 180 });

    const line = document.querySelector('g.overlay line') as SVGLineElement;
    expect(line.getAttribute('x1')).toBe('100');
    expect(line.getAttribute('x2')).toBe('260');
    expect(line.getAttribute('y2')).toBe('180');
  });
});

/* -------------------------------------------------------------------------- */
/* Dropping from the palette                                                  */
/* -------------------------------------------------------------------------- */

describe('dropping a shape from the palette', () => {
  const dataTransfer = (kind: string) => ({
    getData: (type: string) => (type === 'application/x-eer-node' ? kind : ''),
    dropEffect: 'none',
  });

  it('adds the dropped kind where it landed', () => {
    const { svg, onAddNodeAt } = setup();
    fireEvent.drop(svg, { clientX: 210, clientY: 160, dataTransfer: dataTransfer('entity') });

    expect(onAddNodeAt).toHaveBeenCalledWith('entity', { x: 210, y: 160 });
  });

  it('snaps the drop to the grid', () => {
    const { svg, onAddNodeAt } = setup({ snap: 20 });
    fireEvent.drop(svg, { clientX: 213, clientY: 157, dataTransfer: dataTransfer('entity') });

    expect(onAddNodeAt).toHaveBeenCalledWith('entity', { x: 220, y: 160 });
  });

  it('ignores a drop carrying something else', () => {
    const { svg, onAddNodeAt } = setup();
    fireEvent.drop(svg, { clientX: 210, clientY: 160, dataTransfer: dataTransfer('') });

    expect(onAddNodeAt).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Renaming in place                                                          */
/* -------------------------------------------------------------------------- */

describe('renaming a shape', () => {
  const input = () => document.querySelector('input.inline-rename') as HTMLInputElement | null;

  it('opens an editor holding the current name', () => {
    const { node } = setup();
    fireEvent.doubleClick(node('a'));

    expect(input()?.value).toBe('STUDENT');
  });

  it('commits the new name when the editor loses focus', () => {
    const { node, sent } = setup();
    fireEvent.doubleClick(node('a'));
    fireEvent.change(input()!, { target: { value: 'PUPIL' } });
    fireEvent.blur(input()!);

    expect(sent('updateNode')).toEqual([
      { type: 'updateNode', id: 'a', patch: { name: 'PUPIL' } },
    ]);
    expect(input()).toBeNull();
  });

  it('abandons the edit on Escape without changing anything', () => {
    const { node, sent } = setup();
    fireEvent.doubleClick(node('a'));
    fireEvent.change(input()!, { target: { value: 'PUPIL' } });
    fireEvent.keyDown(input()!, { key: 'Escape' });

    expect(sent('updateNode')).toEqual([]);
    expect(input()).toBeNull();
  });

  // A specialisation marker carries a fixed d/o glyph, not a label.
  it('does not open an editor on a marker shape', () => {
    const diagram: Diagram = { nodes: [isa('i1', 200, 200)], edges: [] };
    const { node } = setup({ diagram });
    fireEvent.doubleClick(node('i1'));

    expect(input()).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Viewport                                                                   */
/* -------------------------------------------------------------------------- */

/** Holds a real viewport so pan and zoom can be asserted on the result. */
function LiveCanvas({ tool = 'select' as Tool }) {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  return (
    <>
      <output data-testid="viewport">{`${viewport.x},${viewport.y},${viewport.k.toFixed(3)}`}</output>
      <Canvas
        model={eerModel as never}
        diagram={twoEntities()}
        selection={[]}
        dispatch={() => undefined}
        tool={tool}
        viewport={viewport}
        setViewport={setViewport}
        theme="light"
        showGrid={false}
        snap={0}
        issues={new Map()}
        onAddNodeAt={() => undefined}
      />
    </>
  );
}

describe('panning and zooming', () => {
  const readViewport = () => document.querySelector('[data-testid="viewport"]')!.textContent;

  it('pans with alt held, rather than starting a marquee', () => {
    render(<LiveCanvas />);
    const svg = document.querySelector('svg.canvas')!;
    fireEvent.pointerDown(svg, { button: 0, clientX: 200, clientY: 200, altKey: true });
    fireEvent.pointerMove(svg, { clientX: 260, clientY: 230 });

    expect(readViewport()).toBe('60,30,1.000');
    expect(document.querySelector('g.overlay rect')).toBeNull();
  });

  it('pans with the middle button', () => {
    render(<LiveCanvas />);
    const svg = document.querySelector('svg.canvas')!;
    fireEvent.pointerDown(svg, { button: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(svg, { clientX: 180, clientY: 200 });

    expect(readViewport()).toBe('-20,0,1.000');
  });

  it('zooms in on the wheel and keeps the point under the pointer still', () => {
    render(<LiveCanvas />);
    const svg = document.querySelector('svg.canvas')!;
    // The origin is at (0,0), so a wheel at (0,0) must not shift the view.
    fireEvent.wheel(svg, { deltaY: -100, clientX: 0, clientY: 0 });

    const [x, y, k] = readViewport()!.split(',');
    expect(Number(k)).toBeGreaterThan(1);
    expect(x).toBe('0');
    expect(y).toBe('0');
  });

  it('zooms out on the opposite wheel direction', () => {
    render(<LiveCanvas />);
    const svg = document.querySelector('svg.canvas')!;
    fireEvent.wheel(svg, { deltaY: 100, clientX: 0, clientY: 0 });

    expect(Number(readViewport()!.split(',')[2])).toBeLessThan(1);
  });

  it('scrolls sideways when shift is held instead of zooming', () => {
    render(<LiveCanvas />);
    const svg = document.querySelector('svg.canvas')!;
    fireEvent.wheel(svg, { deltaY: 120, clientX: 0, clientY: 0, shiftKey: true });

    expect(readViewport()).toBe('-120,0,1.000');
  });
});

/* -------------------------------------------------------------------------- */
/* What gets drawn                                                            */
/* -------------------------------------------------------------------------- */

describe('rendering', () => {
  it('draws a shape for every node', () => {
    setup();
    expect(document.querySelectorAll('g.node')).toHaveLength(2);
  });

  // A half-deleted edge must not take the canvas down with it.
  it('skips an edge whose endpoint is missing', () => {
    const diagram: Diagram = {
      nodes: [entity('a', 'STUDENT', 100, 100)],
      edges: [{ id: 'e1', kind: 'participation', source: 'a', target: 'gone' } as Edge],
    };
    setup({ diagram });
    expect(document.querySelectorAll('g.edge')).toHaveLength(0);
  });

  it('draws a teammate cursor and what they have selected', () => {
    setup({
      peers: [
        {
          clientId: 'p1',
          name: 'Sam',
          color: '#e11d48',
          cursor: { x: 250, y: 160 },
          selection: ['a'],
        },
      ],
    });

    const peers = document.querySelector('g.peers')!;
    expect(peers.querySelector('g')?.getAttribute('transform')).toBe('translate(250 160)');
    expect(peers.textContent).toContain('Sam');

    // The halo around the shape they have selected. It is a direct child;
    // the other rect in here is the pill behind the cursor label.
    const halos = [...peers.children].filter((el) => el.tagName === 'rect');
    expect(halos).toHaveLength(1);
    // Drawn 5px outside the shape it surrounds.
    expect(halos[0].getAttribute('x')).toBe('25');
    expect(halos[0].getAttribute('width')).toBe('150');
  });

  it('marks the selected shape as selected', () => {
    const { node } = setup({ selection: ['a'] });
    expect(node('a').getAttribute('class')).toContain('selected');
    expect(node('b').getAttribute('class')).not.toContain('selected');
  });
});
