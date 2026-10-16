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
   connection URLs. Set `PUBLIC_BASE_URL` to `https://short.remindkro.in`; this is
   the public short-link domain, not the Render API origin. Render generates
   `JWT_SECRET`; `EMBEDDED_WORKER=true` enables click processing and guest cleanup
   in the API process.
3. To enable password recovery, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
   `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in Render's environment. Without these
   settings, normal sign-in continues to work but password-reset requests return a
   clear service-unavailable message.
4. The start command deploys Prisma migrations before launching the API. Its
   liveness endpoint is `/health/live`; `/health/ready` checks PostgreSQL and Redis.
5. Note the Render service's public HTTPS origin for the Vercel configuration.

## Deploy the Vercel frontend

1. Import the GitHub repository into Vercel and select the
   `pantkartik-linkpulse-dashboard` branch.
2. Keep the repository root as the project root. `vercel.json` installs dependencies,
   builds the browser bundle and local Rive WASM asset, and publishes `public/`.
3. Add `short.remindkro.in` as a Vercel domain and configure its DNS records as
   instructed by Vercel. The Vercel rewrites proxy API and short-link requests to
   `https://linkpulse-api-0w93.onrender.com`; the Render URL is an internal service
   origin and must not be used as the public short-link base.

## Verify deployment

- Open `https://short.remindkro.in` and start a guest session.
- With SMTP configured, test password recovery using an account you can access;
  reset links expire after 30 minutes and are single-use.
- Create a short link and verify its share URL uses the Vercel origin.
- Verify the share URL starts with `https://short.remindkro.in/`, then open it in
  a private window; it should redirect through the Vercel rewrite to the Render API.
- Visit `/health/live` and `/health/ready` on the Render service; readiness checks
  PostgreSQL and Redis.
- Confirm the embedded click worker is running and monitor API logs and the
  `linkpulse:click-events:dead` stream.

No Supabase API key is used by this design. Rotate credentials previously shared in
chat before using any hosted database or Redis service. Never commit `.env` or
provider credentials.
