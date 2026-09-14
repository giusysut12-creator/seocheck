-- Remember what a crawl worked out about the site, so resuming is cheap.
--
-- Every slice of a crawl used to re-resolve the homepage and re-read
-- robots.txt before it could fetch a single page: two round trips per call,
-- repeated a dozen times over a run, for answers that cannot change while the
-- run is in flight. Holding them on the audit row lets a resumed slice spend
-- its entire budget on pages.
--
-- Shape: { "base": "https://example.com/", "robots": { ...parsed rules... } }

alter table public.site_audits
  add column if not exists crawl_context jsonb;
