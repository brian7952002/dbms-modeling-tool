import { describe, expect, it } from 'vitest';
import { validate } from './validate';
import { makeColumn, makeTable } from './factory';
import { relationalFromEer } from './fromEer';
import { companySample, categorySample } from '../eer/samples';
import type { Column, Diagram, Edge, TableNode } from './types';

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

let seq = 0;

const col = (name: string, extra: Partial<Column> = {}) =>
  makeColumn({ name, dataType: 'INTEGER', ...extra });

const pk = (name: string, extra: Partial<Column> = {}) =>
  col(name, { pk: true, notNull: true, ...extra });

const table = (name: string, columns: Column[]) => makeTable(name, 0, 0, columns);

const fk = (
  child: TableNode,
  parent: TableNode,
  columns: string[],
  references: string[],
): Edge => ({
  id: `fk${++seq}`,
  kind: 'foreign-key',
  source: child.id,
  target: parent.id,
  columns,
  references,
});

/* -------------------------------------------------------------------------- */
/* Assertions                                                                 */
/* -------------------------------------------------------------------------- */

const at = (severity: string) => (d: Diagram) =>
  validate(d).filter((i) => i.severity === severity).map((i) => i.message);

const errors = at('error');
const warnings = at('warning');

const saying = (messages: string[], fragment: string) =>
  messages.some((m) => m.includes(fragment));

/* -------------------------------------------------------------------------- */
/* Tables and columns                                                         */
/* -------------------------------------------------------------------------- */

describe('tables', () => {
  it('accepts a keyed table', () => {
    const d: Diagram = { nodes: [table('student', [pk('id'), col('name')])], edges: [] };
    expect(validate(d)).toEqual([]);
  });

  it('wants every table named', () => {
    const d: Diagram = { nodes: [table('  ', [pk('id')])], edges: [] };
    expect(saying(errors(d), 'A table needs a name.')).toBe(true);
  });

  it('refuses two tables with the same name', () => {
    const d: Diagram = {
      nodes: [table('student', [pk('id')]), table('STUDENT', [pk('id')])],
      edges: [],
    };
    expect(saying(errors(d), '2 tables are named')).toBe(true);
  });

  it('refuses a table with no columns', () => {
    const d: Diagram = { nodes: [table('empty', [])], edges: [] };
    expect(saying(errors(d), 'has no columns')).toBe(true);
  });

  // Every relation needs a key; without one, rows cannot be told apart.
  it('refuses a table with no primary key', () => {
    const d: Diagram = { nodes: [table('student', [col('name')])], edges: [] };
    expect(saying(errors(d), 'has no primary key')).toBe(true);
  });

  it('refuses two columns with the same name', () => {
    const d: Diagram = {
      nodes: [table('student', [pk('id'), col('name'), col('NAME')])],
      edges: [],
    };
    expect(saying(errors(d), 'has 2 columns named')).toBe(true);
  });

  it('refuses a column with no name', () => {
    const d: Diagram = { nodes: [table('student', [pk('id'), col('   ')])], edges: [] };
    expect(saying(errors(d), 'has no name')).toBe(true);
  });

  it('warns about a column with no data type', () => {
    const d: Diagram = {
      nodes: [table('student', [pk('id'), col('name', { dataType: '' })])],
      edges: [],
    };
    expect(saying(warnings(d), 'has no data type')).toBe(true);
  });

  // A key that admits nulls cannot identify a row.
  it('warns about a nullable primary key column', () => {
    const d: Diagram = {
      nodes: [table('student', [col('id', { pk: true, notNull: false })])],
      edges: [],
    };
    expect(saying(warnings(d), 'is nullable')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Foreign keys                                                               */
/* -------------------------------------------------------------------------- */

describe('foreign keys', () => {
  /** A parent keyed on `id` and a child carrying `parent_id`. */
  function pair(childExtra: Partial<Column> = {}) {
    const parentId = pk('id');
    const parent = table('department', [parentId]);
    const childRef = col('department_id', childExtra);
    const child = table('employee', [pk('ssn'), childRef]);
    return { parent, parentId, child, childRef };
  }

  it('accepts one that points at the parent key', () => {
    const { parent, parentId, child, childRef } = pair();
    const d: Diagram = {
      nodes: [parent, child],
      edges: [fk(child, parent, [childRef.id], [parentId.id])],
    };
    expect(validate(d)).toEqual([]);
  });

  it('reports one with no columns chosen', () => {
    const { parent, child } = pair();
    const d: Diagram = { nodes: [parent, child], edges: [fk(child, parent, [], [])] };
    expect(saying(errors(d), 'has no columns. Choose which')).toBe(true);
  });

  it('reports a mismatched number of columns on the two sides', () => {
    const { parent, parentId, childRef } = pair();
    const extra = col('extra');
    const wider = table('employee', [pk('ssn'), childRef, extra]);
    const d: Diagram = {
      nodes: [parent, wider],
      edges: [fk(wider, parent, [childRef.id, extra.id], [parentId.id])],
    };
    expect(saying(errors(d), 'maps 2 columns onto 1')).toBe(true);
  });

  it('reports a reference to a column that has been deleted', () => {
    const { parent, child, childRef } = pair();
    const d: Diagram = {
      nodes: [parent, child],
      edges: [fk(child, parent, [childRef.id], ['no-such-column'])],
    };
    expect(saying(errors(d), 'references a column that no longer exists')).toBe(true);
  });

  it('reports a foreign key whose own column has been deleted', () => {
    const parentId = pk('id');
    const parent = table('department', [parentId]);
    const child = table('employee', [pk('ssn')]);
    const d: Diagram = {
      nodes: [parent, child],
      edges: [fk(child, parent, ['no-such-column'], [parentId.id])],
    };
    expect(saying(errors(d), 'uses a column that no longer exists')).toBe(true);
  });

  // Referencing something that is not unique cannot single out one row.
  it('refuses a reference to a column that is neither key nor unique', () => {
    const plain = col('city');
    const parent = table('department', [pk('id'), plain]);
    const childRef = col('city');
    const child = table('employee', [pk('ssn'), childRef]);
    const d: Diagram = {
      nodes: [parent, child],
      edges: [fk(child, parent, [childRef.id], [plain.id])],
    };
    expect(saying(errors(d), 'neither a primary key nor unique')).toBe(true);
  });

  it('allows a reference to a unique column that is not the key', () => {
    const code = col('code', { unique: true, notNull: true });
    const parent = table('department', [pk('id'), code]);
    const childRef = col('department_code');
    const child = table('employee', [pk('ssn'), childRef]);
    const d: Diagram = {
      nodes: [parent, child],
      edges: [fk(child, parent, [childRef.id], [code.id])],
    };
    expect(validate(d)).toEqual([]);
  });

  // Half a composite key identifies a group of rows, not one.
  it('warns about a reference to part of a composite key', () => {
    const a = pk('employee_ssn');
    const b = pk('dependent_name');
    const parent = table('dependent', [a, b]);
    const childRef = col('employee_ssn');
    const child = table('claim', [pk('claim_no'), childRef]);
    const d: Diagram = {
      nodes: [parent, child],
      edges: [fk(child, parent, [childRef.id], [a.id])],
    };
    expect(saying(warnings(d), 'part of')).toBe(true);
  });

  it('warns when the two sides of a foreign key have different types', () => {
    const parentId = pk('id', { dataType: 'INTEGER' });
    const parent = table('department', [parentId]);
    const childRef = col('department_id', { dataType: 'VARCHAR(20)' });
    const child = table('employee', [pk('ssn'), childRef]);
    const d: Diagram = {
      nodes: [parent, child],
      edges: [fk(child, parent, [childRef.id], [parentId.id])],
    };
    expect(saying(warnings(d), 'should match its referenced type')).toBe(true);
  });

  // A half-deleted diagram should not produce noise about the survivor.
  it('ignores an edge whose table is gone', () => {
    const parentId = pk('id');
    const parent = table('department', [parentId]);
    const child = table('employee', [pk('ssn')]);
    const d: Diagram = {
      nodes: [parent],
      edges: [fk(child, parent, ['x'], [parentId.id])],
    };
    expect(validate(d)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Against the mapping                                                        */
/* -------------------------------------------------------------------------- */

describe('the schemas the mapper produces', () => {
  it('passes the checker for the company sample', () => {
    expect(errors(relationalFromEer(companySample()).diagram)).toEqual([]);
  });

  it('passes the checker for the category sample', () => {
    expect(errors(relationalFromEer(categorySample()).diagram)).toEqual([]);
  });
});
