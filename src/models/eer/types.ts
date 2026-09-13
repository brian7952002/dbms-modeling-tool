/** The EER model: entity types, relationships and specialisation, in Chen notation. */

import type { BaseEdge, BaseNode, Id, Point } from '../../platform/types';

export type { Id, Point };

export type NodeKind =
  | 'entity'
  | 'relationship'
  | 'attribute'
  | 'isa'
  | 'union'
  | 'note';

type NodeBase = BaseNode;

export interface EntityNode extends NodeBase {
  kind: 'entity';
  /** Weak entity types are drawn with a double border. */
  weak: boolean;
  /**
   * Candidate keys other than the primary one, each a set of this entity's own
   * attributes. Chen notation can underline only one key, so a second or third
   * candidate key has nowhere to go; these carry it, are drawn as IDEF1X-style
   * AK1/AK2 markers, and become a UNIQUE constraint apiece in the SQL.
   *
   * Attribute ids rather than names, so renaming an attribute keeps the key.
   */
  altKeys?: Id[][];
}

export interface RelationshipNode extends NodeBase {
  kind: 'relationship';
  /** Identifying relationships (weak entity owners) get a double diamond. */
  identifying: boolean;
}

export interface AttributeNode extends NodeBase {
  kind: 'attribute';
  /** Primary key component: solid underline. */
  key: boolean;
  /** Discriminator of a weak entity: dashed underline. */
  partialKey: boolean;
  /** Double oval. */
  multivalued: boolean;
  /** Dashed oval. */
  derived: boolean;
  /** SQL type used by the DDL generator. */
  dataType: string;
  nullable: boolean;
  /** Formula shown for derived attributes, e.g. "age = today - dob". */
  derivation?: string;
}

export interface IsaNode extends NodeBase {
  kind: 'isa';
  /** true = disjoint (d), false = overlapping (o). */
  disjoint: boolean;
  /** true = total specialisation (double line to the superclass). */
  total: boolean;
  /**
   * Which shape carries the d/o marker. Elmasri & Navathe draw a circle;
   * other texts use a triangle labelled ISA. Undefined means circle, which is
   * the form the subset symbols on the subclass lines belong to.
   */
  symbol?: 'circle' | 'triangle';
  /** Attribute-defined specialisation: the defining attribute's name. */
  definingAttribute?: string;
}

/** Union / category type: a subclass whose members come from several superclasses. */
export interface UnionNode extends NodeBase {
  kind: 'union';
  total: boolean;
}

/**
 * A bracket note: free text with a brace pointing at the part of the diagram it
 * explains. Carries no meaning for the schema — it is there to record why the
 * design is the way it is — so it takes no connectors and no validation.
 */
export interface NoteNode extends NodeBase {
  kind: 'note';
  /** The explanation itself. Wraps to the note's width; newlines are kept. */
  body: string;
  /** Which side the brace sits on, so a note can point either way. */
  side: 'left' | 'right';
}

export type DiagramNode =
  | EntityNode
  | RelationshipNode
  | AttributeNode
  | IsaNode
  | UnionNode
  | NoteNode;

export type EdgeKind =
  /** attribute -> owner (entity, relationship, or parent attribute) */
  | 'attribute'
  /** entity <-> relationship participation */
  | 'participation'
  /** ISA triangle -> superclass entity */
  | 'isa-super'
  /** ISA triangle -> subclass entity */
  | 'isa-sub'
  /** union circle -> one of the superclasses */
  | 'union-super'
  /** union circle -> the category (subclass) entity */
  | 'union-sub';

/** Chen-style ratio label on a participation edge. */
export type Cardinality = '1' | 'N' | 'M' | 'P' | 'Q';

export interface Edge extends BaseEdge {
  kind: EdgeKind;
  /** Chen ratio label, e.g. the "N" in 1:N. Participation edges only. */
  cardinality?: Cardinality;
  /** (min,max) structural constraint. `max: null` means "many". */
  min?: number;
  max?: number | null;
  /** Show the (min,max) pair instead of / alongside the ratio label. */
  showMinMax?: boolean;
  /** Total participation: drawn as a double line. */
  total?: boolean;
  /** Role name, required to disambiguate recursive relationships. */
  role?: string;
  /** Manual perpendicular offset, used to fan out parallel edges. */
  bow?: number;
}

/** An EER diagram. Structurally a platform `Diagram<DiagramNode, Edge>`. */
export interface Diagram {
  nodes: DiagramNode[];
  edges: Edge[];
}

export const emptyDiagram = (): Diagram => ({ nodes: [], edges: [] });

export const isEntity = (n: DiagramNode): n is EntityNode => n.kind === 'entity';
export const isRelationship = (n: DiagramNode): n is RelationshipNode =>
  n.kind === 'relationship';
export const isAttribute = (n: DiagramNode): n is AttributeNode =>
  n.kind === 'attribute';
export const isIsa = (n: DiagramNode): n is IsaNode => n.kind === 'isa';
export const isUnion = (n: DiagramNode): n is UnionNode => n.kind === 'union';
export const isNote = (n: DiagramNode): n is NoteNode => n.kind === 'note';
