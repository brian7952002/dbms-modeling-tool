import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { toFile } from '../platform/serialize';
import type { BaseNode, Diagram } from '../platform/types';
import * as lib from './library';

/**
 * The library is the only copy of a person's work that this app manages, so
 * these cover the operations that could lose some of it: saving over the wrong
 * record, renaming, deleting, and whether a backup can actually be restored.
 */

const node = (id: string, name: string): BaseNode => ({
  id,
  kind: 'entity',
  name,
  x: 0,
  y: 0,
  w: 140,
  h: 60,
});

const diagram = (...names: string[]): Diagram => ({
  nodes: names.map((n, i) => node(`n${i}`, n)),
  edges: [],
});

const file = (title: string, ...names: string[]) => toFile(diagram(...names), title, 'eer');

// fake-indexeddb persists for the whole file, so each test starts clean.
beforeEach(async () => {
  await lib.clearLibrary();
});

/* -------------------------------------------------------------------------- */

describe('the local diagram library', () => {
  it('starts empty', async () => {
    expect(await lib.listDiagrams()).toEqual([]);
  });

  it('saves a diagram and lists it', async () => {
    const saved = await lib.saveDiagram(null, file('Company schema', 'STUDENT'));
    expect(saved.title).toBe('Company schema');

    const list = await lib.listDiagrams();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(saved.id);
  });

  it('gives back exactly what it was given', async () => {
    const original = file('Practice', 'STUDENT', 'COURSE');
    const { id } = await lib.saveDiagram(null, original);

    const loaded = await lib.loadDiagram(id);
    expect(loaded!.file).toEqual(original);
    expect(loaded!.file.diagram.nodes.map((n) => n.name)).toEqual(['STUDENT', 'COURSE']);
  });

  // The autosave calls this on every change; a second save must replace the
  // first rather than piling up copies of the same diagram.
  it('saves over the same record when given its id', async () => {
    const first = await lib.saveDiagram(null, file('Practice', 'STUDENT'));
    const second = await lib.saveDiagram(first.id, file('Practice', 'STUDENT', 'COURSE'));

    expect(second.id).toBe(first.id);
    expect(await lib.listDiagrams()).toHaveLength(1);
    expect((await lib.loadDiagram(first.id))!.file.diagram.nodes).toHaveLength(2);
  });

  it('keeps the original creation time across a save', async () => {
    const first = await lib.saveDiagram(null, file('Practice', 'STUDENT'));
    const second = await lib.saveDiagram(first.id, file('Practice', 'STUDENT', 'COURSE'));
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('keeps two diagrams apart', async () => {
    const a = await lib.saveDiagram(null, file('First', 'STUDENT'));
    const b = await lib.saveDiagram(null, file('Second', 'INVOICE'));

    expect(a.id).not.toBe(b.id);
    expect((await lib.listDiagrams()).map((d) => d.title).sort()).toEqual(['First', 'Second']);
    expect((await lib.loadDiagram(a.id))!.file.diagram.nodes[0].name).toBe('STUDENT');
    expect((await lib.loadDiagram(b.id))!.file.diagram.nodes[0].name).toBe('INVOICE');
  });

  it('lists the most recently touched first', async () => {
    const older = await lib.saveDiagram(null, file('Older', 'A'));
    await lib.saveDiagram(null, file('Newer', 'B'));
    // Touching the older one should move it back to the top.
    await lib.saveDiagram(older.id, file('Older', 'A', 'C'));

    expect((await lib.listDiagrams()).map((d) => d.title)).toEqual(['Older', 'Newer']);
  });

  // The title lives in the file, so a rename has to reach both or the library
  // and the title bar start disagreeing about what the diagram is called.
  it('renames the record and the file together', async () => {
    const { id } = await lib.saveDiagram(null, file('Untitled diagram', 'STUDENT'));
    const renamed = await lib.renameDiagram(id, 'Company schema');

    expect(renamed.title).toBe('Company schema');
    expect((await lib.loadDiagram(id))!.file.title).toBe('Company schema');
  });

  it('refuses to rename something that is gone', async () => {
    await expect(lib.renameDiagram('nope', 'New name')).rejects.toThrow(/no longer in your library/);
  });

  it('deletes one without touching the others', async () => {
    const a = await lib.saveDiagram(null, file('First', 'A'));
    const b = await lib.saveDiagram(null, file('Second', 'B'));

    await lib.deleteDiagram(a.id);

    expect(await lib.loadDiagram(a.id)).toBeNull();
    expect(await lib.loadDiagram(b.id)).not.toBeNull();
    expect(await lib.listDiagrams()).toHaveLength(1);
  });

  it('duplicates into a separate record', async () => {
    const { id } = await lib.saveDiagram(null, file('Practice', 'STUDENT'));
    const copy = await lib.duplicateDiagram(id);

    expect(copy.id).not.toBe(id);
    expect(copy.title).toBe('Practice copy');
    expect(await lib.listDiagrams()).toHaveLength(2);

    // Editing the copy must not reach the original.
    await lib.saveDiagram(copy.id, file('Practice copy', 'STUDENT', 'COURSE'));
    expect((await lib.loadDiagram(id))!.file.diagram.nodes).toHaveLength(1);
  });

  it('returns null for a diagram that was never there', async () => {
    expect(await lib.loadDiagram('nope')).toBeNull();
  });
});

describe('backing the library up', () => {
  it('exports every diagram', async () => {
    await lib.saveDiagram(null, file('First', 'A'));
    await lib.saveDiagram(null, file('Second', 'B'));

    const bundle = await lib.exportAll();
    expect(bundle.format).toBe('dbms-modeling-tool-library');
    expect(bundle.diagrams.map((d) => d.title).sort()).toEqual(['First', 'Second']);
  });

  // An export that cannot be restored is only the appearance of a backup.
  it('restores an export into an empty library', async () => {
    await lib.saveDiagram(null, file('First', 'STUDENT'));
    await lib.saveDiagram(null, file('Second', 'INVOICE'));
    const bundle = await lib.exportAll();

    await lib.clearLibrary();
    expect(await lib.listDiagrams()).toEqual([]);

    expect(await lib.importBundle(bundle)).toBe(2);
    const restored = await lib.listDiagrams();
    expect(restored.map((d) => d.title).sort()).toEqual(['First', 'Second']);

    const first = restored.find((d) => d.title === 'First')!;
    expect((await lib.loadDiagram(first.id))!.file.diagram.nodes[0].name).toBe('STUDENT');
  });

  // Importing is additive, so a restore can never silently eat current work.
  it('adds to the library rather than replacing it', async () => {
    await lib.saveDiagram(null, file('Existing', 'A'));
    const bundle: lib.LibraryBundle = {
      format: 'dbms-modeling-tool-library',
      version: 1,
      exportedAt: new Date().toISOString(),
      diagrams: [file('From backup', 'B')],
    };

    await lib.importBundle(bundle);
    expect((await lib.listDiagrams()).map((d) => d.title).sort()).toEqual([
      'Existing',
      'From backup',
    ]);
  });

  it('refuses a file that is not a library', async () => {
    await expect(lib.importBundle(null)).rejects.toThrow(/does not contain a diagram library/);
    await expect(lib.importBundle({ format: 'something-else' })).rejects.toThrow(
      /not a diagram library/,
    );
    // A single diagram file is not a library, and says so rather than importing nothing.
    await expect(lib.importBundle(file('One diagram', 'A'))).rejects.toThrow(
      /not a diagram library/,
    );
  });
});
