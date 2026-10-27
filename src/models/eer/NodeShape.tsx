import { memo } from 'react';
import type { NodeShapeProps } from '../../ecosystem/registry';
import type { AttributeNode, DiagramNode } from './types';
import { measureText, wrapText } from '../../platform/measure';

type Props = NodeShapeProps<DiagramNode>;

function diamondPoints(x: number, y: number, w: number, h: number, inset = 0) {
  const hw = w / 2 - inset;
  const hh = h / 2 - inset;
  return `${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}`;
}

function trianglePoints(x: number, y: number, w: number, h: number) {
  const hw = w / 2;
  const hh = h / 2;
  return `${x},${y - hh} ${x + hw},${y + hh} ${x - hw},${y + hh}`;
}

/**
 * The flyout carrying a derived attribute's formula.
 *
 * It is drawn inside the attribute's own group, which gets three things for
 * free: it travels with the shape, it can be grabbed to drag it, and it lands
 * in the SVG export like any other part of the diagram. It deliberately does
 * not change the node's width or height — edges attach to the oval's outline,
 * and a flyout that moved the attachment points would drag every connected
 * line around with it.
 */
const DERIVATION_FONT = '500 11.5px "Segoe UI", system-ui, -apple-system, sans-serif';
const DERIVATION_MAX_WIDTH = 180;
const DERIVATION_PAD_X = 9;
const DERIVATION_PAD_Y = 5;
const DERIVATION_LINE = 15;
/** Length of the leader line between the oval and the box. */
const DERIVATION_GAP = 16;

function derivationFlyout(node: AttributeNode): React.ReactNode {
  const formula = node.derivation?.trim();
  if (!node.derived || !formula || node.showDerivation === false) return null;

  const lines = wrapText(formula, DERIVATION_MAX_WIDTH, DERIVATION_FONT);
  const textWidth = lines.reduce((m, l) => Math.max(m, measureText(l, DERIVATION_FONT)), 0);
  const boxW = Math.round(textWidth) + DERIVATION_PAD_X * 2;
  const boxH = lines.length * DERIVATION_LINE + DERIVATION_PAD_Y * 2;

  const onLeft = node.derivationSide === 'left';
  const anchor = onLeft ? node.x - node.w / 2 : node.x + node.w / 2;
  const boxX = onLeft ? anchor - DERIVATION_GAP - boxW : anchor + DERIVATION_GAP;
  const boxY = node.y - boxH / 2;
  const textX = boxX + DERIVATION_PAD_X;
  // `dominant-baseline: central` puts y at the middle of each line.
  const firstLineY = boxY + DERIVATION_PAD_Y + DERIVATION_LINE / 2;

  return (
    <g className="derivation">
      <line
        className="derivation-leader"
        x1={anchor}
        y1={node.y}
        x2={onLeft ? boxX + boxW : boxX}
        y2={node.y}
      />
      <rect className="derivation-box" x={boxX} y={boxY} width={boxW} height={boxH} rx={4} />
      <text className="derivation-text" x={textX} y={firstLineY}>
        {lines.map((line, i) => (
          <tspan key={i} x={textX} dy={i === 0 ? 0 : DERIVATION_LINE}>
            {line || ' '}
          </tspan>
        ))}
      </text>
    </g>
  );
}

/** How much of a note's width the brace takes, and how deep its tip pokes. */
const BRACE_BAND = 22;
const BRACE_TIP = 9;
const NOTE_PAD = 12;
const NOTE_LINE = 17;

/**
 * A vertical curly brace whose spine sits at `x`, running from `y0` to `y1`.
 * A positive `tip` points the middle prong to the left, so the note's text
 * reads to the right of it; negative mirrors the whole thing.
 *
 * It is drawn rather than typed as a "{" glyph for the same reason the subset
 * symbol is: the brace has to stretch to whatever height the author drags, and
 * an exported SVG cannot rely on the app's fonts.
 */
function bracePath(x: number, y0: number, y1: number, tip: number): string {
  const mid = (y0 + y1) / 2;
  // Shallow curls on a short note, so the arms never cross over each other.
  const q = Math.max(4, Math.min(14, (y1 - y0) / 4));
  return [
    `M ${x + tip} ${y0}`,
    `q ${-tip} 0 ${-tip} ${q}`,
    `L ${x} ${mid - q}`,
    `q 0 ${q} ${-tip} ${q}`,
    `q ${tip} 0 ${tip} ${q}`,
    `L ${x} ${y1 - q}`,
    `q 0 ${q} ${tip} ${q}`,
  ].join(' ');
}

/** One EER shape, drawn from its centre point. */
function NodeShapeImpl({
  node,
  selected,
  decoration,
  issue,
  onPointerDown,
  onDoubleClick,
}: Props) {
  // Which way a triangle marker points is a property of the diagram, not of
  // the node, so the model works it out once and hands it over.
  const isaAngle = (decoration?.isaAngle as number) ?? 0;
  const { x, y, w, h } = node;
  const classes = ['node', `n-${node.kind}`];
  if (selected) classes.push('selected');
  if (node.kind === 'attribute' && node.derived) classes.push('derived');

  let shape: React.ReactNode = null;
  let label = node.name;
  let labelDy = 0;

  switch (node.kind) {
    case 'entity':
      shape = (
        <>
          <rect className="shape" x={x - w / 2} y={y - h / 2} width={w} height={h} rx={3} />
          {node.weak && (
            <rect
              className="shape-inner"
              x={x - w / 2 + 5}
              y={y - h / 2 + 5}
              width={w - 10}
              height={h - 10}
              rx={2}
            />
          )}
        </>
      );
      break;

    case 'relationship':
      shape = (
        <>
          <polygon className="shape" points={diamondPoints(x, y, w, h)} />
          {node.identifying && (
            <polygon className="shape-inner" points={diamondPoints(x, y, w, h, 7)} />
          )}
        </>
      );
      break;

    case 'attribute':
      shape = (
        <>
          <ellipse className="shape" cx={x} cy={y} rx={w / 2} ry={h / 2} />
          {node.multivalued && (
            <ellipse className="shape-inner" cx={x} cy={y} rx={w / 2 - 5} ry={h / 2 - 5} />
          )}
        </>
      );
      break;

    case 'isa':
      if (node.constrained === false) {
        // Plain inheritance: no circle and no letter, so the subclass hangs
        // off its superclass on one line carrying only the ⊂.
        //
        // The joint still has to be here for the two lines to meet at, and
        // has to be grabbable to move or configure, so it is drawn as a faint
        // dot that the exporter strips — the editor gets a handle, the
        // exported diagram gets the notation.
        shape = <circle className="isa-joint no-export" cx={x} cy={y} r={Math.min(w, h) / 2} />;
        label = '';
      } else {
        // Elmasri & Navathe draw the d/o marker in a circle; other texts use a
        // triangle, which is rotated so its apex points at the superclass.
        shape =
          node.symbol === 'triangle' ? (
            <g transform={`rotate(${isaAngle} ${x} ${y})`}>
              <polygon className="shape" points={trianglePoints(x, y, w, h)} />
            </g>
          ) : (
            <circle className="shape" cx={x} cy={y} r={Math.min(w, h) / 2} />
          );
        label = node.disjoint ? 'd' : 'o';
        // In the triangle form the label sits in the wide lower half.
        labelDy = node.symbol === 'triangle' ? 8 : 0;
      }
      break;

    case 'union':
      shape = <circle className="shape" cx={x} cy={y} r={w / 2} />;
      label = '∪';
      break;
  }

  if (node.kind === 'note') {
    const left = x - w / 2;
    const right = x + w / 2;
    const top = y - h / 2;
    const bottom = y + h / 2;
    const onLeft = node.side !== 'right';
    // The brace hugs one edge; the text takes the rest of the box.
    const spine = onLeft ? left + BRACE_BAND : right - BRACE_BAND;
    const textX = onLeft ? spine + NOTE_PAD : left + NOTE_PAD;
    const textWidthAvailable = w - BRACE_BAND - NOTE_PAD * 2;
    const lines = wrapText(node.body || 'Double-click to type your explanation.', textWidthAvailable);
    const block = (lines.length - 1) * NOTE_LINE;

    return (
      <g
        className={classes.join(' ')}
        data-id={node.id}
        onPointerDown={(e) => onPointerDown?.(e, node)}
        onDoubleClick={(e) => onDoubleClick?.(e, node)}
      >
        {/* Invisible but hit-testable, so the whole note can be grabbed. */}
        <rect className="note-area" x={left} y={top} width={w} height={h} />
        <path className="brace" d={bracePath(spine, top + 4, bottom - 4, onLeft ? BRACE_TIP : -BRACE_TIP)} />
        <text className={`note-text${node.body ? '' : ' placeholder'}`} x={textX} y={y - block / 2}>
          {lines.map((line, i) => (
            <tspan key={i} x={textX} dy={i === 0 ? 0 : NOTE_LINE}>
              {line || ' '}
            </tspan>
          ))}
        </text>
        {selected && (
          <rect className="sel-halo" x={left - 7} y={top - 7} width={w + 14} height={h + 14} rx={6} />
        )}
      </g>
    );
  }

  // IDEF1X-style alternate-key markers, worked out by the model.
  const altKeys = (decoration?.altKeys as number[] | undefined) ?? [];
  const akLabel = altKeys.length > 0 ? altKeys.map((n) => `AK${n}`).join(' ') : null;
  // The name shifts up to make room, so the marker never sits on the underline.
  if (akLabel) labelDy = -6;

  const textWidth = measureText(label);
  const underline =
    node.kind === 'attribute' && (node.key || node.partialKey) ? (
      <line
        className={`key-underline${node.partialKey ? ' partial' : ''}`}
        x1={x - textWidth / 2}
        x2={x + textWidth / 2}
        y1={y + labelDy + 9}
        y2={y + labelDy + 9}
      />
    ) : null;

  return (
    <g
      className={classes.join(' ')}
      data-id={node.id}
      onPointerDown={(e) => onPointerDown?.(e, node)}
      onDoubleClick={(e) => onDoubleClick?.(e, node)}
    >
      {shape}
      {label !== '' && (
        <text x={x} y={y + labelDy} textAnchor="middle" dominantBaseline="central">
          {label}
        </text>
      )}
      {underline}
      {node.kind === 'attribute' && derivationFlyout(node)}
      {akLabel && (
        <text className="alt-key" x={x} y={y + 13} textAnchor="middle" dominantBaseline="central">
          {akLabel}
        </text>
      )}
      {node.kind === 'isa' && (
        <title>
          {node.constrained === false
            ? 'Subclass'
            : node.disjoint
              ? 'Disjoint'
              : 'Overlapping'}{' '}
          · {node.total ? 'total' : 'partial'} specialisation
        </title>
      )}
      {node.kind === 'union' && (
        <title>Union / category type ({node.total ? 'total' : 'partial'})</title>
      )}
      {selected && (
        <rect
          className="sel-halo"
          x={x - w / 2 - 7}
          y={y - h / 2 - 7}
          width={w + 14}
          height={h + 14}
          rx={6}
        />
      )}
      {issue && (
        <g className={`issue-badge ${issue}`} transform={`translate(${x + w / 2 - 2} ${y - h / 2 + 2})`}>
          <circle r={7} />
          <text textAnchor="middle" dominantBaseline="central" y={0.5}>
            !
          </text>
        </g>
      )}
    </g>
  );
}

export const NodeShape = memo(NodeShapeImpl);
