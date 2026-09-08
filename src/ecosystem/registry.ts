import type { ComponentType, Dispatch, MouseEvent, PointerEvent, ReactNode } from 'react';
import type { BaseEdge, BaseNode, Diagram, Id, Point } from '../platform/types';
import type { Action } from '../platform/actions';

/**
 * A modelling tool.
 *
 * This is the seam. The platform owns the canvas, selection, undo, real-time
 * sync, persistence and export; a tool owns everything about what its diagram
 * *means* — its shapes, its connection rules, its inspector, its checks.
 *
 * Adding the logical or physical model should mean writing one of these and
 * registering it, with no change to the platform.
 */
export interface ModelTool<
  N extends BaseNode = BaseNode,
  E extends BaseEdge = BaseEdge,
> {
  id: ModelId;
  /** Shown in the model picker and on diagram cards. */
  label: string;
  blurb: string;
  /** Emoji or short glyph for the picker. */
  glyph: string;
  /** Where this model sits in the design process, for ordering the picker. */
  stage: 'conceptual' | 'logical' | 'physical';

  createEmpty(): Diagram<N, E>;
  samples: ModelSample<N, E>[];
  palette: PaletteItem[];

  /** Diagram-level styling, embedded in the SVG so exports stand alone. */
  css(theme: 'light' | 'dark'): string;

  /**
   * Outline used to clip connectors and to hit-test. Return null for an
   * elliptical shape, which the platform handles analytically.
   */
  outline(node: N): Point[] | null;

  /**
   * Per-render values the shapes need but the platform cannot know — an ISA
   * marker's rotation, which connectors are drawn doubled, and so on.
   * Computed once per diagram rather than per shape.
   */
  decorate(diagram: Diagram<N, E>): Decorations;

  NodeShape: ComponentType<NodeShapeProps<N>>;
  EdgeShape: ComponentType<EdgeShapeProps<N, E>>;
  Inspector: ComponentType<InspectorProps<N, E>>;
  /** Notation guide shown in the help dialog. */
  Help: ComponentType;

  /**
   * Whether and how two shapes may be joined. Returning null means the pair is
   * not legal in this model, and the canvas refuses the connection.
   */
  inferEdge(a: N, b: N, diagram: Diagram<N, E>): EdgeSpec | null;
  createEdge(source: Id, target: Id, kind: string): E;
  createNode(kind: string, x: number, y: number): N;

  /**
   * New box for a node whose label changed, so a renamed shape grows to fit.
   * Return null for shapes sized by something other than their text.
   */
  sizeFor?(node: N, name: string): { w: number; h: number } | null;

  validate(diagram: Diagram<N, E>, context: ValidationContext): Issue[];

  /** Optional outputs, e.g. SQL from an EER model. */
  exports?: {
    sql?(diagram: Diagram<N, E>, title: string): { sql: string; warnings: string[] };
  };

  /**
   * A model that is checked against, or generated from, another. An instance
   * diagram names 'eer' here so the platform can offer a source diagram.
   */
  derivesFrom?: ModelId;
}

export type ModelId = 'eer' | 'instance' | 'relational' | 'physical';

export interface ModelSample<N extends BaseNode = BaseNode, E extends BaseEdge = BaseEdge> {
  id: string;
  title: string;
  blurb: string;
  build(): Diagram<N, E>;
}

export interface PaletteItem {
  kind: string;
  label: string;
  hint: string;
  /** Rendered inside a 48×40 viewBox. */
  glyph: ReactNode;
}

export interface EdgeSpec {
  source: Id;
  target: Id;
  kind: string;
}

/** Extras keyed by element id, produced once per diagram by the model. */
export interface Decorations {
  nodes: Map<Id, Record<string, unknown>>;
  edges: Map<Id, Record<string, unknown>>;
}

export const noDecorations = (): Decorations => ({ nodes: new Map(), edges: new Map() });

export interface NodeShapeProps<N extends BaseNode = BaseNode> {
  node: N;
  selected: boolean;
  issue?: 'error' | 'warning';
  /** This node's entry from `decorate()`. */
  decoration?: Record<string, unknown>;
  onPointerDown?: (e: PointerEvent, node: N) => void;
  onDoubleClick?: (e: MouseEvent, node: N) => void;
}

export interface EdgeShapeProps<
  N extends BaseNode = BaseNode,
  E extends BaseEdge = BaseEdge,
> {
  edge: E;
  from: N;
  to: N;
  /** Perpendicular offset that fans apart connectors sharing a node pair. */
  bow: number;
  selected: boolean;
  decoration?: Record<string, unknown>;
  onPointerDown?: (e: PointerEvent, edge: E) => void;
}

export interface InspectorProps<
  N extends BaseNode = BaseNode,
  E extends BaseEdge = BaseEdge,
> {
  diagram: Diagram<N, E>;
  selection: Id[];
  title: string;
  dispatch: Dispatch<Action>;
  onAddAttribute: (ownerId: Id) => void;
  onAlign: (axis: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => void;
  onDistribute: (axis: 'x' | 'y') => void;
  /**
   * For a model that derives from another: which diagram it is checked
   * against, and how to change it. Absent when the model stands alone.
   */
  sourceLink?: SourceLink;
}

export interface SourceLink {
  /** Diagrams of the source model that this user can open. */
  options: { id: string; title: string }[];
  currentId: string | null;
  onChange: (id: string | null) => void;
  /** Why the picker is unavailable, e.g. not signed in. */
  unavailable?: string;
  loading?: boolean;
}

/** What a model needs beyond its own diagram in order to check it. */
export interface ValidationContext {
  /** The diagram this one is derived from, when the model declares a source. */
  source?: Diagram | null;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  id: string;
  severity: Severity;
  message: string;
  /** Elements to select when the issue is clicked. */
  targets: Id[];
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

const tools = new Map<ModelId, ModelTool<never, never>>();

export function registerModel<N extends BaseNode, E extends BaseEdge>(
  tool: ModelTool<N, E>,
) {
  tools.set(tool.id, tool as unknown as ModelTool<never, never>);
}

export function getModel(id: ModelId | string | undefined): ModelTool {
  const tool = tools.get((id ?? 'eer') as ModelId);
  if (!tool) {
    throw new Error(`No modelling tool is registered for “${id}”.`);
  }
  return tool as unknown as ModelTool;
}

export function hasModel(id: string | undefined): boolean {
  return tools.has((id ?? '') as ModelId);
}

const STAGE_ORDER: Record<ModelTool['stage'], number> = {
  conceptual: 0,
  logical: 1,
  physical: 2,
};

export function allModels(): ModelTool[] {
  return [...tools.values()].sort(
    (a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage],
  ) as unknown as ModelTool[];
}
