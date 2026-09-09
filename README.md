# RankPilot — SEO Intelligence Platform

A working SaaS SEO Intelligence product (React + TypeScript + Tailwind + shadcn/ui +
Supabase), inspired by the functional logic of tools like Ubersuggest / Ahrefs /
Semrush — no branding, copy, or UI copied from them.

Enter a domain and RankPilot runs a real server-side crawl (robots.txt, sitemap.xml,
up to 100 pages), computes an SEO Health Score, and surfaces prioritized technical/
on-page issues — all without any third-party API key. Keyword, ranking, competitor,
backlink and traffic data are designed around a pluggable `SEODataProvider`
interface: until you connect a real SEO data vendor, those screens clearly say
**"SEO data provider not connected"** instead of showing invented numbers.

## 1. Stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4 + hand-built shadcn/ui-style primitives (Radix UI + CVA)
- Supabase: Postgres (with Row Level Security), Auth, Edge Functions (Deno)
- Recharts for charts, jsPDF for report export

## 2. Project structure

```
src/
  components/          shared UI (shadcn-style primitives in components/ui)
  hooks/                useAuth, useProjects, useCurrentProject, data hooks
  lib/
    database.types.ts   TypeScript types mirroring the SQL schema
    seo/                SEODataProvider interface, types, adapter, opportunity score
    edgeFunctions.ts     typed wrappers around Supabase Edge Function calls
  pages/
    auth/                Login, Signup
    project/              per-project pages (Overview, Audit, Keywords, ...)
    Dashboard.tsx, Projects.tsx, Settings.tsx
supabase/
  migrations/0001_init.sql   full schema + RLS policies
  functions/
    crawl-site/            server-side SEO crawler (Deno)
    seo-provider-proxy/    SEODataProvider adapter (keeps API keys server-side)
    ai-assistant/          AI SEO Assistant (grounded in project data only)
```

Each Edge Function is a single self-contained `index.ts` with no cross-file
imports, so it can be deployed either with the Supabase CLI or by pasting it
straight into the dashboard's Edge Functions editor.

## 3. Database structure (Postgres, Supabase)

All tables use `uuid` primary keys (`gen_random_uuid()`) and `created_at` /
`updated_at` timestamps, and every table is scoped by Row Level Security so a
user can only ever read or write rows that belong to one of their own
`projects`. See `supabase/migrations/0001_init.sql` for the full DDL.

| Table | Purpose |
|---|---|
| `profiles` | 1:1 with `auth.users`, plan/limits |
| `projects` | a tracked website: domain, country, device, search engine |
| `domains` | the project's own domain (and, in future, tracked competitor domains) |
| `domain_metrics` | daily snapshot time series: SEO score, traffic, keywords, backlinks — `source` is `'crawler'` (SEO score only) or `'provider'` |
| `keywords` | organic keywords discovered via provider, or manually tracked rank-tracking keywords |
| `keyword_rankings` | position history per keyword (date, position, previous, best, URL, SERP features) |
| `pages` | crawled URLs with on-page/technical signals (title, meta, H1/H2, canonical, robots, status, links, etc.) |
| `page_metrics` | per-page traffic performance (from provider) |
| `competitors` / `competitor_keywords` | organic competitors and keyword-gap data |
| `backlinks` / `referring_domains` | link profile (from provider) |
| `site_audits` | one row per crawl run: status, progress, SEO score breakdown, issue counts |
| `audit_issues` | prioritized issues found by a crawl (category, priority, why it matters, how to fix, affected URLs) |
| `serp_results` | SERP feature data per keyword (from provider) |
| `seo_opportunities` | prioritized recommendations — technical/internal-linking/content ones are generated automatically from crawl data; keyword/backlink ones need a provider |
| `reports` | generated SEO report snapshots (JSON), exportable to PDF client-side |

RLS pattern: every child table is scoped via `EXISTS (... projects p WHERE p.id
= <table>.project_id AND p.user_id = auth.uid())` (or one join further for
tables like `keyword_rankings`, `page_metrics`, `competitor_keywords`,
`domain_metrics`). Edge Functions write with the service-role key (bypasses
RLS) after independently verifying the caller owns the project.

## 4. APIs used

### Internal (Supabase Edge Functions, Deno)

- **`crawl-site`** — `POST { project_id }`. Verifies the caller owns the
  project, fetches `robots.txt` + `sitemap.xml`, crawls up to 100 same-origin
  URLs (5 concurrent, respects `crawl-delay`, 10s timeout per request, avoids
  loops via a visited-set), parses each page's HTML with a dependency-free
  regex-based analyzer, computes prioritized audit issues + a 0-100 SEO Health
  Score (Technical / On-page / Performance / Indexability / Content /
  Backlinks), and persists `pages`, `audit_issues`, `site_audits`,
  crawler-derived `seo_opportunities`, and a `domain_metrics` snapshot.
- **`seo-provider-proxy`** — `POST { action, params }`. Server-side adapter
  implementing the `SEODataProvider` interface against `SEO_API_URL` /
  `SEO_API_KEY`. Returns `{ configured: false }` when unset instead of
  fabricating data. Response mapping in `mapResponse()` targets a generic
  REST vendor shape — adjust it to match whichever provider you connect.
- **`ai-assistant`** — `POST { project_id, question }`. Gathers only the
  project's real stored data (latest audit, tracked keyword rankings, domain
  metrics, opportunities, competitors, top pages) and sends it as context to
  an LLM (Anthropic Messages API via `AI_API_KEY`) with a system prompt that
  forbids inventing data and requires citing the metrics used. Returns
  `{ configured: false }` when `AI_API_KEY` is unset.

### External (bring your own)

- **SEO data provider** — any vendor offering organic keywords, rankings,
  competitors, backlinks and traffic-estimate data via a JSON REST API (e.g.
  DataForSEO, SEMrush API, Ahrefs API, Moz API — you choose). Configure via
  `SEO_API_URL` / `SEO_API_KEY` Edge Function secrets and adjust
  `mapResponse()` in `supabase/functions/seo-provider-proxy/index.ts` to the
  vendor's actual response shape.
- **AI provider** — Anthropic Messages API by default (`AI_API_KEY`,
  `AI_MODEL`). Swap the `fetch` call in `ai-assistant/index.ts` for a
  different LLM provider if you prefer.

## 5. Environment variables

Frontend (`.env`, see `.env.example`):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Server-side (Supabase Edge Function **secrets** — never in frontend `.env`):

```
SEO_API_URL=            # optional — enables Keywords/Competitors/Backlinks/Traffic/keyword Opportunities
SEO_API_KEY=
AI_API_KEY=              # optional — enables the AI SEO Assistant
AI_MODEL=claude-sonnet-4-5   # optional, defaults to claude-sonnet-4-5
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically into every Edge Function by Supabase — you don't set
them yourself.

## 6. Setup instructions

### Option A — no terminal, browser only

Everything can be done from the browser, with the app hosted on Vercel:

1. **Supabase → SQL Editor**: paste the contents of
   `supabase/migrations/0001_init.sql` and hit Run. This creates all tables
   and RLS policies.
2. **Supabase → Edge Functions**: create three functions named exactly
   `crawl-site`, `seo-provider-proxy` and `ai-assistant`, pasting the
   matching `supabase/functions/<name>/index.ts` into each. Each file is
   self-contained, so a single paste per function is all that's needed.
3. **Vercel → Add New → Project**: import the GitHub repo, add the two
   environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (from Supabase → Project Settings → API), then Deploy. Vercel builds it
   in the cloud and gives you a public URL.

### Option B — with the Supabase CLI

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. **Run the migration**:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push        # applies supabase/migrations/0001_init.sql
   ```
   (or paste the SQL file into the Supabase SQL Editor).
3. **Deploy the Edge Functions**:
   ```bash
   supabase functions deploy crawl-site
   supabase functions deploy seo-provider-proxy
   supabase functions deploy ai-assistant
   ```
4. **Set server-side secrets** (optional integrations):
   ```bash
   supabase secrets set SEO_API_URL=https://api.your-provider.com SEO_API_KEY=xxxx
   supabase secrets set AI_API_KEY=sk-ant-xxxxx
   ```
5. **Configure the frontend**: copy `.env.example` to `.env` and fill in
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from your Supabase project
   settings.
6. **Install and run**:
   ```bash
   npm install
   npm run dev
   ```
7. Sign up, create a project (enter a domain, pick country/device/engine),
   click **Analyze** — the crawler runs immediately and populates the SEO
   Health Score, technical issues, and Pages screens with zero external
   dependencies. Connect an SEO data provider whenever you want Keywords,
   Rank Tracking positions, Competitors, Backlinks, Traffic and keyword
   Opportunities to unlock real data.

## 7. What needs an external provider

Per the "never invent data" requirement, these screens show a clear
**"SEO data provider not connected"** empty state until `SEO_API_URL` /
`SEO_API_KEY` are set:

- Keywords (organic keywords, volume, difficulty, CPC, intent)
- Keyword Opportunities & Keyword Gap (competitor comparison)
- Competitors (auto-detection + traffic/keyword estimates)
- Backlinks & Referring Domains
- Traffic (estimated organic traffic — explicitly labeled "estimated", since
  no real analytics connector like GA4/Search Console is wired up in this
  MVP)
- Keyword/backlink categories on the SEO Opportunities page
- Live rank-tracking position refreshes on the Rank Tracking page (adding
  and viewing tracked keywords always works; fetching their live position
  needs the provider)

The AI SEO Assistant (Reports page) needs `AI_API_KEY`, and always answers
strictly from the data actually stored for the project.

Works with **zero external providers**: Auth, Projects, Site Audit crawler,
SEO Health Score, Site Audit issues, Pages (crawler-derived columns),
crawler-derived Technical/Internal-Linking/Content Opportunities, Rank
Tracking keyword management, and PDF report export.

---

## Google Search Console & Google Ads

The crawler answers *what is wrong with the site*. Search Console answers
*what the site actually earns in search*. This integration joins the two, and
adds Google Ads demand data on top where it is available.

### Data provenance

Every metric knows where it came from, and the three sources are never
blended into one number:

| Source | Provides | Nature |
|---|---|---|
| **Site Audit crawler** | title, meta, H1, word count, internal links, status codes, images without alt | measured on the page |
| **Google Search Console** | clicks, impressions, CTR, average position, ranking page, per-query and per-page | measured by Google for *this* site |
| **Google Ads** | average monthly searches, CPC, competition | estimated market demand for the *query* |

Two distinctions the UI keeps visible because conflating them produces wrong
decisions:

- **Search Console impressions ≠ Google Ads search volume.** The first counts
  how often *your* pages were shown; the second estimates how often anyone
  searches the term. They live in different tables (`search_console_queries`
  vs `keyword_metrics`) and different columns.
- **Average position is an average.** Search Console reports a mean over the
  period and over every impression, not a live rank. It is labelled
  "Avg. Position" everywhere and never presented as a keyword's current
  standing.

### Setup

**1. Google Cloud (once)**

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the **Google Search Console API** (and the **Google Ads API** only if
   you intend to use Ads enrichment)
3. Configure the OAuth consent screen; while it is in *Testing*, add your own
   Google account under **Test users**
4. Create credentials → **OAuth client ID** → *Web application*, with this
   authorized redirect URI, exactly:
   ```
   https://<your-project-ref>.supabase.co/functions/v1/google-oauth-callback
   ```
5. Set the client ID and secret as Edge Function secrets:
   ```bash
   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
   ```

**2. Database**

Apply `supabase/migrations/0002_google_search_console.sql`. It is idempotent,
so re-running it is safe.

**3. Edge Functions**

Deploy `google-search-console`, `google-oauth-callback` and — if you are using
Ads — `google-ads`.

> **`google-oauth-callback` must have JWT verification disabled.** Google
> redirects a browser to it with no `Authorization` header. It is safe because
> it trusts nothing but a single-use `oauth_states` row that binds the callback
> to the user who started the flow. With the CLI this comes from
> `supabase/config.toml`; in the dashboard, turn off "Verify JWT" for that
> function.

**4. In the app**

Settings → **Connect Google** → pick the Search Console property for the
project → **Sync now**.

### Synchronization

Data is imported on demand rather than fetched from Google on every page view.
`search_console_syncs` records each run (`pending` / `running` / `completed` /
`failed`) with its date range, row count and any error, and the connection
panel shows when the last one finished.

The sync defaults to the `date`, `query` and `page` dimensions. Adding
`country` and `device` multiplies the row count several-fold, so segmentation
is opt-in per run via the `dimensions` parameter. Search Console finalizes
data with a lag, so every window ends three days before today — otherwise the
most recent days read as a traffic collapse.

Token refresh, retry with exponential backoff on quota and 5xx responses, and
pagination through `startRow` are handled server-side. A revoked grant deletes
the stored connection so the UI offers a clean reconnect instead of failing
repeatedly.

### Opportunity Engine

`src/lib/seo/opportunityEngine.ts` scores keywords deterministically:

```
Opportunity Score = 100 x RankingPotential x ImpressionWeight x ClickGap
```

- **RankingPotential** — highest for positions 4-10 (already on page one),
  lower for deep positions where climbing is unlikely, and low for positions
  1-3 where little room remains.
- **ImpressionWeight** — observed demand, log-scaled so large keywords lead
  without flattening everything else to zero.
- **ClickGap** — clicks currently missed versus position 3, saturating so a
  few enormous keywords cannot dominate the list.

The click gap uses a modelled CTR-by-position curve. That curve is a modelling
assumption, marked as such in the code, and is never rendered as though it
were measured data. All three inputs are independent constants blocks, so the
formula can be retuned without side effects.

Recommendations cite only facts the crawler actually recorded — a thin-content
suggestion quotes the measured word count, and no on-page advice appears at
all for a page the crawler has not reached.

### What this integration deliberately does not do

Backlink databases, competitor keyword databases and SERP scraping need data
sources Google does not expose. Those screens continue to report that they
need an external provider rather than showing invented numbers.

### Tests

```bash
npm test                                    # unit tests
psql "$DATABASE_URL" -f supabase/tests/rls.sql   # Row Level Security
```

The unit suite covers the opportunity scoring properties, recommendation
grounding, crawler/Search Console URL matching, date-window arithmetic, and
the Edge Function client contract with Google mocked — no test calls a real
Google API.

`supabase/tests/rls.sql` verifies the security boundary against a live
database: refresh tokens are unreadable through the Data API even by their
owner, users cannot read or write each other's rows, and the aggregation
functions do not become a way around the policies.
