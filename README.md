# DBMS Modeling Tool

A browser-based modelling tool covering all three stages of database design — the **conceptual**
EER diagram, the **logical** relational schema and the **physical** storage design — built for
practising the process end to end. It draws each notation properly, checks the model as you build
it, and generates the next stage from the one before.

Formerly *EER Diagram Designer*; the repository moved with the name, and links handed out under the
old address still work.

No installation for the people using it: it is a static site, so a URL is enough.

---

## What it does

**Every EER construct, drawn correctly**

| Construct | Notation |
| --- | --- |
| Entity type | Rectangle; double border for a weak entity |
| Relationship type | Diamond; double border when identifying |
| Attribute | Oval — double for multivalued, dashed for derived |
| Key / partial key | Solid / dashed underline |
| Composite attribute | Child ovals hanging off the parent |
| Cardinality | `1 : N : M` ratio labels and `(min,max)` structural constraints |
| Total participation | Double line |
| Recursive relationship | Two legs to one diamond, fanned apart, each with a role name |
| Specialisation | Circle carrying `d` (disjoint) or `o` (overlapping), or a triangle if your course uses that form; double line for total |
| Plain inheritance | No circle at all — a lone subclass on a line carrying only `⊂`, as Elmasri draws MANAGER under EMPLOYEE |
| Subset inclusion | `⊂` on every subclass line and on a category line, opening towards the superclass |
| Attribute-defined specialisation | The defining attribute labelled on the superclass line |
| Shared subclass | One entity may be a subclass under several specialisations |
| Union / category | `∪` circle joining several unrelated superclasses to one subclass |

**A model checker that runs as you draw.** Missing keys, weak entities with no identifying
relationship, recursive relationships with unnamed roles, attributes attached to two owners,
subclasses redeclaring an inherited key, specialisation cycles, single-leg relationships. Click any
finding to select what it refers to.

**SQL generation.** The diagram is mapped to `CREATE TABLE` statements following the standard
seven-step ER-to-relational algorithm: weak entities borrow their owner's key, 1:N becomes a foreign
key on the functional side, M:N and n-ary become junction tables, multivalued attributes become
their own tables, composite attributes flatten into component columns, derived attributes are
omitted with a note, subclasses get one table each keyed on the inherited primary key, and category
types get a surrogate key with mutually exclusive links. Constraints SQL cannot express — total and
disjoint specialisation — are called out as warnings rather than silently dropped.

**Storage and sharing.** A library of named diagrams kept in your browser, `.eer.json` files, SVG
and PNG export, and a shareable link that carries the entire diagram in the URL. No account, no
server, no network — the whole thing is a folder of static files, so nothing can expire or go down.

**Three models, one project.** The design process has three stages and this has a tool for each:
the **conceptual** EER diagram, the **logical** relational schema, and the **physical** design —
plus instance diagrams that test the conceptual one. Each stage generates the next: **Generate
relational model** maps an EER diagram to tables using the same code that produces the SQL, so the
diagram and the script cannot disagree, and **Generate physical model** turns those tables into
stored files with clustering and foreign-key indexes.

**Physical design with real numbers.** Each stored file carries its organisation, row count and
record size, and shows the blocking factor, block count and block accesses needed to find one
record — linear for a heap, `log₂(b)` for an ordered file, tree levels plus one through an index.
The arithmetic is the textbook kind rather than a query planner, so the absolute figures are
idealised, but the ratios are right and the ratios are what the choice turns on.

**Instance diagrams, checked against the schema.** Draw a handful of sample rows for an EER model
and the checker holds them against its constraints: an instance joined to two owners where the
schema says one, an instance in no relationship where participation is total, a count outside a
`(min,max)` bound, a weak-entity instance with no owner, a subclass member missing from its
superclass or sitting in two disjoint subclasses. Read the other way, it is how you test a
constraint — if you can draw legal-looking data that violates what you meant, the schema is what
needs fixing.

**Team projects.** Start a project, hand out a revocable invite link, and work on the same diagrams.
Members are owners, editors, or viewers, enforced by row-level security rather than by hiding
buttons. Every change is attributed: a restorable version history with the author on each snapshot,
plus an activity feed covering the things a snapshot cannot show — renames, publishing, joining.
Presence shows who else has a diagram open, and a save based on a stale copy is refused rather than
silently overwriting a teammate.

---

## Using it

| | |
| --- | --- |
| Add a shape | Drag from the palette, or click to place one |
| Rename | Double-click a shape |
| Connect | Press `C`, click one shape, then the other — the connection type is inferred |
| Edit anything | Select it; every property is in the right-hand inspector |
| Add an attribute | Select the owner, then **+ Add attribute** — it places and connects the oval |
| Pan / zoom | Space-drag, Alt-drag or middle-drag; wheel to zoom; `F` to fit |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Duplicate | `Ctrl+D` |

The full notation guide and shortcut list are behind the **?** button in the app.

Two worked examples ship with it, under **File ▸ Example**: the classic company schema (weak entity,
recursive supervision, ISA, M:N with attributes) and a small union/category model.

---

## Running it locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints. `npm run build` produces a static `dist/` directory;
`npm run typecheck` runs the TypeScript project check.

---

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. **Settings ▸ Pages ▸ Build and deployment ▸ Source** → **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes it.

The Vite `base` is `./`, so the site works at `https://<user>.github.io/<repo>/` without any
repository-specific configuration.

There is nothing to configure: no secrets, no services. The workflow builds the site and publishes
it.

---

## Where your diagrams live

In your browser, in IndexedDB, under **My diagrams**. Save as many as you like, reopen, rename,
duplicate, export. Once a diagram has been saved once, later edits go back to it on their own.

A separate autosave keeps whatever is on the canvas even before you have named it, so closing the
tab is never destructive.

**The limitation, stated plainly:** browser storage is not a safe place for the only copy of
anything. Clearing site data removes it, and it does not follow you to another browser or machine.
So the library offers **Back up all diagrams** — one file holding everything — and **Restore from a
backup** to read it back. Individual diagrams export as `.eer.json` too.

This app used to offer accounts, shared projects and real-time collaborative editing, backed by
Supabase. That was removed in October 2026: the free database paused itself after a week of
inactivity, which took sign-in with it, which took saving with it. A tool for coursework that can
stop accepting work because a server went idle is the wrong shape. The code is in the git history if
anyone wants it back.

---

## How it is built

Plain React 19 + TypeScript on Vite, with hand-drawn SVG — no diagramming library, so the shapes are
exactly the EER notation rather than an approximation of it.

```
src/
  platform/    canvas, geometry, text measurement, serialisation, export, the document
  ecosystem/   the model registry — the seam every modelling tool plugs into
  models/      eer, instance, relational, physical: shapes, rules, inspectors, generators
  local/       the diagram library (IndexedDB) and its backup format
  app/         toolbar and the library dialog
```

Two decisions are worth knowing about if you read the code:

- **Diagram styling lives inside the `<svg>` as a `<style>` element.** SVG export is therefore a
  clone, a few `remove()` calls and a new `viewBox` — the exported file looks identical outside the
  app with no style-rewriting step.
- **A library entry is the export format.** A saved diagram and a `.eer.json` file on disk are the
  same object, so exporting is a copy rather than a conversion and the two cannot drift apart.
- **Chen ratio labels and `(min,max)` constraints read in opposite directions.** In `A —1— R —N— B`
  it is *B* whose table takes the foreign key; in `A —(1,N)— R —(1,1)— B` the `(1,1)` marks the same
  side. `functionalSides()` in `src/models/eer/ddl.ts` normalises both notations before
  anything downstream looks at them.

---

## Contributing / picking this up again

[`DEVELOPMENT.md`](DEVELOPMENT.md) is the working context: current status, the decisions already
taken and why, the planned three-model ecosystem, and what is in flight or broken. Read it before
resuming work.

---

## Licence

MIT — see [LICENSE](LICENSE).
