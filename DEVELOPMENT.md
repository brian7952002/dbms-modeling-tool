# Development notes

Working context for this project. Written so that work can resume after the chat history is
cleared: it records what exists, what is decided and why, what is broken, and what is next.

**Last updated:** 2026-09-07

---

## 1. Status at a glance

| | |
| --- | --- |
| Live site | https://brian7952002.github.io/eer-diagram-designer/ |
| Repo | https://github.com/brian7952002/eer-diagram-designer (public) |
| Supabase project ref | `mftxzxdnkozkfpzwryfe` |
| Deploy | GitHub Actions → Pages, on push to `main` |
| Branch `main` | Working. Real-time CRDT collaboration. |

**Shipped and verified:** full Chen/Elmasri EER notation, live model checker, SQL generation,
JSON/SVG/PNG export, share links, accounts, team projects with roles, invite links, version history
with attribution, activity feed, real-time collaborative editing with cursors and per-user undo.

**Decided but not built:** instance diagrams (§6), the three-model ecosystem (§5).

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
  model/       types, geometry, graph queries, validation, SQL generation, samples, text measurement
  state/       store.ts — reducer with undo/redo history (the Action union is the editing API)
  components/  Canvas, NodeShape, EdgeShape, Palette, Inspector, panels, modals
  cloud/       supabase client, auth context, diagram CRUD, projects, presence
  export/      SVG serialisation and PNG rasterisation
supabase/
  schema.sql   canonical schema: tables, RLS policies, audited write functions
```

Two decisions worth not re-deriving:

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

### Outstanding dashboard items (not reachable via the connector)

- Enable leaked-password protection (Authentication ▸ Policies).
- Confirm **Site URL** and **Redirect URLs** point at the Pages URL, or confirmation emails strand
  people on a dead page. Note that sign-up *succeeds* either way — verification happens server-side
  — so a working sign-up does not prove this is configured.

---

## 5. Planned: the modelling ecosystem

The direction: this stops being one EER editor and becomes a shell hosting **three independent
modelling tools**, matching the design process in Elmasri & Navathe.

| Model | Purpose | Status |
| --- | --- | --- |
| Conceptual | EER diagram — entities, relationships, specialisation | Built |
| Logical / implementation | Relational schema — tables, columns, keys, referential integrity | Not started |
| Physical | Storage and access — indexes, file organisation, partitioning, per-DBMS types | Not started |

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

Proposed: **DBMS Modeling Tool**. Renaming the GitHub repo would change the Pages URL and **break
every share link already handed out**, since links are `…github.io/<repo>/#c=<id>`. Recommended:
change the displayed product name only and leave the repo slug alone. Revisit if the URL matters
more than the existing links.

---

## 6. Planned: instance diagrams

Decided in conversation, not yet built.

- **Notation:** Elmasri instance style — a labelled region per entity set holding small circles for
  instances, with relationship instances drawn as lines between them.
- **Linked to a source EER diagram**, chosen from the same project. Entity and relationship sets
  come from it; `source_diagram_id` carries the link.
- **The payoff is checking**, not drawing: verify the sample data actually obeys the schema.
  - a 1:N relationship where an instance is joined to two owners
  - total participation with an unconnected instance
  - `(min,max)` bounds violated by the number of links on an instance
  - a weak-entity instance with no owner
  - a subclass instance absent from its superclass set; disjointness violated by an instance in two
    disjoint subclasses
  - the constraint direction problem from §3 applies here too — reuse `functionalSides()`
- n-ary relationships: not supported in the first cut. Warn rather than mislead.

---

## 7. Real-time collaboration

Shipped. Yjs CRDT over Supabase Realtime, with no server component.

- `src/collab/doc.ts` — `DiagramDoc`. Nodes and edges are `Y.Map`s keyed by id, and **each node is
  itself a `Y.Map` of its fields**. That is the whole point: two people editing different fields of
  one shape both keep their change, where a single blob per node would let the last writer silently
  discard the other. Per-user undo via `Y.UndoManager` scoped to a local origin.
- `src/collab/provider.ts` — peers broadcast their own updates and answer each other's
  `sync-request` with a state-vector diff. Awareness (cursor, selection, name, colour) rides the
  same channel but never enters the document, so a moving cursor is not an undoable edit.
- `src/collab/useDiagramDoc.ts` — binds the document to React while **keeping the existing `Action`
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

`src/collab/doc.test.ts` covers concurrent rename-plus-move on one shape, conflicting writes to one
field, a delete racing an edit, dangling-edge cleanup, three-way convergence, and undo reverting
only its own author's work. Run `npm test` after touching anything in `src/collab/`.

### Not yet verified

The multi-browser path — two real accounts editing the same diagram at once, seeing each other's
cursors. Convergence is proven; the Supabase Realtime wiring under genuine network conditions is
not. Check that Realtime is enabled for the project if peers never appear.

## 8. Backlog, in the order I would do it

1. **Two-browser check of real-time** (§7) — the one thing convergence tests cannot prove.
2. **Extend test coverage** to `ddl.ts` mapping for each relationship shape, and the `validate.ts`
   rules.
3. **Extract the platform/model seam** (§5) while there are only two model types to move — it gets
   harder with every feature added to `Canvas.tsx`.
4. **Instance diagrams** (§6), as the first tool built on the new seam. It proves the seam is real.
5. **Relational (logical) model.** Largely already implied by `ddl.ts`: generating it from an EER
   diagram is a strong starting point, with editing on top.
6. **Physical model.**
7. Product rename (§5), once the ecosystem shell exists to justify it.

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
| Cursors + selection highlights | Chosen as part of the real-time work |
| Instance diagrams linked with constraint checking | Turns them into a way to test the model, not just draw it |
