# SIGNAL

UK political-risk research workspace. This repository currently contains the application foundation, not a finished research product.

## Services
- GitHub: https://github.com/signalaiproject1-del/SIGNAL
- Supabase: SIGNAL (`epegqqlcfnakppnmpmyy`), Ireland
- Vercel: SIGNAL project, connected to this repository

## Local development
Use Node.js 22 or newer. Run `npm ci`, copy `.env.example` to `.env.local`, and supply the Supabase project URL and publishable key from the project dashboard. Never add a service-role key to frontend code or commit environment files.

Run `npm run dev`. Visit http://localhost:3000. Use `npm run typecheck` and `npm run build` before pushing.

## Connection check
`GET /api/health` calls the read-only `signal_health` database function through Supabase's Data API. It returns 200 only when the expected SIGNAL response is received; missing configuration or a failed connection returns 503. No research or user data is returned.

## Deployment
Vercel builds the `main` branch. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in each intended Vercel environment. Keep `.env.local` and `.vercel` out of Git.

## Next phase
Source ingestion, research tables, authentication, vector search and AI analysis are not implemented. Define their access model before enabling APIs or adding user data. Supabase automatic table exposure is disabled.
