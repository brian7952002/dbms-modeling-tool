export function Help() {
  return (
    <div className="help">
      <section>
        <h3>What an instance diagram is for</h3>
        <p>
          An EER diagram says what <em>may</em> exist. An instance diagram shows a handful of rows
          that actually do, which is how you check that a constraint says what you meant. If your
          schema claims 1:N and you can draw a legal-looking instance joined to two owners, the
          schema is wrong.
        </p>
      </section>

      <section>
        <h3>Drawing one</h3>
        <ol>
          <li>Drop an <strong>Entity set</strong> for each entity type and name it to match.</li>
          <li>Drop <strong>Instances</strong> inside it — one dot per row, labelled with its key.</li>
          <li>Press <strong>C</strong> and click an instance then its set to record membership.</li>
          <li>Connect two instances to record one relationship instance between them.</li>
        </ol>
      </section>

      <section>
        <h3>Checking against the schema</h3>
        <p>
          Link an EER diagram under <strong>Schema</strong> in the inspector and the checker stops
          looking only at the drawing and starts asking whether the rows are actually permitted:
        </p>
        <ul>
          <li>an instance joined to two owners where the schema says one</li>
          <li>an instance in no relationship where participation is total</li>
          <li>a count outside a <code>(min,max)</code> constraint</li>
          <li>a weak-entity instance with no identifying owner</li>
          <li>a subclass member missing from its superclass, or in two disjoint subclasses</li>
          <li>a superclass member in no subclass where the specialisation is total</li>
        </ul>
        <p>
          Read the other way, this is how you test a constraint. If you can draw legal-looking data
          that violates what you meant, the schema is what needs fixing.
        </p>
        <p className="panel-hint">
          Recursive and n-ary relationships are reported as unchecked rather than guessed at: a link
          joins two dots, and which end plays which role cannot be read off it.
        </p>
      </section>

      <section>
        <h3>Notation</h3>
        <table>
          <tbody>
            <tr>
              <th>Rounded region</th>
              <td>An entity set — all the rows of one entity type. A double border marks a weak entity.</td>
            </tr>
            <tr>
              <th>Dot</th>
              <td>One instance, labelled with its key value.</td>
            </tr>
            <tr>
              <th>Faint dashed line</th>
              <td>Membership: which set an instance belongs to.</td>
            </tr>
            <tr>
              <th>Solid line between dots</th>
              <td>One relationship instance.</td>
            </tr>
            <tr>
              <th>Pill</th>
              <td>A relationship set — a legend naming the links.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
