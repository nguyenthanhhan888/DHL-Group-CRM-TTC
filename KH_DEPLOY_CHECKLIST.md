# DHL Group CRM - Customer Deploy Checklist

## Included In This Package

- Full frontend source: `index.html`, `src/`, `images/`, `logo/`
- Vercel serverless APIs: `api/`
- Supabase migrations and functions: `supabase/`
- Build/test scripts: `scripts/`, `tests/`, `package.json`, `vercel.json`
- Browser public config sample: `config.example.js`
- Deployment environment sample: `.env.deploy.example`

## Before Deploying

1. Create or choose the Supabase project.
2. Apply the SQL files in `supabase/migrations/` in timestamp order if the target database is new.
3. Deploy Supabase Edge Functions from `supabase/functions/` when needed.
4. Add all variables from `.env.deploy.example` to the hosting environment.
5. Run `npm run build` so `config.js` is generated from `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
6. Deploy to Vercel or another Node/Vercel-compatible host that supports the `api/` serverless routes.

## Important Notes

- `.env.local` and `config.local.js` are intentionally not included because they can contain local secrets.
- `config.js` is included so the current static web can still be opened/tested with the current public Supabase config.
- PayOS, staff management, TTC verification, and webhook flows require the server-side environment variables to be configured on the deployment platform.
- For production TTC Facebook verification, do not rely on `FACEBOOK_VERIFY_DEV_BYPASS`; configure a real verifier/token.
