-- Resumable crawling.
--
-- An Edge Function is killed when it outruns the platform's budget, and a
-- killed run saves nothing. Rather than guessing how much work fits inside
-- that budget — the ceiling differs by plan and counts CPU separately from
-- wall clock — a crawl now proceeds in small slices across several calls.
--
-- That requires the run to remember, between calls, which URLs it has
-- discovered and which ones some other page links to. The pages table already
-- records what has been crawled, so only these two sets need somewhere to live.

alter table public.site_audits
  add column if not exists discovered_urls jsonb not null default '[]'::jsonb;

-- URLs that at least one crawled page links to. Orphan detection compares the
-- crawled set against this; accumulating it per run keeps that check possible
-- even when the crawl spans several invocations.
alter table public.site_audits
  add column if not exists linked_urls jsonb not null default '[]'::jsonb;
