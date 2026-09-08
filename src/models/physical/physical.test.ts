import { describe, expect, it } from 'vitest';
import { estimateIndex, estimateStore } from './estimates';
import { physicalFromRelational } from './fromRelational';
import { validate } from './validate';
import { indexesOf, isIndex, isStore, type Diagram, type StoreNode } from './types';
import { makeIndex, makeStore } from './factory';
import { relationalFromEer } from '../relational/fromEer';
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
