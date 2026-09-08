import { describe, expect, it } from 'vitest';
import { checkAgainstSchema } from './check';
import type { Diagram as InstanceDiagram, DiagramNode as InstanceNode, Edge as InstanceEdge } from './types';
import type { Diagram as EerDiagram, DiagramNode as EerNode, Edge as EerEdge, Cardinality } from '../eer/types';

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

let seq = 0;
const id = (p: string) => `${p}${++seq}`;

function schema() {
  const nodes: EerNode[] = [];
  const edges: EerEdge[] = [];

  const entity = (name: string, weak = false) => {
    const n: EerNode = { id: id('E'), kind: 'entity', name, x: 0, y: 0, w: 140, h: 58, weak };
    nodes.push(n);
    return n;
  };
  const key = (owner: EerNode, name: string, partial = false) => {
    const a: EerNode = {
      id: id('A'), kind: 'attribute', name, x: 0, y: 0, w: 100, h: 46,
      key: !partial, partialKey: partial, multivalued: false, derived: false,
      dataType: 'VARCHAR(50)', nullable: false,
    };
    nodes.push(a);
    edges.push({ id: id('x'), kind: 'attribute', source: a.id, target: owner.id });
    return a;
  };
  const rel = (name: string, identifying = false) => {
    const n: EerNode = { id: id('R'), kind: 'relationship', name, x: 0, y: 0, w: 130, h: 74, identifying };
    nodes.push(n);
    return n;
  };
  const part = (
    e: EerNode,
    r: EerNode,
    cardinality: Cardinality,
    opts: { total?: boolean; showMinMax?: boolean; min?: number; max?: number | null } = {},
  ) => {
    edges.push({
      id: id('p'), kind: 'participation', source: e.id, target: r.id,
      cardinality, total: opts.total ?? false,
      showMinMax: opts.showMinMax, min: opts.min, max: opts.max,
    });
  };
  const isa = (disjoint: boolean, total: boolean) => {
    const n: EerNode = { id: id('I'), kind: 'isa', name: 'ISA', x: 0, y: 0, w: 46, h: 46, disjoint, total };
    nodes.push(n);
    return n;
  };
  const link = (kind: EerEdge['kind'], source: string, target: string) =>
    edges.push({ id: id('l'), kind, source, target });

  return {
    entity, key, rel, part, isa, link,
    build: (): EerDiagram => ({ nodes, edges }),
  };
}

function data() {
  const nodes: InstanceNode[] = [];
  const edges: InstanceEdge[] = [];

  const set = (entityName: string, weak = false) => {
    const n: InstanceNode = {
      id: id('S'), kind: 'entity-set', name: entityName, entityName, weak,
      x: 0, y: 0, w: 220, h: 180,
    };
    nodes.push(n);
    return n;
  };
  const dot = (label: string, owner: InstanceNode) => {
    const n: InstanceNode = { id: id('i'), kind: 'instance', name: label, label, x: 0, y: 0, w: 18, h: 18 };
    nodes.push(n);
    edges.push({ id: id('m'), kind: 'member-of', source: n.id, target: owner.id });
    return n;
  };
  const relSet = (relationshipName: string) => {
    const n: InstanceNode = {
      id: id('T'), kind: 'rel-set', name: relationshipName, relationshipName,
      x: 0, y: 0, w: 120, h: 34,
    };
    nodes.push(n);
    return n;
  };
  const join = (a: InstanceNode, b: InstanceNode, rs: InstanceNode) =>
    edges.push({ id: id('k'), kind: 'instance-link', source: a.id, target: b.id, relSetId: rs.id });

  return { set, dot, relSet, join, build: (): InstanceDiagram => ({ nodes, edges }) };
}

const errors = (issues: { severity: string; message: string }[]) =>
  issues.filter((i) => i.severity === 'error').map((i) => i.message);

/* -------------------------------------------------------------------------- */
/* A 1:N schema: one department, many employees                               */
/* -------------------------------------------------------------------------- */

function worksForSchema() {
  const s = schema();
  const emp = s.entity('EMPLOYEE');
  const dept = s.entity('DEPARTMENT');
  s.key(emp, 'ssn');
  s.key(dept, 'dnumber');
  const worksFor = s.rel('WORKS_FOR');
  // Chen: the N-labelled side is the one that may take part only once.
  s.part(dept, worksFor, '1');
  s.part(emp, worksFor, 'N', { total: true });
  return s.build();
}

describe('instance data against a 1:N schema', () => {
  it('accepts data that respects the constraint', () => {
    const d = data();
    const emp = d.set('EMPLOYEE');
    const dept = d.set('DEPARTMENT');
    const rs = d.relSet('WORKS_FOR');
    const e1 = d.dot('e1', emp);
    const e2 = d.dot('e2', emp);
    const d1 = d.dot('d1', dept);
    d.join(e1, d1, rs);
    d.join(e2, d1, rs);

    expect(errors(checkAgainstSchema(d.build(), worksForSchema()))).toEqual([]);
  });

  // The whole reason to draw one of these.
  it('catches an employee working for two departments', () => {
    const d = data();
    const emp = d.set('EMPLOYEE');
    const dept = d.set('DEPARTMENT');
    const rs = d.relSet('WORKS_FOR');
    const e1 = d.dot('e1', emp);
    const d1 = d.dot('d1', dept);
    const d2 = d.dot('d2', dept);
    d.join(e1, d1, rs);
    d.join(e1, d2, rs);

    const found = errors(checkAgainstSchema(d.build(), worksForSchema()));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('takes part in 2 “WORKS_FOR” links');
    expect(found[0]).toContain('at most one');
  });

  it('catches total participation left unsatisfied', () => {
    const d = data();
    const emp = d.set('EMPLOYEE');
    d.set('DEPARTMENT');
    d.relSet('WORKS_FOR');
    d.dot('e1', emp);

    const found = errors(checkAgainstSchema(d.build(), worksForSchema()));
    expect(found.some((m) => m.includes('takes part in no “WORKS_FOR”'))).toBe(true);
  });

  it('reads (min,max) in the opposite direction from a ratio label', () => {
    const s = schema();
    const emp = s.entity('EMPLOYEE');
    const dept = s.entity('DEPARTMENT');
    s.key(emp, 'ssn');
    s.key(dept, 'dnumber');
    const worksFor = s.rel('WORKS_FOR');
    // The (1,1) side is the one restricted to a single link — the same side
    // that carries 'N' under Chen ratios.
    s.part(dept, worksFor, '1', { showMinMax: true, min: 1, max: null });
    s.part(emp, worksFor, 'N', { showMinMax: true, min: 1, max: 1 });

    const d = data();
    const emp2 = d.set('EMPLOYEE');
    const dept2 = d.set('DEPARTMENT');
    const rs = d.relSet('WORKS_FOR');
    const e1 = d.dot('e1', emp2);
    const d1 = d.dot('d1', dept2);
    const d2 = d.dot('d2', dept2);
    d.join(e1, d1, rs);
    d.join(e1, d2, rs);

    const found = errors(checkAgainstSchema(d.build(), s.build()));
    expect(found.some((m) => m.includes('e1') && m.includes('at most one'))).toBe(true);
  });

  it('rejects a link between the wrong entity types', () => {
    const d = data();
    const emp = d.set('EMPLOYEE');
    d.set('DEPARTMENT');
    const rs = d.relSet('WORKS_FOR');
    const e1 = d.dot('e1', emp);
    const e2 = d.dot('e2', emp);
    d.join(e1, e2, rs);

    const found = errors(checkAgainstSchema(d.build(), worksForSchema()));
    expect(found.some((m) => m.includes('but the schema relates'))).toBe(true);
  });

  it('rejects an entity set that names nothing in the schema', () => {
    const d = data();
    d.set('CUSTOMER');
    const found = errors(checkAgainstSchema(d.build(), worksForSchema()));
    expect(found.some((m) => m.includes('No entity type named “CUSTOMER”'))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Specialisation                                                             */
/* -------------------------------------------------------------------------- */

function specialisationSchema(disjoint: boolean, total: boolean) {
  const s = schema();
  const emp = s.entity('EMPLOYEE');
  s.key(emp, 'ssn');
  const sec = s.entity('SECRETARY');
  const eng = s.entity('ENGINEER');
  const marker = s.isa(disjoint, total);
  s.link('isa-super', emp.id, marker.id);
  s.link('isa-sub', sec.id, marker.id);
  s.link('isa-sub', eng.id, marker.id);
  return s.build();
}

describe('instance data against a specialisation', () => {
  it('catches a subclass member missing from its superclass', () => {
    const d = data();
    const emp = d.set('EMPLOYEE');
    const sec = d.set('SECRETARY');
    d.set('ENGINEER');
    d.dot('e1', emp);
    d.dot('e2', sec); // e2 is a secretary but not an employee

    const found = errors(checkAgainstSchema(d.build(), specialisationSchema(true, false)));
    expect(found.some((m) => m.includes('“e2” is in SECRETARY but not in its superclass'))).toBe(true);
  });

  it('catches one instance in two disjoint subclasses', () => {
    const d = data();
    const emp = d.set('EMPLOYEE');
    const sec = d.set('SECRETARY');
    const eng = d.set('ENGINEER');
    d.dot('e1', emp);
    d.dot('e1', sec);
    d.dot('e1', eng);

    const found = errors(checkAgainstSchema(d.build(), specialisationSchema(true, false)));
    expect(found.some((m) => m.includes('disjoint'))).toBe(true);
  });

  it('allows the same instance in two overlapping subclasses', () => {
    const d = data();
    const emp = d.set('EMPLOYEE');
    const sec = d.set('SECRETARY');
    const eng = d.set('ENGINEER');
    d.dot('e1', emp);
    d.dot('e1', sec);
    d.dot('e1', eng);

    const found = errors(checkAgainstSchema(d.build(), specialisationSchema(false, false)));
    expect(found.filter((m) => m.includes('disjoint'))).toEqual([]);
  });

  it('catches a superclass member in no subclass when the specialisation is total', () => {
    const d = data();
    const emp = d.set('EMPLOYEE');
    const sec = d.set('SECRETARY');
    d.set('ENGINEER');
    d.dot('e1', emp);
    d.dot('e1', sec);
    d.dot('e9', emp); // in no subclass

    const found = errors(checkAgainstSchema(d.build(), specialisationSchema(true, true)));
    expect(found.some((m) => m.includes('“e9” is in no subclass'))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Weak entities and things that cannot be checked                            */
/* -------------------------------------------------------------------------- */

describe('instance data against a weak entity', () => {
  function weakSchema() {
    const s = schema();
    const emp = s.entity('EMPLOYEE');
    s.key(emp, 'ssn');
    const dep = s.entity('DEPENDENT', true);
    s.key(dep, 'dname', true);
    const owns = s.rel('DEPENDENTS_OF', true);
    s.part(emp, owns, '1');
    s.part(dep, owns, 'N', { total: true });
    return s.build();
  }

  it('catches a dependent with no owner', () => {
    const d = data();
    const emp = d.set('EMPLOYEE');
    const dep = d.set('DEPENDENT', true);
    const rs = d.relSet('DEPENDENTS_OF');
    const e1 = d.dot('e1', emp);
    d.dot('dep1', dep);
    const dep2 = d.dot('dep2', dep);
    d.join(dep2, e1, rs);

    const found = errors(checkAgainstSchema(d.build(), weakSchema()));
    expect(found.some((m) => m.includes('“dep1” is identified by 0'))).toBe(true);
  });

  it('warns when a set contradicts the schema on weakness', () => {
    const d = data();
    d.set('DEPENDENT', false);
    const issues = checkAgainstSchema(d.build(), weakSchema());
    expect(
      issues.some((i) => i.severity === 'warning' && i.message.includes('weak entity in the schema')),
    ).toBe(true);
  });
});

describe('what the checker declines to check', () => {
  it('says so for a recursive relationship rather than guessing', () => {
    const s = schema();
    const emp = s.entity('EMPLOYEE');
    s.key(emp, 'ssn');
    const sup = s.rel('SUPERVISION');
    s.part(emp, sup, '1');
    s.part(emp, sup, 'N');

    const d = data();
    const set = d.set('EMPLOYEE');
    const rs = d.relSet('SUPERVISION');
    const e1 = d.dot('e1', set);
    const e2 = d.dot('e2', set);
    const e3 = d.dot('e3', set);
    d.join(e1, e2, rs);
    d.join(e1, e3, rs);

    const issues = checkAgainstSchema(d.build(), s.build());
    expect(errors(issues)).toEqual([]);
    expect(issues.some((i) => i.message.includes('recursive'))).toBe(true);
  });

  it('warns about links with no relationship set assigned', () => {
    const d = data();
    const emp = d.set('EMPLOYEE');
    const dept = d.set('DEPARTMENT');
    const e1 = d.dot('e1', emp);
    const d1 = d.dot('d1', dept);
    const diagram = d.build();
    diagram.edges.push({ id: 'loose', kind: 'instance-link', source: e1.id, target: d1.id });

    const issues = checkAgainstSchema(diagram, worksForSchema());
    expect(
      issues.some((i) => i.severity === 'warning' && i.message.includes('not assigned')),
    ).toBe(true);
  });
});
