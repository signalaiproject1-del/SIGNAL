# SIGNAL

A UK political-risk research pilot with a searchable library of five official energy and climate sources.

## Services
- GitHub: https://github.com/signalaiproject1-del/SIGNAL
- Supabase: SIGNAL (`epegqqlcfnakppnmpmyy`), Ireland
- Vercel: https://vercel.com/signalaiproject1-2956/signal
- Production: https://signal-murex-zeta.vercel.app

## Feed
The homepage reads `source_documents` from Supabase. Search matches all words across titles, publisher descriptions, and imported text, with document-type filtering and date/title sorting. The pilot loads at most 100 records; add server-side search and pagination before expanding beyond that.

Dates are kept separate: original publication, public update, consultation deadline, release timestamp, first collection and latest check. Technical API update timestamps are not used as publication dates. Descriptions and change notes come from GOV.UK, not AI. HTML attachments are imported as plain text with original links. PDF attachments are linked but their contents are **not extracted or searched**. The statistics announcement is not a price dataset. Geographic coverage is not inferred.

## Refresh the curated sources
Python 3 and curl are required. The import currently runs manually:

```sh
python3 scripts/import_sources.py --output /private/tmp/signal-import
```

Review the generated `sources.json` and apply `import.sql` to the SIGNAL project using an authenticated administrator (Supabase SQL editor or MCP `execute_sql`). Never apply it through a public browser endpoint. No service-role credential is required by the script. Edit `scripts/sources.json` to add official GOV.UK publication URLs.

All requests must succeed before output files are written; a nonzero exit means do not apply an older output file. The SQL transaction upserts by canonical URL and archives each distinct SHA-256 content hash once in `source_versions`. Repeating an unchanged import does not duplicate documents or versions. First collection is retained while last check advances. The hash includes public metadata, extracted HTML text and attachment links; it does not detect a PDF changing at an unchanged URL. A removed seed URL is not automatically deleted from the library.

## Access model
Only public official-source material belongs in these tables. `source_documents` has RLS and explicit SELECT-only grants for anonymous/authenticated readers. Writes require administrator access. `source_versions` has RLS, no public grants and intentionally no public policies (the advisor reports this as informational). Do not add private notes or user information to the public feed.

## Local development and checks
Use Node.js 22+ (24 recommended for tests). Run `npm ci`, copy `.env.example` to `.env.local`, and set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Never commit credentials. Then run `npm run dev` and visit http://localhost:3000.

```sh
npm run typecheck
npm run build
node --test tests/health.test.mjs tests/sources.test.mjs
python3 -m unittest discover -s tests -p '*_test.py'
```

`GET /api/health` checks the read-only `signal_health` function, returning 200 for the expected SIGNAL response and 503 otherwise. The homepage separately handles source-library fetch failures without presenting an outage as an empty library.

## Deployment
Vercel deploys `main` automatically. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the intended Vercel environment. Apply database migrations before deploying dependent application changes. Keep `.env.local` and `.vercel` out of Git.

## Remaining work
Scheduled collection, PDF extraction, broader source discovery, authentication, private workspaces, vector search and AI analysis are not implemented. The current UI explicitly labels the manually refreshed pilot and coverage limitations.

## Structured worked example
The build baseline is [docs/V1_SPEC.md](docs/V1_SPEC.md), mapped to the user's master project-plan PDF. `/events/clean-heat-2027` shows the first database-backed political event, seven PDF-cited facts, the proposed target trajectory, and three sector impact pathways. Source facts and analytical inferences are separate; every pathway has evidence references, assumptions, confidence reasons, countervailing effects and missing evidence. Company exposure remains explicitly unasserted pending company-specific sources. This AI-assisted example is awaiting independent review and is not yet gold-standard evaluation data.

`political_events`, `sectors` and `event_sector_impacts` expose SELECT only to public readers under RLS. The migration seeds the first example using natural keys. Subsequent editorial changes require authenticated administrator access; no public write form or automated analysis job exists. The event is linked to its source-library record and captures the reviewed PDF URL, SHA-256 and check date. This one-off PDF review does not enable general PDF search or scheduled source ingestion.

Test event lookup with `node --test tests/events.test.mjs`. An unknown slug returns a 404; a database outage displays an unavailable state rather than inventing or hiding a record. Invalid evidence references fail closed.
