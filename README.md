# LinkPulse API

LinkPulse is a URL management and analytics platform. This repository starts with a
backend-first MVP using Fastify, TypeScript, PostgreSQL, Prisma, and Redis.

## Project flow

1. A user authenticates and operates within an authorized workspace.
2. The user submits a destination URL and link options. The API validates the URL,
   alias, campaign membership, and redirect rules before saving the link.
3. The API returns the short URL for sharing.
4. A visitor requests the alias. The redirect service checks link status, expiration,
   click limits, and any password gate before selecting a destination. It increments
   the accepted-redirect counter and enqueues a sanitized event in a Redis Stream;
   redirects do not wait for analytics persistence.
5. A separate worker consumes events and persists them idempotently to PostgreSQL.
   Authenticated workspace members can query stored click and campaign aggregates.
   Disabled and expired links remain available for reporting.
6. Workspace members can disable abusive links; redirect checks reject them.

See [docs/architecture.md](docs/architecture.md) for component responsibilities,
data relationships, and the staged delivery plan.

## Local development

Requirements: Node.js 22+, npm, and Docker Compose.

```sh
cp .env.example .env
docker compose up -d
npm install
npm run db:generate
npm run db:deploy
npm run dev
```

The web app is served by the API at `http://localhost:3000/`. It uses same-origin
requests and needs no browser API key or separate frontend environment variable.
Continue as a guest to create links and view persisted click analytics immediately,
or sign in/register to use a saved account. Guest workspaces are server-backed and
their workspace, links, and analytics are automatically deleted after seven days.
The login screen loads the supplied Rive animation as a local asset; `npm run dev`
and `npm run build` generate the bundled browser script and copy the Rive WebAssembly
runtime into `public/assets/`.

Run the click-event worker in another terminal:

```sh
npm run dev:worker
```

For production, deploy `npm run start` and `npm run worker` as separate processes.
Configure Redis persistence/replication and monitor the click stream and
`linkpulse:click-events:dead` dead-letter stream. Queue publication failures are
logged; the visitor still receives the accepted redirect, so analytics for that
request may be lost if Redis is unavailable.

The liveness endpoint is `GET /health/live`; readiness is `GET /health/ready`.
For a Vercel frontend with a Render API, PostgreSQL, Redis, and worker, see
[docs/deployment.md](docs/deployment.md). The repository includes a Render Blueprint
and Vercel project configuration; review provider plans and set the deployment
origins before confirming hosted resources.

## Identity and workspaces

- `POST /auth/guest` creates a server-backed guest identity and OWNER workspace.
  Its bearer token lasts seven days; the workspace and its links are removed by the
  worker after expiry. Guest workspaces use the same link and analytics endpoints as
  registered accounts, but cannot create additional workspaces.
- `POST /auth/register` creates a normalized email account, a personal workspace,
  and an OWNER membership atomically. Passwords must be 12–128 characters.
- `POST /auth/login` returns a signed 15-minute Bearer access token.
- `GET /auth/me`, `GET /workspaces`, and `POST /workspaces` require that token.
- Register/login are limited to five requests per IP per minute; guest workspace
  creation is limited to three per IP per hour. The API uses Redis for shared
  rate-limit state across instances.

The supplied Supabase API keys are not used by this architecture: the API connects
directly to PostgreSQL through `DATABASE_URL` and uses Redis through `REDIS_URL`.
Never put database, Redis, or service-role credentials in frontend files or tracked
configuration. A PostgreSQL password by itself is not a complete connection URL;
configure the full host/database/SSL URL in the deployment secret store.

Use the reusable workspace membership and role pre-handler for workspace-scoped
routes; never trust a workspace ID supplied by a caller without checking membership.
See [docs/architecture.md](docs/architecture.md) for implementation boundaries.

## Link lifecycle

Authenticated workspace members can create and manage links:

- `POST /workspaces/:workspaceId/links` — create a link, optionally setting `alias`,
  `campaignId`, `expiresAt`, `maxClicks`, and `password`.
- `GET /workspaces/:workspaceId/links?limit=50` and
  `GET /workspaces/:workspaceId/links/:linkId` — list or retrieve links in that
  workspace.
- `PATCH /workspaces/:workspaceId/links/:linkId` — update destination or rules;
  `password: null`, `expiresAt: null`, and `maxClicks: null` clear those settings.
- `POST /workspaces/:workspaceId/links/:linkId/disable` — disable a link.
- `GET /:alias` — public 302 redirect after the link is accepted. Password-protected
  links require the `x-link-password` header. Missing and invalid passwords return
  401 and 403 without consuming a click. Disabled, expired, and exhausted links return
  410; unknown aliases return 404.

Destinations are restricted to absolute HTTP(S) URLs without credentials, control
characters, local hostnames, or non-public IP addresses. Custom aliases are globally
unique. Link creation is limited to 30 requests per IP per minute using Redis when
configured. Redirect click caps are enforced by a conditional database update, so
concurrent requests cannot exceed the configured maximum. Passwords are stored only
as scrypt hashes and are redacted from request logs.

## Click tracking and analytics

- The API writes accepted redirects to the `linkpulse:click-events` Redis Stream.
  The event has a UUID used as the PostgreSQL primary key, so worker redelivery is
  idempotent. Redis consumer groups retain unacknowledged events and retry them after
  the visibility timeout; after five failed deliveries an event is moved to
  `linkpulse:click-events:dead`.
- The worker runs with bounded concurrency (10 by default), logs successful writes,
  retries, and dead-letter events, and prunes events older than
  `CLICK_EVENT_RETENTION_DAYS` (90 by default; valid range 1–3650 days).
- The collector stores no raw IP and does not trust forwarded country headers.
  Referrers are reduced to their HTTP(S) origin; user agents are stripped of control
  characters and truncated to 512 characters. Device/browser categories and a known
  bot flag are derived from that sanitized user agent.
- Every successful redirect, including detected bots, consumes the link's existing
  click counter and is eligible for event recording. Analytics totals exclude events
  marked as bots. Analytics includes inactive links and uses a half-open time range
  (`from` inclusive, `to` exclusive).
- `GET /workspaces/:workspaceId/analytics/overview?from=<ISO>&to=<ISO>&limit=10`
  returns daily counts, top links, campaign totals, and total workspace links.
  `GET /workspaces/:workspaceId/analytics/links?from=<ISO>&to=<ISO>&limit=50&offset=0`
  provides bounded link pagination. Dates default to the last 30 days; ranges are
  limited to 366 days and limits to 50.

## Validation

```sh
npm test
npm run build
npm run db:generate
npx prisma validate
npm audit
git diff --check
```
