# SIGNAL

A UK political-risk research pilot with a searchable library of five official energy and climate sources.

## Services
- GitHub: https://github.com/signalaiproject1-del/SIGNAL
- Supabase: SIGNAL (`epegqqlcfnakppnmpmyy`), Ireland
- Vercel: https://vercel.com/signalaiproject1-2956/signal
- Production: https://signal-murex-zeta.vercel.app

## Feed
The homepage reads `source_documents` from Supabase. Search matches all words across titles, publisher descriptions, and imported text, with document-type filtering and date/title sorting. The pilot loads at most 100 records; add server-side search and pagination before expanding beyond that.

Dates are kept separate: original publication, public update, consultation deadline, release timestamp, first collection and latest check. Technical API update timestamps are not used as publication dates. Descriptions and change notes come from GOV.UK, not AI. HTML attachments are imported as plain text with original links. PDF text is extracted page by page and included in search, with links to original PDF pages. Attachments record a binary SHA-256, page count and text coverage. Scanned images are not OCRed, and extracted text does not preserve table layout. A page with some text can still contain images that are not searchable. The statistics announcement is not a price dataset. Geographic coverage is not inferred.

## Automatic source refresh
GitHub Actions runs `.github/workflows/refresh-sources.yml` daily at **06:23 UTC**, with a manual **Run workflow** control on the Actions page. This refreshes the five curated URLs; it does not discover new publications. GitHub may delay scheduled jobs, and disables schedules in public repositories after 60 days without repository activity. The UI flags interrupted runs after 30 minutes and an overdue completed run after 48 hours.

The runner extracts the official pages, HTML attachments and PDFs using pinned `pypdf`. It obtains a short-lived GitHub OIDC token and sends results to the Supabase `source-import` Edge Function. The function verifies the signature, issuer, audience, expiry, owner/repository IDs, main branch, exact workflow and scheduled/manual event type. No database secret is stored in GitHub. Supabase's server credential stays inside the function. The privileged database RPC is callable only by `service_role`; public users have no import/write capability.

Each run records its start, finish, successful-source count and safe per-source failure codes in `source_import_runs`. Successful sources update atomically; a failed source retains its last successful content and check date. A rejected batch rolls back entirely. Completed run retries are idempotent. Each distinct content hash is archived once, including binary PDF hashes so changed files at unchanged links are detected. Original collection dates are retained. The fixed target allowlist lives in `source_import_targets`; adding a source requires both an administrator-approved target and an entry in `scripts/sources.json`. Removed URLs are not automatically deleted.

A job that cannot start, or loses access before reporting completion, remains visible through GitHub Actions and the stale/interrupted UI state. No separate email-alert service is configured. GitHub's own notification settings apply. Pause using **Disable workflow** on the Actions page.

## Manual collection and development
Use Python 3.12+ and curl, and install `scripts/requirements.txt`. Local collection requires no database credential:

```sh
python3 -m pip install -r scripts/requirements.txt
python3 scripts/import_sources.py --output /private/tmp/signal-import
```

Review the generated JSON and SQL before applying the manual SQL through an authenticated administrator. Failed collection removes obsolete SQL and produces `failures.json` instead. The scheduled runner uses `scripts/refresh_sources.py` and GitHub identity; it is not a public browser endpoint. Downloads are limited to allowlisted HTTPS GOV.UK hosts, 25 MB per file, 400 PDF pages and bounded extracted text. Redirects, encrypted documents and parser errors fail the source and preserve the database copy. Pages without text are labelled as blank or requiring OCR; no OCR or visual/table interpretation is claimed.

## Access model
Only public official-source material belongs in these tables. `source_documents` has RLS and explicit SELECT-only grants for anonymous/authenticated readers. Writes require administrator access or the verified import workflow. `source_versions` has RLS, no public grants and intentionally no public policies (the advisor reports this as informational). Do not add private notes or user information to the public feed.

## Local development and checks
Use Node.js 22+ (24 recommended for tests). Run `npm ci`, copy `.env.example` to `.env.local`, and set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Never commit credentials. Then run `npm run dev` and visit http://localhost:3000.

```sh
npm run typecheck
npm run build
npm ci --prefix supabase/functions/source-import
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p '*_test.py'
```

`GET /api/health` checks the read-only `signal_health` function, returning 200 for the expected SIGNAL response and 503 otherwise. The homepage separately handles source-library fetch failures without presenting an outage as an empty library.

## Deployment
Vercel deploys `main` automatically. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the intended Vercel environment. Apply database migrations before deploying dependent application changes. Keep `.env.local` and `.vercel` out of Git.

## Remaining work
Broader source discovery, OCR, authentication, private workspaces, vector search and automated AI analysis remain future work. The current pilot refreshes only the curated source list. The worked analysis does not automatically change when a source is refreshed; its review date and source hash remain explicit.

## Structured worked example
The build baseline is [docs/V1_SPEC.md](docs/V1_SPEC.md), mapped to the user's master project-plan PDF. `/events/clean-heat-2027` shows the first database-backed political event, seven PDF-cited facts, the proposed target trajectory, and three sector impact pathways. Source facts and analytical inferences are separate; every pathway has evidence references, assumptions, confidence reasons, countervailing effects and missing evidence. Company exposure remains explicitly unasserted pending company-specific sources. This AI-assisted example is awaiting independent review and is not yet gold-standard evaluation data.

`political_events`, `sectors` and `event_sector_impacts` expose SELECT only to public readers under RLS. The migration seeds the first example using natural keys. Subsequent editorial changes require authenticated administrator access; no public write form or automated analysis job exists. The event is linked to its source-library record and captures the reviewed PDF URL, SHA-256 and check date. The worked example remains a separate editorial assessment; automated imports update the evidence library, not its analysis.

Test event lookup with `node --test tests/events.test.mjs`. An unknown slug returns a 404; a database outage displays an unavailable state rather than inventing or hiding a record. Invalid evidence references fail closed.

## Automation deployment
Apply `automated_source_imports` before deploying the Edge Function and app. Deploy `supabase/functions/source-import` with the `deno.json` import map and `verify_jwt=false`: custom GitHub OIDC verification is mandatory in the handler. Do not replace it with anonymous access. Commit the workflow to `main`, run it once from Actions and verify its result, database counts and live search. Future changes to the workflow identity require a matching reviewed change in `auth.ts`. Keep source text and operational metadata public-only.

References: [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc), [GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [Supabase function authentication](https://supabase.com/docs/guides/functions/auth), [pypdf extraction limitations](https://pypdf.readthedocs.io/en/stable/user/extract-text.html).
