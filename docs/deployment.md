# Vercel and Render deployment

This setup serves the static frontend from Vercel and runs the Fastify API on Render.
Vercel serves files from `public/` first; API requests and short-link aliases are
rewritten to the Render web service, so browser requests remain same-origin. The
Render API can run the click worker in-process for a single-service deployment.

## Configure the Render service

1. Create a Render web service from the `pantkartik-linkpulse-dashboard` branch and
   use the settings in `render.yaml`. Review the selected plan and region before
   creating the service.
2. Set `DATABASE_URL` and `REDIS_URL` to your managed PostgreSQL and Redis
   connection URLs, and set `PUBLIC_BASE_URL` to the Vercel production URL. Render
   generates `JWT_SECRET`; `EMBEDDED_WORKER=true` enables click processing and guest
   cleanup in the API process.
3. The start command deploys Prisma migrations before launching the API. Its
   liveness endpoint is `/health/live`; `/health/ready` checks PostgreSQL and Redis.
4. Note the Render service's public HTTPS origin for the Vercel configuration.

## Deploy the Vercel frontend

1. Import the GitHub repository into Vercel and select the
   `pantkartik-linkpulse-dashboard` branch.
2. Keep the repository root as the project root. `vercel.json` installs dependencies,
   builds the browser bundle and local Rive WASM asset, and publishes `public/`.
3. Set the Render API origin in `vercel.json` to your deployed Render service URL,
   then redeploy. Vercel serves static files first and rewrites API and short-link
   routes to the configured backend.
4. Copy the resulting Vercel production URL into the Render API's `PUBLIC_BASE_URL`
   environment variable and trigger a Render deploy if it was not already set.

## Verify deployment

- Open the Vercel URL and start a guest session.
- Create a short link and verify its share URL uses the Vercel origin.
- Open that short URL in a private window; it should redirect through the Vercel
  rewrite to the Render API.
- Visit `/health/live` and `/health/ready` on the Render service; readiness checks
  PostgreSQL and Redis.
- Confirm the embedded click worker is running and monitor API logs and the
  `linkpulse:click-events:dead` stream.

No Supabase API key is used by this design. Rotate credentials previously shared in
chat before using any hosted database or Redis service. Never commit `.env` or
provider credentials.
