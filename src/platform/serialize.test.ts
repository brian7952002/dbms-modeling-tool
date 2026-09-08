import { describe, expect, it } from 'vitest';
import { fromFile, toFile, slugify } from './serialize';

const diagram = {
  nodes: [{ id: 'n1', kind: 'entity', name: 'STUDENT', x: 0, y: 0, w: 140, h: 58 }],
  edges: [],
};

describe('diagram files', () => {
  it('round-trips what it writes', () => {
    const parsed = fromFile(toFile(diagram, 'My schema', 'eer'));
    expect(parsed.title).toBe('My schema');
    expect(parsed.model).toBe('eer');
    expect(parsed.diagram.nodes).toHaveLength(1);
  });

  // The product was renamed; files written under the old name must keep
  // opening. A saved diagram outliving a product name is the least a file
  // format can promise.
  it('still opens files written before the rename', () => {
    const legacy = {
      format: 'eer-diagram-designer',
      version: 1,
      title: 'Old file',
      diagram,
    };
    const parsed = fromFile(legacy);
    expect(parsed.title).toBe('Old file');
    expect(parsed.diagram.nodes[0].name).toBe('STUDENT');
    // Files predating the ecosystem are all EER diagrams.
    expect(parsed.model).toBe('eer');
  });

  it('refuses a file it did not write', () => {
    expect(() => fromFile({ format: 'something-else', version: 1, diagram })).toThrow(
      /not saved by DBMS Modeling Tool/,
    );
  });

  it('drops edges whose endpoints are missing rather than drawing broken lines', () => {
    const parsed = fromFile({
      format: 'dbms-modeling-tool',
      version: 1,
      title: 'Damaged',
      diagram: {
        nodes: diagram.nodes,
        edges: [{ id: 'e1', kind: 'attribute', source: 'n1', target: 'gone' }],
      },
    });
    expect(parsed.diagram.edges).toEqual([]);
  });

  it('reports a malformed file readably', () => {
    expect(() => fromFile(null)).toThrow(/does not contain a diagram/);
    expect(() => fromFile({ format: 'dbms-modeling-tool', version: 1 })).toThrow(/malformed/);
  });

  it('makes a filename from a title', () => {
    expect(slugify('Company Schema — v2')).toBe('company-schema-v2');
    expect(slugify('   ')).toBe('diagram');
  });
});
