# Deploying Counterpart

Three pieces, all on free tiers:

| Piece | Where | Why |
|---|---|---|
| Database, accounts, image storage | Supabase (already set up) | Postgres, Supabase Auth and a public Storage bucket in one place |
| API (FastAPI) | Render, Docker web service | Runs the agent, the checks and the photo importer |
| Web app (Next.js) | Vercel | Serves the owner workspace and the public QR pages; keeps sign-in tokens in httpOnly cookies |

The browser talks only to Vercel. Vercel's server talks to the API with a shared `OWNER_API_TOKEN` and the
signed-in owner's token. Keys never reach the browser.

> The Docker image has not been test-built on this machine (no Docker installed). Render builds it from
> `backend/Dockerfile`; check the first build log.

## 0. Before you start (once)

In `backend/`:

```bash
uv run python -m scripts.set_secret SUPABASE_SERVICE_ROLE_KEY   # Dashboard > Project Settings > API Keys > secret key
uv run python -m scripts.set_secret GOOGLE_MAPS_API_KEY         # optional: Google Maps photos
uv run python -m scripts.upload_storage                          # copy local images to Supabase Storage
```

Each key is typed hidden and tested before it is saved. Never paste keys into chat or commit them.

## 1. API on Render

1. Render dashboard > New > Blueprint > pick this GitHub repository. Render reads `render.yaml`.
2. Fill the values marked "sync: false" from `backend/.env`:
   `DATABASE_URL`, `GEMINI_API_KEY`, `AGNES_API_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `GOOGLE_MAPS_API_KEY` (optional).
3. Leave `PUBLIC_BASE_URL` and `CORS_ORIGINS` for step 3. `DEMO_PASSWORD` and `OWNER_API_TOKEN` are generated.
4. Deploy. When it is live, `https://<api>.onrender.com/api/health` returns `{"status":"ok"}`.

The free plan sleeps after 15 minutes idle; the first request then takes about a minute. Open the app a few
minutes before a demo, or use the paid Starter plan.

## 2. Web app on Vercel

1. Vercel > Add New > Project > this repository. Root directory: `frontend`. Framework: Next.js.
2. Environment variables:
   - `BACKEND_URL` = `https://<api>.onrender.com`
   - `OWNER_API_TOKEN` = the value Render generated (Render > counterpart-api > Environment)
3. Deploy. Note the URL, e.g. `https://counterpart.vercel.app`.

## 3. Connect them

On Render set, then redeploy:

- `PUBLIC_BASE_URL` = the Vercel URL (QR codes and tracking links point here)
- `CORS_ORIGINS` = `["https://<your-app>.vercel.app"]`

## 4. Check

1. Open the Vercel URL: the sign-in page shows three demo posts.
2. "Try the demo café" opens the demo business.
3. Create an account, finish onboarding, start a campaign, approve a post.
4. Results > copy a post's link, open it on a phone, tap "Get my code", redeem it on the Counter screen.
   The post's numbers go up.

## Costs and limits to know

- Gemini free tier: about 20 requests a day per model. A campaign uses 6 to 12. Turn on billing before real use.
- Google Places photos are billed per request after the monthly free credit; one import makes up to 11 requests.
- Supabase free tier: 500 MB database, 1 GB storage, 50,000 monthly active users.
