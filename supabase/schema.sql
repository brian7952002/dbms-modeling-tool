-- ---------------------------------------------------------------------------
-- DBMS Modeling Tool — Supabase schema
--
-- Run this once in your Supabase project: SQL Editor -> New query -> paste ->
-- Run. Every statement is idempotent, so it is safe to run again after an
-- update.
--
-- The shape of the thing: a diagram belongs either to one person (project_id
-- is null) or to a project. Projects have members with roles, members arrive
-- through revocable invite links, and every change is attributed and kept.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Identity
--
-- auth.users is not readable from the browser, so mirror the minimum needed to
-- put a name next to a change.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'member')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email, display_name)
select u.id, u.email,
       coalesce(nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'member')
from auth.users u
on conflict (id) do nothing;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Trigger functions must not be reachable over the REST API.
revoke execute on function public.handle_new_user()  from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Projects, membership, invites
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_role') then
    create type public.project_role as enum ('owner', 'editor', 'viewer');
  end if;
end
$$;

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 200),
  owner      uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.project_role not null default 'editor',
  invited_by uuid references auth.users (id) on delete set null,
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Several links may be live at once, so a project can hand out an editor link
-- and a viewer link independently and revoke either alone.
create table if not exists public.project_invites (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  code       text not null unique,
  role       public.project_role not null default 'editor',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists project_members_user_idx    on public.project_members (user_id);
create index if not exists project_invites_project_idx on public.project_invites (project_id);

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Diagrams, history, activity
-- ---------------------------------------------------------------------------

create table if not exists public.diagrams (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'Untitled diagram',
  data        jsonb not null,
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint diagrams_title_length check (char_length(title) between 1 and 200)
);

alter table public.diagrams
  add column if not exists project_id uuid references public.projects (id) on delete cascade,
  add column if not exists version    integer not null default 1,
  add column if not exists updated_by uuid references auth.users (id) on delete set null,
  -- Which model this diagram belongs to, and the diagram it is derived from
  -- or checked against.
  add column if not exists kind text not null default 'eer',
  add column if not exists source_diagram_id uuid references public.diagrams (id) on delete set null,
  -- The CRDT state, base64-encoded. `data` stays the plain JSON that exports,
  -- published links and the SQL generators read.
  add column if not exists ydoc text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diagrams_kind_check') then
    alter table public.diagrams
      add constraint diagrams_kind_check
      check (kind in ('eer', 'instance', 'relational', 'physical'));
  end if;
end
$$;

create index if not exists diagrams_source_idx on public.diagrams (source_diagram_id);

create index if not exists diagrams_owner_updated_idx on public.diagrams (owner, updated_at desc);
create index if not exists diagrams_project_idx       on public.diagrams (project_id, updated_at desc);
create index if not exists diagrams_public_idx        on public.diagrams (id) where is_public;

drop trigger if exists diagrams_touch_updated_at on public.diagrams;
create trigger diagrams_touch_updated_at
  before update on public.diagrams
  for each row execute function public.touch_updated_at();

-- Restorable snapshots, coalesced per author so one editing session is one row.
create table if not exists public.diagram_versions (
  id         uuid primary key default gen_random_uuid(),
  diagram_id uuid not null references public.diagrams (id) on delete cascade,
  version    integer not null,
  title      text not null,
  data       jsonb not null,
  author     uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (diagram_id, version)
);

create index if not exists diagram_versions_recent_idx
  on public.diagram_versions (diagram_id, created_at desc);

-- The things a snapshot cannot show: renames, publishing, joining, restoring.
create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  project_id uuid references public.projects (id) on delete cascade,
  diagram_id uuid references public.diagrams (id) on delete cascade,
  actor      uuid references auth.users (id) on delete set null,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_project_idx on public.activity (project_id, created_at desc);
create index if not exists activity_diagram_idx on public.activity (diagram_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Membership helpers
--
-- A policy on project_members that queried project_members would recurse.
-- These run as the definer, so they see the table without RLS and give every
-- other policy one cheap question to ask.
--
-- They must stay executable by `authenticated`, because policies are evaluated
-- with the caller's privileges — which also makes them callable directly, so
-- project_role_of deliberately answers only for the caller.
-- ---------------------------------------------------------------------------

create or replace function public.project_role_of(p_project uuid, p_user uuid default auth.uid())
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.project_members m
  where m.project_id = p_project
    and m.user_id = auth.uid()
    and (p_user is null or p_user = auth.uid())
$$;

create or replace function public.can_edit_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.project_role_of(p_project) in ('owner', 'editor')
$$;

revoke execute on function public.project_role_of(uuid, uuid) from public;
revoke execute on function public.can_edit_project(uuid)      from public;

-- Both roles need EXECUTE, including anon. Every SELECT policy on `diagrams`
-- is evaluated for every reader, and the project one calls project_role_of();
-- without EXECUTE a signed-out visitor opening a published link is refused by
-- the policy machinery before row filtering happens. Granting it reveals
-- nothing — the function answers only for auth.uid(), which is null without a
-- JWT, so anonymous callers always get null back.
grant execute on function public.project_role_of(uuid, uuid) to authenticated, anon;
grant execute on function public.can_edit_project(uuid)      to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- This is what makes it safe to ship the publishable key in a static site: the
-- key alone grants nothing.
-- ---------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.projects         enable row level security;
alter table public.project_members  enable row level security;
alter table public.project_invites  enable row level security;
alter table public.diagrams         enable row level security;
alter table public.diagram_versions enable row level security;
alter table public.activity         enable row level security;

-- ---- profiles -------------------------------------------------------------
drop policy if exists "read own profile"        on public.profiles;
drop policy if exists "read co-member profiles" on public.profiles;
drop policy if exists "update own profile"      on public.profiles;

create policy "read own profile"
  on public.profiles for select using (id = auth.uid());

-- You see the name and email of people you actually share a project with, and
-- nobody else. This is what makes attribution readable without a directory.
create policy "read co-member profiles"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id
      where mine.user_id = auth.uid() and theirs.user_id = public.profiles.id
    )
  );

create policy "update own profile"
  on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ---- projects -------------------------------------------------------------
drop policy if exists "read projects you belong to" on public.projects;
drop policy if exists "create own projects"         on public.projects;
drop policy if exists "owners update projects"      on public.projects;
drop policy if exists "owners delete projects"      on public.projects;

create policy "read projects you belong to"
  on public.projects for select
  using (owner = auth.uid() or public.project_role_of(id) is not null);

create policy "create own projects"
  on public.projects for insert with check (owner = auth.uid());

create policy "owners update projects"
  on public.projects for update
  using (owner = auth.uid() or public.project_role_of(id) = 'owner')
  with check (owner = auth.uid() or public.project_role_of(id) = 'owner');

create policy "owners delete projects"
  on public.projects for delete using (owner = auth.uid());

-- ---- project_members ------------------------------------------------------
drop policy if exists "read fellow members"   on public.project_members;
drop policy if exists "owners manage members" on public.project_members;
drop policy if exists "leave a project"       on public.project_members;

create policy "read fellow members"
  on public.project_members for select
  using (user_id = auth.uid() or public.project_role_of(project_id) is not null);

create policy "owners manage members"
  on public.project_members for all
  using (public.project_role_of(project_id) = 'owner')
  with check (public.project_role_of(project_id) = 'owner');

create policy "leave a project"
  on public.project_members for delete using (user_id = auth.uid());

-- ---- project_invites ------------------------------------------------------
-- Codes are never selectable by their recipients: redemption goes through a
-- SECURITY DEFINER function, so a link cannot be found by enumeration.
drop policy if exists "owners manage invites" on public.project_invites;

create policy "owners manage invites"
  on public.project_invites for all
  using (public.project_role_of(project_id) = 'owner')
  with check (public.project_role_of(project_id) = 'owner');

-- ---- diagrams -------------------------------------------------------------
drop policy if exists "read own diagrams"           on public.diagrams;
drop policy if exists "read published diagrams"     on public.diagrams;
drop policy if exists "read project diagrams"       on public.diagrams;
drop policy if exists "insert own diagrams"         on public.diagrams;
drop policy if exists "update own diagrams"         on public.diagrams;
drop policy if exists "update diagrams you may edit" on public.diagrams;
drop policy if exists "delete own diagrams"         on public.diagrams;
drop policy if exists "delete diagrams you own"     on public.diagrams;

create policy "read own diagrams"
  on public.diagrams for select using (auth.uid() = owner);

-- Published diagrams are readable by anyone holding the link, signed in or not.
create policy "read published diagrams"
  on public.diagrams for select using (is_public);

create policy "read project diagrams"
  on public.diagrams for select
  using (project_id is not null and public.project_role_of(project_id) is not null);

create policy "insert own diagrams"
  on public.diagrams for insert
  with check (
    auth.uid() = owner
    and (project_id is null or public.can_edit_project(project_id))
  );

-- Viewers are excluded here, in the database, not merely in the interface.
create policy "update diagrams you may edit"
  on public.diagrams for update
  using (
    auth.uid() = owner
    or (project_id is not null and public.can_edit_project(project_id))
  )
  with check (
    auth.uid() = owner
    or (project_id is not null and public.can_edit_project(project_id))
  );

create policy "delete diagrams you own"
  on public.diagrams for delete
  using (
    auth.uid() = owner
    or (project_id is not null and public.project_role_of(project_id) = 'owner')
  );

-- ---- history --------------------------------------------------------------
-- Read-only to clients. Nothing has an INSERT policy, so only the SECURITY
-- DEFINER functions below can write history: the audit trail cannot be forged
-- from a browser.
drop policy if exists "read versions of visible diagrams" on public.diagram_versions;
drop policy if exists "read activity you can see"         on public.activity;

create policy "read versions of visible diagrams"
  on public.diagram_versions for select
  using (
    exists (
      select 1 from public.diagrams d
      where d.id = diagram_versions.diagram_id
        and (
          d.owner = auth.uid()
          or (d.project_id is not null and public.project_role_of(d.project_id) is not null)
        )
    )
  );

create policy "read activity you can see"
  on public.activity for select
  using (
    (project_id is not null and public.project_role_of(project_id) is not null)
    or exists (
      select 1 from public.diagrams d
      where d.id = activity.diagram_id and d.owner = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Column-level privileges
--
-- RLS decides which rows anonymous callers may read; this decides which
-- columns. A published diagram needs its content, not its author's id.
-- ---------------------------------------------------------------------------

revoke select on public.diagrams from anon;
grant select (id, title, data, is_public, created_at, updated_at, kind, source_diagram_id)
  on public.diagrams to anon;

-- ---------------------------------------------------------------------------
-- Operations
--
-- Each one re-checks permission explicitly, because SECURITY DEFINER bypasses
-- RLS. A `PTxyz` SQLSTATE is returned to the client by PostgREST as HTTP xyz.
-- ---------------------------------------------------------------------------

-- Creating a project and its owner row must happen together: the membership
-- policy asks whether you are already an owner, which you are not yet.
create or replace function public.create_project(p_name text)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.projects;
begin
  if auth.uid() is null then
    raise exception using errcode = 'PT401', message = 'Sign in to create a project.';
  end if;

  insert into public.projects (name, owner)
  values (coalesce(nullif(btrim(p_name), ''), 'Untitled project'), auth.uid())
  returning * into p;

  insert into public.project_members (project_id, user_id, role, invited_by)
  values (p.id, auth.uid(), 'owner', auth.uid());

  insert into public.activity (project_id, actor, action, detail)
  values (p.id, auth.uid(), 'project_created', jsonb_build_object('name', p.name));

  return p;
end;
$$;

create or replace function public.create_invite(
  p_project uuid,
  p_role public.project_role default 'editor',
  p_days integer default 14
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if public.project_role_of(p_project) <> 'owner' then
    raise exception using errcode = 'PT403', message = 'Only a project owner can create invite links.';
  end if;
  if p_role = 'owner' then
    raise exception using errcode = 'PT400', message = 'Invite links cannot grant ownership.';
  end if;

  -- ~88 bits of entropy; the code is the only secret protecting the project.
  v_code := substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 22);

  insert into public.project_invites (project_id, code, role, created_by, expires_at)
  values (
    p_project, v_code, p_role, auth.uid(),
    case when p_days is null or p_days <= 0 then null else now() + make_interval(days => p_days) end
  );

  insert into public.activity (project_id, actor, action, detail)
  values (p_project, auth.uid(), 'invite_created', jsonb_build_object('role', p_role));

  return v_code;
end;
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from public.project_invites where id = p_invite;
  if v_project is null then
    return;
  end if;
  if public.project_role_of(v_project) <> 'owner' then
    raise exception using errcode = 'PT403', message = 'Only a project owner can revoke invite links.';
  end if;

  update public.project_invites set revoked_at = now() where id = p_invite;

  insert into public.activity (project_id, actor, action, detail)
  values (v_project, auth.uid(), 'invite_revoked', '{}'::jsonb);
end;
$$;

-- Redemption is the only path that reads an invite, so codes can never be
-- listed or guessed through the API.
create or replace function public.redeem_invite(p_code text)
returns table (project_id uuid, project_name text, role public.project_role, already_member boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv        public.project_invites;
  v_existing public.project_role;
  v_name     text;
begin
  if auth.uid() is null then
    raise exception using errcode = 'PT401',
      message = 'Sign in first, then open the invite link again.';
  end if;

  select * into inv
  from public.project_invites
  where code = btrim(p_code)
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if not found then
    raise exception using errcode = 'PT404',
      message = 'That invite link is not valid any more. Ask the project owner for a new one.';
  end if;

  select p.name into v_name from public.projects p where p.id = inv.project_id;
  v_existing := public.project_role_of(inv.project_id);

  if v_existing is not null then
    return query select inv.project_id, v_name, v_existing, true;
    return;
  end if;

  insert into public.project_members (project_id, user_id, role, invited_by)
  values (inv.project_id, auth.uid(), inv.role, inv.created_by);

  insert into public.activity (project_id, actor, action, detail)
  values (inv.project_id, auth.uid(), 'joined', jsonb_build_object('role', inv.role));

  return query select inv.project_id, v_name, inv.role, false;
end;
$$;

-- Every write goes through here so that permission, the stale-write check, the
-- snapshot and the activity row cannot drift apart.
create or replace function public.save_diagram(
  p_id uuid,
  p_title text,
  p_data jsonb,
  p_expected_version integer default null
)
returns table (version integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  d      public.diagrams;
  v_new  integer;
  v_last public.diagram_versions;
  v_when timestamptz;
begin
  select * into d from public.diagrams where id = p_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'That diagram no longer exists.';
  end if;

  if not (
    d.owner = auth.uid()
    or (d.project_id is not null and public.can_edit_project(d.project_id))
  ) then
    raise exception using errcode = 'PT403', message = 'You have view-only access to this diagram.';
  end if;

  if p_expected_version is not null and d.version <> p_expected_version then
    raise exception using errcode = 'PT409',
      message = 'Someone else saved this diagram while you were editing it.';
  end if;

  v_new := d.version + 1;

  update public.diagrams
     set title = p_title, data = p_data, version = v_new, updated_by = auth.uid()
   where id = p_id
   returning diagrams.updated_at into v_when;

  select * into v_last
  from public.diagram_versions
  where diagram_id = p_id
  order by created_at desc
  limit 1;

  -- One editing session is one snapshot: extend your own recent snapshot
  -- rather than filling the history with keystrokes.
  if found and v_last.author is not distinct from auth.uid()
     and v_last.created_at > now() - interval '10 minutes' then
    update public.diagram_versions
       set version = v_new, title = p_title, data = p_data, created_at = now()
     where id = v_last.id;
  else
    insert into public.diagram_versions (diagram_id, version, title, data, author)
    values (p_id, v_new, p_title, p_data, auth.uid());

    insert into public.activity (project_id, diagram_id, actor, action, detail)
    values (d.project_id, p_id, auth.uid(), 'edited',
            jsonb_build_object('title', p_title, 'version', v_new));
  end if;

  if d.title is distinct from p_title then
    insert into public.activity (project_id, diagram_id, actor, action, detail)
    values (d.project_id, p_id, auth.uid(), 'renamed',
            jsonb_build_object('from', d.title, 'to', p_title));
  end if;

  return query select v_new, v_when;
end;
$$;

create or replace function public.restore_diagram_version(p_version uuid)
returns table (version integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      public.diagram_versions;
  d      public.diagrams;
  v_new  integer;
  v_when timestamptz;
begin
  select * into v from public.diagram_versions where id = p_version;
  if not found then
    raise exception using errcode = 'PT404', message = 'That version no longer exists.';
  end if;

  select * into d from public.diagrams where id = v.diagram_id for update;
  if not (
    d.owner = auth.uid()
    or (d.project_id is not null and public.can_edit_project(d.project_id))
  ) then
    raise exception using errcode = 'PT403', message = 'You have view-only access to this diagram.';
  end if;

  v_new := d.version + 1;

  update public.diagrams
     set data = v.data, title = v.title, version = v_new, updated_by = auth.uid()
   where id = d.id
   returning diagrams.updated_at into v_when;

  -- A restore is itself a point in history, never a rewrite of it.
  insert into public.diagram_versions (diagram_id, version, title, data, author)
  values (d.id, v_new, v.title, v.data, auth.uid());

  insert into public.activity (project_id, diagram_id, actor, action, detail)
  values (d.project_id, d.id, auth.uid(), 'restored',
          jsonb_build_object('from_version', v.version, 'version', v_new));

  return query select v_new, v_when;
end;
$$;

create or replace function public.set_diagram_published(p_id uuid, p_public boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.diagrams;
begin
  select * into d from public.diagrams where id = p_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'That diagram no longer exists.';
  end if;
  if not (
    d.owner = auth.uid()
    or (d.project_id is not null and public.can_edit_project(d.project_id))
  ) then
    raise exception using errcode = 'PT403', message = 'You cannot change sharing for this diagram.';
  end if;

  update public.diagrams set is_public = p_public where id = p_id;

  insert into public.activity (project_id, diagram_id, actor, action, detail)
  values (d.project_id, p_id, auth.uid(),
          case when p_public then 'published' else 'unpublished' end, '{}'::jsonb);
end;
$$;

create or replace function public.move_diagram_to_project(p_id uuid, p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.diagrams;
begin
  select * into d from public.diagrams where id = p_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'That diagram no longer exists.';
  end if;
  if d.owner <> auth.uid() then
    raise exception using errcode = 'PT403', message = 'Only the diagram''s owner can move it.';
  end if;
  if p_project is not null and not public.can_edit_project(p_project) then
    raise exception using errcode = 'PT403', message = 'You cannot add diagrams to that project.';
  end if;

  update public.diagrams set project_id = p_project where id = p_id;

  insert into public.activity (project_id, diagram_id, actor, action, detail)
  values (coalesce(p_project, d.project_id), p_id, auth.uid(),
          case when p_project is null then 'removed_from_project' else 'added_to_project' end,
          jsonb_build_object('title', d.title));
end;
$$;

revoke execute on function public.create_project(text)                              from public, anon;
revoke execute on function public.create_invite(uuid, public.project_role, integer)  from public, anon;
revoke execute on function public.revoke_invite(uuid)                               from public, anon;
revoke execute on function public.redeem_invite(text)                               from public, anon;
revoke execute on function public.save_diagram(uuid, text, jsonb, integer)           from public, anon;
revoke execute on function public.restore_diagram_version(uuid)                      from public, anon;
revoke execute on function public.set_diagram_published(uuid, boolean)               from public, anon;
revoke execute on function public.move_diagram_to_project(uuid, uuid)                from public, anon;

grant execute on function public.create_project(text)                               to authenticated;
grant execute on function public.create_invite(uuid, public.project_role, integer)   to authenticated;
grant execute on function public.revoke_invite(uuid)                                to authenticated;
grant execute on function public.redeem_invite(text)                                to authenticated;
grant execute on function public.save_diagram(uuid, text, jsonb, integer)            to authenticated;
grant execute on function public.restore_diagram_version(uuid)                       to authenticated;
grant execute on function public.set_diagram_published(uuid, boolean)                to authenticated;
grant execute on function public.move_diagram_to_project(uuid, uuid)                 to authenticated;
