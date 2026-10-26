# Development notes

Working context for this project. Written so that work can resume after the chat history is
cleared: it records what exists, what is decided and why, what is broken, and what is next.

**Last updated:** 2026-09-08

---

## 1. Status at a glance

| | |
| --- | --- |
| Live site | https://brian7952002.github.io/dbms-modeling-tool/ |
| Repo | https://github.com/brian7952002/dbms-modeling-tool (public) |
| Deploy | GitHub Actions → Pages, on push to `main`; tests gate the build |
| Backend | **None.** Diagrams are kept in the browser. |

**Shipped:** full Chen/Elmasri EER notation, live model checker, SQL generation, JSON/SVG/PNG
export, self-contained share links, and a local diagram library with backup and restore.

**Ecosystem:** complete. The platform/model seam carries all four tools — EER, instance diagrams,
the relational schema, and the physical design — and the three stages of the design process chain
into each other: conceptual → logical → physical.

**Accounts and collaboration were removed on 26 October 2026**, along with Supabase. See §4 for
what replaced them and why. The history is in git if any of it is ever wanted back; the commit to
start from is the one that removed `src/cloud/`.

---

## 2. Running it

```bash
npm install
npm run dev        # http://localhost:5183 (see .claude/launch.json)
npm test           # vitest
npm run build      # typechecks, then builds
```

Nothing else is needed: no credentials, no services, no network. The app runs entirely in the
browser and the build is a folder of static files.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` survive as GitHub Actions secrets for the one-time
importer described in §4. When that goes, so do they.

### Gotchas already paid for

- **GitHub Pages caches `index.html` for ~10 minutes.** After a deploy that changes environment
  config, a browser can keep running the previous bundle and look broken. Hard-reload before
  believing a bug. Asset filenames are content-hashed, so this only bites on the first load after a
  change.
- **Vite does not always pick up a new `.env.local`** if the file appears after the dev server
  starts. Restart the server.
- Long `bash` heredocs sometimes truncate through the tool layer, and they collapse backslashes
  even inside a quoted delimiter. Write a script file and run it instead for anything sizable, and
  build literal escapes from character codes rather than typing them.

---

## 3. Architecture as it stands

```
src/
  platform/    model-agnostic engine: canvas, geometry, measurement, selection,
               undo, the Action vocabulary, persistence, export, collab/ (CRDT)
  ecosystem/   registry.ts (the ModelTool contract), models.ts (what is registered),
               ModelPicker
  models/
    eer/       conceptual: types, factory, graph, validate, ddl, samples, shapes,
               inspector, palette, styles, help — plus index.ts, the ModelTool
    instance/  sample data for an EER schema, same shape
  app/         shell: toolbar and the cloud dialogs
  cloud/       supabase client, auth, diagram CRUD, projects, presence
supabase/
  schema.sql   canonical schema: tables, RLS policies, audited write functions
```

**The seam.** `platform` knows only that a node has `{id, kind, name, x, y, w, h}` and an edge joins
two of them. Everything else is reached through the open `ModelTool`: its shapes, palette,
inspector, help, connection rules, checks, styling, and optional exports. Two pieces are worth
understanding:

- `outline(node)` — the shape's boundary, used to clip connectors and hit-test. `null` means an
  ellipse. This is why the canvas can draw a diamond it knows nothing about.
- `decorate(diagram)` — per-render values a shape needs but the platform cannot derive, keyed by
  element id: which way an ISA marker points, which connectors are doubled. Computed once per
  diagram, not per shape.

Adding the logical or physical model means writing a `ModelTool` and registering it. No platform
change should be required; if one is, the seam is in the wrong place and it is worth moving rather
than working around.

Three decisions worth not re-deriving:

- **The `Action` union is the editing API** (`platform/actions.ts`). Shapes and inspectors dispatch
  it; `useDiagramDoc` turns it into CRDT transactions. Keeping this shape is what let the CRDT
  migration and the ecosystem refactor happen without rewriting the canvas both times. Preserve it.

- **Diagram styling lives inside the `<svg>` as a `<style>` element** (`components/diagramStyles.ts`).
  SVG export is therefore a clone, a few `remove()` calls and a new `viewBox`. Do not move this
  styling into the app stylesheet or export breaks.
- **Chen ratio labels and `(min,max)` constraints read in opposite directions.** In `A —1— R —N— B`
  it is *B* whose table takes the foreign key; in `A —(1,N)— R —(1,1)— B` the `(1,1)` marks that
  same side. `functionalSides()` in `model/ddl.ts` normalises both before anything downstream looks
  at them. This is the single most error-prone part of the mapping.

---

## 4. Where diagrams are kept

There is no server. `src/local/library.ts` keeps diagrams in **IndexedDB** on the machine they were
made on, and that is the whole storage story.

A record holds exactly the `DiagramFile` that "Save .eer.json" writes, so a library entry and a file
on disk are one format. Exporting is a copy rather than a conversion, and anything you can open you
can also save out. IndexedDB rather than localStorage because localStorage is a ~5 MB budget shared
by the whole origin and holds strings only; a library of worked-up diagrams would hit that wall.

### Two layers of saving, and why both exist

1. **The scratch autosave** (`localStorage`, `eer-designer:autosave:v1`) holds whatever is on the
   canvas, saved 400 ms after any change. It is what makes closing the tab safe before you have
   decided a diagram is worth keeping.
2. **The library** holds named diagrams. Once a diagram has been saved to it once, later edits go
   back to the same entry automatically.

`eer-designer:current:v1` remembers which entry the tab was editing. Without it a reload restores
the drawing but forgets where it came from, so the status reads "Not saved yet" and every edit after
that quietly stops reaching the entry it belongs to — which is exactly how work gets lost.

### The honest limitation, stated in the interface

Browser storage is not a safe place for the only copy of anything: clearing site data takes it, and
it does not follow you to another browser or machine. The library says so in as many words, and
offers **Back up all diagrams** and **Restore from a backup** so there is a way out and a way back.
An export that cannot be restored is only the appearance of a backup, so both halves are tested.

### Why this replaced the hosted version

The Supabase project paused itself after a week of inactivity — which free projects do — and with it
went sign-in, and with sign-in went the ability to save. A tool for coursework that can stop
accepting work because a server went idle is the wrong shape. Nothing here can pause.

### The one-time importer

`src/local/importFromCloud.ts` is the last thing that talks to a server, and it exists to empty that
server rather than to use it: sign in once, copy every diagram into this browser, done. **It is
meant to be deleted**, along with the `@supabase/supabase-js` dependency and the two
`VITE_SUPABASE_*` build secrets, once the diagrams are across.

## 5. The modelling ecosystem

Built. This is no longer one EER editor but a shell hosting **independent modelling tools**,
matching the design process in Elmasri & Navathe. Adding another means writing a `ModelTool` and
registering it in `ecosystem/models.ts`; nothing in `platform/` should need to change.

| Model | Purpose | Status |
| --- | --- | --- |
| Conceptual | EER diagram — entities, relationships, specialisation | Built |
| Logical / implementation | Relational schema — tables, columns, keys, referential integrity | Built |
| Physical | Storage and access — file organisation, indexes, block-access cost | Built |

Instance diagrams (§6) belong to the conceptual family: sample data illustrating an EER model.

### Separation of concerns

Each tool should be genuinely independent — its own types, validation, palette, shapes and
inspector — over a shared, model-agnostic platform.

```
src/
  platform/     canvas engine, hit-testing, selection, undo, export, persistence, collaboration
  ecosystem/    the registry and the model-picker shell
  models/
    eer/        conceptual
    instance/   sample data for an EER model
    relational/ logical
    physical/   physical
  cloud/        unchanged
```

The registry is the seam. Something like:

```ts
interface ModelTool {
  id: 'eer' | 'instance' | 'relational' | 'physical';
  label: string;
  blurb: string;
  createEmpty(): Diagram;
  samples: Sample[];
  palette: PaletteItem[];
  validate(diagram: Diagram, context: ModelContext): Issue[];
  NodeShape: React.FC<NodeShapeProps>;
  EdgeShape: React.FC<EdgeShapeProps>;
  Inspector: React.FC<InspectorProps>;
  exports?: { sql?(d: Diagram): string };
  /** For models derived from or checked against another. */
  sourceModel?: ModelTool['id'];
}
```

The platform layer knows only that nodes have `{id, x, y, w, h, kind}` and edges have
`{source, target, kind}`; everything else is delegated. Getting `Canvas.tsx` down to that contract
is most of the refactor.

**Database:** `diagrams.kind` already exists with a check constraint of `('eer','instance')` —
extend it to include `'relational'` and `'physical'`. `diagrams.source_diagram_id` already exists
for cross-model links (instance → eer, relational → eer, physical → relational).

### Naming

Done. The product is **DBMS Modeling Tool** and the repository is `dbms-modeling-tool`.

Renaming the repo moved the Pages URL, and GitHub does **not** redirect old project-page URLs — so
every share link handed out under the old address would have died. Links are
`…github.io/<repo>/#c=<id>`, and the diagram lives in the fragment.

The old slug is therefore held by a second repository serving one page, which forwards to the new
address **preserving `location.hash`**. Old links keep working, including `#d=` share links that
carry a whole diagram and `#join=` invite links. Do not delete that repository; it is the only thing
keeping those links alive.

The file format keeps reading `eer-diagram-designer` and writes `dbms-modeling-tool`; there is a
test for it.

---

## 6. Instance diagrams

Built, as the second tool on the seam — which is what proves the seam is real.

Entity sets are labelled regions, instances are dots inside them, membership is a faint dashed line,
and a solid line between two dots is one relationship instance. A relationship-set pill acts as the
legend; link labels only appear when there are two or more sets to tell apart.

**Checking against the schema.** Link an EER diagram under *Schema* in the inspector and
`check.ts` holds the sample data against it: cardinality on the functional side, total
participation, `(min,max)` bounds, weak-entity ownership, and specialisation — subclass members
missing from their superclass, one instance in two disjoint subclasses, a superclass member in no
subclass when the specialisation is total. It reuses `functionalSides()` from
`models/eer/ddl.ts`, so the Chen-versus-`(min,max)` direction problem in §3 is handled in one place.

Recursive and n-ary relationships are reported as *unchecked* rather than guessed at: a link joins
two dots and which end plays which role cannot be read off it. If that becomes worth doing, it needs
roles on the links.

Source diagrams come from the cloud library, so linking a schema requires signing in — a schema you
check against has to be one you can open. The link lives in the CRDT document's `meta`, so it
travels with the diagram, and is mirrored to `diagrams.source_diagram_id`.

Covered by `check.test.ts`.

## 6a. The relational model

Built. `models/relational/`.

**Generated from the EER model, not reimplemented.** `models/eer/ddl.ts` was split into
`mapToRelational()` — the seven-step algorithm producing a `RelationalSchema` — and a renderer that
turns it into SQL. `models/relational/fromEer.ts` consumes the same structure and turns it into
shapes. That is why the generated diagram and the generated SQL cannot disagree, and there is a test
asserting they name the same tables and the same number of foreign keys.

The action appears as **File ▸ Generate relational model** whenever the open model declares
`derive` in the registry. It opens the result as a new diagram and leaves the source alone.

**Columns are stored one per key.** A table node carries `columnOrder: string[]` plus a `col:<id>`
entry per column, rather than an array. This keeps the CRDT property that made per-field storage
worth it in the first place: two people renaming different columns of the same table do not
overwrite each other. Read them with `readColumns()`; never touch the keys directly.

A table's box is sized by its widest row — name, type, and the `FK`/NOT NULL markers that sit
between them — so `sizeForTable` is called on every column edit, not only on rename.

Its checker covers the faults that fail at `CREATE TABLE` time: relations with no key, duplicate
table or column names, foreign keys with mismatched column counts, foreign keys referencing
something neither primary nor unique, and type mismatches. Its SQL generator emits tables in
dependency order and reports reference cycles rather than looping.

## 6b. The physical model

Built. `models/physical/`.

Each relation becomes a **stored file** with an organisation (heap, sequential, hash, clustered),
a row count, a record size, a block size and a fill factor. **Indexes** attach to files: B+-tree,
hash or bitmap; unique or not; clustering or secondary.

**The estimates are the point.** `estimates.ts` computes blocking factor, block count, and the
block accesses needed to reach one record — linear for a heap, `log₂(b)` for an ordered file,
near-constant for a hash, tree levels plus one for an index. It is textbook arithmetic (uniform
records, no buffering, one block per access), not a query planner, and the help says so. The
absolute numbers are idealised; the ratios are right, and the ratios are what the decision turns on.

Generated from the relational model by `fromRelational.ts`: every table becomes a file, its primary
key gets a unique clustering index, and each foreign key gets a secondary index — except where the
foreign key *is* the primary key, as on a subclass table, where the clustering index already serves
it. That exception exists because the first version generated the duplicate and its own checker
caught it; there is now a test asserting the generator produces nothing its checker complains about.

The checker covers what makes a physical design impossible or pointless: two clustering indexes on
one file, a clustering index on a hashed file, a large heap with no index, duplicate indexes,
records larger than a block, and — with a relational schema linked — index or key columns the table
does not have, and a primary key with no fast access path.

## 7. The document model

`src/platform/collab/` keeps its name for the sake of git history, but there is no collaboration in
it any more — only the document the canvas edits.

### Why Yjs is still here

A `DiagramDoc` wraps a `Y.Doc`: nodes and edges are each a `Y.Map` keyed by id, and every node is
itself a `Y.Map` of its fields. That was built for concurrent editing and now earns its place for
two plainer reasons:

- **`Y.UndoManager` is the undo stack**, with a capture timeout that makes a finished drag one step
  rather than forty.
- **It holds the work.** Replacing the document layer would be a large refactor of the one thing
  that must not lose a diagram, in exchange for dropping a dependency. That is a bad trade, and it
  stays a bad trade until there is a reason beyond tidiness.

`doc.test.ts` still contains merge tests. They exercise the data structure, not a feature: nothing
in the app merges two documents today. They are kept because they are the proof that per-field
storage works, and because they are what any future sync would be built on.

### Opening a diagram builds a new document

`reset` in `useDiagramDoc.ts` constructs a fresh `DiagramDoc` rather than emptying the current one.
This mattered acutely under collaboration — emptying a live document broadcast the deletion to
everyone else in it — and it still matters: a document's history is what gets saved, so reusing one
document for every diagram a tab opens means saving all of them, forever.

### What was removed on 26 October 2026

`RealtimeProvider`, awareness and peer cursors, `src/cloud/` entirely, the account and projects and
history modals, and the Supabase schema. Removed rather than disabled, because dead code that looks
live is worse than no code: the next person to read it cannot tell what the app actually does.

### Tests

292 tests across 15 files; `npm test` runs them in a few seconds, and CI runs them before the build
so a red test stops the deploy.

Every model's checker has its own `validate.test.ts` (the physical one lives in `physical.test.ts`)
built on a small scene builder, so a rule is added by writing the diagram that should trip it. Each
file also asserts that the samples the app ships raise **no errors** — that is what catches a rule
that is too eager, which is the failure mode that matters here: a checker crying wolf on correct
work teaches students to ignore it.

`src/platform/Canvas.test.tsx` covers the interaction layer: selection, dragging with its single
undo step per gesture, grid snapping, marquee, the connect tool, palette drops, inline rename, and
pan/zoom. `src/local/library.test.ts` covers the storage operations that could lose work — saving
over the wrong record, renaming, deleting, and whether a backup can actually be restored — against
`fake-indexeddb`.

The DOM-dependent files opt in with a `// @vitest-environment jsdom` docblock rather than slowing
the rest down. `src/test/dom.ts` holds the shims jsdom is missing: `PointerEvent`, `DragEvent` and
pointer capture.

**Still untested:** `App.tsx` wiring, which is where the save binding and the autosave live.

## 8. Backlog, in the order I would do it

1. **Finish the migration**: once the old diagrams are imported, delete `src/local/importFromCloud.ts`,
   drop `@supabase/supabase-js`, remove the `VITE_SUPABASE_*` secrets from the workflow, and delete
   the Supabase project itself.
2. **Test `App.tsx`**, particularly the library binding and the two autosave layers. It is the last
   substantial untested area and it is the one that holds the work.
3. Consider the File System Access API so a diagram can be saved straight back to a file on disk,
   which would make browser storage a convenience rather than the system of record. Chrome only.

---

## 9. Decisions already taken

Recorded so they are not re-argued.

| Decision | Why |
| --- | --- |
| Chen/Elmasri notation, circle marker default | Matches the course; the triangle stays switchable per node |
| React + Vite + TypeScript, static build | GitHub Pages hosting; `base: './'` so any repo path works |
| Hand-drawn SVG, no diagram library | The shapes must *be* the notation, not approximate it |
| Supabase | Team already thinks in SQL; RLS lets the publishable key ship in a static bundle |
| Private diagrams + explicit publish | Sharing is opt-in and revocable; shared links open as copies |
| Invite links rather than email invites | Chosen over email lookup; no directory, nothing to enumerate |
| Roles enforced in RLS | The interface hides what you cannot do; the database is what stops you |
| Yjs CRDT over a lighter broadcast scheme | Only option with a merge guarantee; half-built real-time loses work |
| Node fields stored individually, not as a blob | A blob makes concurrent edits to one shape last-write-wins |
| A model registry rather than branching on diagram kind | Adding a model must not mean editing the canvas |
| Instance diagrams built before logical/physical | Cheapest second tool, so the seam is tested early rather than assumed |
| The relational model generated from the shared mapping | The diagram and the SQL cannot disagree if neither owns the algorithm |
| Relational columns stored one per CRDT key | Same reason node fields are: an array makes concurrent column edits last-write-wins |
| Physical estimates kept textbook-simple | Idealised absolutes, correct ratios; a fake query planner would mislead more than it helps |
| Breach checking done client-side | Supabase gates it behind Pro; advisory checking beats none, and the limitation is stated rather than hidden |
| Old repo kept as a redirect | GitHub does not forward renamed Pages URLs, and the diagram lives in the fragment |
| Cursors + selection highlights | Chosen as part of the real-time work |
| Instance diagrams linked with constraint checking | Turns them into a way to test the model, not just draw it |
| Diagrams kept in the browser, no backend | A free hosted database pauses itself when idle; a tool that stops accepting coursework because a server went to sleep is the wrong shape |
| Library entries stored as the export format | One format for the file on disk and the record in the browser, so exporting is a copy and nothing can drift |
| Yjs kept after collaboration was removed | It is the undo stack and it holds the work; replacing it risks the one thing that must not lose a diagram, to drop a dependency |
| Cloud code deleted rather than disabled | Dead code that looks live is worse than none — the next reader cannot tell what the app does |
