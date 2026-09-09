-- Keyword cannibalization detection.
--
-- When several of a site's own pages rank for the same query, Google has to
-- choose between them and the ranking signals end up split. This is visible
-- only because Search Console rows are stored per page as well as per query.
--
-- p_min_impressions filters out the long tail of pages that appeared once or
-- twice for a query, which is normal noise rather than genuine competition.

create or replace function public.gsc_cannibalization(
  p_project_id uuid,
  p_date_from date,
  p_date_to date,
  p_min_impressions integer default 50
)
returns table (
  keyword text,
  total_impressions bigint,
  page_count integer,
  pages jsonb
)
language sql
stable
as $$
  with per_page as (
    select
      q.query,
      q.page,
      sum(q.clicks)::bigint as clicks,
      sum(q.impressions)::bigint as impressions,
      case when sum(q.impressions) > 0
        then round(sum(q.position * q.impressions) / sum(q.impressions), 1)
        else null end as position
    from public.search_console_queries q
    where q.project_id = p_project_id
      and q.date between p_date_from and p_date_to
      and q.page <> ''
    group by q.query, q.page
    having sum(q.impressions) >= greatest(p_min_impressions, 1)
  )
  select
    pp.query,
    sum(pp.impressions)::bigint,
    count(*)::integer,
    jsonb_agg(
      jsonb_build_object(
        'page', pp.page,
        'impressions', pp.impressions,
        'clicks', pp.clicks,
        'position', pp.position
      )
      order by pp.impressions desc
    )
  from per_page pp
  group by pp.query
  having count(*) >= 2
  order by sum(pp.impressions) desc
$$;
