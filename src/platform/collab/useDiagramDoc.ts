import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { BaseNode, Diagram, Id, Point } from '../types';
import type { ModelTool } from '../../ecosystem/registry';
import type { Action } from '../actions';
import { DiagramDoc, type DiagramKind } from './doc';

export interface DocBinding {
  doc: DiagramDoc;
  diagram: Diagram;
  title: string;
  kind: DiagramKind;
  selection: Id[];
  setSelection: (ids: Id[]) => void;
  dispatch: React.Dispatch<Action>;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped whenever the document changes, local or remote. */
  revision: number;
}

/**
 * Binds a CRDT document to React.
 *
 * The action shape from the old reducer is kept deliberately: the canvas and
 * inspector still `dispatch` exactly as before, and only what happens
 * underneath changed. Selection stays outside the document — it is per-person,
 * not part of the diagram.
 */
export function useDiagramDoc(
  initial: { diagram: Diagram; title: string },
  model: ModelTool,
): DocBinding {
  const docRef = useRef<DiagramDoc | null>(null);
  if (docRef.current === null) {
    const doc = new DiagramDoc();
    doc.replace(initial.diagram, initial.title);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [revision, bump] = useReducer((n: number) => n + 1, 0);
  const [selection, setSelectionState] = useState<Id[]>([]);

  useEffect(() => {
    const onUpdate = () => bump();
    doc.ydoc.on('update', onUpdate);
    doc.undoManager.on('stack-item-added', onUpdate);
    doc.undoManager.on('stack-item-popped', onUpdate);
    return () => {
      doc.ydoc.off('update', onUpdate);
      doc.undoManager.off('stack-item-added', onUpdate);
      doc.undoManager.off('stack-item-popped', onUpdate);
    };
  }, [doc]);

  const diagram = useMemo(() => doc.snapshot(), [doc, revision]);
  const title = useMemo(() => doc.title, [doc, revision]);
  const kind = useMemo(() => doc.kind, [doc, revision]);

  // A teammate deleting a shape should drop it from your selection rather than
  // leaving the inspector pointed at something that no longer exists.
  useEffect(() => {
    setSelectionState((current) => {
      if (current.length === 0) return current;
      const alive = current.filter(
        (id) => doc.nodes.has(id) || doc.edges.has(id),
      );
      return alive.length === current.length ? current : alive;
    });
  }, [doc, revision]);

  const setSelection = useCallback((ids: Id[]) => setSelectionState(ids), []);

  const dispatch = useCallback<React.Dispatch<Action>>(
    (action) => {
      switch (action.type) {
        case 'select': {
          const mode = action.mode ?? 'replace';
          setSelectionState((current) => {
            if (mode === 'replace') return action.ids;
            if (mode === 'add') return [...new Set([...current, ...action.ids])];
            const set = new Set(current);
            for (const id of action.ids) (set.has(id) ? set.delete(id) : set.add(id));
            return [...set];
          });
          return;
        }

        // A drag streams many small updates; this closes the undo group so the
        // whole gesture undoes in one step.
        case 'begin':
          doc.breakUndoGroup();
          return;

        case 'undo':
          doc.undoManager.undo();
          return;

        case 'redo':
          doc.undoManager.redo();
          return;

        case 'load':
          doc.replace(action.diagram, action.title, doc.kind);
          setSelectionState([]);
          return;

        case 'setTitle':
          doc.setTitle(action.title);
          return;

        case 'addNode': {
          const node = model.createNode(action.kind, action.x, action.y);
          doc.addNode(node);
          if (action.select !== false) setSelectionState([node.id]);
          return;
        }

        case 'insertNodes':
          doc.insert(action.nodes, action.edges);
          setSelectionState(action.nodes.map((n) => n.id));
          return;

        case 'updateNode': {
          const patch = { ...action.patch };
          if (typeof patch.name === 'string') {
            // A renamed shape should grow to fit, on whatever terms its model
            // sizes shapes.
            const existing = doc.nodes.get(action.id)?.toJSON() as BaseNode | undefined;
            const size = existing ? model.sizeFor?.(existing, patch.name) : null;
            if (size) Object.assign(patch, size);
          }
          doc.updateNode(action.id, patch);
          return;
        }

        case 'updateEdge':
          doc.updateEdge(action.id, action.patch);
          return;

        case 'moveNodes':
          doc.moveNodes(action.ids, action.dx, action.dy);
          return;

        case 'connect': {
          if (action.a === action.b) return;
          const snapshot = doc.snapshot();
          const a = snapshot.nodes.find((n) => n.id === action.a);
          const b = snapshot.nodes.find((n) => n.id === action.b);
          if (!a || !b) return;
          const spec = model.inferEdge(a, b, snapshot);
          if (!spec) return;

          const singleUse = spec.kind === 'attribute' || spec.kind === 'union-sub';
          if (
            singleUse &&
            snapshot.edges.some((e) => e.kind === spec.kind && e.source === spec.source)
          ) {
            return;
          }
          if (
            spec.kind === 'isa-super' &&
            snapshot.edges.some((e) => e.kind === 'isa-super' && e.target === spec.target)
          ) {
            return;
          }
          const duplicate = snapshot.edges.some(
            (e) =>
              e.kind === spec.kind &&
              e.source === spec.source &&
              e.target === spec.target &&
              e.kind !== 'participation',
          );
          if (duplicate) return;

          const edge = model.createEdge(spec.source, spec.target, spec.kind);
          doc.addEdge(edge);
          setSelectionState([edge.id]);
          return;
        }

        case 'deleteSelection':
          setSelectionState((current) => {
            if (current.length > 0) doc.remove(current);
            return [];
          });
          return;
      }
    },
    [doc, model],
  );

  return {
    doc,
    diagram,
    title,
    kind,
    selection,
    setSelection,
    dispatch,
    canUndo: doc.undoManager.undoStack.length > 0,
    canRedo: doc.undoManager.redoStack.length > 0,
    revision,
  };
}

/** Screen-space helper shared by the canvas and the cursor overlay. */
export const samePoint = (a: Point | null, b: Point | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
