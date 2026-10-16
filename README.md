# LinkPulse API

LinkPulse is a URL management and analytics platform. This repository starts with a
backend-first MVP using Fastify, TypeScript, PostgreSQL, Prisma, and Redis.

## Project flow

1. A user authenticates and operates within an authorized workspace.
2. The user submits a destination URL and link options. The API validates the URL,
   alias, campaign membership, and redirect rules before saving the link.
3. The API returns the short URL for sharing.
4. A visitor requests the alias. The redirect service checks link status, expiration,
   click limits, and any password gate before selecting a destination.
5. Valid visits are queued for asynchronous click recording, then redirected without
   waiting for analytics writes.
6. Authenticated workspace members query click and campaign aggregates from persisted
   events. Disabled and expired links remain available for reporting.
7. Administrators can disable abusive links; redirect checks observe the disabled state
   immediately.

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

## Validation

```sh
npm test
npm run build
```
