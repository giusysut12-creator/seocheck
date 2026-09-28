-- Daily positions for tracked keywords, from Search Console.
--
-- Rank tracking was gated behind a paid SEO data provider, which for a shop
-- owner means the feature does not exist. But a third-party rank tracker
-- guesses where a site sits by scraping results from one place on one
-- device; Search Console reports where Google actually put the page for the
-- people who actually searched. For your own site that is the better number,
-- and it is already in this database.
--
-- Returns one row per keyword per day, so history arrives with the first
-- sync instead of starting from zero and accruing one point a day.
--
-- What this genuinely cannot give: a position for a query the site has never
-- appeared for (Google reports nothing to report), a competitor's position,
-- and search volume. Those still need a provider, and the UI says so rather
-- than presenting this as the same thing.

create or replace function public.gsc_keyword_positions(
  p_project_id uuid,
  p_keywords text[],
  p_days integer default 90
)
returns table (
  keyword text,
  date date,
  "position" numeric,
  clicks bigint,
  impressions bigint,
  top_page text
)
language sql
stable
as $$
  select
    q.query as keyword,
    q.date,
    -- Impression-weighted, matching how Search Console itself averages a
    -- position across a day's rows: a position seen 900 times and one seen
    -- 3 times are not worth the same.
    case when sum(q.impressions) > 0
      then sum(q.position * q.impressions) / sum(q.impressions)
      else null end as position,
    sum(q.clicks)::bigint as clicks,
    sum(q.impressions)::bigint as impressions,
    (array_agg(q.page order by q.impressions desc nulls last))[1] as top_page
  from public.search_console_queries q
  where q.project_id = p_project_id
    and q.query = any (p_keywords)
    and q.date >= current_date - p_days
    and (
      public.project_property_id(p_project_id) is null
      or q.property_id = public.project_property_id(p_project_id)
    )
  group by q.query, q.date
  order by q.query, q.date
$$;
