import type { IndexNode, StoreNode } from './types';

/**
 * Textbook sizing and access-cost estimates, in block accesses.
 *
 * These are the arithmetic from a physical-design chapter, not a query
 * planner: uniform records, no buffering, one block per access. The point is
 * to make the difference between a heap scan and an index lookup visible while
 * the choice is still being made, and the ratios are right even though the
 * absolute numbers are idealised.
 */

export interface StoreEstimate {
  /** Records per block, after the fill factor. */
  blockingFactor: number;
  blocks: number;
  bytes: number;
  /** Average block accesses to find one record on the file's own key. */
  keyLookup: number;
  /** Block accesses for a full scan. */
  fullScan: number;
  /** Why the lookup figure is what it is. */
  lookupBasis: string;
}

export function estimateStore(store: StoreNode): StoreEstimate | null {
  const rows = Math.max(0, Math.floor(store.estimatedRows));
  const rowBytes = Math.max(1, Math.floor(store.avgRowBytes));
  const blockSize = Math.max(1, Math.floor(store.blockSize));
  const fill = Math.min(1, Math.max(0.05, store.fillFactor || 1));
  if (!rows) return null;

  const blockingFactor = Math.max(1, Math.floor((blockSize * fill) / rowBytes));
  const blocks = Math.ceil(rows / blockingFactor);

  let keyLookup: number;
  let lookupBasis: string;
  switch (store.organisation) {
    case 'sequential':
    case 'clustered':
      keyLookup = Math.max(1, Math.ceil(Math.log2(blocks)));
      lookupBasis = `binary search, log₂(${blocks})`;
      break;
    case 'hash':
      // One block, plus a modest allowance for overflow chains.
      keyLookup = 2;
      lookupBasis = 'hash bucket, plus overflow';
      break;
    default:
      keyLookup = Math.max(1, Math.ceil(blocks / 2));
      lookupBasis = `linear scan, ${blocks}/2 on average`;
  }

  return {
    blockingFactor,
    blocks,
    bytes: rows * rowBytes,
    keyLookup,
    fullScan: blocks,
    lookupBasis,
  };
}

export interface IndexEstimate {
  /** Entries per index block. */
  fanout: number;
  levels: number;
  leafBlocks: number;
  /** Block accesses to reach one record through this index. */
  lookup: number;
  basis: string;
}

export function estimateIndex(index: IndexNode, store: StoreNode): IndexEstimate | null {
  const rows = Math.max(0, Math.floor(store.estimatedRows));
  const blockSize = Math.max(1, Math.floor(store.blockSize));
  const keyBytes = Math.max(1, Math.floor(index.avgKeyBytes));
  if (!rows) return null;

  // An entry is the key plus a block pointer.
  const entryBytes = keyBytes + 8;
  const fanout = Math.max(2, Math.floor(blockSize / entryBytes));
  const leafBlocks = Math.ceil(rows / fanout);

  if (index.type === 'hash') {
    return {
      fanout,
      levels: 1,
      leafBlocks,
      lookup: 2 + 1,
      basis: 'hash bucket, plus overflow, then the record',
    };
  }

  // Levels of a B+-tree over the leaf blocks.
  let levels = 1;
  let nodes = leafBlocks;
  while (nodes > 1) {
    nodes = Math.ceil(nodes / fanout);
    levels += 1;
  }

  // Walking the tree, then one access for the record itself — unless the index
  // determines the file's order, in which case the record is where you land.
  const lookup = levels + 1;
  return {
    fanout,
    levels,
    leafBlocks,
    lookup,
    basis: index.clustering
      ? `${levels} index levels, then the clustered record`
      : `${levels} index levels, then one record access`,
  };
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

export const formatCount = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
