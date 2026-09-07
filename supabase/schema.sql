-- ---------------------------------------------------------------------------
-- EER Diagram Designer — Supabase schema
--
-- Run this once in your Supabase project: SQL Editor -> New query -> paste ->
-- Run. It is safe to run again; every statement is idempotent.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

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

create index if not exists diagrams_owner_updated_idx
  on public.diagrams (owner, updated_at desc);

create index if not exists diagrams_public_idx
  on public.diagrams (id) where is_public;

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists diagrams_touch_updated_at on public.diagrams;
create trigger diagrams_touch_updated_at
  before update on public.diagrams
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- This is what makes it safe to ship the anon key in a static site: the key
-- alone grants nothing. A request may read a row only if the caller owns it or
-- the row has been explicitly published, and may write only its own rows.
-- ---------------------------------------------------------------------------

alter table public.diagrams enable row level security;

drop policy if exists "read own diagrams"       on public.diagrams;
drop policy if exists "read published diagrams" on public.diagrams;
drop policy if exists "insert own diagrams"     on public.diagrams;
drop policy if exists "update own diagrams"     on public.diagrams;
drop policy if exists "delete own diagrams"     on public.diagrams;

create policy "read own diagrams"
  on public.diagrams for select
  using (auth.uid() = owner);

-- Published diagrams are readable by anyone holding the link, signed in or not.
create policy "read published diagrams"
  on public.diagrams for select
  using (is_public);

create policy "insert own diagrams"
  on public.diagrams for insert
  with check (auth.uid() = owner);

create policy "update own diagrams"
  on public.diagrams for update
  using (auth.uid() = owner)
  with check (auth.uid() = owner);

create policy "delete own diagrams"
  on public.diagrams for delete
  using (auth.uid() = owner);

-- ---------------------------------------------------------------------------
-- Column-level privileges
--
-- Row-level security decides which rows anonymous callers may read; this
-- decides which columns. A published diagram needs its content, not the
-- identity of whoever wrote it, so `owner` is withheld from the anon role
-- entirely — no query it can write will return that column.
--
-- `authenticated` keeps full access, which is what insert and the ownership
-- policies need.
-- ---------------------------------------------------------------------------

revoke select on public.diagrams from anon;

grant select (id, title, data, is_public, created_at, updated_at)
  on public.diagrams to anon;
