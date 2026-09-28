-- Remember which opportunities have already been fixed.
--
-- Opportunities are recomputed from Search Console on every visit, so one
-- that has been dealt with comes straight back — identical, with no sign
-- that anything was done about it. Google needs weeks to re-crawl a page and
-- report a new position, and until then the list keeps offering work that is
-- already finished. The more the tool is used, the less its own list can be
-- trusted.
--
-- A row is written when a fix is actually published to the user's site, so
-- this records what happened rather than what was suggested. History is kept
-- rather than overwritten: re-publishing the same page is a real event, and
-- the most recent row is the one that matters.

create table if not exists public.applied_fixes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The opportunity this closed. Matching on keyword + kind + page mirrors
  -- how the list itself identifies a card.
  keyword text not null,
  kind text not null,
  page_url text,
  page_normalized text generated always as (public.normalize_url(page_url)) stored,
  -- What was published, so the card can show it without another AI call.
  title text,
  meta_description text,
  applied_at timestamptz not null default now()
);

create index if not exists applied_fixes_project_idx
  on public.applied_fixes (project_id, applied_at desc);
create index if not exists applied_fixes_lookup_idx
  on public.applied_fixes (project_id, keyword, kind);

alter table public.applied_fixes enable row level security;

-- Reachable from the browser, unlike the Google tables: it holds no
-- credentials, and the record is written by the same click that publishes.
drop policy if exists "applied_fixes_select_own" on public.applied_fixes;
create policy "applied_fixes_select_own" on public.applied_fixes for select using (
  exists (select 1 from public.projects p where p.id = applied_fixes.project_id and p.user_id = auth.uid())
);

drop policy if exists "applied_fixes_insert_own" on public.applied_fixes;
create policy "applied_fixes_insert_own" on public.applied_fixes for insert with check (
  exists (select 1 from public.projects p where p.id = applied_fixes.project_id and p.user_id = auth.uid())
);

drop policy if exists "applied_fixes_delete_own" on public.applied_fixes;
create policy "applied_fixes_delete_own" on public.applied_fixes for delete using (
  exists (select 1 from public.projects p where p.id = applied_fixes.project_id and p.user_id = auth.uid())
);
