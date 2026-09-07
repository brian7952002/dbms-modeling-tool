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
| Specialisation | ISA triangle carrying `d` (disjoint) or `o` (overlapping); double line for total |
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

### Why it is safe to publish those keys

The anon key is designed to ship in client bundles. On its own it grants nothing: every policy in
`supabase/schema.sql` restricts rows to `auth.uid() = owner`, so a signed-in user can only read and
write their own diagrams. The one exception is deliberate — a diagram the owner explicitly publishes
becomes readable by anyone holding its link, which is how team sharing works. Publishing can be
reverted at any time from the library, and a shared link always opens as an editable *copy*, so a
teammate can never overwrite the original.

---

## How it is built

Plain React 19 + TypeScript on Vite, with hand-drawn SVG — no diagramming library, so the shapes are
exactly the EER notation rather than an approximation of it.

```
src/
  model/       types, geometry, graph queries, validation, SQL generation, samples
  state/       reducer with undo/redo history
  components/  canvas, shapes, palette, inspector, panels, modals
  cloud/       Supabase client, auth context, diagram CRUD
  export/      SVG serialisation and PNG rasterisation
supabase/
  schema.sql   table + row-level-security policies
```

Two decisions are worth knowing about if you read the code:

- **Diagram styling lives inside the `<svg>` as a `<style>` element.** SVG export is therefore a
  clone, a few `remove()` calls and a new `viewBox` — the exported file looks identical outside the
  app with no style-rewriting step.
- **Chen ratio labels and `(min,max)` constraints read in opposite directions.** In `A —1— R —N— B`
  it is *B* whose table takes the foreign key; in `A —(1,N)— R —(1,1)— B` the `(1,1)` marks the same
  side. `functionalSides()` in `src/model/ddl.ts` normalises both notations before anything
  downstream looks at them.

---

## Licence

MIT — see [LICENSE](LICENSE).
