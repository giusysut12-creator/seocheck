-- Google Search Console + Google Ads integration.
--
-- Extends the existing schema rather than duplicating it: crawler data stays
-- in `pages`, keyword identity stays in `keywords`, and the new tables hold
-- only what Google provides. Every metric keeps its provenance so the UI can
-- always say which source a number came from.

-- ---------------------------------------------------------------------------
-- URL normalization, for matching Search Console page URLs against the URLs
-- the existing crawler stored. The crawler persists raw URLs, so the same
-- page can appear as "https://x.com/a/" there and "https://x.com/a" in GSC.
-- IMMUTABLE so it can back a generated column and an index.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_url(url text)
returns text
language sql
immutable
as $$
  select case
    when url is null then null
    else rtrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(url), '#.*$', ''),   -- drop fragment
          '^https?://', ''                            -- drop scheme
        ),
        '^www\.', ''                                  -- drop leading www.
      ),
      '/'                                             -- drop trailing slash
    )
  end
$$;

alter table public.pages
  add column if not exists url_normalized text
  generated always as (public.normalize_url(url)) stored;

create index if not exists pages_url_normalized_idx on public.pages (project_id, url_normalized);

-- ---------------------------------------------------------------------------
-- search_console_connections
--
-- Holds a Google refresh token: a long-lived credential for the user's Google
-- account. RLS is enabled with NO policies, so the table is unreachable
-- through the Data API — only Edge Functions (service role, which bypasses
-- RLS) can read it. The frontend learns connection state from an Edge
-- Function, never by reading this row.
-- ---------------------------------------------------------------------------
create table if not exists public.search_console_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  google_account_id text,
  google_email text,
  refresh_token text not null,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

drop trigger if exists set_updated_at on public.search_console_connections;
create trigger set_updated_at before update on public.search_console_connections
  for each row execute function public.set_updated_at();

-- One-time, short-lived state values binding an OAuth callback back to the
-- user who started the flow. The callback endpoint is public by necessity
-- (Google redirects a browser to it), so it cannot trust anything but this.
create table if not exists public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'google',
  redirect_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists oauth_states_expires_at_idx on public.oauth_states (expires_at);

drop trigger if exists set_updated_at on public.oauth_states;
create trigger set_updated_at before update on public.oauth_states
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- search_console_properties — the verified properties a connection can read
-- ---------------------------------------------------------------------------
create table if not exists public.search_console_properties (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.search_console_connections (id) on delete cascade,
  property_url text not null,
  property_type text not null default 'url_prefix' check (property_type in ('domain', 'url_prefix')),
  permission_level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, property_url)
);
create index if not exists search_console_properties_connection_idx on public.search_console_properties (connection_id);

drop trigger if exists set_updated_at on public.search_console_properties;
create trigger set_updated_at before update on public.search_console_properties
  for each row execute function public.set_updated_at();

-- Which property a project reads from. Google identifies properties as
-- "sc-domain:example.com" or "https://example.com/", neither of which is
-- derivable from the project's domain alone.
alter table public.projects
  add column if not exists search_console_property_id uuid references public.search_console_properties (id) on delete set null;

-- ---------------------------------------------------------------------------
-- search_console_queries — raw Search Analytics rows
--
-- row_hash keeps the uniqueness key bounded: query + page can otherwise
-- exceed the btree index row limit.
-- ---------------------------------------------------------------------------
create table if not exists public.search_console_queries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  property_id uuid references public.search_console_properties (id) on delete set null,
  date date not null,
  query text not null,
  page text not null default '',
  page_normalized text generated always as (public.normalize_url(page)) stored,
  country text not null default '',
  device text not null default '',
  clicks bigint not null default 0,
  impressions bigint not null default 0,
  ctr numeric not null default 0,
  position numeric,
  row_hash text generated always as (
    md5(query || '|' || page || '|' || country || '|' || device)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists search_console_queries_unique_idx
  on public.search_console_queries (project_id, date, row_hash);
create index if not exists search_console_queries_project_date_idx
  on public.search_console_queries (project_id, date desc);
create index if not exists search_console_queries_query_idx
  on public.search_console_queries (project_id, query);
create index if not exists search_console_queries_page_idx
  on public.search_console_queries (project_id, page_normalized);

drop trigger if exists set_updated_at on public.search_console_queries;
create trigger set_updated_at before update on public.search_console_queries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- search_console_syncs — one row per synchronization run
-- ---------------------------------------------------------------------------
create table if not exists public.search_console_syncs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  date_from date,
  date_to date,
  rows_imported integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists search_console_syncs_project_idx on public.search_console_syncs (project_id, created_at desc);

drop trigger if exists set_updated_at on public.search_console_syncs;
create trigger set_updated_at before update on public.search_console_syncs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- keyword_metrics — Google Ads enrichment, cached
--
-- Deliberately separate from search_console_queries: Google Ads search volume
-- and GSC impressions are different measurements and must never be conflated.
-- updated_at drives the refresh policy so the same keyword is not re-billed.
-- ---------------------------------------------------------------------------
create table if not exists public.keyword_metrics (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references public.keywords (id) on delete cascade,
  source text not null default 'google_ads' check (source in ('google_ads', 'provider')),
  search_volume bigint,
  cpc numeric,
  competition text check (competition in ('LOW', 'MEDIUM', 'HIGH', 'UNSPECIFIED', 'UNKNOWN')),
  competition_index integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (keyword_id, source)
);
create index if not exists keyword_metrics_keyword_idx on public.keyword_metrics (keyword_id);

drop trigger if exists set_updated_at on public.keyword_metrics;
create trigger set_updated_at before update on public.keyword_metrics
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Extend existing provenance constraints for the new sources
-- ---------------------------------------------------------------------------
alter table public.keywords drop constraint if exists keywords_source_check;
alter table public.keywords add constraint keywords_source_check
  check (source in ('provider', 'manual', 'google_search_console'));

alter table public.domain_metrics drop constraint if exists domain_metrics_source_check;
alter table public.domain_metrics add constraint domain_metrics_source_check
  check (source in ('provider', 'crawler', 'google_search_console'));

-- keyword_rankings gains provenance too: a Search Console position is an
-- average over a period, not the absolute position a rank tracker reports.
alter table public.keyword_rankings
  add column if not exists source text not null default 'provider';
alter table public.keyword_rankings drop constraint if exists keyword_rankings_source_check;
alter table public.keyword_rankings add constraint keyword_rankings_source_check
  check (source in ('provider', 'manual', 'google_search_console'));

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.search_console_connections enable row level security;
alter table public.oauth_states enable row level security;
alter table public.search_console_properties enable row level security;
alter table public.search_console_queries enable row level security;
alter table public.search_console_syncs enable row level security;
alter table public.keyword_metrics enable row level security;

-- search_console_connections and oauth_states intentionally get NO policies:
-- they hold credentials and are served only to Edge Functions.

-- Properties are readable by the user who owns the connection (needed to
-- render the property picker), but never carry a token.
drop policy if exists "search_console_properties_select_own" on public.search_console_properties;
create policy "search_console_properties_select_own" on public.search_console_properties for select using (
  exists (
    select 1 from public.search_console_connections c
    where c.id = search_console_properties.connection_id and c.user_id = auth.uid()
  )
);

drop policy if exists "search_console_queries_select_own" on public.search_console_queries;
create policy "search_console_queries_select_own" on public.search_console_queries for select using (
  exists (select 1 from public.projects p where p.id = search_console_queries.project_id and p.user_id = auth.uid())
);

drop policy if exists "search_console_syncs_select_own" on public.search_console_syncs;
create policy "search_console_syncs_select_own" on public.search_console_syncs for select using (
  exists (select 1 from public.projects p where p.id = search_console_syncs.project_id and p.user_id = auth.uid())
);

drop policy if exists "keyword_metrics_select_own" on public.keyword_metrics;
create policy "keyword_metrics_select_own" on public.keyword_metrics for select using (
  exists (
    select 1 from public.keywords k
    join public.projects p on p.id = k.project_id
    where k.id = keyword_metrics.keyword_id and p.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- Aggregation helpers
--
-- Search Console rows are stored per date/query/page, so every screen needs
-- the same grouping work. Doing it in SQL keeps sorting and pagination
-- server-side and avoids shipping raw rows to the browser. These run as
-- SECURITY INVOKER, so the RLS policies above still scope every read to the
-- caller's own projects.
--
-- Average position is always weighted by impressions: a plain average would
-- let a query with 2 impressions count as much as one with 20,000.
-- ---------------------------------------------------------------------------

create or replace function public.gsc_performance_summary(
  p_project_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  clicks bigint,
  impressions bigint,
  ctr numeric,
  "position" numeric,
  days integer
)
language sql
stable
as $$
  select
    coalesce(sum(q.clicks), 0)::bigint as clicks,
    coalesce(sum(q.impressions), 0)::bigint as impressions,
    case when coalesce(sum(q.impressions), 0) > 0
      then sum(q.clicks)::numeric / sum(q.impressions)
      else 0 end as ctr,
    case when coalesce(sum(q.impressions), 0) > 0
      then sum(q.position * q.impressions) / sum(q.impressions)
      else null end as position,
    count(distinct q.date)::integer as days
  from public.search_console_queries q
  where q.project_id = p_project_id
    and q.date between p_date_from and p_date_to
$$;

create or replace function public.gsc_daily_performance(
  p_project_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  "date" date,
  clicks bigint,
  impressions bigint,
  ctr numeric,
  "position" numeric
)
language sql
stable
as $$
  select
    q.date,
    sum(q.clicks)::bigint,
    sum(q.impressions)::bigint,
    case when sum(q.impressions) > 0 then sum(q.clicks)::numeric / sum(q.impressions) else 0 end,
    case when sum(q.impressions) > 0 then sum(q.position * q.impressions) / sum(q.impressions) else null end
  from public.search_console_queries q
  where q.project_id = p_project_id
    and q.date between p_date_from and p_date_to
  group by q.date
  order by q.date
$$;

-- Keyword table with the previous-period comparison the trend column needs.
-- p_segment filters on the aggregated position: top3 | top10 | page2 | page3plus.
create or replace function public.gsc_keywords(
  p_project_id uuid,
  p_date_from date,
  p_date_to date,
  p_search text default null,
  p_segment text default null,
  p_country text default null,
  p_device text default null,
  p_page text default null,
  p_sort text default 'clicks',
  p_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  keyword text,
  clicks bigint,
  impressions bigint,
  ctr numeric,
  "position" numeric,
  top_page text,
  previous_position numeric,
  previous_clicks bigint,
  position_change numeric,
  total_count bigint
)
language sql
stable
as $$
  with period_length as (
    select (p_date_to - p_date_from) as len
  ),
  current_window as (
    select
      q.query as keyword,
      sum(q.clicks)::bigint as clicks,
      sum(q.impressions)::bigint as impressions,
      case when sum(q.impressions) > 0 then sum(q.clicks)::numeric / sum(q.impressions) else 0 end as ctr,
      case when sum(q.impressions) > 0 then sum(q.position * q.impressions) / sum(q.impressions) else null end as position,
      (array_agg(q.page order by q.impressions desc nulls last))[1] as top_page
    from public.search_console_queries q
    where q.project_id = p_project_id
      and q.date between p_date_from and p_date_to
      and (p_search is null or q.query ilike '%' || p_search || '%')
      and (p_country is null or q.country = p_country)
      and (p_device is null or q.device = p_device)
      and (p_page is null or q.page_normalized = public.normalize_url(p_page))
    group by q.query
  ),
  previous_window as (
    select
      q.query as keyword,
      sum(q.clicks)::bigint as clicks,
      case when sum(q.impressions) > 0 then sum(q.position * q.impressions) / sum(q.impressions) else null end as position
    from public.search_console_queries q, period_length pl
    where q.project_id = p_project_id
      and q.date >= (p_date_from - pl.len - 1)
      and q.date < p_date_from
      and (p_country is null or q.country = p_country)
      and (p_device is null or q.device = p_device)
    group by q.query
  ),
  joined as (
    select
      c.keyword,
      c.clicks,
      c.impressions,
      c.ctr,
      c.position,
      c.top_page,
      p.position as previous_position,
      coalesce(p.clicks, 0)::bigint as previous_clicks,
      -- Positive means the keyword moved up (toward a lower position number).
      case when p.position is null or c.position is null then null
        else round(p.position - c.position, 1)
      end as position_change
    from current_window c
    left join previous_window p on p.keyword = c.keyword
    where case
      when p_segment = 'top3' then c.position <= 3
      when p_segment = 'top10' then c.position <= 10
      when p_segment = 'page2' then c.position > 10 and c.position <= 20
      when p_segment = 'page3plus' then c.position > 20
      else true
    end
  )
  select
    j.keyword,
    j.clicks,
    j.impressions,
    j.ctr,
    j.position,
    j.top_page,
    j.previous_position,
    j.previous_clicks,
    j.position_change,
    count(*) over ()::bigint as total_count
  from joined j
  order by
    case when p_dir = 'asc' then
      case p_sort
        when 'clicks' then j.clicks::numeric
        when 'impressions' then j.impressions::numeric
        when 'ctr' then j.ctr
        when 'position' then j.position
        else j.clicks::numeric
      end
    end asc nulls last,
    case when p_dir <> 'asc' then
      case p_sort
        when 'clicks' then j.clicks::numeric
        when 'impressions' then j.impressions::numeric
        when 'ctr' then j.ctr
        when 'position' then j.position
        else j.clicks::numeric
      end
    end desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0)
$$;

-- Per-page organic performance, keyed on the normalized URL so it lines up
-- with what the existing crawler stored in `pages`.
create or replace function public.gsc_pages(
  p_project_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  page text,
  page_normalized text,
  clicks bigint,
  impressions bigint,
  ctr numeric,
  "position" numeric,
  keyword_count bigint,
  top_keyword text
)
language sql
stable
as $$
  select
    (array_agg(q.page order by q.impressions desc nulls last))[1] as page,
    q.page_normalized,
    sum(q.clicks)::bigint,
    sum(q.impressions)::bigint,
    case when sum(q.impressions) > 0 then sum(q.clicks)::numeric / sum(q.impressions) else 0 end,
    case when sum(q.impressions) > 0 then sum(q.position * q.impressions) / sum(q.impressions) else null end,
    count(distinct q.query)::bigint,
    (array_agg(q.query order by q.impressions desc nulls last))[1]
  from public.search_console_queries q
  where q.project_id = p_project_id
    and q.date between p_date_from and p_date_to
    and q.page_normalized is not null
  group by q.page_normalized
$$;

-- Keywords for one specific page, used by the page detail view.
create or replace function public.gsc_page_keywords(
  p_project_id uuid,
  p_page_normalized text,
  p_date_from date,
  p_date_to date
)
returns table (
  keyword text,
  clicks bigint,
  impressions bigint,
  ctr numeric,
  "position" numeric
)
language sql
stable
as $$
  select
    q.query,
    sum(q.clicks)::bigint,
    sum(q.impressions)::bigint,
    case when sum(q.impressions) > 0 then sum(q.clicks)::numeric / sum(q.impressions) else 0 end,
    case when sum(q.impressions) > 0 then sum(q.position * q.impressions) / sum(q.impressions) else null end
  from public.search_console_queries q
  where q.project_id = p_project_id
    and q.page_normalized = p_page_normalized
    and q.date between p_date_from and p_date_to
  group by q.query
  order by sum(q.impressions) desc
$$;
