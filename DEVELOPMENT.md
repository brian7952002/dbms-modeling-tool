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
| Supabase project ref | `mftxzxdnkozkfpzwryfe` |
| Deploy | GitHub Actions → Pages, on push to `main`; tests gate the build |
| Branch `main` | Working. Real-time CRDT collaboration. |

**Shipped and verified:** full Chen/Elmasri EER notation, live model checker, SQL generation,
JSON/SVG/PNG export, share links, accounts, team projects with roles, invite links, version history
with attribution, activity feed, real-time collaborative editing with cursors and per-user undo.

**Ecosystem:** complete. The platform/model seam carries all four tools — EER, instance diagrams,
the relational schema, and the physical design — and the three stages of the design process chain
into each other: conceptual → logical → physical.

**The one thing never verified:** two real browsers editing the same diagram at once. Convergence is
proven by tests and in the runtime; the Supabase Realtime *transport* under real network conditions
is not. If peers never appear, check Realtime is enabled for the project. This needs two accounts,
and it is the top item in §8.

---

## 2. Running it

```bash
npm install
npm run dev        # http://localhost:5183 (see .claude/launch.json)
npm test           # vitest — convergence and undo tests for the CRDT
npm run build      # typechecks, then builds
```

`.env.local` holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (gitignored). The same two
values are GitHub Actions secrets. With them unset the app builds and runs local-only, with every
cloud affordance explaining what is missing — keep that property.

### Gotchas already paid for

- **GitHub Pages caches `index.html` for ~10 minutes.** After a deploy that changes environment
  config, a browser can keep running the previous bundle and look broken. Hard-reload before
  believing a bug. Asset filenames are content-hashed, so this only bites on the first load after a
  change.
- **Vite does not always pick up a new `.env.local`** if the file appears after the dev server
  starts. Restart the server.
- The Supabase MCP connector loads at session start. Adding it mid-session does nothing until a new
  session begins.
- Long `bash` heredocs sometimes truncate through the tool layer; write a script file and run it
  instead for anything sizable.

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

## 4. Backend and its invariants

Schema lives in `supabase/schema.sql`, which mirrors what is deployed. Tables: `profiles`,
`projects`, `project_members`, `project_invites`, `diagrams`, `diagram_versions`, `activity`.

**Security properties that must survive any refactor.** Each was verified by simulating two users in
SQL; re-run that style of check after touching policies.

1. A signed-in user reads only their own diagrams plus those in projects they belong to.
2. A viewer cannot write, *including by calling the REST API directly* — enforced by RLS, not UI.
3. `owner` is revoked from `anon` at column level, so a published diagram exposes content without
   its author's id.
4. Invite codes are never selectable; `redeem_invite()` is the only path that reads them.
5. `diagram_versions` and `activity` have **no INSERT policy at all**. Only `SECURITY DEFINER`
   functions write them, so history cannot be forged from a browser.
6. `project_role_of()` answers only for the caller — it must stay executable by `authenticated`
   because RLS policies run with the caller's privileges, so the guard is in the function body.

Every `SECURITY DEFINER` function re-checks permission explicitly, because DEFINER bypasses RLS.
Errors use a `PTxyz` SQLSTATE, which PostgREST returns as HTTP `xyz`.

### Account management

Clicking the account chip opens a panel with the display name, a password change and sign out. The
display name is what teammates see in history and activity, so it is worth setting.

Changing a password **re-authenticates first**: the current password is verified with
`signInWithPassword` before `updateUser` is called. A session alone should not be enough to change
the password on a machine somebody walked away from.

### Breached-password checking, and why it is client-side

**Supabase only rejects leaked passwords on the Pro plan.** This org is on free, so the dashboard
toggle renders but does nothing — confirmed the hard way: it was switched on, a known-bad password
was still accepted, and the advisor kept reporting it disabled because it was right.

`src/cloud/pwned.ts` therefore does the check from the browser against the Have I Been Pwned range
API, used by both sign-up and password change. It is k-anonymous: only the first five hex characters
of the password's SHA-1 are sent, and the response covers every hash sharing that prefix, so the
service cannot tell which was asked about. Verified working — `password123` reports 2.2 million
breaches, `Password1` 3.4 million, a random passphrase passes.

**It is advisory, not enforcement.** Someone determined could call the auth API directly with the
publishable key and bypass it. Real enforcement needs the server, which needs Pro. That is an honest
trade for catching accidental reuse at no cost, and the code says so where someone will read it.

Free-plan password settings that *do* work and are worth turning on, under
Authentication ▸ Providers ▸ Email: minimum length, and required character classes.

### Outstanding dashboard items (not reachable via the connector)

- Enable leaked-password protection (Authentication ▸ Policies).
- Confirm **Site URL** and **Redirect URLs** point at the Pages URL, or confirmation emails strand
  people on a dead page. Note that sign-up *succeeds* either way — verification happens server-side
  — so a working sign-up does not prove this is configured.

---

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

## 7. Real-time collaboration

Shipped. Yjs CRDT over Supabase Realtime, with no server component.

- `src/platform/collab/doc.ts` — `DiagramDoc`. Nodes and edges are `Y.Map`s keyed by id, and **each node is
  itself a `Y.Map` of its fields**. That is the whole point: two people editing different fields of
  one shape both keep their change, where a single blob per node would let the last writer silently
  discard the other. Per-user undo via `Y.UndoManager` scoped to a local origin.
- `src/platform/collab/provider.ts` — peers broadcast their own updates and answer each other's
  `sync-request` with a state-vector diff. Awareness (cursor, selection, name, colour) rides the
  same channel but never enters the document, so a moving cursor is not an undoable edit.
- `src/platform/collab/useDiagramDoc.ts` — binds the document to React while **keeping the existing `Action`
  union**, so `Canvas` and `Inspector` still `dispatch` exactly as before. Preserve this seam: it is
  what made this migration tractable and what will make the ecosystem refactor tractable.
- `persist_realtime_diagram()` saves the merged state plus the plain JSON, with no stale-version
  check — under a CRDT concurrent writes are normal, and the document is already reconciled before
  it arrives.

### A trap worth remembering

This was believed broken for some time. It was not. The **browser test harness** imported `yjs`
through a hand-written `/node_modules/.vite/deps/yjs.js?v=1` URL, which is a *different module
instance* from the one Vite gives `doc.ts`. Structs created by one Yjs cannot integrate into a
document owned by another, and the symptom mimics a CRDT bug closely: the delete set applies, the
replacement structs do not, so an edited field vanishes on one side only.

**Never import a dependency by a guessed bundler path.** In the browser console, import only your
own modules and use what they re-export — `encodeState`/`applyEncodedState` are enough to drive a
convergence check without touching Yjs directly. Better still, write it as a test.

### Tests

204 tests across nine files; `npm test` runs them in about three seconds. CI runs them too, before the build in `.github/workflows/deploy.yml`, so a red test stops the deploy rather than shipping past it.

`src/platform/collab/doc.test.ts` covers concurrent rename-plus-move on one shape, conflicting writes
to one field, a delete racing an edit, dangling-edge cleanup, three-way convergence, and undo
reverting only its own author's work. Run `npm test` after touching anything in
`src/platform/collab/`.

`src/platform/Canvas.test.tsx` covers the interaction layer: selection, dragging with its single
undo step per gesture, grid snapping, marquee, the connect tool, palette drops, inline rename, and
pan/zoom. It is the only test file needing a DOM, so it opts in with a `// @vitest-environment jsdom`
docblock rather than slowing the rest down — everything else stays on the default node environment.

`src/test/dom.ts` holds the shims jsdom is missing: `PointerEvent`, `DragEvent`, and pointer capture.
It deliberately does **not** stub `getBoundingClientRect` — jsdom's all-zero rect puts the origin at
zero, so with an unscaled viewport client coordinates *are* diagram coordinates and the arithmetic
under test stays readable in the assertions. It does stub `getContext` to `null`, which pins text
measurement to the fallback in `measure.ts` so shape geometry never depends on installed fonts.

Every model's checker has its own `validate.test.ts` (the physical one lives in `physical.test.ts`)
built on a small scene builder, so a rule is added by writing the diagram that should trip it. Each
file also asserts that the samples the app ships raise **no errors** — that is what catches a rule
that is too eager, which is the failure mode that matters here: a checker crying wolf on correct
work teaches students to ignore it.

### Not yet verified

The multi-browser path — two real accounts editing the same diagram at once, seeing each other's
cursors. Convergence is proven; the Supabase Realtime wiring under genuine network conditions is
not. Check that Realtime is enabled for the project if peers never appear.

## 8. Backlog, in the order I would do it

1. **Two-browser check of real-time** (§7) — the one thing convergence tests cannot prove, and the
   only substantial unknown left in the project.
2. **Extend test coverage** to the parts still untested: `App.tsx` wiring, the inspectors, and
   `cloud/` (which would need the API stubbed). *(The `validate.ts` rules and `Canvas.tsx`
   interaction are now covered — see §7.)*
3. Turn on the free-plan password settings (§4): minimum length and required character classes.
4. Rename the Supabase project to match (cosmetic; the database, keys and URL are unaffected).

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
