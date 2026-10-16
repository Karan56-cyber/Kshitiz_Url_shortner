# LinkPulse system flow and backend architecture

## Request and data flow

```text
User -> registration/login -> signed access token -> workspace authorization
     -> validate destination and link rules -> persist Link -> return short URL

Visitor -> GET /:alias -> load link -> evaluate status / expiry / click cap
        -> (password required? verify before releasing destination)
        -> atomically claim click -> optional queue hook -> redirect to destination

Workspace member -> (future analytics API) -> aggregate ClickEvents by link/campaign/period
Admin -> disable abusive Link -> redirect service rejects subsequent requests
```

## Service boundaries

- **HTTP/API layer:** Fastify routes, request validation, authentication hooks, and
  stable error responses. Route handlers delegate business behavior to services.
- **Identity and access:** Users belong to workspaces through role-bearing memberships.
  Registration creates the user, personal workspace, and OWNER membership atomically.
  Passwords use scrypt hashes; API access tokens are short-lived and signed. Every
  management and analytics query is scoped to a workspace the caller can access.
  Authentication rate limits use Redis so limits are shared across API instances.
- **Link service:** Owns alias uniqueness, destination validation, link lifecycle, and
  rule evaluation. Database constraints are the final authority for alias uniqueness.
- **Redirect path:** Performs only the reads and rule checks required to decide the
  response. The click counter is conditionally incremented in PostgreSQL so the
  configured cap is respected under concurrent traffic. An injectable callback is the
  seam for the next click-queue layer; no click events are written in this delivery.
- **Click pipeline (next layer):** A Redis-backed durable queue should buffer sanitized
  click events; workers persist them to PostgreSQL. Queue health, retries, and
  dead-letter handling are operational requirements before production deployment.
- **Analytics:** Reads persisted click events and returns time-bounded aggregates;
  reporting must not depend on hard-coded demo values.
- **PostgreSQL:** Source of truth for users, memberships, campaigns, links, and click
  events. Foreign keys and indexes support tenant scoping and time-range queries.

## Core relationships

- A user can belong to multiple workspaces through `WorkspaceMembership`.
- A workspace owns campaigns and links.
- A campaign groups links within the same workspace.
- A link has one globally unique alias, redirect rules, and many click events.
- Click events retain the link relationship so disabled and expired links stay reportable.

Raw visitor IP addresses are not persisted. The click pipeline stores a one-way,
rotating-key hash when visitor-level deduplication is enabled. Retention and privacy
policies should be configured before collecting production analytics.

## Redirect decision order

1. Resolve the alias; return not found for unknown aliases.
2. Reject disabled, expired, or exhausted links without recording a successful click.
3. For password-protected links, require and verify the password before consuming a
   click or revealing the destination.
4. Atomically increment the accepted-click counter only if the link is still active,
   unexpired, and below its cap; the password hash must still match the initially
   checked hash.
5. Invoke the optional click queue hook and return the redirect response. Queue
   failures are logged without blocking a valid redirect.

Workspace link APIs are tenant scoped for every list/read/update/disable operation.
Destination validation permits absolute HTTP(S) URLs only, rejects credentials and
local or non-public IP targets, and normalizes the stored URL. Passwords use the same
scrypt password-hashing implementation as account credentials; only their hash is
persisted.

## Delivery plan

1. **Foundation:** API runtime, validated configuration, health checks, database schema,
   local PostgreSQL/Redis, architecture docs, and automated checks.
2. **Authentication/workspaces:** registration/login, secure password hashing, signed
   access tokens, workspace creation, and role-based access checks (implemented).
3. **Link lifecycle (implemented):** create/list/update/disable links; aliases; URL
   validation; expiry, click caps, and password protection; atomic redirects and
   link-creation limits.
4. **Tracking/analytics:** bot filtering, durable asynchronous click ingestion, safe
   metadata capture, and workspace-scoped time/campaign/link aggregates.

QR codes, CSV import, device targeting, link-in-bio pages, custom domains, and advanced
abuse tooling remain follow-up work after the core lifecycle is reliable.

## Production scaling considerations

- Keep API instances stateless and scale them behind a load balancer.
- Enforce limits and tenant boundaries in application logic and database constraints.
- Use Redis for queue buffering and distributed rate-limit state; configure persistence,
  bounded retries, dead-letter handling, and queue-depth alerts.
- Index redirect aliases and workspace/time query paths. Introduce pre-aggregated
  analytics or a columnar store only when measured query volume warrants it.
- Define click-event retention, backup/restore, secrets rotation, observability, and
  abuse response policies before public launch.
