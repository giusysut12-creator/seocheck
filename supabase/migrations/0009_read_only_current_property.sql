-- Read only the Search Console rows that belong to the project's property.
--
-- Every imported row records which Search Console property it came from, and
-- until now nothing read that column. A project that had ever been synced
-- against the wrong property kept those rows for good, and every view mixed
-- two different websites: a shop's Opportunities page listing a tax-advice
-- site's queries, each row real, none of them that project's.
--
-- Migration 0008 deleted what was already there and the Edge Function now
-- clears the old rows when a project's property changes. This is the part
-- that makes it impossible rather than merely fixed: whatever ends up in the
-- table, a project can only ever read its own property's rows.
--
-- A project with no property selected has nothing to compare against, so it
-- is left unfiltered and behaves exactly as before.

create or replace function public.project_property_id(p_project_id uuid)
returns uuid
language sql
stable
as $$
  select search_console_property_id from public.projects where id = p_project_id
$$;

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
    and (
      public.project_property_id(p_project_id) is null
      or q.property_id = public.project_property_id(p_project_id)
    )
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
    and (
      public.project_property_id(p_project_id) is null
      or q.property_id = public.project_property_id(p_project_id)
    )
    and q.date between p_date_from and p_date_to
  group by q.date
  order by q.date
$$;

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
    and (
      public.project_property_id(p_project_id) is null
      or q.property_id = public.project_property_id(p_project_id)
    )
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
    and (
      public.project_property_id(p_project_id) is null
      or q.property_id = public.project_property_id(p_project_id)
    )
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
    and (
      public.project_property_id(p_project_id) is null
      or q.property_id = public.project_property_id(p_project_id)
    )
    and q.date between p_date_from and p_date_to
    and q.page_normalized is not null
  group by q.page_normalized
$$;

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
    and (
      public.project_property_id(p_project_id) is null
      or q.property_id = public.project_property_id(p_project_id)
    )
    and q.page_normalized = p_page_normalized
    and q.date between p_date_from and p_date_to
  group by q.query
  order by sum(q.impressions) desc
$$;

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
    and (
      public.project_property_id(p_project_id) is null
      or q.property_id = public.project_property_id(p_project_id)
    )
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

