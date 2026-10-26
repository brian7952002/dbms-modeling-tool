/**
 * The diagrams kept in this browser.
 *
 * This replaces the account-backed library. There is no server, no sign-in and
 * nothing to pause: the diagrams live in IndexedDB on this machine and are
 * available offline, forever, with no credentials involved.
 *
 * What a record holds is exactly the `DiagramFile` that "Save .eer.json"
 * writes. Library entry and file on disk are one format, so exporting is a
 * copy rather than a conversion, and anything you can open you can also save
 * out and keep somewhere this app does not control — which, given what browser
 * storage is, is the point.
 *
 * IndexedDB rather than localStorage because localStorage is a ~5 MB budget
 * shared by the whole origin and holds strings only; one worked-up diagram
 * with its history is not small, and a library of them would hit that wall.
 */

import type { DiagramFile } from '../platform/types';
import { newId } from '../platform/ids';

const DB_NAME = 'dbms-modeling-tool';
const DB_VERSION = 1;
const STORE = 'diagrams';

/** What the library list shows: everything about a diagram except the diagram. */
export interface LocalDiagram {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredDiagram extends LocalDiagram {
  file: DiagramFile;
}

/** A whole-library backup, and the only thing `importBundle` accepts. */
export interface LibraryBundle {
  format: 'dbms-modeling-tool-library';
  version: 1;
  exportedAt: string;
  diagrams: DiagramFile[];
}

const BUNDLE_FORMAT = 'dbms-modeling-tool-library';

/* -------------------------------------------------------------------------- */
/* The database                                                               */
/* -------------------------------------------------------------------------- */

/** False in private windows and anywhere site data is blocked. */
export function isAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!isAvailable()) {
    return Promise.reject(
      new Error('This browser will not let the app store diagrams. You can still save files.'),
    );
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        // A failed open must not be cached, or one hiccup disables the
        // library for the rest of the session.
        dbPromise = null;
        reject(request.error ?? new Error('Could not open the diagram store.'));
      };
    });
  }
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = fn(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error('The diagram store refused that.'));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('The diagram store refused that.'));
      }),
  );
}

const stripFile = ({ file: _file, ...rest }: StoredDiagram): LocalDiagram => rest;

/** Newest first: the one you were last working on is the one you want. */
const byNewest = (a: LocalDiagram, b: LocalDiagram) =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export async function listDiagrams(): Promise<LocalDiagram[]> {
  const all = await run<StoredDiagram[]>('readonly', (s) => s.getAll());
  return all.map(stripFile).sort(byNewest);
}

export async function loadDiagram(id: string): Promise<StoredDiagram | null> {
  const found = await run<StoredDiagram | undefined>('readonly', (s) => s.get(id));
  return found ?? null;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Saves under `id`, or creates a new diagram when `id` is null.
 *
 * The title follows the file, because the title bar is the one place a person
 * actually renames a diagram; keeping a separate library name would let the
 * two drift apart with no way to tell which was meant.
 */
export async function saveDiagram(id: string | null, file: DiagramFile): Promise<LocalDiagram> {
  const now = new Date().toISOString();
  const existing = id ? await loadDiagram(id) : null;
  const record: StoredDiagram = {
    id: existing?.id ?? id ?? newId('d'),
    title: file.title,
    model: file.model ?? 'eer',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    file,
  };
  await run('readwrite', (s) => s.put(record));
  return stripFile(record);
}

export async function renameDiagram(id: string, title: string): Promise<LocalDiagram> {
  const existing = await loadDiagram(id);
  if (!existing) throw new Error('That diagram is no longer in your library.');
  return saveDiagram(id, { ...existing.file, title });
}

export async function deleteDiagram(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

export async function duplicateDiagram(id: string): Promise<LocalDiagram> {
  const existing = await loadDiagram(id);
  if (!existing) throw new Error('That diagram is no longer in your library.');
  return saveDiagram(null, { ...existing.file, title: `${existing.title} copy` });
}

/* -------------------------------------------------------------------------- */
/* Backup                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything, in one object.
 *
 * Browser storage is not a safe place to keep the only copy of anything:
 * clearing site data takes it, and so does a different browser or machine.
 * This is the way out, and `importBundle` is the way back in — an export that
 * cannot be restored is only the appearance of a backup.
 */
export async function exportAll(): Promise<LibraryBundle> {
  const all = await run<StoredDiagram[]>('readonly', (s) => s.getAll());
  return {
    format: BUNDLE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    diagrams: all.sort(byNewest).map((d) => d.file),
  };
}

/** Empties the library. Nothing in the interface calls this without a confirmation. */
export async function clearLibrary(): Promise<void> {
  await run('readwrite', (s) => s.clear());
}

/** Adds a bundle's diagrams alongside what is already here; nothing is replaced. */
export async function importBundle(raw: unknown): Promise<number> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('That file does not contain a diagram library.');
  }
  const bundle = raw as Partial<LibraryBundle>;
  if (bundle.format !== BUNDLE_FORMAT || !Array.isArray(bundle.diagrams)) {
    throw new Error('That file is not a diagram library exported by this app.');
  }
  let added = 0;
  for (const file of bundle.diagrams) {
    if (!file || typeof file !== 'object' || !('diagram' in file)) continue;
    await saveDiagram(null, file as DiagramFile);
    added += 1;
  }
  return added;
}
