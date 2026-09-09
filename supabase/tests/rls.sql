-- Row Level Security verification.
--
-- Run against any instance that has both migrations applied:
--   psql "$DATABASE_URL" -f supabase/tests/rls.sql
--
-- Every check raises an exception on failure, so the script either completes
-- silently or stops at the first violated guarantee. It cleans up after
-- itself and is safe to re-run.

begin;

-- Impersonate a real Data API caller: the `authenticated` role with a JWT
-- subject claim, which is exactly what auth.uid() reads.
create or replace function pg_temp.as_user(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.as_admin() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

create or replace function pg_temp.expect(p_condition boolean, p_what text) returns void
language plpgsql as $$
begin
  if not p_condition then
    raise exception 'RLS CHECK FAILED: %', p_what;
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- Fixtures: two unrelated users, each with a project
-- --------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@test.local');

insert into public.projects (id, user_id, name, domain) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'alice', 'alice.test'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000002', 'bob', 'bob.test');

insert into public.search_console_queries (project_id, date, query, page, clicks, impressions, ctr, position) values
  ('aaaaaaaa-1111-1111-1111-111111111111', current_date, 'alice kw', 'https://alice.test/a', 5, 50, 0.1, 4),
  ('bbbbbbbb-2222-2222-2222-222222222222', current_date, 'bob kw',   'https://bob.test/b',   7, 70, 0.1, 6);

insert into public.search_console_connections (user_id, refresh_token) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice-secret-refresh-token'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob-secret-refresh-token');

insert into public.oauth_states (state, user_id, redirect_to, expires_at) values
  ('alice-state', 'aaaaaaaa-0000-0000-0000-000000000001', 'https://app.test', now() + interval '10 minutes');

insert into public.search_console_syncs (project_id, status) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'completed'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'completed');

insert into public.keywords (id, project_id, keyword) values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111', 'alice kw'),
  ('bbbbbbbb-4444-4444-4444-444444444444', 'bbbbbbbb-2222-2222-2222-222222222222', 'bob kw');

insert into public.keyword_metrics (keyword_id, source, search_volume) values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'google_ads', 100),
  ('bbbbbbbb-4444-4444-4444-444444444444', 'google_ads', 200);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- --------------------------------------------------------------------------
-- Credentials must be invisible to every API caller, including their owner:
-- the browser has no reason to read a refresh token.
-- --------------------------------------------------------------------------
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');

select pg_temp.expect(
  (select count(*) from public.search_console_connections) = 0,
  'refresh tokens must not be readable through the Data API, not even by their owner'
);

select pg_temp.expect(
  (select count(*) from public.oauth_states) = 0,
  'oauth states must not be readable through the Data API'
);

-- --------------------------------------------------------------------------
-- Project-scoped data: each user sees only their own
-- --------------------------------------------------------------------------
select pg_temp.expect(
  (select count(*) from public.search_console_queries) = 1,
  'a user must see only their own Search Console rows'
);

select pg_temp.expect(
  (select count(*) from public.search_console_queries where query = 'bob kw') = 0,
  'alice must not see bob''s Search Console rows'
);

select pg_temp.expect(
  (select count(*) from public.search_console_syncs) = 1,
  'a user must see only their own sync history'
);

select pg_temp.expect(
  (select count(*) from public.keyword_metrics) = 1,
  'a user must see only Google Ads metrics for their own keywords'
);

select pg_temp.expect(
  (select count(*) from public.projects) = 1,
  'a user must see only their own projects'
);

-- --------------------------------------------------------------------------
-- The aggregation functions run as SECURITY INVOKER, so they must not become
-- a way around the policies above.
-- --------------------------------------------------------------------------
select pg_temp.expect(
  (select coalesce(clicks, 0) from public.gsc_performance_summary(
     'bbbbbbbb-2222-2222-2222-222222222222', current_date - 30, current_date)) = 0,
  'gsc_performance_summary must return nothing for another user''s project'
);

select pg_temp.expect(
  (select count(*) from public.gsc_keywords(
     'bbbbbbbb-2222-2222-2222-222222222222', current_date - 30, current_date)) = 0,
  'gsc_keywords must return nothing for another user''s project'
);

select pg_temp.expect(
  (select count(*) from public.gsc_pages(
     'bbbbbbbb-2222-2222-2222-222222222222', current_date - 30, current_date)) = 0,
  'gsc_pages must return nothing for another user''s project'
);

select pg_temp.expect(
  (select count(*) from public.gsc_cannibalization(
     'bbbbbbbb-2222-2222-2222-222222222222', current_date - 30, current_date)) = 0,
  'gsc_cannibalization must return nothing for another user''s project'
);

select pg_temp.expect(
  (select count(*) from public.gsc_keywords(
     'aaaaaaaa-1111-1111-1111-111111111111', current_date - 30, current_date)) = 1,
  'gsc_keywords must still return the caller''s own data'
);

-- --------------------------------------------------------------------------
-- The other user sees the mirror image
-- --------------------------------------------------------------------------
select pg_temp.as_admin();
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');

select pg_temp.expect(
  (select count(*) from public.search_console_queries where query = 'bob kw') = 1,
  'bob must see his own Search Console rows'
);

select pg_temp.expect(
  (select count(*) from public.search_console_queries where query = 'alice kw') = 0,
  'bob must not see alice''s Search Console rows'
);

-- --------------------------------------------------------------------------
-- Writes must be scoped too: no inserting into someone else's project
-- --------------------------------------------------------------------------
do $$
begin
  insert into public.keywords (project_id, keyword)
  values ('aaaaaaaa-1111-1111-1111-111111111111', 'injected');
  raise exception 'RLS CHECK FAILED: a user must not insert keywords into another user''s project';
exception
  when insufficient_privilege then null;  -- expected
end;
$$;

select pg_temp.as_admin();

\echo 'All RLS checks passed.'

rollback;
