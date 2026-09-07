import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Diagram, DiagramNode, Edge, Id, NodeKind, Point } from '../model/types';
import type { Action } from '../state/store';
import { NodeShape } from './NodeShape';
import { EdgeShape } from './EdgeShape';
import { diagramCss, type Theme } from './diagramStyles';
import { inferEdge } from '../model/factory';

export type Tool = 'select' | 'connect';

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

interface Props {
  diagram: Diagram;
  selection: Id[];
  dispatch: React.Dispatch<Action>;
  tool: Tool;
  viewport: Viewport;
  setViewport: (v: Viewport | ((v: Viewport) => Viewport)) => void;
  theme: Theme;
  showGrid: boolean;
  snap: number;
  issues: Map<Id, 'error' | 'warning'>;
  onAddNodeAt: (kind: NodeKind, p: Point) => void;
  /** Shared with the exporter, which serialises the live SVG. */
  svgRef?: React.MutableRefObject<SVGSVGElement | null>;
}

type DragState =
  | { mode: 'none' }
  | { mode: 'pan'; startClient: Point; startView: Point }
  | { mode: 'move'; last: Point; ids: Id[]; moved: boolean }
  | { mode: 'marquee'; start: Point; current: Point; additive: boolean };

const GRID = 20;

export function Canvas({
  diagram,
  selection,
  dispatch,
  tool,
  viewport,
  setViewport,
  theme,
  showGrid,
  snap,
  issues,
  onAddNodeAt,
  svgRef: externalRef,
}: Props) {
  const localRef = useRef<SVGSVGElement | null>(null);
  const svgRef = externalRef ?? localRef;
  const drag = useRef<DragState>({ mode: 'none' });
  const [, forceRender] = useState(0);
  const [connectFrom, setConnectFrom] = useState<Id | null>(null);
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const [editing, setEditing] = useState<Id | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const selected = useMemo(() => new Set(selection), [selection]);
  const nodeById = useMemo(
    () => new Map(diagram.nodes.map((n) => [n.id, n])),
    [diagram.nodes],
  );

  /* ---- coordinate helpers --------------------------------------------- */

  const toDiagram = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.x) / viewport.k,
        y: (clientY - rect.top - viewport.y) / viewport.k,
      };
    },
    [viewport],
  );

  const snapValue = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : v);

  /* ---- edge fan-out ---------------------------------------------------- */

  // Two legs between the same pair of shapes (a recursive relationship, most
  // often) would otherwise land exactly on top of each other.
  const bows = useMemo(() => {
    const groups = new Map<string, Edge[]>();
    for (const e of diagram.edges) {
      const key = [e.source, e.target].sort().join('~');
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const out = new Map<Id, number>();
    for (const list of groups.values()) {
      list.forEach((e, i) => {
        const spread = list.length > 1 ? (i - (list.length - 1) / 2) * 34 : 0;
        out.set(e.id, e.bow ?? spread);
      });
    }
    return out;
  }, [diagram.edges]);

  /** Angle that points an ISA triangle's apex at its superclass. */
  const isaAngles = useMemo(() => {
    const out = new Map<Id, number>();
    for (const e of diagram.edges) {
      if (e.kind !== 'isa-super') continue;
      const isa = nodeById.get(e.target);
      const sup = nodeById.get(e.source);
      if (!isa || !sup) continue;
      const deg = (Math.atan2(sup.y - isa.y, sup.x - isa.x) * 180) / Math.PI + 90;
      out.set(isa.id, deg);
    }
    return out;
  }, [diagram.edges, nodeById]);

  /** Attribute-defined specialisation labels, shown on the superclass line. */
  const definingLabels = useMemo(() => {
    const out = new Map<Id, string>();
    for (const e of diagram.edges) {
      if (e.kind !== 'isa-super') continue;
      const isa = nodeById.get(e.target);
      if (isa && isa.kind === 'isa' && isa.definingAttribute?.trim()) {
        out.set(e.id, isa.definingAttribute.trim());
      }
    }
    return out;
  }, [diagram.edges, nodeById]);

  /** Which edges get drawn as double lines. */
  const doubleEdges = useMemo(() => {
    const out = new Set<Id>();
    for (const e of diagram.edges) {
      if (e.kind === 'participation' && e.total) out.add(e.id);
      if (e.kind === 'isa-super') {
        const isa = nodeById.get(e.target);
        if (isa && isa.kind === 'isa' && isa.total) out.add(e.id);
      }
      if (e.kind === 'union-sub') {
        const u = nodeById.get(e.target);
        if (u && u.kind === 'union' && u.total) out.add(e.id);
      }
    }
    return out;
  }, [diagram.edges, nodeById]);

  /* ---- interaction ----------------------------------------------------- */

  const beginConnect = useCallback(
    (id: Id) => {
      if (connectFrom === null) {
        setConnectFrom(id);
        return;
      }
      if (connectFrom === id) {
        setConnectFrom(null);
        return;
      }
      const a = nodeById.get(connectFrom);
      const b = nodeById.get(id);
      if (a && b && inferEdge(a, b, diagram)) {
        dispatch({ type: 'connect', a: connectFrom, b: id });
        setConnectFrom(null);
      } else {
        // Illegal pair: treat the click as restarting the connection.
        setConnectFrom(id);
      }
    },
    [connectFrom, diagram, dispatch, nodeById],
  );

  const onNodePointerDown = (e: React.PointerEvent, node: DiagramNode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (tool === 'connect') {
      beginConnect(node.id);
      return;
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (additive) {
      dispatch({ type: 'select', ids: [node.id], mode: 'toggle' });
    } else if (!selected.has(node.id)) {
      dispatch({ type: 'select', ids: [node.id] });
    }
    const ids = additive
      ? []
      : selected.has(node.id)
        ? selection.filter((id) => nodeById.has(id))
        : [node.id];
    if (ids.length === 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { mode: 'move', last: toDiagram(e.clientX, e.clientY), ids, moved: false };
    forceRender((n) => n + 1);
  };

  const onEdgePointerDown = (e: React.PointerEvent, edge: Edge) => {
    e.stopPropagation();
    if (e.button !== 0 || tool === 'connect') return;
    dispatch({
      type: 'select',
      ids: [edge.id],
      mode: e.shiftKey ? 'toggle' : 'replace',
    });
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (tool === 'connect' && e.button === 0) {
      setConnectFrom(null);
      return;
    }
    const panning = e.button === 1 || spaceHeld || e.altKey;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (panning) {
      drag.current = {
        mode: 'pan',
        startClient: { x: e.clientX, y: e.clientY },
        startView: { x: viewport.x, y: viewport.y },
      };
    } else if (e.button === 0) {
      const p = toDiagram(e.clientX, e.clientY);
      drag.current = { mode: 'marquee', start: p, current: p, additive: e.shiftKey };
      if (!e.shiftKey) dispatch({ type: 'select', ids: [] });
    }
    forceRender((n) => n + 1);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toDiagram(e.clientX, e.clientY);
    if (tool === 'connect' && connectFrom) setCursor(p);
    const d = drag.current;
    switch (d.mode) {
      case 'pan':
        setViewport((v) => ({
          ...v,
          x: d.startView.x + (e.clientX - d.startClient.x),
          y: d.startView.y + (e.clientY - d.startClient.y),
        }));
        break;
      case 'move': {
        if (!d.moved) {
          dispatch({ type: 'begin' });
          d.moved = true;
        }
        dispatch({ type: 'moveNodes', ids: d.ids, dx: p.x - d.last.x, dy: p.y - d.last.y });
        d.last = p;
        break;
      }
      case 'marquee':
        d.current = p;
        forceRender((n) => n + 1);
        break;
      default:
        break;
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (d.mode === 'move' && d.moved && snap > 0) {
      for (const id of d.ids) {
        const n = nodeById.get(id);
        if (!n) continue;
        dispatch({
          type: 'updateNode',
          id,
          patch: { x: snapValue(n.x), y: snapValue(n.y) },
          transient: true,
        });
      }
    }
    if (d.mode === 'marquee') {
      const x1 = Math.min(d.start.x, d.current.x);
      const x2 = Math.max(d.start.x, d.current.x);
      const y1 = Math.min(d.start.y, d.current.y);
      const y2 = Math.max(d.start.y, d.current.y);
      if (Math.abs(x2 - x1) > 3 || Math.abs(y2 - y1) > 3) {
        const hits = diagram.nodes
          .filter((n) => n.x > x1 && n.x < x2 && n.y > y1 && n.y < y2)
          .map((n) => n.id);
        dispatch({ type: 'select', ids: hits, mode: d.additive ? 'add' : 'replace' });
      }
    }
    drag.current = { mode: 'none' };
    forceRender((n) => n + 1);
  };

  /* ---- wheel zoom ------------------------------------------------------ */

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setViewport((v) => {
        if (e.shiftKey && !e.ctrlKey) return { ...v, x: v.x - e.deltaY, y: v.y };
        const factor = Math.exp(-e.deltaY * 0.0015);
        const k = Math.min(4, Math.max(0.15, v.k * factor));
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setViewport]);

  /* ---- space-to-pan ---------------------------------------------------- */

  useEffect(() => {
    const target = (e: KeyboardEvent) => e.target as HTMLElement | null;
    const typing = (e: KeyboardEvent) => {
      const t = target(e);
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
      if (e.key === 'Escape') {
        setConnectFrom(null);
        setEditing(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* ---- render ---------------------------------------------------------- */

  const d = drag.current;
  const marquee =
    d.mode === 'marquee'
      ? {
          x: Math.min(d.start.x, d.current.x),
          y: Math.min(d.start.y, d.current.y),
          w: Math.abs(d.current.x - d.start.x),
          h: Math.abs(d.current.y - d.start.y),
        }
      : null;

  const editingNode = editing ? nodeById.get(editing) : undefined;
  const fromNode = connectFrom ? nodeById.get(connectFrom) : undefined;

  const cursorStyle =
    tool === 'connect' ? 'crosshair' : spaceHeld || d.mode === 'pan' ? 'grabbing' : 'default';

  return (
    <svg
      ref={svgRef}
      className="eer-svg canvas"
      style={{ cursor: cursorStyle }}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData('application/x-eer-node') as NodeKind;
        if (!kind) return;
        const p = toDiagram(e.clientX, e.clientY);
        onAddNodeAt(kind, { x: snapValue(p.x), y: snapValue(p.y) });
      }}
    >
      <style>{diagramCss(theme)}</style>
      <defs>
        {/* The pattern carries the viewport transform so the grid pans and
            zooms with the diagram without re-rendering a single line of it. */}
        <pattern
          id="eer-grid"
          width={GRID * viewport.k}
          height={GRID * viewport.k}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${viewport.x} ${viewport.y})`}
        >
          <path
            d={`M ${GRID * viewport.k} 0 L 0 0 0 ${GRID * viewport.k}`}
            fill="none"
            stroke="var(--grid)"
            strokeWidth="1"
          />
        </pattern>
      </defs>

      <rect className="canvas-bg" width="100%" height="100%" fill="var(--bg)" />
      {showGrid && (
        <rect
          className="no-export"
          width="100%"
          height="100%"
          fill="url(#eer-grid)"
          style={{ pointerEvents: 'none' }}
        />
      )}

      <g className="viewport" transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
        <g className="edges">
          {diagram.edges.map((e) => {
            const from = nodeById.get(e.source);
            const to = nodeById.get(e.target);
            if (!from || !to) return null;
            return (
              <EdgeShape
                key={e.id}
                edge={e}
                from={from}
                to={to}
                bow={bows.get(e.id) ?? 0}
                selected={selected.has(e.id)}
                double={doubleEdges.has(e.id)}
                definingAttribute={definingLabels.get(e.id)}
                onPointerDown={onEdgePointerDown}
              />
            );
          })}
        </g>

        <g className="nodes">
          {diagram.nodes.map((n) => (
            <NodeShape
              key={n.id}
              node={n}
              selected={selected.has(n.id)}
              isaAngle={isaAngles.get(n.id) ?? 0}
              issue={issues.get(n.id)}
              onPointerDown={onNodePointerDown}
              onDoubleClick={(_e, node) => {
                if (node.kind === 'isa' || node.kind === 'union') return;
                setEditing(node.id);
              }}
            />
          ))}
        </g>

        <g className="no-export overlay" style={{ pointerEvents: 'none' }}>
          {fromNode && tool === 'connect' && (
            <line
              x1={fromNode.x}
              y1={fromNode.y}
              x2={cursor.x}
              y2={cursor.y}
              stroke="var(--accent)"
              strokeWidth={1.8}
              strokeDasharray="5 4"
            />
          )}
          {fromNode && tool === 'connect' && (
            <circle
              cx={fromNode.x}
              cy={fromNode.y}
              r={Math.max(fromNode.w, fromNode.h) / 2 + 8}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )}
          {marquee && (
            <rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              fill="var(--accent)"
              fillOpacity={0.08}
              stroke="var(--accent)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}
        </g>

        {editingNode && (
          <foreignObject
            className="no-export"
            x={editingNode.x - Math.max(editingNode.w, 110) / 2}
            y={editingNode.y - 14}
            width={Math.max(editingNode.w, 110)}
            height={28}
          >
            <input
              className="inline-rename"
              autoFocus
              defaultValue={editingNode.name}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                dispatch({
                  type: 'updateNode',
                  id: editingNode.id,
                  patch: { name: e.target.value },
                });
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
                e.stopPropagation();
              }}
            />
          </foreignObject>
        )}
      </g>

      {tool === 'connect' && (
        <text className="no-export" x={16} y={26} fill="var(--muted)" fontSize={12}>
          {connectFrom
            ? 'Now click the shape to connect it to — Esc to cancel'
            : 'Click a shape to start a connection'}
        </text>
      )}
    </svg>
  );
}
