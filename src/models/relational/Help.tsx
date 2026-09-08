export function Help() {
  return (
    <div className="help">
      <section>
        <h3>What this model is</h3>
        <p>
          The logical model: the tables an EER diagram becomes. Where the conceptual model says what
          the data <em>means</em>, this says how it is actually stored — relations, columns, keys,
          and the referential integrity between them.
        </p>
      </section>

      <section>
        <h3>Start from your EER diagram</h3>
        <p>
          Open a conceptual diagram and choose <strong>Generate relational model</strong>. The
          mapping is the standard one, and it is the same code that produces the SQL: weak entities
          borrow their owner’s key, 1:N becomes a foreign key on the side that can only take part
          once, M:N and n-ary become junction tables, multivalued attributes become their own
          tables, and each subclass gets a table keyed on the inherited primary key.
        </p>
        <p>
          Generating gives you a starting point, not a finished schema. Renaming, adding indexes and
          denormalising are yours to do here.
        </p>
      </section>

      <section>
        <h3>Drawing one by hand</h3>
        <ol>
          <li>Drop a <strong>Table</strong> and name it.</li>
          <li>Add columns in the inspector; tick <strong>PK</strong> for the key.</li>
          <li>
            Press <strong>C</strong>, click the referencing table, then the one it references.
          </li>
          <li>Select the arrow to say which column references which, and what happens on delete.</li>
        </ol>
      </section>

      <section>
        <h3>Notation</h3>
        <table>
          <tbody>
            <tr>
              <th>Box</th>
              <td>A relation. The name sits above the rule; columns below it.</td>
            </tr>
            <tr>
              <th>Underlined column</th>
              <td>Part of the primary key — the same convention as the EER diagram.</td>
            </tr>
            <tr>
              <th>FK</th>
              <td>This column takes part in a foreign key.</td>
            </tr>
            <tr>
              <th>•</th>
              <td>NOT NULL, on a column that is not already a key.</td>
            </tr>
            <tr>
              <th>Arrow</th>
              <td>
                Referential integrity, pointing from the referencing table to the one it references.
                A dashed arrow has no columns chosen yet.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>What the checker looks for</h3>
        <p>
          Relations with no key, duplicate table or column names, foreign keys with mismatched
          column counts, foreign keys referencing something that is neither a primary key nor
          unique, and type mismatches between a foreign key and what it points at. These are the
          faults that fail at <code>CREATE TABLE</code> time rather than at design time.
        </p>
      </section>
    </div>
  );
}
