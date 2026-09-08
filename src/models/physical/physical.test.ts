import { describe, expect, it } from 'vitest';
import { estimateIndex, estimateStore } from './estimates';
import { physicalFromRelational } from './fromRelational';
import { validate } from './validate';
import { indexesOf, isIndex, isStore, type Diagram, type StoreNode } from './types';
import { makeIndex, makeStore } from './factory';
import { relationalFromEer } from '../relational/fromEer';
import { readColumns } from '../relational/types';
import { companySample } from '../eer/samples';

const store = (extra: Partial<StoreNode> = {}): StoreNode => ({
  ...makeStore('t', 0, 0),
  estimatedRows: 10000,
  avgRowBytes: 100,
  blockSize: 4096,
  fillFactor: 1,
  ...extra,
});

const errors = (issues: { severity: string; message: string }[]) =>
  issues.filter((i) => i.severity === 'error').map((i) => i.message);
const warnings = (issues: { severity: string; message: string }[]) =>
  issues.filter((i) => i.severity === 'warning').map((i) => i.message);

describe('storage estimates', () => {
  it('computes blocking factor and block count', () => {
    // 4096 / 100 = 40 records per block; 10000 / 40 = 250 blocks.
    const est = estimateStore(store())!;
    expect(est.blockingFactor).toBe(40);
    expect(est.blocks).toBe(250);
    expect(est.bytes).toBe(1_000_000);
  });

  it('honours the fill factor', () => {
    const est = estimateStore(store({ fillFactor: 0.5 }))!;
    expect(est.blockingFactor).toBe(20);
    expect(est.blocks).toBe(500);
  });

  // The whole reason to record an organisation: the costs differ by orders.
  it('charges a heap a linear scan and an ordered file a binary search', () => {
    const heap = estimateStore(store({ organisation: 'heap' }))!;
    const sequential = estimateStore(store({ organisation: 'sequential' }))!;
    const hash = estimateStore(store({ organisation: 'hash' }))!;

    expect(heap.keyLookup).toBe(125); // 250 / 2
    expect(sequential.keyLookup).toBe(8); // ceil(log2(250))
    expect(hash.keyLookup).toBe(2);
    expect(sequential.keyLookup).toBeLessThan(heap.keyLookup);
    expect(hash.keyLookup).toBeLessThan(sequential.keyLookup);
  });

  it('returns nothing when there are no rows to estimate from', () => {
    expect(estimateStore(store({ estimatedRows: 0 }))).toBeNull();
  });

  it('makes an index beat a heap scan by a wide margin', () => {
    const heap = store({ organisation: 'heap', estimatedRows: 1_000_000 });
    const index = makeIndex('idx', ['id'], 0, 0, { avgKeyBytes: 8 });
    const viaIndex = estimateIndex(index, heap)!;
    const viaScan = estimateStore(heap)!;

    expect(viaIndex.lookup).toBeLessThan(10);
    expect(viaScan.keyLookup).toBeGreaterThan(1000);
  });

  it('grows index levels with the row count, not linearly', () => {
    const small = estimateIndex(makeIndex('i', ['id'], 0, 0), store({ estimatedRows: 1000 }))!;
    const large = estimateIndex(makeIndex('i', ['id'], 0, 0), store({ estimatedRows: 10_000_000 }))!;
    expect(large.levels).toBeGreaterThan(small.levels);
    expect(large.levels).toBeLessThan(6);
  });
});

describe('generating a physical model from a relational one', () => {
  const build = () => physicalFromRelational(relationalFromEer(companySample()).diagram);

  it('stores every table exactly once', () => {
    const { diagram } = build();
    const relational = relationalFromEer(companySample()).diagram;
    const stored = diagram.nodes.filter(isStore).map((s) => s.tableName).sort();
    expect(stored).toEqual(relational.nodes.map((n) => n.name).sort());
  });

  it('gives each keyed table one unique clustering index', () => {
    const { diagram } = build();
    for (const s of diagram.nodes.filter(isStore)) {
      const clustering = indexesOf(diagram, s.id).filter((i) => i.clustering);
      expect(clustering.length).toBeLessThanOrEqual(1);
      if (clustering.length === 1) expect(clustering[0].unique).toBe(true);
    }
  });

  it('indexes the foreign keys, because joins read through them', () => {
    const { diagram } = build();
    const employee = diagram.nodes.filter(isStore).find((s) => s.tableName === 'employee')!;
    const columns = indexesOf(diagram, employee.id).flatMap((i) => i.columns);
    expect(columns).toContain('department_dnumber');
    expect(columns).toContain('supervisor_ssn');
  });

  it('attaches every index to a file', () => {
    const { diagram } = build();
    for (const i of diagram.nodes.filter(isIndex)) {
      expect(diagram.edges.some((e) => e.source === i.id)).toBe(true);
    }
  });

  it('produces a design that passes its own checker', () => {
    const { diagram } = build();
    expect(errors(validate(diagram, {}))).toEqual([]);
  });

  // A subclass table's foreign key *is* its primary key, so indexing both
  // would cost storage and slow every write for nothing.
  it('does not index a foreign key its clustering index already serves', () => {
    const { diagram } = build();
    expect(warnings(validate(diagram, {})).filter((m) => m.includes('identical indexes'))).toEqual([]);

    const secretary = diagram.nodes.filter(isStore).find((s) => s.tableName === 'secretary')!;
    expect(indexesOf(diagram, secretary.id)).toHaveLength(1);
  });
});

describe('the physical checker', () => {
  function withIndexes(count: number, clustering: boolean): Diagram {
    const s = store({ estimatedRows: 100 });
    const nodes = [s];
    const edges = [];
    for (let i = 0; i < count; i++) {
      const index = makeIndex(`idx${i}`, [`c${i}`], 0, 0, { clustering });
      nodes.push(index as never);
      edges.push({ id: `e${i}`, kind: 'indexes' as const, source: index.id, target: s.id });
    }
    return { nodes, edges } as Diagram;
  }

  // A file has one physical order, so only one index can decide it.
  it('catches two clustering indexes on one file', () => {
    const found = errors(validate(withIndexes(2, true), {}));
    expect(found.some((m) => m.includes('clustering indexes'))).toBe(true);
  });

  it('allows several secondary indexes', () => {
    expect(errors(validate(withIndexes(3, false), {}))).toEqual([]);
  });

  it('catches a record larger than a block', () => {
    const d: Diagram = { nodes: [store({ avgRowBytes: 9000, blockSize: 4096 })], edges: [] };
    expect(errors(validate(d, {})).some((m) => m.includes('must fit inside a block'))).toBe(true);
  });

  it('catches an ordered file with no key', () => {
    const d: Diagram = { nodes: [store({ organisation: 'sequential', keyColumns: [] })], edges: [] };
    expect(errors(validate(d, {})).some((m) => m.includes('ordered file needs'))).toBe(true);
  });

  it('warns about a large heap with no index', () => {
    const d: Diagram = { nodes: [store({ organisation: 'heap', estimatedRows: 50000 })], edges: [] };
    expect(warnings(validate(d, {})).some((m) => m.includes('full scan'))).toBe(true);
  });

  it('warns about duplicate indexes', () => {
    const s = store({ estimatedRows: 100 });
    const a = makeIndex('a', ['x'], 0, 0);
    const b = makeIndex('b', ['x'], 0, 0);
    const d = {
      nodes: [s, a, b],
      edges: [
        { id: 'e1', kind: 'indexes', source: a.id, target: s.id },
        { id: 'e2', kind: 'indexes', source: b.id, target: s.id },
      ],
    } as Diagram;
    expect(warnings(validate(d, {})).some((m) => m.includes('identical indexes'))).toBe(true);
  });

  it('checks index columns against a linked relational schema', () => {
    const relational = relationalFromEer(companySample()).diagram;
    const { diagram } = physicalFromRelational(relational);
    const index = diagram.nodes.filter(isIndex)[0];
    index.columns = ['not_a_column'];

    const found = errors(validate(diagram, { source: relational }));
    expect(found.some((m) => m.includes('not a column of'))).toBe(true);
  });

  it('accepts the generated design against its own schema', () => {
    const relational = relationalFromEer(companySample()).diagram;
    const { diagram } = physicalFromRelational(relational);
    expect(errors(validate(diagram, { source: relational }))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The rules the block above does not reach                                   */
/* -------------------------------------------------------------------------- */

describe('the physical checker, on stores', () => {
  const only = (nodes: StoreNode[]): Diagram => ({ nodes, edges: [] });

  it('accepts a plausible small file', () => {
    expect(validate(only([store({ estimatedRows: 100 })]), {})).toHaveLength(1);
    // The one issue is the note that no schema is linked, not a complaint.
    expect(errors(validate(only([store({ estimatedRows: 100 })]), {}))).toEqual([]);
  });

  it('wants a table name', () => {
    const d = only([store({ tableName: '', name: '' })]);
    expect(errors(validate(d, {})).some((m) => m.includes('needs a table name'))).toBe(true);
  });

  it('refuses two files for the same table', () => {
    const d = only([store({ tableName: 'employee' }), store({ tableName: 'EMPLOYEE' })]);
    expect(errors(validate(d, {})).some((m) => m.includes('2 stored files are named'))).toBe(true);
  });

  // Without a row count there is nothing to compute a cost from, but an
  // unfinished design is not a broken one.
  it('notes a missing row estimate without calling it an error', () => {
    const d = only([store({ estimatedRows: 0 })]);
    const issues = validate(d, {});
    expect(issues.some((i) => i.severity === 'info' && i.message.includes('no row estimate'))).toBe(true);
    expect(errors(issues).some((m) => m.includes('row estimate'))).toBe(false);
  });

  it('refuses a record size of zero', () => {
    const d = only([store({ avgRowBytes: 0 })]);
    expect(errors(validate(d, {})).some((m) => m.includes('average record size above zero'))).toBe(true);
  });

  it('refuses a fill factor outside 0 to 1', () => {
    for (const fillFactor of [0, 1.5, -0.2]) {
      const d = only([store({ fillFactor })]);
      expect(errors(validate(d, {})).some((m) => m.includes('must be between 0 and 1'))).toBe(true);
    }
  });

  it('refuses a hash file with no hash key', () => {
    const d = only([store({ organisation: 'hash', keyColumns: [] })]);
    expect(errors(validate(d, {})).some((m) => m.includes('a hash file needs a hash key'))).toBe(true);
  });

  // A hash file's order is already decided by the hash function.
  it('warns that clustering a hashed file achieves nothing', () => {
    const s = store({ organisation: 'hash', keyColumns: ['id'], estimatedRows: 100 });
    const i = makeIndex('idx', ['id'], 0, 0, { clustering: true });
    const d = {
      nodes: [s, i],
      edges: [{ id: 'e1', kind: 'indexes', source: i.id, target: s.id }],
    } as Diagram;
    expect(warnings(validate(d, {})).some((m) => m.includes('clustering index on it does nothing'))).toBe(true);
  });
});

describe('the physical checker, on indexes', () => {
  /** One index sitting on one heap file. */
  function on(extra: Partial<Parameters<typeof makeIndex>[4]> = {}): Diagram {
    const s = store({ estimatedRows: 100 });
    const i = makeIndex('idx', ['id'], 0, 0, extra as never);
    return {
      nodes: [s, i],
      edges: [{ id: 'e1', kind: 'indexes', source: i.id, target: s.id }],
    } as Diagram;
  }

  it('wants a name', () => {
    expect(errors(validate(on({ indexName: '  ' }), {})).some((m) => m.includes('An index needs a name'))).toBe(true);
  });

  it('wants columns', () => {
    expect(errors(validate(on({ columns: [] }), {})).some((m) => m.includes('has no columns'))).toBe(true);
  });

  it('refuses an index floating free of any file', () => {
    const d: Diagram = { nodes: [makeIndex('idx', ['id'], 0, 0)], edges: [] };
    expect(errors(validate(d, {})).some((m) => m.includes('not attached to a stored file'))).toBe(true);
  });

  it('refuses a key size of zero', () => {
    expect(errors(validate(on({ avgKeyBytes: 0 }), {})).some((m) => m.includes('average key size above zero'))).toBe(true);
  });

  // A hash has no order, so there is nothing for it to cluster by.
  it('warns about a clustering hash index', () => {
    const found = warnings(validate(on({ type: 'hash', clustering: true }), {}));
    expect(found.some((m) => m.includes('no order to cluster by'))).toBe(true);
  });

  it('warns about a unique bitmap index', () => {
    const found = warnings(validate(on({ type: 'bitmap', unique: true }), {}));
    expect(found.some((m) => m.includes('bitmaps suit low-cardinality'))).toBe(true);
  });
});

describe('the physical checker, against a linked schema', () => {
  const schema = () => relationalFromEer(companySample()).diagram;

  it('says so when no schema is linked', () => {
    const d: Diagram = { nodes: [store({ estimatedRows: 100 })], edges: [] };
    const issues = validate(d, {});
    expect(issues.some((i) => i.message.includes('No relational schema is linked'))).toBe(true);
  });

  it('refuses a file for a table the schema does not have', () => {
    const relational = schema();
    const d: Diagram = { nodes: [store({ tableName: 'not_a_table' })], edges: [] };
    expect(
      errors(validate(d, { source: relational })).some((m) => m.includes('No table named')),
    ).toBe(true);
  });

  it('refuses an ordering key that is not a column of the table', () => {
    const relational = schema();
    const d: Diagram = {
      nodes: [store({ tableName: 'employee', organisation: 'sequential', keyColumns: ['nope'] })],
      edges: [],
    };
    expect(
      errors(validate(d, { source: relational })).some((m) => m.includes('is keyed on')),
    ).toBe(true);
  });

  // A key with no access path means referential-integrity checks scan the file.
  it('warns when nothing gives fast access to the primary key', () => {
    const relational = schema();
    const d: Diagram = {
      nodes: [store({ tableName: 'employee', organisation: 'heap', estimatedRows: 100 })],
      edges: [],
    };
    expect(
      warnings(validate(d, { source: relational })).some((m) =>
        m.includes('Nothing gives fast access'),
      ),
    ).toBe(true);
  });

  it('is satisfied by an ordered file keyed on the primary key', () => {
    const relational = schema();
    const employee = relational.nodes.find((t) => t.name === 'employee')!;
    const key = readColumns(employee).filter((c) => c.pk).map((c) => c.name);
    const d: Diagram = {
      nodes: [
        store({ tableName: 'employee', organisation: 'sequential', keyColumns: key, estimatedRows: 100 }),
      ],
      edges: [],
    };
    expect(
      warnings(validate(d, { source: relational })).some((m) =>
        m.includes('Nothing gives fast access'),
      ),
    ).toBe(false);
  });

  it('lists the tables that are not stored anywhere', () => {
    const relational = schema();
    const d: Diagram = { nodes: [store({ tableName: 'employee', estimatedRows: 100 })], edges: [] };
    const issues = validate(d, { source: relational });
    const note = issues.find((i) => i.message.includes('Not stored anywhere'));
    expect(note).toBeDefined();
    expect(note!.message).toContain('department');
  });
});
