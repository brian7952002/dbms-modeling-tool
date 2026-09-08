import { newId } from '../../platform/ids';
import { createNode } from './factory';
import type { Diagram, DiagramNode, Edge } from './types';

/**
 * The classic figure: a 1:N relationship shown as data. One department holds
 * several employees, and no employee is joined to two departments — which is
 * exactly what makes this a legal instance of a 1:N schema, and what a second
 * link from any employee would break.
 */
export function worksForSample(): Diagram {
  const nodes: DiagramNode[] = [];
  const edges: Edge[] = [];

  const set = (name: string, x: number, y: number, w: number, h: number) => {
    const n = createNode('entity-set', x, y) as Extract<DiagramNode, { kind: 'entity-set' }>;
    n.name = name;
    n.entityName = name;
    n.w = w;
    n.h = h;
    nodes.push(n);
    return n;
  };

  const dot = (label: string, x: number, y: number, owner: DiagramNode) => {
    const n = createNode('instance', x, y) as Extract<DiagramNode, { kind: 'instance' }>;
    n.name = label;
    n.label = label;
    nodes.push(n);
    edges.push({ id: newId('e'), kind: 'member-of', source: n.id, target: owner.id });
    return n;
  };

  const employee = set('EMPLOYEE', 240, 300, 260, 320);
  const department = set('DEPARTMENT', 680, 300, 250, 220);

  const e1 = dot('e1', 190, 200, employee);
  const e2 = dot('e2', 190, 260, employee);
  const e3 = dot('e3', 190, 320, employee);
  const e4 = dot('e4', 190, 380, employee);

  const d1 = dot('d1', 630, 250, department);
  const d2 = dot('d2', 630, 340, department);

  const rel = createNode('rel-set', 460, 470) as Extract<DiagramNode, { kind: 'rel-set' }>;
  rel.name = 'WORKS_FOR';
  rel.relationshipName = 'WORKS_FOR';
  nodes.push(rel);

  const link = (a: DiagramNode, b: DiagramNode) =>
    edges.push({ id: newId('e'), kind: 'instance-link', source: a.id, target: b.id, relSetId: rel.id });

  link(e1, d1);
  link(e2, d1);
  link(e3, d2);
  link(e4, d2);

  return { nodes, edges };
}
