import { describe, expect, it } from 'vitest';
import { validate } from './validate';
import { companySample, categorySample } from './samples';
import type {
  AttributeNode,
  Diagram,
  DiagramNode,
  Edge,
  EdgeKind,
  EntityNode,
  IsaNode,
  RelationshipNode,
  UnionNode,
} from './types';

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

let seq = 0;
const id = (p: string) => `${p}${++seq}`;

/**
 * A tiny scene builder. The checker only reads structure, so positions and
 * sizes are filler; what matters is which nodes exist and how they are wired.
 */
function scene() {
  const nodes: DiagramNode[] = [];
  const edges: Edge[] = [];

  const entity = (name: string, weak = false): EntityNode => {
    const n: EntityNode = { id: id('E'), kind: 'entity', name, x: 0, y: 0, w: 140, h: 60, weak };
    nodes.push(n);
    return n;
  };

  const attr = (
    owner: DiagramNode,
    name: string,
    extra: Partial<AttributeNode> = {},
  ): AttributeNode => {
    const a: AttributeNode = {
      id: id('A'),
      kind: 'attribute',
      name,
      x: 0,
      y: 0,
      w: 120,
      h: 48,
      key: false,
      partialKey: false,
      multivalued: false,
      derived: false,
      dataType: 'VARCHAR(255)',
      nullable: true,
      ...extra,
    };
    nodes.push(a);
    edges.push({ id: id('x'), kind: 'attribute', source: a.id, target: owner.id });
    return a;
  };

  /** An attribute with no owner edge, for the "floating" cases. */
  const looseAttr = (name: string, extra: Partial<AttributeNode> = {}): AttributeNode => {
    const a: AttributeNode = {
      id: id('A'),
      kind: 'attribute',
      name,
      x: 0,
      y: 0,
      w: 120,
      h: 48,
      key: false,
      partialKey: false,
      multivalued: false,
      derived: false,
      dataType: 'VARCHAR(255)',
      nullable: true,
      ...extra,
    };
    nodes.push(a);
    return a;
  };

  const rel = (name: string, identifying = false): RelationshipNode => {
    const n: RelationshipNode = {
      id: id('R'),
      kind: 'relationship',
      name,
      x: 0,
      y: 0,
      w: 130,
      h: 74,
      identifying,
    };
    nodes.push(n);
    return n;
  };

  const part = (
    e: EntityNode,
    r: RelationshipNode,
    extra: Partial<Edge> = {},
  ): Edge => {
    const edge: Edge = {
      id: id('p'),
      kind: 'participation',
      source: e.id,
      target: r.id,
      cardinality: 'N',
      total: false,
      ...extra,
    };
    edges.push(edge);
    return edge;
  };

  const isa = (extra: Partial<IsaNode> = {}): IsaNode => {
    const n: IsaNode = {
      id: id('I'),
      kind: 'isa',
      name: 'ISA',
      x: 0,
      y: 0,
      w: 74,
      h: 54,
      disjoint: true,
      total: false,
      ...extra,
    };
    nodes.push(n);
    return n;
  };

  const union = (extra: Partial<UnionNode> = {}): UnionNode => {
    const n: UnionNode = {
      id: id('U'),
      kind: 'union',
      name: 'U',
      x: 0,
      y: 0,
      w: 44,
      h: 44,
      total: false,
      ...extra,
    };
    nodes.push(n);
    return n;
  };

  const link = (kind: EdgeKind, source: string, target: string): Edge => {
    const edge: Edge = { id: id('l'), kind, source, target };
    edges.push(edge);
    return edge;
  };

  /** A well-formed strong entity: named, with a key. The baseline for "clean". */
  const strong = (name: string): EntityNode => {
    const e = entity(name);
    attr(e, `${name.toLowerCase()}_id`, { key: true });
    return e;
  };

  return {
    entity,
    strong,
    attr,
    looseAttr,
    rel,
    part,
    isa,
    union,
    link,
    diagram: (): Diagram => ({ nodes, edges }),
  };
}

/* -------------------------------------------------------------------------- */
/* Assertions                                                                 */
/* -------------------------------------------------------------------------- */

const at = (severity: string) => (d: Diagram) =>
  validate(d).filter((i) => i.severity === severity).map((i) => i.message);

const errors = at('error');
const warnings = at('warning');
const infos = at('info');

const saying = (messages: string[], fragment: string) =>
  messages.some((m) => m.includes(fragment));

/* -------------------------------------------------------------------------- */
/* Names                                                                      */
/* -------------------------------------------------------------------------- */

describe('names', () => {
  it('wants every entity named', () => {
    const s = scene();
    s.entity('   ');
    expect(saying(errors(s.diagram()), 'An unnamed entity needs a name.')).toBe(true);
  });

  it('flags two entities sharing a name, and says "entities"', () => {
    const s = scene();
    s.strong('Student');
    s.strong('STUDENT');
    const found = warnings(s.diagram());
    expect(saying(found, 'share the name')).toBe(true);
    // The message is read by students, so it has to be English.
    expect(saying(found, 'entitys')).toBe(false);
    expect(saying(found, '2 entities share the name "student".')).toBe(true);
  });

  // Two entities can legitimately both have a `name` attribute; complaining
  // about that would bury the warnings that matter.
  it('does not mind two attributes sharing a name', () => {
    const s = scene();
    const a = s.strong('Student');
    const b = s.strong('Course');
    s.attr(a, 'title');
    s.attr(b, 'title');
    expect(saying(warnings(s.diagram()), 'share the name')).toBe(false);
  });

  // The specialisation and union markers carry a fixed glyph, not a name.
  it('does not ask an ISA or union marker for a name', () => {
    const s = scene();
    const sup = s.strong('Person');
    const sub = s.entity('Student');
    const i = s.isa();
    s.link('isa-super', sup.id, i.id);
    s.link('isa-sub', sub.id, i.id);
    expect(saying(errors(s.diagram()), 'needs a name')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Entities                                                                   */
/* -------------------------------------------------------------------------- */

describe('entities', () => {
  it('accepts a named entity with a key', () => {
    const s = scene();
    s.strong('Student');
    expect(validate(s.diagram())).toEqual([]);
  });

  it('warns about an entity with no attributes at all', () => {
    const s = scene();
    s.entity('Ghost');
    expect(saying(warnings(s.diagram()), 'has no attributes')).toBe(true);
  });

  it('reports an entity with attributes but no key', () => {
    const s = scene();
    const e = s.entity('Student');
    s.attr(e, 'name');
    expect(saying(errors(s.diagram()), 'has no key attribute')).toBe(true);
  });

  // A subclass inherits its superclass's key, so demanding one of its own
  // would flag every correct specialisation.
  it('does not demand a key from a subclass', () => {
    const s = scene();
    const sup = s.strong('Person');
    const sub = s.entity('Student');
    s.attr(sub, 'gpa');
    const i = s.isa();
    s.link('isa-super', sup.id, i.id);
    s.link('isa-sub', sub.id, i.id);
    expect(saying(errors(s.diagram()), 'has no key attribute')).toBe(false);
  });

  it('does not demand a key from a category entity', () => {
    const s = scene();
    const owner = s.strong('Person');
    const firm = s.strong('Company');
    const cat = s.entity('Owner');
    s.attr(cat, 'since');
    const u = s.union();
    s.link('union-sub', cat.id, u.id);
    s.link('union-super', owner.id, u.id);
    s.link('union-super', firm.id, u.id);
    expect(saying(errors(s.diagram()), 'has no key attribute')).toBe(false);
  });
});

describe('weak entities', () => {
  /** A weak entity done properly: partial key, identifying relationship, strong owner. */
  function wellFormed() {
    const s = scene();
    const owner = s.strong('Employee');
    const weak = s.entity('Dependent', true);
    s.attr(weak, 'dependent_name', { partialKey: true });
    const r = s.rel('has', true);
    s.part(owner, r, { cardinality: '1' });
    s.part(weak, r, { cardinality: 'N', total: true });
    return s;
  }

  it('accepts one that is properly identified', () => {
    expect(validate(wellFormed().diagram())).toEqual([]);
  });

  it('requires a partial key', () => {
    const s = scene();
    const owner = s.strong('Employee');
    const weak = s.entity('Dependent', true);
    s.attr(weak, 'age');
    const r = s.rel('has', true);
    s.part(owner, r);
    s.part(weak, r);
    expect(saying(errors(s.diagram()), 'needs a partial key (discriminator)')).toBe(true);
  });

  it('requires an identifying relationship with a strong owner', () => {
    const s = scene();
    const weak = s.entity('Dependent', true);
    s.attr(weak, 'dependent_name', { partialKey: true });
    expect(
      saying(errors(s.diagram()), 'not attached to an identifying relationship'),
    ).toBe(true);
  });

  // A weak entity may own another weak entity: the borrowed key just cascades
  // down the chain, as long as it bottoms out at a strong entity.
  it('accepts an ownership chain two levels deep', () => {
    const s = wellFormed();
    const mid = s.diagram().nodes.find((n) => n.name === 'Dependent') as EntityNode;
    const inner = s.entity('Medication', true);
    s.attr(inner, 'drug_name', { partialKey: true });
    const r = s.rel('takes', true);
    s.part(mid, r, { cardinality: '1' });
    s.part(inner, r, { cardinality: 'N', total: true });
    expect(validate(s.diagram())).toEqual([]);
  });

  // Two weak entities leaning on each other never reach a real key.
  it('does not accept another weak entity as the owner', () => {
    const s = scene();
    const a = s.entity('Dependent', true);
    s.attr(a, 'dependent_name', { partialKey: true });
    const b = s.entity('Visit', true);
    s.attr(b, 'visit_no', { partialKey: true });
    const r = s.rel('has', true);
    s.part(a, r);
    s.part(b, r);
    expect(
      saying(errors(s.diagram()), 'never reaches a strong owner'),
    ).toBe(true);
  });

  it('warns when a weak entity has a full key of its own', () => {
    const s = wellFormed();
    const weak = s.diagram().nodes.find((n) => n.name === 'Dependent') as EntityNode;
    s.attr(weak, 'ssn', { key: true });
    expect(saying(warnings(s.diagram()), 'has a full key attribute')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Relationships                                                              */
/* -------------------------------------------------------------------------- */

describe('relationships', () => {
  it('reports one with no legs', () => {
    const s = scene();
    s.rel('floats');
    expect(saying(errors(s.diagram()), 'is not connected to any entity')).toBe(true);
  });

  it('reports one with a single leg', () => {
    const s = scene();
    const e = s.strong('Student');
    s.part(e, s.rel('dangles'));
    expect(saying(errors(s.diagram()), 'has only one leg')).toBe(true);
  });

  // Without roles there is no way to say which end of SUPERVISES is which.
  it('requires role names on a recursive relationship', () => {
    const s = scene();
    const e = s.strong('Employee');
    const r = s.rel('supervises');
    s.part(e, r, { cardinality: '1' });
    s.part(e, r, { cardinality: 'N' });
    expect(saying(errors(s.diagram()), 'needs a role name on every leg')).toBe(true);
  });

  it('points at the legs that are missing a role, not just the diamond', () => {
    const s = scene();
    const e = s.strong('Employee');
    const r = s.rel('supervises');
    const supervisor = s.part(e, r, { cardinality: '1', role: 'supervisor' });
    const supervisee = s.part(e, r, { cardinality: 'N' });

    const issue = validate(s.diagram()).find((i) => i.message.includes('role name'))!;
    expect(issue.targets).toContain(supervisee.id);
    expect(issue.targets).not.toContain(supervisor.id);
  });

  it('accepts a recursive relationship once both legs have roles', () => {
    const s = scene();
    const e = s.strong('Employee');
    const r = s.rel('supervises');
    s.part(e, r, { cardinality: '1', role: 'supervisor' });
    s.part(e, r, { cardinality: 'N', role: 'supervisee' });
    expect(validate(s.diagram())).toEqual([]);
  });

  it('warns about an identifying relationship with no weak entity on it', () => {
    const s = scene();
    const a = s.strong('Employee');
    const b = s.strong('Department');
    const r = s.rel('works_for', true);
    s.part(a, r);
    s.part(b, r);
    expect(saying(warnings(s.diagram()), 'has no weak entity attached')).toBe(true);
  });

  it('warns when an identifying relationship is not binary', () => {
    const s = scene();
    const owner = s.strong('Employee');
    const other = s.strong('Department');
    const weak = s.entity('Dependent', true);
    s.attr(weak, 'dependent_name', { partialKey: true });
    const r = s.rel('has', true);
    s.part(owner, r);
    s.part(other, r);
    s.part(weak, r);
    expect(saying(warnings(s.diagram()), 'should normally be binary')).toBe(true);
  });

  // In an n-ary relationship the key is the combination of the participants.
  it('warns about a key attribute on an n-ary relationship', () => {
    const s = scene();
    const r = s.rel('supplies');
    s.part(s.strong('Supplier'), r);
    s.part(s.strong('Part'), r);
    s.part(s.strong('Project'), r);
    s.attr(r, 'contract_no', { key: true });
    expect(saying(warnings(s.diagram()), 'are unusual')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Attributes                                                                 */
/* -------------------------------------------------------------------------- */

describe('attributes', () => {
  it('reports one attached to nothing', () => {
    const s = scene();
    s.strong('Student');
    s.looseAttr('orphan');
    expect(saying(errors(s.diagram()), 'is not attached to anything')).toBe(true);
  });

  it('reports one attached to two owners', () => {
    const s = scene();
    const a = s.strong('Student');
    const b = s.strong('Course');
    const shared = s.attr(a, 'code');
    s.link('attribute', shared.id, b.id);
    expect(saying(errors(s.diagram()), 'is attached to 2 owners')).toBe(true);
  });

  it('refuses an attribute that is both key and partial key', () => {
    const s = scene();
    const e = s.entity('Dependent', true);
    s.attr(e, 'name', { key: true, partialKey: true });
    expect(saying(errors(s.diagram()), 'both a key and a partial key')).toBe(true);
  });

  it('refuses a multivalued key', () => {
    const s = scene();
    const e = s.entity('Student');
    s.attr(e, 'id', { key: true, multivalued: true });
    expect(saying(errors(s.diagram()), 'cannot be multivalued')).toBe(true);
  });

  it('notes that a composite key is flattened in the SQL', () => {
    const s = scene();
    const e = s.entity('Student');
    const composite = s.attr(e, 'full_name', { key: true });
    s.attr(composite, 'first');
    s.attr(composite, 'last');
    expect(saying(infos(s.diagram()), 'flattened into its component columns')).toBe(true);
  });

  it('notes a derived attribute with no rule recorded', () => {
    const s = scene();
    const e = s.strong('Employee');
    s.attr(e, 'age', { derived: true });
    expect(saying(infos(s.diagram()), 'has no derivation rule recorded')).toBe(true);
  });

  it('says nothing once the derivation is written down', () => {
    const s = scene();
    const e = s.strong('Employee');
    s.attr(e, 'age', { derived: true, derivation: 'today - dob' });
    expect(saying(infos(s.diagram()), 'derivation rule')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Specialisation                                                             */
/* -------------------------------------------------------------------------- */

describe('specialisation', () => {
  it('reports a marker with no superclass', () => {
    const s = scene();
    const sub = s.entity('Student');
    s.attr(sub, 'gpa');
    const i = s.isa();
    s.link('isa-sub', sub.id, i.id);
    expect(saying(errors(s.diagram()), 'has no superclass attached')).toBe(true);
  });

  it('reports a marker with no subclasses', () => {
    const s = scene();
    const sup = s.strong('Person');
    const i = s.isa();
    s.link('isa-super', sup.id, i.id);
    expect(saying(errors(s.diagram()), 'has no subclasses')).toBe(true);
  });

  // With one subclass there is nothing for d or o to distinguish.
  it('notes that disjointness is moot with a single subclass', () => {
    const s = scene();
    const sup = s.strong('Person');
    const sub = s.entity('Student');
    s.attr(sub, 'gpa');
    const i = s.isa({ disjoint: true });
    s.link('isa-super', sup.id, i.id);
    s.link('isa-sub', sub.id, i.id);
    expect(saying(infos(s.diagram()), 'has no effect')).toBe(true);
  });

  it('refuses an entity that is its own superclass', () => {
    const s = scene();
    const e = s.strong('Person');
    const i = s.isa();
    s.link('isa-super', e.id, i.id);
    s.link('isa-sub', e.id, i.id);
    expect(
      saying(errors(s.diagram()), 'is both the superclass and a subclass'),
    ).toBe(true);
  });

  it('catches a specialisation cycle two levels deep', () => {
    const s = scene();
    const a = s.strong('A');
    const b = s.strong('B');
    const up = s.isa();
    const down = s.isa();
    s.link('isa-super', a.id, up.id);
    s.link('isa-sub', b.id, up.id); // B ISA A
    s.link('isa-super', b.id, down.id);
    s.link('isa-sub', a.id, down.id); // A ISA B
    expect(saying(errors(s.diagram()), 'Specialisation cycle')).toBe(true);
  });

  // Multiple inheritance is legal EER, so this is a note, not a complaint.
  it('notes a shared subclass without treating it as a mistake', () => {
    const s = scene();
    const employee = s.strong('Employee');
    const student = s.strong('Student');
    const both = s.entity('StudentAssistant');
    s.attr(both, 'hours');
    const i1 = s.isa();
    const i2 = s.isa();
    s.link('isa-super', employee.id, i1.id);
    s.link('isa-sub', both.id, i1.id);
    s.link('isa-super', student.id, i2.id);
    s.link('isa-sub', both.id, i2.id);

    expect(saying(infos(s.diagram()), 'is a shared subclass of 2 specialisations')).toBe(true);
    expect(errors(s.diagram())).toEqual([]);
  });

  it('warns when a subclass declares its own key', () => {
    const s = scene();
    const sup = s.strong('Person');
    const sub = s.entity('Student');
    s.attr(sub, 'student_no', { key: true });
    const i = s.isa();
    s.link('isa-super', sup.id, i.id);
    s.link('isa-sub', sub.id, i.id);
    expect(saying(warnings(s.diagram()), 'declares its own key')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Union / category types                                                     */
/* -------------------------------------------------------------------------- */

describe('union types', () => {
  it('reports a union with no category entity', () => {
    const s = scene();
    const a = s.strong('Person');
    const b = s.strong('Company');
    const u = s.union();
    s.link('union-super', a.id, u.id);
    s.link('union-super', b.id, u.id);
    expect(saying(errors(s.diagram()), 'has no category entity attached')).toBe(true);
  });

  // One superclass is a specialisation wearing a union's clothes.
  it('requires at least two superclasses', () => {
    const s = scene();
    const owner = s.strong('Person');
    const cat = s.entity('Owner');
    s.attr(cat, 'since');
    const u = s.union();
    s.link('union-sub', cat.id, u.id);
    s.link('union-super', owner.id, u.id);
    expect(saying(errors(s.diagram()), 'needs at least two superclasses')).toBe(true);
  });

  it('warns when a superclass has no key for the category to reference', () => {
    const s = scene();
    const person = s.strong('Person');
    const company = s.entity('Company');
    s.attr(company, 'trading_name');
    const cat = s.entity('Owner');
    s.attr(cat, 'since');
    const u = s.union();
    s.link('union-sub', cat.id, u.id);
    s.link('union-super', person.id, u.id);
    s.link('union-super', company.id, u.id);
    expect(saying(warnings(s.diagram()), 'so the category cannot reference it')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                               */
/* -------------------------------------------------------------------------- */

describe('the checker itself', () => {
  it('reports an edge left pointing at a deleted node', () => {
    const s = scene();
    const e = s.strong('Student');
    s.link('participation', e.id, 'gone');
    expect(saying(errors(s.diagram()), 'points at a node that no longer exists')).toBe(true);
  });

  // The same problem is reachable from both the entity and the relationship.
  it('reports each problem once', () => {
    const s = scene();
    s.entity('Ghost');
    const found = validate(s.diagram()).map((i) => i.message);
    expect(new Set(found).size).toBe(found.length);
  });

  it('puts errors before warnings before notes', () => {
    const s = scene();
    s.entity('Nameless'); // warning: no attributes
    const e = s.entity('Student'); // error: no key
    s.attr(e, 'age', { derived: true }); // info: no derivation rule
    const severities = validate(s.diagram()).map((i) => i.severity);
    expect(severities).toEqual([...severities].sort((a, b) => {
      const rank = { error: 0, warning: 1, info: 2 } as const;
      return rank[a] - rank[b];
    }));
    expect(severities[0]).toBe('error');
    expect(severities[severities.length - 1]).toBe('info');
  });

  it('finds nothing wrong with the samples the app ships', () => {
    expect(errors(companySample())).toEqual([]);
    expect(errors(categorySample())).toEqual([]);
  });
});
