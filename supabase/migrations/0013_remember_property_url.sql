-- Keep a project's Search Console property across a Google reconnect.
--
-- A project points at a property by id. Those property rows hang off the
-- Google connection, and the connection row is replaced whenever the user
-- reconnects their Google account — which cascades the properties away and,
-- through `on delete set null`, silently clears the pointer on every project
-- at once. The projects still have their data; they just no longer know
-- which property it came from, so the user is asked to pick again and to
-- re-sync, with no hint that reconnecting Google is what did it.
--
-- The property's URL is stable across reconnects in a way the id is not, so
-- storing it lets the project find its property again by itself.

alter table public.projects
  add column if not exists search_console_property_url text;

-- Backfill for projects that still have a live pointer.
update public.projects p
set search_console_property_url = sp.property_url
from public.search_console_properties sp
where sp.id = p.search_console_property_id
  and p.search_console_property_url is null;
