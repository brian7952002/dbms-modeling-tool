// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDiagramDoc } from './useDiagramDoc';
import { encodeState } from './doc';
import { eerModel } from '../../models/eer';
import type { BaseNode, Diagram } from '../types';

/**
 * Opening a diagram starts a *new* document rather than emptying the one on
 * screen. That mattered for collaboration, which is gone; it still matters
 * because a document's history is what gets saved, and reusing one document
 * for every diagram a tab ever opens means saving all of them, forever.
 */

const node = (id: string, name: string): BaseNode => ({
  id,
  kind: 'entity',
  name,
  x: 0,
  y: 0,
  w: 140,
  h: 60,
});

const diagramOf = (...names: string[]): Diagram => ({
  nodes: names.map((n, i) => node(`n${i}`, n)),
  edges: [],
});

const names = (d: { snapshot: () => Diagram }) =>
  d
    .snapshot()
    .nodes.map((n) => n.name)
    .sort();

function mount(initial: Diagram, title = 'First') {
  return renderHook(() => useDiagramDoc({ diagram: initial, title }, eerModel as never));
}

describe('the document behind the canvas', () => {
  it('starts with whatever it was handed', () => {
    const { result } = mount(diagramOf('STUDENT', 'COURSE'));
    expect(names(result.current.doc)).toEqual(['COURSE', 'STUDENT']);
    expect(result.current.title).toBe('First');
  });

  it('builds a new document when reset, rather than emptying this one', () => {
    const { result } = mount(diagramOf('STUDENT', 'COURSE'));
    const before = result.current.doc;

    act(() => result.current.reset({ diagram: diagramOf('INVOICE'), title: 'Second' }));

    expect(result.current.doc).not.toBe(before);
    expect(names(result.current.doc)).toEqual(['INVOICE']);
    expect(result.current.title).toBe('Second');
    // The abandoned document is left untouched rather than cleared.
    expect(names(before)).toEqual(['COURSE', 'STUDENT']);
  });

  // Opening a diagram is not an edit, so there is nothing to undo back to.
  it('cannot be undone back to the previous diagram', () => {
    const { result } = mount(diagramOf('STUDENT'));
    act(() => result.current.reset({ diagram: diagramOf('INVOICE'), title: 'Second' }));

    expect(result.current.canUndo).toBe(false);
    act(() => result.current.dispatch({ type: 'undo' }));
    expect(names(result.current.doc)).toEqual(['INVOICE']);
  });

  it('drops the selection when a different diagram is opened', () => {
    const { result } = mount(diagramOf('STUDENT', 'COURSE'));
    act(() => result.current.dispatch({ type: 'select', ids: ['n0'] }));
    expect(result.current.selection).toEqual(['n0']);

    act(() => result.current.reset({ diagram: diagramOf('INVOICE'), title: 'Second' }));
    expect(result.current.selection).toEqual([]);
  });

  it('restores a saved document from its encoded state', () => {
    const { result } = mount(diagramOf('STUDENT'));
    act(() => result.current.dispatch({ type: 'addNode', kind: 'entity', x: 10, y: 10 }));
    const encoded = encodeState(result.current.doc);
    const before = names(result.current.doc);
    expect(before).toHaveLength(2);

    act(() => result.current.reset({ diagram: diagramOf('OTHER'), title: 'Elsewhere' }));
    expect(names(result.current.doc)).toEqual(['OTHER']);

    act(() => result.current.reset({ title: 'Back again', encodedState: encoded }));
    expect(names(result.current.doc)).toEqual(before);
  });
});
