-- RankPilot SEO Intelligence Platform — initial schema
-- Uses uuid primary keys, created_at/updated_at on every table, and Row Level
-- Security so a user can only ever see rows that belong to their own projects.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro', 'agency')),
  monthly_crawl_limit integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  domain text not null,
  country text not null default 'US',
  device text not null default 'desktop' check (device in ('desktop', 'mobile')),
  search_engine text not null default 'google',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_id_idx on public.projects (user_id);
drop trigger if exists set_updated_at on public.projects;
create trigger set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- domains (the project's own domain, plus any competitor domains tracked)
-- ---------------------------------------------------------------------------
create table if not exists public.domains (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  domain text not null,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, domain)
);
create index if not exists domains_project_id_idx on public.domains (project_id);
drop trigger if exists set_updated_at on public.domains;
create trigger set_updated_at before update on public.domains
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- domain_metrics (daily snapshot time series, from SEO data provider)
-- ---------------------------------------------------------------------------
create table if not exists public.domain_metrics (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.domains (id) on delete cascade,
  date date not null default current_date,
  seo_score integer,
  domain_authority integer,
  organic_traffic bigint,
  organic_keywords bigint,
  traffic_value numeric,
  backlinks bigint,
  referring_domains bigint,
  source text not null default 'provider' check (source in ('provider', 'crawler')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain_id, date, source)
);
create index if not exists domain_metrics_domain_id_idx on public.domain_metrics (domain_id, date desc);
drop trigger if exists set_updated_at on public.domain_metrics;
create trigger set_updated_at before update on public.domain_metrics
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- keywords (organic keywords discovered via provider, and manually tracked
-- rank-tracking keywords)
-- ---------------------------------------------------------------------------
create table if not exists public.keywords (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  domain_id uuid references public.domains (id) on delete cascade,
  keyword text not null,
  country text not null default 'US',
  device text not null default 'desktop' check (device in ('desktop', 'mobile')),
  search_volume bigint,
  difficulty integer,
  cpc numeric,
  search_intent text check (search_intent in ('informational', 'navigational', 'commercial', 'transactional')),
  is_branded boolean not null default false,
  is_tracked boolean not null default false,
  source text not null default 'provider' check (source in ('provider', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, keyword, country, device)
);
create index if not exists keywords_project_id_idx on public.keywords (project_id);
drop trigger if exists set_updated_at on public.keywords;
create trigger set_updated_at before update on public.keywords
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- keyword_rankings (position history per keyword)
-- ---------------------------------------------------------------------------
create table if not exists public.keyword_rankings (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references public.keywords (id) on delete cascade,
  date date not null default current_date,
  position integer,
  previous_position integer,
  best_position integer,
  url text,
  serp_features jsonb not null default '[]'::jsonb,
  traffic_estimate bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (keyword_id, date)
);
create index if not exists keyword_rankings_keyword_id_idx on public.keyword_rankings (keyword_id, date desc);
drop trigger if exists set_updated_at on public.keyword_rankings;
create trigger set_updated_at before update on public.keyword_rankings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pages (crawled / provider-known URLs)
-- ---------------------------------------------------------------------------
create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  domain_id uuid references public.domains (id) on delete cascade,
  url text not null,
  title text,
  meta_description text,
  h1 text,
  h1_count integer not null default 0,
  h2_count integer not null default 0,
  canonical text,
  robots_meta text,
  status_code integer,
  redirect_url text,
  is_indexable boolean not null default true,
  is_https boolean not null default true,
  word_count integer,
  internal_links_count integer not null default 0,
  external_links_count integer not null default 0,
  images_missing_alt_count integer not null default 0,
  load_time_ms integer,
  is_orphan boolean not null default false,
  last_crawled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, url)
);
create index if not exists pages_project_id_idx on public.pages (project_id);
drop trigger if exists set_updated_at on public.pages;
create trigger set_updated_at before update on public.pages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- page_metrics (traffic performance per page, from provider)
-- ---------------------------------------------------------------------------
create table if not exists public.page_metrics (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  date date not null default current_date,
  organic_traffic bigint,
  keywords_count bigint,
  top_keyword text,
  avg_position numeric,
  traffic_value numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, date)
);
create index if not exists page_metrics_page_id_idx on public.page_metrics (page_id, date desc);
drop trigger if exists set_updated_at on public.page_metrics;
create trigger set_updated_at before update on public.page_metrics
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- competitors
-- ---------------------------------------------------------------------------
create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  domain text not null,
  is_auto_detected boolean not null default false,
  organic_traffic bigint,
  organic_keywords bigint,
  common_keywords bigint,
  traffic_value numeric,
  visibility numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, domain)
);
create index if not exists competitors_project_id_idx on public.competitors (project_id);
drop trigger if exists set_updated_at on public.competitors;
create trigger set_updated_at before update on public.competitors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- competitor_keywords (keyword-gap data)
-- ---------------------------------------------------------------------------
create table if not exists public.competitor_keywords (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  keyword_id uuid references public.keywords (id) on delete cascade,
  keyword text not null,
  competitor_position integer,
  your_position integer,
  url text,
  search_volume bigint,
  gap_type text check (gap_type in ('missing', 'weaker', 'common', 'stronger')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists competitor_keywords_competitor_id_idx on public.competitor_keywords (competitor_id);
drop trigger if exists set_updated_at on public.competitor_keywords;
create trigger set_updated_at before update on public.competitor_keywords
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- backlinks
-- ---------------------------------------------------------------------------
create table if not exists public.backlinks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  domain_id uuid references public.domains (id) on delete cascade,
  source_url text not null,
  source_domain text not null,
  target_url text not null,
  anchor_text text,
  source_domain_authority integer,
  link_type text not null default 'dofollow' check (link_type in ('dofollow', 'nofollow')),
  status text not null default 'active' check (status in ('active', 'lost', 'new')),
  first_seen date,
  last_seen date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists backlinks_project_id_idx on public.backlinks (project_id);
drop trigger if exists set_updated_at on public.backlinks;
create trigger set_updated_at before update on public.backlinks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- referring_domains
-- ---------------------------------------------------------------------------
create table if not exists public.referring_domains (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  domain_id uuid references public.domains (id) on delete cascade,
  referring_domain text not null,
  domain_authority integer,
  backlinks_count integer not null default 1,
  first_seen date,
  last_seen date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, referring_domain)
);
create index if not exists referring_domains_project_id_idx on public.referring_domains (project_id);
drop trigger if exists set_updated_at on public.referring_domains;
create trigger set_updated_at before update on public.referring_domains
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- site_audits (one row per crawl run)
-- ---------------------------------------------------------------------------
create table if not exists public.site_audits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  domain_id uuid references public.domains (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'crawling', 'completed', 'failed')),
  urls_total integer not null default 0,
  urls_crawled integer not null default 0,
  urls_errored integer not null default 0,
  seo_score integer,
  technical_score integer,
  onpage_score integer,
  performance_score integer,
  indexability_score integer,
  content_score integer,
  backlinks_score integer,
  critical_count integer not null default 0,
  warning_count integer not null default 0,
  passed_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_audits_project_id_idx on public.site_audits (project_id, created_at desc);
drop trigger if exists set_updated_at on public.site_audits;
create trigger set_updated_at before update on public.site_audits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_issues
-- ---------------------------------------------------------------------------
create table if not exists public.audit_issues (
  id uuid primary key default gen_random_uuid(),
  site_audit_id uuid not null references public.site_audits (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  issue_type text not null,
  category text not null check (category in ('technical', 'onpage', 'performance', 'indexability', 'content', 'backlinks')),
  priority text not null check (priority in ('critical', 'high', 'medium', 'low')),
  title text not null,
  description text not null,
  why_it_matters text not null,
  how_to_fix text not null,
  affected_urls jsonb not null default '[]'::jsonb,
  affected_count integer not null default 0,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists audit_issues_site_audit_id_idx on public.audit_issues (site_audit_id);
create index if not exists audit_issues_project_id_idx on public.audit_issues (project_id);
drop trigger if exists set_updated_at on public.audit_issues;
create trigger set_updated_at before update on public.audit_issues
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- serp_results
-- ---------------------------------------------------------------------------
create table if not exists public.serp_results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  keyword_id uuid references public.keywords (id) on delete cascade,
  date date not null default current_date,
  result_type text not null check (result_type in ('organic', 'featured_snippet', 'people_also_ask', 'local_pack', 'image_pack', 'video', 'shopping', 'ai_overview')),
  position integer,
  title text,
  url text,
  snippet text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists serp_results_project_id_idx on public.serp_results (project_id);
create index if not exists serp_results_keyword_id_idx on public.serp_results (keyword_id);
drop trigger if exists set_updated_at on public.serp_results;
create trigger set_updated_at before update on public.serp_results
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- seo_opportunities
-- ---------------------------------------------------------------------------
create table if not exists public.seo_opportunities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  keyword_id uuid references public.keywords (id) on delete cascade,
  page_id uuid references public.pages (id) on delete cascade,
  category text not null check (category in ('quick_win', 'content', 'keyword', 'technical', 'internal_linking', 'backlink')),
  title text not null,
  description text not null,
  current_position integer,
  search_volume bigint,
  difficulty integer,
  potential_impact text check (potential_impact in ('high', 'medium', 'low')),
  opportunity_score integer not null default 0,
  recommended_actions jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists seo_opportunities_project_id_idx on public.seo_opportunities (project_id, opportunity_score desc);
drop trigger if exists set_updated_at on public.seo_opportunities;
create trigger set_updated_at before update on public.seo_opportunities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  period_start date,
  period_end date,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'ready' check (status in ('generating', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reports_project_id_idx on public.reports (project_id, created_at desc);
drop trigger if exists set_updated_at on public.reports;
create trigger set_updated_at before update on public.reports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.domains enable row level security;
alter table public.domain_metrics enable row level security;
alter table public.keywords enable row level security;
alter table public.keyword_rankings enable row level security;
alter table public.pages enable row level security;
alter table public.page_metrics enable row level security;
alter table public.competitors enable row level security;
alter table public.competitor_keywords enable row level security;
alter table public.backlinks enable row level security;
alter table public.referring_domains enable row level security;
alter table public.site_audits enable row level security;
alter table public.audit_issues enable row level security;
alter table public.serp_results enable row level security;
alter table public.seo_opportunities enable row level security;
alter table public.reports enable row level security;

-- profiles: a user can only see/update their own profile row
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid());

-- projects: full CRUD scoped to owner
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects for select using (user_id = auth.uid());
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects for insert with check (user_id = auth.uid());
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects for update using (user_id = auth.uid());
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects for delete using (user_id = auth.uid());

-- domains: scoped via project ownership
drop policy if exists "domains_all_own" on public.domains;
create policy "domains_all_own" on public.domains for all using (
  exists (select 1 from public.projects p where p.id = domains.project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = domains.project_id and p.user_id = auth.uid())
);

-- domain_metrics: scoped via domain -> project ownership
drop policy if exists "domain_metrics_all_own" on public.domain_metrics;
create policy "domain_metrics_all_own" on public.domain_metrics for all using (
  exists (
    select 1 from public.domains d
    join public.projects p on p.id = d.project_id
    where d.id = domain_metrics.domain_id and p.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.domains d
    join public.projects p on p.id = d.project_id
    where d.id = domain_metrics.domain_id and p.user_id = auth.uid()
  )
);

-- keywords: scoped via project ownership
drop policy if exists "keywords_all_own" on public.keywords;
create policy "keywords_all_own" on public.keywords for all using (
  exists (select 1 from public.projects p where p.id = keywords.project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = keywords.project_id and p.user_id = auth.uid())
);

-- keyword_rankings: scoped via keyword -> project ownership
drop policy if exists "keyword_rankings_all_own" on public.keyword_rankings;
create policy "keyword_rankings_all_own" on public.keyword_rankings for all using (
  exists (
    select 1 from public.keywords k
    join public.projects p on p.id = k.project_id
    where k.id = keyword_rankings.keyword_id and p.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.keywords k
    join public.projects p on p.id = k.project_id
    where k.id = keyword_rankings.keyword_id and p.user_id = auth.uid()
  )
);

-- pages: scoped via project ownership
drop policy if exists "pages_all_own" on public.pages;
create policy "pages_all_own" on public.pages for all using (
  exists (select 1 from public.projects p where p.id = pages.project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = pages.project_id and p.user_id = auth.uid())
);

-- page_metrics: scoped via page -> project ownership
drop policy if exists "page_metrics_all_own" on public.page_metrics;
create policy "page_metrics_all_own" on public.page_metrics for all using (
  exists (
    select 1 from public.pages pg
    join public.projects p on p.id = pg.project_id
    where pg.id = page_metrics.page_id and p.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.pages pg
    join public.projects p on p.id = pg.project_id
    where pg.id = page_metrics.page_id and p.user_id = auth.uid()
  )
);

-- competitors: scoped via project ownership
drop policy if exists "competitors_all_own" on public.competitors;
create policy "competitors_all_own" on public.competitors for all using (
  exists (select 1 from public.projects p where p.id = competitors.project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = competitors.project_id and p.user_id = auth.uid())
);

-- competitor_keywords: scoped via competitor -> project ownership
drop policy if exists "competitor_keywords_all_own" on public.competitor_keywords;
create policy "competitor_keywords_all_own" on public.competitor_keywords for all using (
  exists (
    select 1 from public.competitors c
    join public.projects p on p.id = c.project_id
    where c.id = competitor_keywords.competitor_id and p.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.competitors c
    join public.projects p on p.id = c.project_id
    where c.id = competitor_keywords.competitor_id and p.user_id = auth.uid()
  )
);

-- backlinks: scoped via project ownership
drop policy if exists "backlinks_all_own" on public.backlinks;
create policy "backlinks_all_own" on public.backlinks for all using (
  exists (select 1 from public.projects p where p.id = backlinks.project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = backlinks.project_id and p.user_id = auth.uid())
);

-- referring_domains: scoped via project ownership
drop policy if exists "referring_domains_all_own" on public.referring_domains;
create policy "referring_domains_all_own" on public.referring_domains for all using (
  exists (select 1 from public.projects p where p.id = referring_domains.project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = referring_domains.project_id and p.user_id = auth.uid())
);

-- site_audits: scoped via project ownership
drop policy if exists "site_audits_all_own" on public.site_audits;
create policy "site_audits_all_own" on public.site_audits for all using (
  exists (select 1 from public.projects p where p.id = site_audits.project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = site_audits.project_id and p.user_id = auth.uid())
);

-- audit_issues: scoped via project ownership
drop policy if exists "audit_issues_all_own" on public.audit_issues;
create policy "audit_issues_all_own" on public.audit_issues for all using (
  exists (select 1 from public.projects p where p.id = audit_issues.project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = audit_issues.project_id and p.user_id = auth.uid())
);

-- serp_results: scoped via project ownership
drop policy if exists "serp_results_all_own" on public.serp_results;
create policy "serp_results_all_own" on public.serp_results for all using (
  exists (select 1 from public.projects p where p.id = serp_results.project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = serp_results.project_id and p.user_id = auth.uid())
);

-- seo_opportunities: scoped via project ownership
drop policy if exists "seo_opportunities_all_own" on public.seo_opportunities;
create policy "seo_opportunities_all_own" on public.seo_opportunities for all using (
  exists (select 1 from public.projects p where p.id = seo_opportunities.project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = seo_opportunities.project_id and p.user_id = auth.uid())
);

-- reports: scoped via owner
drop policy if exists "reports_all_own" on public.reports;
create policy "reports_all_own" on public.reports for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
