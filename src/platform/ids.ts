import type { Id } from './types';

let counter = 0;

/** Unique enough for a collaborative document without coordination. */
export function newId(prefix = 'n'): Id {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}
