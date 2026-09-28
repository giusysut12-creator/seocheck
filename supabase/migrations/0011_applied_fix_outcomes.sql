-- Did the published fixes actually work?
--
-- Publishing a rewritten title is a bet: Google has to re-crawl the page,
-- re-index it, and report a new position before anything shows. That takes
-- weeks, which is exactly long enough for the user to forget what they
-- changed and lose any way of telling whether it helped. Without this the
-- tool asks for trust and never earns it.
--
-- Compares the same keyword on the same page across the days before the fix
-- and the days since, from data the project already has. It reports how many
-- days of data exist on each side so the caller can refuse to draw a
-- conclusion from three days of noise rather than presenting one.
--
-- Search Console's own reporting lag (roughly three days) means the most
-- recent days are simply absent: they are not counted as zeros, because a
-- day with no row is a day Google has not reported, not a day with no clicks.

create or replace function public.applied_fix_outcomes(
  p_project_id uuid,
  p_window_days integer default 28
)
returns table (
  fix_id uuid,
  keyword text,
  kind text,
  page_url text,
  applied_at timestamptz,
  before_clicks bigint,
  before_impressions bigint,
  before_position numeric,
  before_days integer,
  after_clicks bigint,
  after_impressions bigint,
  after_position numeric,
  after_days integer
)
language sql
stable
as $$
  with fixes as (
    select distinct on (f.keyword, f.kind, f.page_normalized)
      f.id, f.keyword, f.kind, f.page_url, f.page_normalized, f.applied_at
    from public.applied_fixes f
    where f.project_id = p_project_id
    order by f.keyword, f.kind, f.page_normalized, f.applied_at desc
  ),
  measured as (
    select
      f.id,
      -- A row dated before the fix describes the page as it was; one dated
      -- on or after it describes the page as it is now. The day of the fix
      -- itself counts as "after": the change was live for part of it.
      case when q.date < f.applied_at::date then 'before' else 'after' end as side,
      q.date,
      q.clicks,
      q.impressions,
      q.position
    from fixes f
    join public.search_console_queries q
      on q.project_id = p_project_id
     and q.query = f.keyword
     and (f.page_normalized is null or q.page_normalized = f.page_normalized)
     and q.date >= (f.applied_at::date - p_window_days)
     and q.date <= (f.applied_at::date + p_window_days)
    where (
      public.project_property_id(p_project_id) is null
      or q.property_id = public.project_property_id(p_project_id)
    )
  ),
  sides as (
    select
      m.id,
      m.side,
      sum(m.clicks)::bigint as clicks,
      sum(m.impressions)::bigint as impressions,
      case when sum(m.impressions) > 0
        then sum(m.position * m.impressions) / sum(m.impressions)
        else null end as position,
      count(distinct m.date)::integer as days
    from measured m
    group by m.id, m.side
  )
  select
    f.id as fix_id,
    f.keyword,
    f.kind,
    f.page_url,
    f.applied_at,
    coalesce(b.clicks, 0)::bigint as before_clicks,
    coalesce(b.impressions, 0)::bigint as before_impressions,
    b.position as before_position,
    coalesce(b.days, 0)::integer as before_days,
    coalesce(a.clicks, 0)::bigint as after_clicks,
    coalesce(a.impressions, 0)::bigint as after_impressions,
    a.position as after_position,
    coalesce(a.days, 0)::integer as after_days
  from fixes f
  left join sides b on b.id = f.id and b.side = 'before'
  left join sides a on a.id = f.id and a.side = 'after'
  order by f.applied_at desc
$$;
