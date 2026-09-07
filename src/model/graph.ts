import type {
  AttributeNode,
  Diagram,
  DiagramNode,
  Edge,
  EntityNode,
  Id,
  IsaNode,
  RelationshipNode,
  UnionNode,
} from './types';

export function nodeById(d: Diagram, id: Id): DiagramNode | undefined {
  return d.nodes.find((n) => n.id === id);
}

export const entities = (d: Diagram) =>
  d.nodes.filter((n): n is EntityNode => n.kind === 'entity');
export const relationships = (d: Diagram) =>
  d.nodes.filter((n): n is RelationshipNode => n.kind === 'relationship');
export const isaNodes = (d: Diagram) =>
  d.nodes.filter((n): n is IsaNode => n.kind === 'isa');
export const unionNodes = (d: Diagram) =>
  d.nodes.filter((n): n is UnionNode => n.kind === 'union');

/** Attributes attached directly to an entity, relationship, or parent attribute. */
export function attributesOf(d: Diagram, ownerId: Id): AttributeNode[] {
  return d.edges
    .filter((e) => e.kind === 'attribute' && e.target === ownerId)
    .map((e) => nodeById(d, e.source))
    .filter((n): n is AttributeNode => !!n && n.kind === 'attribute');
}

/** True when the attribute itself has attribute children (i.e. it is composite). */
export function isComposite(d: Diagram, attrId: Id): boolean {
  return attributesOf(d, attrId).length > 0;
}

/**
 * Flattens an attribute into the columns it contributes to a table.
 * Composite attributes expand into their leaves (`address` -> `address_city`);
 * multivalued attributes contribute nothing here because they become their own
 * table.
 */
export function leafColumns(
  d: Diagram,
  attr: AttributeNode,
  prefix = '',
): { attr: AttributeNode; column: string }[] {
  const name = prefix ? `${prefix}_${attr.name}` : attr.name;
  const children = attributesOf(d, attr.id);
  if (children.length > 0) {
    return children.flatMap((c) => leafColumns(d, c, name));
  }
  return [{ attr, column: name }];
}

export function keyAttributes(d: Diagram, ownerId: Id): AttributeNode[] {
  return attributesOf(d, ownerId).filter((a) => a.key);
}

export function partialKeyAttributes(d: Diagram, ownerId: Id): AttributeNode[] {
  return attributesOf(d, ownerId).filter((a) => a.partialKey);
}

export interface Participation {
  edge: Edge;
  entity: EntityNode;
}

/** All entity legs of a relationship diamond, in creation order. */
export function participantsOf(d: Diagram, relId: Id): Participation[] {
  return d.edges
    .filter((e) => e.kind === 'participation' && e.target === relId)
    .map((edge) => ({ edge, entity: nodeById(d, edge.source) as EntityNode }))
    .filter((p): p is Participation => !!p.entity && p.entity.kind === 'entity');
}

/** A relationship is recursive when one entity plays two or more of its roles. */
export function isRecursive(d: Diagram, relId: Id): boolean {
  const ids = participantsOf(d, relId).map((p) => p.entity.id);
  return new Set(ids).size < ids.length;
}

export function superclassOf(d: Diagram, isaId: Id): EntityNode | undefined {
  const e = d.edges.find((x) => x.kind === 'isa-super' && x.target === isaId);
  if (!e) return undefined;
  const n = nodeById(d, e.source);
  return n && n.kind === 'entity' ? n : undefined;
}

export function subclassesOf(d: Diagram, isaId: Id): EntityNode[] {
  return d.edges
    .filter((e) => e.kind === 'isa-sub' && e.target === isaId)
    .map((e) => nodeById(d, e.source))
    .filter((n): n is EntityNode => !!n && n.kind === 'entity');
}

export function unionSuperclasses(d: Diagram, unionId: Id): EntityNode[] {
  return d.edges
    .filter((e) => e.kind === 'union-super' && e.target === unionId)
    .map((e) => nodeById(d, e.source))
    .filter((n): n is EntityNode => !!n && n.kind === 'entity');
}

export function unionCategory(d: Diagram, unionId: Id): EntityNode | undefined {
  const e = d.edges.find((x) => x.kind === 'union-sub' && x.target === unionId);
  if (!e) return undefined;
  const n = nodeById(d, e.source);
  return n && n.kind === 'entity' ? n : undefined;
}

/** The ISA triangle, if any, that makes this entity a subclass. */
export function isaParentOf(d: Diagram, entityId: Id): IsaNode | undefined {
  const e = d.edges.find((x) => x.kind === 'isa-sub' && x.source === entityId);
  if (!e) return undefined;
  const n = nodeById(d, e.target);
  return n && n.kind === 'isa' ? n : undefined;
}

/**
 * For a weak entity, the identifying relationship and the owning entity that
 * supplies the borrowed part of its primary key.
 */
export function identifyingOwner(
  d: Diagram,
  weakId: Id,
): { rel: RelationshipNode; owner: EntityNode } | undefined {
  for (const e of d.edges) {
    if (e.kind !== 'participation' || e.source !== weakId) continue;
    const rel = nodeById(d, e.target);
    if (!rel || rel.kind !== 'relationship' || !rel.identifying) continue;
    const owner = participantsOf(d, rel.id).find(
      (p) => p.entity.id !== weakId && !p.entity.weak,
    );
    if (owner) return { rel, owner: owner.entity };
  }
  return undefined;
}

/** Edges touching a node, in either direction. */
export function edgesOf(d: Diagram, nodeId: Id): Edge[] {
  return d.edges.filter((e) => e.source === nodeId || e.target === nodeId);
}

/** "many" for the purposes of mapping: max is unbounded or the ratio is not 1. */
export function isManySide(edge: Edge): boolean {
  if (edge.showMinMax) return edge.max === null || (edge.max ?? 1) > 1;
  return edge.cardinality !== '1';
}
