import { describe, expect, it } from 'vitest';
import { validate } from './validate';
import { worksForSample } from './samples';
import type {
  Diagram,
  DiagramNode,
  Edge,
  EntitySetNode,
  InstanceNode,
  RelSetNode,
} from './types';
import type { Diagram as EerDiagram, DiagramNode as EerNode } from '../eer/types';

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

let seq = 0;
const id = (p: string) => `${p}${++seq}`;

function scene() {
  const nodes: DiagramNode[] = [];
  const edges: Edge[] = [];

  const set = (entityName: string, weak = false): EntitySetNode => {
    const n: EntitySetNode = {
      id: id('S'),
      kind: 'entity-set',
      name: entityName,
      entityName,
      x: 0,
      y: 0,
      w: 220,
      h: 180,
      weak,
    };
    nodes.push(n);
    return n;
  };

  /** A dot, optionally dropped into a set. */
  const dot = (label: string, owner?: EntitySetNode): InstanceNode => {
    const n: InstanceNode = {
      id: id('i'),
      kind: 'instance',
      name: label,
      label,
      x: 0,
      y: 0,
      w: 18,
      h: 18,
    };
    nodes.push(n);
    if (owner) edges.push({ id: id('m'), kind: 'member-of', source: n.id, target: owner.id });
    return n;
  };

  const relSet = (relationshipName: string): RelSetNode => {
    const n: RelSetNode = {
      id: id('R'),
      kind: 'rel-set',
      name: relationshipName,
      relationshipName,
      x: 0,
      y: 0,
      w: 120,
      h: 34,
    };
    nodes.push(n);
    return n;
  };

  const memberOf = (i: InstanceNode, s: EntitySetNode) =>
    edges.push({ id: id('m'), kind: 'member-of', source: i.id, target: s.id });

  const link = (a: InstanceNode, b: InstanceNode, relSetId?: string) =>
    edges.push({ id: id('l'), kind: 'instance-link', source: a.id, target: b.id, relSetId });

  return { set, dot, relSet, memberOf, link, diagram: (): Diagram => ({ nodes, edges }) };
}

/* -------------------------------------------------------------------------- */
/* Assertions                                                                 */
/* -------------------------------------------------------------------------- */

const at = (severity: string) => (d: Diagram, source: EerDiagram | null = null) =>
  validate(d, { source }).filter((i) => i.severity === severity).map((i) => i.message);

const errors = at('error');
const warnings = at('warning');
const infos = at('info');

const saying = (messages: string[], fragment: string) =>
  messages.some((m) => m.includes(fragment));

/* -------------------------------------------------------------------------- */
/* Structure of the drawing                                                   */
/* -------------------------------------------------------------------------- */

describe('sample data on its own', () => {
  it('accepts instances sitting in a named set', () => {
    const s = scene();
    const set = s.set('EMPLOYEE');
    s.dot('e1', set);
    s.dot('e2', set);
    expect(errors(s.diagram())).toEqual([]);
    expect(warnings(s.diagram())).toEqual([]);
  });

  it('reports instances drawn with no set to belong to', () => {
    const s = scene();
    s.dot('e1');
    expect(saying(errors(s.diagram()), 'no entity set to put them in')).toBe(true);
  });

  it('wants every set named', () => {
    const s = scene();
    const set = s.set('   ');
    s.dot('e1', set);
    expect(saying(errors(s.diagram()), 'An entity set needs a name.')).toBe(true);
  });

  it('warns about two sets standing for the same entity type', () => {
    const s = scene();
    const a = s.set('EMPLOYEE');
    const b = s.set('employee');
    s.dot('e1', a);
    s.dot('e2', b);
    const found = warnings(s.diagram());
    expect(saying(found, 'share the name')).toBe(true);
    // "both" only reads correctly for two, and this rule fires for any number.
    expect(saying(found, 'are both named')).toBe(false);
  });

  it('says "3 entity sets" when there are three of them', () => {
    const s = scene();
    for (const _ of [0, 1, 2]) s.dot('e1', s.set('EMPLOYEE'));
    expect(saying(warnings(s.diagram()), '3 entity sets share the name')).toBe(true);
  });

  it('reports an instance belonging to no set', () => {
    const s = scene();
    s.dot('e1', s.set('EMPLOYEE'));
    s.dot('stray');
    expect(saying(errors(s.diagram()), 'does not belong to an entity set')).toBe(true);
  });

  // An instance is a row; a row lives in exactly one table.
  it('reports an instance belonging to two sets', () => {
    const s = scene();
    const a = s.set('EMPLOYEE');
    const b = s.set('DEPARTMENT');
    const i = s.dot('e1', a);
    s.memberOf(i, b);
    expect(saying(errors(s.diagram()), 'belongs to 2 entity sets')).toBe(true);
  });

  // A label stands for the instance's key, so repeating it inside one set
  // is drawing the same row twice.
  it('warns about a repeated label inside one set', () => {
    const s = scene();
    const set = s.set('EMPLOYEE');
    s.dot('e1', set);
    s.dot('e1', set);
    expect(saying(warnings(s.diagram()), 'instance labels stand for keys')).toBe(true);
  });

  it('allows the same label in two different sets', () => {
    const s = scene();
    s.dot('x1', s.set('EMPLOYEE'));
    s.dot('x1', s.set('DEPARTMENT'));
    expect(saying(warnings(s.diagram()), 'instance labels stand for keys')).toBe(false);
  });

  it('warns about a link touching an instance that is in no set', () => {
    const s = scene();
    const set = s.set('EMPLOYEE');
    const inside = s.dot('e1', set);
    const outside = s.dot('e2');
    s.link(inside, outside);
    expect(saying(warnings(s.diagram()), 'not in any entity set')).toBe(true);
  });

  it('finds nothing wrong with the sample the app ships', () => {
    expect(errors(worksForSample())).toEqual([]);
    expect(warnings(worksForSample())).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The link to a schema                                                       */
/* -------------------------------------------------------------------------- */

describe('checking against a linked schema', () => {
  /** The smallest EER diagram with one strong entity in it. */
  function schemaWith(entityName: string): EerDiagram {
    const entity: EerNode = {
      id: id('E'),
      kind: 'entity',
      name: entityName,
      x: 0,
      y: 0,
      w: 140,
      h: 60,
      weak: false,
    };
    return { nodes: [entity], edges: [] };
  }

  it('says so when nothing is linked, rather than staying silent', () => {
    const s = scene();
    s.dot('e1', s.set('EMPLOYEE'));
    expect(saying(infos(s.diagram()), 'No schema is linked')).toBe(true);
  });

  it('does not nag about an empty canvas', () => {
    expect(validate({ nodes: [], edges: [] }, { source: null })).toEqual([]);
  });

  it('stops saying it once a schema is linked', () => {
    const s = scene();
    s.dot('e1', s.set('EMPLOYEE'));
    expect(saying(infos(s.diagram(), schemaWith('EMPLOYEE')), 'No schema is linked')).toBe(false);
  });

  // The structural rules above are about the drawing; this proves the
  // schema checks are actually reached through the same entry point.
  it('passes the diagram on to the schema checker', () => {
    const s = scene();
    s.dot('e1', s.set('EMPLOYEE'));
    const found = errors(s.diagram(), schemaWith('DEPARTMENT'));
    expect(saying(found, 'No entity type named “EMPLOYEE” exists in the linked schema.')).toBe(true);
  });

  it('is quiet when the set matches an entity in the schema', () => {
    const s = scene();
    s.dot('e1', s.set('EMPLOYEE'));
    expect(errors(s.diagram(), schemaWith('EMPLOYEE'))).toEqual([]);
  });

  // A set marked weak against a strong entity is a real mismatch worth saying.
  it('notices a set whose weakness disagrees with the schema', () => {
    const s = scene();
    const set = s.set('EMPLOYEE', true);
    s.dot('e1', set);
    expect(
      saying(warnings(s.diagram(), schemaWith('EMPLOYEE')), 'but this set is marked weak'),
    ).toBe(true);
  });

  it('reports a relationship set the schema does not have', () => {
    const s = scene();
    s.dot('e1', s.set('EMPLOYEE'));
    s.relSet('MANAGES');
    const found = errors(s.diagram(), schemaWith('EMPLOYEE'));
    expect(saying(found, 'No relationship named “MANAGES” exists in the linked schema.')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                               */
/* -------------------------------------------------------------------------- */

describe('the checker itself', () => {
  it('reports each problem once', () => {
    const s = scene();
    const set = s.set('EMPLOYEE');
    s.dot('e1', set);
    s.dot('e1', set);
    s.dot('stray');
    const found = validate(s.diagram(), {}).map((i) => i.message);
    expect(new Set(found).size).toBe(found.length);
  });

  it('puts errors before warnings before notes', () => {
    const s = scene();
    const set = s.set('EMPLOYEE');
    s.dot('e1', set);
    s.dot('e1', set); // warning
    s.dot('stray'); // error
    const severities = validate(s.diagram(), {}).map((i) => i.severity);
    expect(severities[0]).toBe('error');
    expect(severities[severities.length - 1]).toBe('info');
  });
});
