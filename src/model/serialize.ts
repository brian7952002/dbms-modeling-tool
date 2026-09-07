import type { Diagram, DiagramFile } from './types';

export const FILE_FORMAT = 'eer-diagram-designer';

export function toFile(diagram: Diagram, title: string): DiagramFile {
  return { format: FILE_FORMAT, version: 1, title, diagram };
}

/** Parses and sanity-checks a diagram file; throws with a readable message. */
export function fromFile(raw: unknown): { diagram: Diagram; title: string } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('That file does not contain a diagram.');
  }
  const f = raw as Partial<DiagramFile>;
  if (f.format !== FILE_FORMAT) {
    throw new Error('That file was not saved by EER Diagram Designer.');
  }
  const d = f.diagram;
  if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) {
    throw new Error('The diagram in that file is malformed.');
  }
  // Drop edges whose endpoints are missing rather than rendering broken lines.
  const ids = new Set(d.nodes.map((n) => n.id));
  const edges = d.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return {
    diagram: { nodes: d.nodes, edges },
    title: typeof f.title === 'string' && f.title ? f.title : 'Untitled diagram',
  };
}

/* -------------------------------------------------------------------------- */
/* Share links                                                                */
/* -------------------------------------------------------------------------- */

const toBase64Url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (s: string) => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function pipe(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(
    stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/**
 * Encodes the whole diagram into the URL fragment so a link is enough to share
 * it — there is no backend. Deflate keeps typical diagrams comfortably inside
 * browser URL limits; the caller warns when a link gets long anyway.
 */
export async function encodeShare(file: DiagramFile): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(file));
  if (typeof CompressionStream === 'undefined') return `u${toBase64Url(json)}`;
  const packed = await pipe(json, new CompressionStream('deflate-raw'));
  return `z${toBase64Url(packed)}`;
}

export async function decodeShare(payload: string): Promise<DiagramFile> {
  const kind = payload[0];
  const body = fromBase64Url(payload.slice(1));
  let json: Uint8Array;
  if (kind === 'z') {
    json = await pipe(body, new DecompressionStream('deflate-raw'));
  } else if (kind === 'u') {
    json = body;
  } else {
    throw new Error('Unrecognised share link.');
  }
  return JSON.parse(new TextDecoder().decode(json)) as DiagramFile;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
  'diagram';
