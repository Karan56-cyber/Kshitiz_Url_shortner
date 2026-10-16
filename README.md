# LinkPulse API

LinkPulse is a URL management and analytics platform. This repository starts with a
backend-first MVP using Fastify, TypeScript, PostgreSQL, Prisma, and Redis.

## Project flow

1. A user authenticates and operates within an authorized workspace.
2. The user submits a destination URL and link options. The API validates the URL,
   alias, campaign membership, and redirect rules before saving the link.
3. The API returns the short URL for sharing.
4. A visitor requests the alias. The redirect service checks link status, expiration,
   click limits, and any password gate before selecting a destination. Accepted clicks
   are exposed through an injectable queue hook; durable click ingestion is the next
   delivery layer.
5. Authenticated workspace members will query click and campaign aggregates from
   persisted events after analytics is implemented. Disabled and expired links remain
   available for reporting.
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
npm run db:migrate -- --name initial
npm run dev
```

The liveness endpoint is `GET /health/live`; readiness is `GET /health/ready`.

## Identity and workspaces

- `POST /auth/register` creates a normalized email account, a personal workspace,
  and an OWNER membership atomically. Passwords must be 12–128 characters.
- `POST /auth/login` returns a signed 15-minute Bearer access token.
- `GET /auth/me`, `GET /workspaces`, and `POST /workspaces` require that token.
- Authentication endpoints are limited to five requests per IP per minute. The
  API uses Redis for shared rate-limit state across instances.

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

## Validation

```sh
npm test
npm run build
```
