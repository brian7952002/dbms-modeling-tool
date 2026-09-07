import type { Diagram } from '../model/types';
import { nodeBounds } from '../model/geometry';
import { diagramCss } from '../components/diagramStyles';

const MARGIN = 40;

/**
 * Produces a standalone SVG document from the live canvas.
 *
 * The diagram's styling already lives in a <style> element inside the SVG, so
 * the only work here is trimming editor-only chrome (grid, marquee, selection
 * halos) and re-framing the viewBox around the content.
 */
export function toSvgString(svg: SVGSVGElement, diagram: Diagram): string {
  const bounds = nodeBounds(diagram.nodes, MARGIN) ?? {
    minX: 0,
    minY: 0,
    maxX: 800,
    maxY: 600,
  };
  const width = Math.max(1, Math.round(bounds.maxX - bounds.minX));
  const height = Math.max(1, Math.round(bounds.maxY - bounds.minY));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('.no-export').forEach((el) => el.remove());
  clone.querySelectorAll('.sel-halo').forEach((el) => el.remove());
  clone.querySelectorAll('.issue-badge').forEach((el) => el.remove());
  clone.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
  clone.querySelectorAll('.edge-hit').forEach((el) => el.remove());

  // Always export the light palette: exported files are usually dropped into
  // documents and slides with white backgrounds.
  const style = clone.querySelector('style');
  if (style) style.textContent = diagramCss('light');

  const viewport = clone.querySelector('.viewport');
  viewport?.removeAttribute('transform');

  const bg = clone.querySelector('.canvas-bg') as SVGRectElement | null;
  if (bg) {
    bg.setAttribute('x', String(bounds.minX));
    bg.setAttribute('y', String(bounds.minY));
    bg.setAttribute('width', String(width));
    bg.setAttribute('height', String(height));
  }

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('viewBox', `${bounds.minX} ${bounds.minY} ${width} ${height}`);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.removeAttribute('style');

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

export async function toPngBlob(
  svg: SVGSVGElement,
  diagram: Diagram,
  scale = 2,
): Promise<Blob> {
  const source = toSvgString(svg, diagram);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The diagram could not be rasterised.'));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))),
      'image/png',
    );
  });
}
