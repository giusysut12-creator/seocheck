-- WordPress connections — Phase 1 of "Applica al sito" (see AiFixSuggestion).
--
-- Holds a WordPress Application Password: a credential scoped to writing
-- posts/pages, generated in the site's own admin (Users → Profile →
-- Application Passwords) and revocable there with one click, independent of
-- the user's real login password. Never the user's real admin password —
-- that would be a much larger blast radius for no real benefit here.
--
-- Same shape as search_console_connections: RLS enabled with NO policies, so
-- the table is unreachable through the Data API — only Edge Functions
-- (service role, which bypasses RLS) can read or write it. The frontend
-- learns connection state from an Edge Function, never by reading this row.
create table if not exists public.wordpress_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  site_url text not null,
  username text not null,
  app_password text not null,
  -- Which SEO plugin owns the meta description field, so the apply step
  -- knows which post-meta key to write and can say plainly when it can't.
  seo_plugin text not null default 'yoast' check (seo_plugin in ('yoast', 'rank_math', 'aioseo', 'none')),
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  last_verify_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);
create index if not exists wordpress_connections_project_idx on public.wordpress_connections (project_id);

alter table public.wordpress_connections enable row level security;

drop trigger if exists set_updated_at on public.wordpress_connections;
create trigger set_updated_at before update on public.wordpress_connections
  for each row execute function public.set_updated_at();
