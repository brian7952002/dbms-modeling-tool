const SHORTCUTS: [string, string][] = [
  ['V / C', 'Select tool / Connect tool'],
  ['Double-click', 'Rename a shape in place'],
  ['Drag on empty canvas', 'Rubber-band select'],
  ['Shift + click', 'Add to or remove from the selection'],
  ['Space + drag, Alt + drag, middle-drag', 'Pan'],
  ['Wheel', 'Zoom at the pointer · Shift + wheel scrolls sideways'],
  ['F', 'Fit the diagram to the window'],
  ['Ctrl/Cmd + Z, Ctrl/Cmd + Shift + Z', 'Undo, redo'],
  ['Ctrl/Cmd + D', 'Duplicate the selection'],
  ['Ctrl/Cmd + S', 'Save the .eer.json file'],
  ['Delete / Backspace', 'Delete the selection'],
  ['Arrow keys', 'Nudge (hold Shift for 10×)'],
  ['Esc', 'Cancel a connection or an inline rename'],
];

const NOTATION: [string, string][] = [
  ['Rectangle', 'Entity type. A double border marks a weak entity.'],
  ['Diamond', 'Relationship type. A double border marks an identifying relationship.'],
  ['Oval', 'Attribute. Double oval = multivalued, dashed = derived.'],
  ['Underlined attribute', 'Key attribute. A dashed underline is a partial key (weak-entity discriminator).'],
  ['Attribute on an attribute', 'Composite attribute — the components hang off the parent oval.'],
  ['Double line', 'Total participation: every instance must take part.'],
  ['1 / N / M labels', 'Cardinality ratio. One “1” side and one “N” side make a 1:N relationship.'],
  ['(min,max)', 'Structural constraint: how many relationship instances one entity instance joins.'],
  ['Triangle with d or o', 'Specialisation. d = disjoint subclasses, o = overlapping.'],
  ['Double line into a triangle', 'Total specialisation: every superclass member is in some subclass.'],
  ['Circle with ∪', 'Union / category type: a subclass drawn from several unrelated superclasses.'],
];

export function HelpContent() {
  return (
    <div className="help">
      <section>
        <h3>Getting started</h3>
        <ol>
          <li>Drag an <strong>Entity</strong> onto the canvas and double-click it to name it.</li>
          <li>
            With the entity selected, use <strong>+ Add attribute</strong> in the inspector — it places
            and connects the oval for you.
          </li>
          <li>
            Drop a <strong>Relationship</strong> diamond, switch to the <strong>Connect</strong> tool,
            then click the entity and the diamond in turn.
          </li>
          <li>
            Select the new line to set its cardinality, total participation, (min,max) constraint and
            role name.
          </li>
        </ol>
        <p>
          The <strong>Connect</strong> tool works out what kind of connection you mean from the two
          shapes you click, and refuses pairs that are not legal EER.
        </p>
      </section>

      <section>
        <h3>Recursive relationships</h3>
        <p>
          Connect the same entity to one diamond twice. The two legs fan apart automatically; give each
          one a <strong>role name</strong> (for example <em>supervisor</em> and <em>supervisee</em>) so
          the sides can be told apart. The role becomes the column prefix in the generated SQL.
        </p>
      </section>

      <section>
        <h3>Specialisation and union types</h3>
        <p>
          Drop an <strong>ISA</strong> triangle, connect the superclass first, then each subclass. The
          triangle rotates so its apex points at the superclass. Set disjoint/overlapping and
          total/partial in the inspector.
        </p>
        <p>
          A <strong>union</strong> circle is for a category whose members come from unrelated
          superclasses — connect the category entity first, then two or more superclasses.
        </p>
      </section>

      <section>
        <h3>Notation</h3>
        <table>
          <tbody>
            {NOTATION.map(([sym, meaning]) => (
              <tr key={sym}>
                <th>{sym}</th>
                <td>{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Keyboard</h3>
        <table>
          <tbody>
            {SHORTCUTS.map(([keys, meaning]) => (
              <tr key={keys}>
                <th>{keys}</th>
                <td>{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Saving and sharing</h3>
        <p>
          Work is kept in this browser automatically. <strong>File ▸ Save</strong> downloads a
          <code> .eer.json</code> file you can re-open or commit to a repo, and
          <strong> Export ▸ Shareable link</strong> packs the whole diagram into a URL — there is no
          server, so the link is the data.
        </p>
      </section>
    </div>
  );
}
