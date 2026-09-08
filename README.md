# EER Diagram Designer

A browser-based, drag-and-drop editor for **Enhanced Entity-Relationship diagrams** in Chen
notation — built for practising database design. It draws the notation properly, checks the model
as you build it, and maps the finished diagram to a relational schema.

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

**Sharing and storage.** Autosave to the browser, `.eer.json` files, SVG and PNG export, a shareable
link that carries the entire diagram in the URL, and optional accounts with a private cloud library.

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

Accounts are optional — with no Supabase secrets set, the workflow still produces a fully working
local-only build.

---

## Optional: accounts and cloud saving

Sign-in lets each person keep a private library of diagrams and open them from any device. It is
backed by [Supabase](https://supabase.com) (free tier is ample) and takes about five minutes to set
up.

1. Create a project at [supabase.com](https://supabase.com).
2. In the project's **SQL Editor**, paste and run [`supabase/schema.sql`](supabase/schema.sql). It
   creates the `diagrams` table and the row-level-security policies.
3. **Authentication ▸ Sign In / Providers** → make sure **Email** is enabled. Email confirmation is
   on by default; turn it off there if you would rather people sign in immediately.
4. **Authentication ▸ URL Configuration** → add your Pages URL
   (`https://<user>.github.io/<repo>/`) to **Site URL** and **Redirect URLs**, so confirmation and
   password-reset links come back to the app.
5. **Project Settings ▸ API** → copy the **Project URL** and the **anon / public** key.
6. Add them as repository secrets under **Settings ▸ Secrets and variables ▸ Actions**:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
7. Re-run the deploy workflow.

For local development, copy `.env.example` to `.env.local` and fill in the same two values.

### Working as a team

**Cloud ▸ Projects & members** creates a project and generates invite links. Anyone signed in who
opens a link joins with that link's role; revoking a link stops it working immediately, while people
who already joined stay. Move a personal diagram into a project from the library, or back out again.

| Role | Can |
| --- | --- |
| Owner | Everything, plus managing members and invite links, and deleting the project |
| Editor | Open and change the project's diagrams, publish read-only links |
| Viewer | Open, export and copy — no changes |

**Cloud ▸ History & activity** shows the diagram's version history with the author of each snapshot,
and restores any of them. A restore is saved on top as a new version, so the trail is never rewritten.

Two people editing at once is handled without a merge engine. Presence shows who else is in the
diagram, and every save carries the version it was based on: if someone saved first, yours is
refused and you are offered the choice of reloading theirs or keeping yours as a separate copy.
Nothing is overwritten silently.

### Why it is safe to publish those keys

The publishable key is designed to ship in client bundles. On its own it grants nothing — every
table is guarded by row-level security, and the guarantees are properties of the database rather
than of the interface:

- A signed-in user reads their own diagrams, plus those in projects they belong to. Nothing else.
- A viewer cannot write, even by calling the API directly.
- `owner` is revoked from the anonymous role at the column level, so a published diagram exposes its
  content without its author's id.
- Invite codes are never selectable. Redemption goes through a `SECURITY DEFINER` function, so a
  link cannot be found by enumeration.
- `diagram_versions` and `activity` have no INSERT policy at all. Only the audited functions write
  them, so the history cannot be forged from a browser.

The one deliberate exception is publishing: a diagram its owner explicitly publishes becomes
readable by anyone holding the link. That can be reverted at any time, and a published link always
opens as an editable *copy*, so it can never overwrite the original.

---

## How it is built

Plain React 19 + TypeScript on Vite, with hand-drawn SVG — no diagramming library, so the shapes are
exactly the EER notation rather than an approximation of it.

```
src/
  model/       types, geometry, graph queries, validation, SQL generation, samples
  state/       reducer with undo/redo history
  components/  canvas, shapes, palette, inspector, panels, modals
  cloud/       Supabase client, auth context, diagram CRUD, projects, presence
  export/      SVG serialisation and PNG rasterisation
supabase/
  schema.sql   tables, row-level-security policies, and the audited write functions
```

Two decisions are worth knowing about if you read the code:

- **Diagram styling lives inside the `<svg>` as a `<style>` element.** SVG export is therefore a
  clone, a few `remove()` calls and a new `viewBox` — the exported file looks identical outside the
  app with no style-rewriting step.
- **Collaboration is enforced in Postgres, not in React.** Saves go through `save_diagram()`, which
  re-checks permission, rejects a stale write, records the snapshot and writes the activity row in
  one transaction. The interface hides what you cannot do; the database is what stops you.
- **Chen ratio labels and `(min,max)` constraints read in opposite directions.** In `A —1— R —N— B`
  it is *B* whose table takes the foreign key; in `A —(1,N)— R —(1,1)— B` the `(1,1)` marks the same
  side. `functionalSides()` in `src/model/ddl.ts` normalises both notations before anything
  downstream looks at them.

---

## Contributing / picking this up again

[`DEVELOPMENT.md`](DEVELOPMENT.md) is the working context: current status, the decisions already
taken and why, the planned three-model ecosystem, and what is in flight or broken. Read it before
resuming work.

---

## Licence

MIT — see [LICENSE](LICENSE).
