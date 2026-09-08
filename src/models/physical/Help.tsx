export function Help() {
  return (
    <div className="help">
      <section>
        <h3>What this model is</h3>
        <p>
          The last stage: how each relation is actually stored, and what paths exist into it. The
          conceptual model says what the data means and the logical model says what the tables are —
          this is where a design acquires a cost.
        </p>
      </section>

      <section>
        <h3>Start from your relational schema</h3>
        <p>
          Open a relational diagram and choose <strong>Generate physical model</strong>. Every table
          becomes a file, its primary key gets a unique clustering index, and each foreign key gets a
          secondary index — the starting point a DBA would actually begin from, since joins and
          referential-integrity checks both read through them.
        </p>
        <p className="panel-hint">
          Row counts and record sizes come out as placeholders. The estimates mean nothing until you
          replace them with figures from the real data.
        </p>
      </section>

      <section>
        <h3>Reading the numbers</h3>
        <p>
          Each file shows its blocking factor, block count and the cost of a lookup on its own key.
          The arithmetic is the textbook kind — uniform records, no buffering, one block per access.
          It will not predict your database, but the ratios are right, and the ratios are what the
          decision turns on:
        </p>
        <table>
          <tbody>
            <tr>
              <th>Heap</th>
              <td>Linear scan: about b/2 blocks to find one record, b to prove it is absent.</td>
            </tr>
            <tr>
              <th>Sequential</th>
              <td>Binary search on the ordering key: log₂(b). Inserts pay for it.</td>
            </tr>
            <tr>
              <th>Hash</th>
              <td>Near-constant for equality on the hash key. Useless for ranges or ordering.</td>
            </tr>
            <tr>
              <th>Clustered</th>
              <td>Ordered physically by a key, so related records arrive together.</td>
            </tr>
            <tr>
              <th>B+-tree index</th>
              <td>Levels of the tree, then one access for the record — unless it clusters the file.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>What the checker looks for</h3>
        <ul>
          <li>two clustering indexes on one file — a file has only one physical order</li>
          <li>a clustering index on a hashed file, where the hash already fixes the order</li>
          <li>a large heap with no index, so every lookup is a full scan</li>
          <li>duplicate indexes, which cost storage and slow every write</li>
          <li>records larger than a block</li>
          <li>
            with a relational schema linked: index or key columns the table does not have, and a
            primary key with no fast access path
          </li>
        </ul>
      </section>

      <section>
        <h3>Notation</h3>
        <table>
          <tbody>
            <tr>
              <th>Box</th>
              <td>A stored file: one relation, with its organisation and estimates.</td>
            </tr>
            <tr>
              <th>Pill</th>
              <td>An index. ⚿ marks a unique one.</td>
            </tr>
            <tr>
              <th>Solid line</th>
              <td>A clustering index — it determines the file’s order.</td>
            </tr>
            <tr>
              <th>Dashed line</th>
              <td>A secondary index: an extra access path, no effect on order.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
