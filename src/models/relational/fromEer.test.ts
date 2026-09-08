import { describe, expect, it } from 'vitest';
import { relationalFromEer } from './fromEer';
import { generateDdl as relationalDdl } from './ddl';
import { validate } from './validate';
import { readColumns } from './types';
import { companySample, categorySample } from '../eer/samples';
import { generateDdl as eerDdl } from '../eer/ddl';

const tableNames = (d: { nodes: { name: string }[] }) => d.nodes.map((n) => n.name).sort();

describe('generating a relational model from an EER diagram', () => {
  it('produces the same tables the SQL generator does', () => {
    const eer = companySample();
    const { diagram } = relationalFromEer(eer);
    const sql = eerDdl(eer, 'Company').sql;

    const fromSql = [...sql.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]).sort();
    expect(tableNames(diagram)).toEqual(fromSql);
  });

  it('carries the mapping through: keys, junction table and self-reference', () => {
    const { diagram } = relationalFromEer(companySample());
    const byName = new Map(diagram.nodes.map((n) => [n.name, n]));

    // A weak entity is keyed on its owner's key plus its own partial key.
    const dependent = byName.get('dependent');
    expect(dependent).toBeDefined();
    expect(readColumns(dependent!).filter((c) => c.pk).map((c) => c.name)).toEqual([
      'employee_ssn',
      'dependent_name',
    ]);

    // M:N became a junction table keyed on both sides.
    const junction = byName.get('employee_project');
    expect(junction).toBeDefined();
    expect(readColumns(junction!).filter((c) => c.pk).map((c) => c.name)).toEqual([
      'employee_ssn',
      'project_pnumber',
    ]);

    // The recursive relationship became a foreign key onto the same table.
    const employee = byName.get('employee');
    const selfRef = diagram.edges.find(
      (e) => e.source === employee!.id && e.target === employee!.id,
    );
    expect(selfRef).toBeDefined();
    expect(
      selfRef!.columns.map((id) => readColumns(employee!).find((c) => c.id === id)?.name),
    ).toEqual(['supervisor_ssn']);

    // A multivalued attribute became its own table.
    expect(byName.has('department_locations')).toBe(true);
  });

  it('wires every foreign key the mapping produced', () => {
    const eer = companySample();
    const { diagram } = relationalFromEer(eer);
    const sql = eerDdl(eer, 'Company').sql;
    const fkCount = (sql.match(/FOREIGN KEY/g) ?? []).length;

    expect(diagram.edges).toHaveLength(fkCount);
    for (const e of diagram.edges) {
      expect(e.columns.length).toBeGreaterThan(0);
      expect(e.columns).toHaveLength(e.references.length);
    }
  });

  it('generates a schema that passes its own checker', () => {
    for (const build of [companySample, categorySample]) {
      const { diagram } = relationalFromEer(build());
      const errors = validate(diagram).filter((i) => i.severity === 'error');
      expect(errors.map((e) => e.message)).toEqual([]);
    }
  });

  it('lays tables out without overlapping', () => {
    const { diagram } = relationalFromEer(companySample());
    for (const a of diagram.nodes) {
      for (const b of diagram.nodes) {
        if (a.id === b.id) continue;
        const apart =
          Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
        expect(apart).toBe(true);
      }
    }
  });

  it('renders SQL a table at a time, after what it references', () => {
    const { diagram } = relationalFromEer(companySample());
    const { sql } = relationalDdl(diagram, 'Company');

    const order = [...sql.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]);
    const position = new Map(order.map((name, i) => [name, i]));
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));

    for (const e of diagram.edges) {
      const child = byId.get(e.source)!;
      const parent = byId.get(e.target)!;
      if (child.id === parent.id) continue; // a self-reference needs no ordering
      expect(position.get(parent.name)!).toBeLessThan(position.get(child.name)!);
    }
  });
});

describe('the relational checker', () => {
  it('catches a table with no primary key', () => {
    const { diagram } = relationalFromEer(companySample());
    const table = diagram.nodes[0];
    for (const c of readColumns(table)) {
      (table as unknown as Record<string, unknown>)[`col:${c.id}`] = { ...c, pk: false };
    }
    const errors = validate(diagram).filter((i) => i.severity === 'error');
    expect(errors.some((e) => e.message.includes('has no primary key'))).toBe(true);
  });

  it('catches a foreign key pointing at a non-unique column', () => {
    const { diagram } = relationalFromEer(companySample());
    const edge = diagram.edges[0];
    const parent = diagram.nodes.find((n) => n.id === edge.target)!;
    const key = readColumns(parent).find((c) => c.pk)!;
    (parent as unknown as Record<string, unknown>)[`col:${key.id}`] = {
      ...key,
      pk: false,
      unique: false,
    };

    const errors = validate(diagram).filter((i) => i.severity === 'error');
    expect(
      errors.some((e) => e.message.includes('neither a primary key nor unique')),
    ).toBe(true);
  });

  it('catches a mismatched column count', () => {
    const { diagram } = relationalFromEer(companySample());
    diagram.edges[0].references = [];
    const errors = validate(diagram).filter((i) => i.severity === 'error');
    expect(errors.some((e) => e.message.includes('maps'))).toBe(true);
  });
});
