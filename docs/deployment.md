# Vercel and Render deployment

This setup serves the static frontend from Vercel and runs the Fastify API, click
worker, PostgreSQL, and Redis on Render. Vercel serves files from `public/` first;
unmatched routes (API requests and short-link aliases) are rewritten to the Render
web service. The API and frontend therefore keep using same-origin browser requests.

## Deploy Render services

1. Push this branch and create a Render Blueprint from `render.yaml` in the
   `pantkartik-linkpulse-dashboard` branch.
2. Review the Blueprint resources and their plans/pricing before confirming. It
   creates a web service, a background worker, PostgreSQL, and a persistent Redis
   Key Value instance. PostgreSQL and Redis accept private-network connections only.
3. Set the requested `PUBLIC_BASE_URL` value to the Vercel production URL (for
   example, `https://<your-project>.vercel.app`) before the API deploy completes.
   Link creation uses this origin to generate shareable short URLs.
4. The API runs `npm run db:deploy` as its pre-deploy command. The click worker
   processes Redis streams and periodically deletes expired click events and guest
   workspaces.

The Blueprint generates `JWT_SECRET` and wires `DATABASE_URL` and `REDIS_URL`
through Render service references. Do not copy service credentials into the
repository. Note the public HTTPS origin assigned to the Render API service for the
Vercel setup.

## Deploy the Vercel frontend

1. Import the GitHub repository into Vercel and select the
   `pantkartik-linkpulse-dashboard` branch.
2. Keep the repository root as the project root. `vercel.json` installs dependencies,
   builds the browser bundle and local Rive WASM asset, and publishes `public/`.
3. Set the Vercel environment variable `RENDER_API_ORIGIN` to the Render API's
   public HTTPS origin (for example, `https://linkpulse-pantkartik-api.onrender.com`)
   for Production and Preview, then redeploy. Vercel serves static files first and
   sends unmatched API and link routes through the external-origin route in
   `vercel.json`.
4. Copy the resulting Vercel production URL into the Render API's `PUBLIC_BASE_URL`
   environment variable and trigger a Render deploy if it was not already set.

## Verify deployment

- Open the Vercel URL and start a guest session.
- Create a short link and verify its share URL uses the Vercel origin.
- Open that short URL in a private window; it should redirect through the Vercel
  rewrite to the Render API.
- Visit `/health/live` and `/health/ready` on the Render service; readiness checks
  PostgreSQL and Redis.
- Confirm the Render worker is running and monitor its logs and
  `linkpulse:click-events:dead` stream.

No Supabase API key is used by this design. Rotate credentials previously shared in
chat before using any hosted database or Redis service. Never commit `.env` or
provider credentials.
