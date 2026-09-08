/**
 * The instance model: sample data for an EER schema.
 *
 * Elmasri draws these as a labelled region per entity set holding a small
 * circle for each instance, with relationship instances as lines between them.
 */

import type { BaseEdge, BaseNode, Id, Point } from '../../platform/types';

export type { Id, Point };

export type NodeKind = 'entity-set' | 'instance' | 'rel-set';

interface NodeBase extends BaseNode {
  kind: NodeKind;
}

/** A labelled region standing for one entity type in the source schema. */
export interface EntitySetNode extends NodeBase {
  kind: 'entity-set';
  /** Name of the entity type this set represents, e.g. EMPLOYEE. */
  entityName: string;
  weak: boolean;
}

/** One member of an entity set — a single row, drawn as a dot. */
export interface InstanceNode extends NodeBase {
  kind: 'instance';
  /** Key value or short label, e.g. "e1" or "123-45-6789". */
  label: string;
}

/** A legend for one relationship type, naming the links drawn in its colour. */
export interface RelSetNode extends NodeBase {
  kind: 'rel-set';
  relationshipName: string;
}

export type DiagramNode = EntitySetNode | InstanceNode | RelSetNode;

export type EdgeKind =
  /** instance -> the entity set it belongs to */
  | 'member-of'
  /** instance <-> instance: one relationship instance */
  | 'instance-link';

export interface Edge extends BaseEdge {
  kind: EdgeKind;
  /** For a link: which relationship set it belongs to. */
  relSetId?: Id;
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: Edge[];
}

export const emptyDiagram = (): Diagram => ({ nodes: [], edges: [] });
