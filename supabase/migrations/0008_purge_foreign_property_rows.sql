-- Remove Search Console rows that belong to a property the project no longer
-- reads from.
--
-- A project points at one Search Console property, and every imported row
-- records which property it came from. Nothing ever removed rows when that
-- pointer changed, and no read filters on it: pick the wrong property once,
-- sync, then correct it, and the first import stays in the table forever.
-- From then on every view of that project mixes two different websites —
-- which is how a shop's Opportunities page ended up listing a tax-advice
-- site's queries, each one real, none of them this project's.
--
-- Deleting is safe: these rows are a cache of Google's data, re-importable
-- at any time with a sync, and they are not this project's to begin with.
-- Rows for a project that has no property selected are left alone — there is
-- nothing to compare them against yet.

delete from public.search_console_queries q
using public.projects p
where q.project_id = p.id
  and p.search_console_property_id is not null
  and q.property_id is distinct from p.search_console_property_id;
