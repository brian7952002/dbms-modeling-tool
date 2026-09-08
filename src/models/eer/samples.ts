import { newId } from '../../platform/ids';
import { fitSize } from './sizing';
import type {
  AttributeNode,
  Cardinality,
  Diagram,
  DiagramNode,
  Edge,
  Id,
  NodeKind,
} from './types';

/**
 * Tiny builder so the bundled examples read like the diagrams they describe
 * rather than like a wall of literals.
 */
class Build {
  nodes: DiagramNode[] = [];
  edges: Edge[] = [];

  private push<T extends DiagramNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  private base(kind: NodeKind, x: number, y: number, name: string) {
    return { id: newId(kind[0]), x, y, ...fitSize(kind, name) };
  }

  entity(name: string, x: number, y: number, weak = false) {
    return this.push({ ...this.base('entity', x, y, name), kind: 'entity' as const, name, weak });
  }

  rel(name: string, x: number, y: number, identifying = false) {
    return this.push({
      ...this.base('relationship', x, y, name),
      kind: 'relationship' as const,
      name,
      identifying,
    });
  }

  attr(
    owner: DiagramNode,
    name: string,
    x: number,
    y: number,
    opts: Partial<Omit<AttributeNode, 'kind' | 'id' | 'name'>> = {},
  ) {
    const a = this.push({
      ...this.base('attribute', x, y, name),
      kind: 'attribute' as const,
      name,
      key: false,
      partialKey: false,
      multivalued: false,
      derived: false,
      dataType: 'VARCHAR(255)',
      nullable: true,
      ...opts,
    });
    this.edges.push({ id: newId('e'), kind: 'attribute', source: a.id, target: owner.id });
    return a;
  }

  isa(x: number, y: number, disjoint: boolean, total: boolean) {
    return this.push({
      ...this.base('isa', x, y, 'ISA'),
      kind: 'isa' as const,
      name: 'ISA',
      disjoint,
      total,
    });
  }

  union(x: number, y: number, total: boolean) {
    return this.push({
      ...this.base('union', x, y, 'U'),
      kind: 'union' as const,
      name: 'U',
      total,
    });
  }

  part(
    entity: DiagramNode,
    rel: DiagramNode,
    cardinality: Cardinality,
    opts: { total?: boolean; role?: string; min?: number; max?: number | null } = {},
  ) {
    this.edges.push({
      id: newId('e'),
      kind: 'participation',
      source: entity.id,
      target: rel.id,
      cardinality,
      total: opts.total ?? false,
      role: opts.role,
      min: opts.min ?? (opts.total ? 1 : 0),
      max: opts.max === undefined ? (cardinality === '1' ? null : 1) : opts.max,
    });
  }

  link(kind: Edge['kind'], source: Id, target: Id) {
    this.edges.push({ id: newId('e'), kind, source, target });
  }

  done(): Diagram {
    return { nodes: this.nodes, edges: this.edges };
  }
}

/**
 * The classic COMPANY schema, chosen because it exercises every construct the
 * editor supports: a weak entity with an identifying relationship, a recursive
 * relationship with role names, total participation, an M:N relationship that
 * carries its own attribute, composite/multivalued/derived attributes, and a
 * partial-disjoint specialisation.
 */
export function companySample(): Diagram {
  const b = new Build();

  const emp = b.entity('EMPLOYEE', 470, 430);
  const name = b.attr(emp, 'name', 200, 300);
  b.attr(name, 'fname', 20, 235);
  b.attr(name, 'minit', 5, 310, { dataType: 'CHAR(1)' });
  b.attr(name, 'lname', 20, 385);
  b.attr(emp, 'ssn', 195, 405, { key: true, dataType: 'CHAR(9)', nullable: false });
  b.attr(emp, 'birth_date', 195, 495, { dataType: 'DATE' });
  b.attr(emp, 'salary', 215, 585, { dataType: 'DECIMAL(10,2)' });
  b.attr(emp, 'age', 275, 675, { derived: true, dataType: 'INTEGER', derivation: 'today - birth_date' });

  const dept = b.entity('DEPARTMENT', 940, 150);
  b.attr(dept, 'dname', 1180, 75);
  b.attr(dept, 'dnumber', 1180, 160, { key: true, dataType: 'INTEGER', nullable: false });
  b.attr(dept, 'locations', 1180, 245, { multivalued: true, dataType: 'VARCHAR(50)' });
  b.attr(dept, 'num_employees', 940, 40, { derived: true, dataType: 'INTEGER', derivation: 'COUNT(employees)' });

  const worksFor = b.rel('WORKS_FOR', 705, 285);
  b.part(emp, worksFor, 'N', { total: true, min: 1, max: 1 });
  b.part(dept, worksFor, '1', { total: true, min: 1, max: null });

  const supervision = b.rel('SUPERVISION', 470, 175);
  b.part(emp, supervision, '1', { role: 'supervisor', min: 0, max: null });
  b.part(emp, supervision, 'N', { role: 'supervisee', min: 0, max: 1 });

  const dependentsOf = b.rel('DEPENDENTS_OF', 600, 620, true);
  const dependent = b.entity('DEPENDENT', 740, 800, true);
  b.part(emp, dependentsOf, '1', { min: 0, max: null });
  b.part(dependent, dependentsOf, 'N', { total: true, min: 1, max: 1 });
  b.attr(dependent, 'dependent_name', 985, 730, { partialKey: true, nullable: false });
  b.attr(dependent, 'sex', 985, 815, { dataType: 'CHAR(1)' });
  b.attr(dependent, 'birth_date', 985, 900, { dataType: 'DATE' });
  b.attr(dependent, 'relation', 985, 985, { dataType: 'VARCHAR(50)' });

  const project = b.entity('PROJECT', 1120, 640);
  b.attr(project, 'pname', 1360, 565);
  b.attr(project, 'pnumber', 1360, 650, { key: true, dataType: 'INTEGER', nullable: false });
  b.attr(project, 'plocation', 1360, 735, { dataType: 'VARCHAR(50)' });

  const worksOn = b.rel('WORKS_ON', 800, 520);
  b.part(emp, worksOn, 'M', { min: 0, max: null });
  b.part(project, worksOn, 'N', { total: true, min: 1, max: null });
  b.attr(worksOn, 'hours', 820, 400, { dataType: 'DECIMAL(5,1)' });

  const controls = b.rel('CONTROLS', 1030, 395);
  b.part(dept, controls, '1', { min: 0, max: null });
  b.part(project, controls, 'N', { total: true, min: 1, max: 1 });

  const isa = b.isa(340, 810, true, false);
  b.link('isa-super', emp.id, isa.id);
  const secretary = b.entity('SECRETARY', 190, 950);
  const engineer = b.entity('ENGINEER', 470, 950);
  b.link('isa-sub', secretary.id, isa.id);
  b.link('isa-sub', engineer.id, isa.id);
  b.attr(secretary, 'typing_speed', 120, 1075, { dataType: 'INTEGER' });
  b.attr(engineer, 'eng_type', 540, 1075, { dataType: 'VARCHAR(50)' });

  return b.done();
}

/**
 * A small union (category) type: OWNER is a subclass whose members are drawn
 * from two unrelated superclasses, which is exactly the case a plain ISA cannot
 * express.
 */
export function categorySample(): Diagram {
  const b = new Build();

  const person = b.entity('PERSON', 220, 200);
  b.attr(person, 'ssn', 40, 120, { key: true, dataType: 'CHAR(9)', nullable: false });
  b.attr(person, 'pname', 30, 250);
  b.attr(person, 'address', 130, 330);

  const company = b.entity('COMPANY', 220, 560);
  b.attr(company, 'cname', 40, 480, { key: true, nullable: false });
  b.attr(company, 'hq_address', 30, 640);

  const u = b.union(470, 380, false);
  b.link('union-super', person.id, u.id);
  b.link('union-super', company.id, u.id);

  const owner = b.entity('OWNER', 700, 380);
  b.link('union-sub', owner.id, u.id);
  b.attr(owner, 'owner_since', 700, 235, { dataType: 'DATE' });

  const owns = b.rel('OWNS', 930, 380);
  const vehicle = b.entity('VEHICLE', 1170, 380);
  b.part(owner, owns, '1', { min: 0, max: null });
  b.part(vehicle, owns, 'N', { total: true, min: 1, max: 1 });
  b.attr(vehicle, 'vin', 1380, 290, { key: true, dataType: 'CHAR(17)', nullable: false });
  b.attr(vehicle, 'model', 1380, 400);
  b.attr(vehicle, 'purchase_price', 1330, 500, { dataType: 'DECIMAL(10,2)' });

  return b.done();
}

export const SAMPLES = [
  {
    id: 'company',
    title: 'Company schema',
    blurb:
      'Weak entity, recursive relationship, ISA specialisation, M:N with attributes.',
    build: companySample,
  },
  {
    id: 'category',
    title: 'Union / category type',
    blurb: 'OWNER as a category drawn from PERSON and COMPANY.',
    build: categorySample,
  },
] as const;
