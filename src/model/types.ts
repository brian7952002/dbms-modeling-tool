/** Core data model for an EER diagram in Chen notation. */

export type Id = string;

export interface Point {
  x: number;
  y: number;
}

export type NodeKind =
  | 'entity'
  | 'relationship'
  | 'attribute'
  | 'isa'
  | 'union';

interface NodeBase {
  id: Id;
  /** Center point of the shape, in diagram coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  note?: string;
}

export interface EntityNode extends NodeBase {
  kind: 'entity';
  /** Weak entity types are drawn with a double border. */
  weak: boolean;
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
}

/** Union / category type: a subclass whose members come from several superclasses. */
export interface UnionNode extends NodeBase {
  kind: 'union';
  total: boolean;
}

export type DiagramNode =
  | EntityNode
  | RelationshipNode
  | AttributeNode
  | IsaNode
  | UnionNode;

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

export interface Edge {
  id: Id;
  kind: EdgeKind;
  /** For participation edges: the entity end. */
  source: Id;
  /** For participation edges: the relationship end. */
  target: Id;
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

export interface Diagram {
  nodes: DiagramNode[];
  edges: Edge[];
}

export interface DiagramFile {
  format: 'eer-diagram-designer';
  version: 1;
  title: string;
  diagram: Diagram;
}

export const emptyDiagram = (): Diagram => ({ nodes: [], edges: [] });

export const isEntity = (n: DiagramNode): n is EntityNode => n.kind === 'entity';
export const isRelationship = (n: DiagramNode): n is RelationshipNode =>
  n.kind === 'relationship';
export const isAttribute = (n: DiagramNode): n is AttributeNode =>
  n.kind === 'attribute';
export const isIsa = (n: DiagramNode): n is IsaNode => n.kind === 'isa';
export const isUnion = (n: DiagramNode): n is UnionNode => n.kind === 'union';
