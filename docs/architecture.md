# LinkPulse system flow and backend architecture

## Request and data flow

```text
User -> API authentication -> workspace authorization
     -> validate destination and link rules -> persist Link -> return short URL

Visitor -> GET /:alias -> load link -> evaluate status / expiry / click cap
        -> (password required? verify before releasing destination)
        -> enqueue ClickEvent -> redirect to destination

Workspace member -> analytics API -> aggregate ClickEvents by link/campaign/period
Admin -> disable abusive Link -> redirect service rejects subsequent requests
```

## Service boundaries

- **HTTP/API layer:** Fastify routes, request validation, authentication hooks, and
  stable error responses. Route handlers delegate business behavior to services.
- **Identity and access:** Users belong to workspaces through role-bearing memberships.
  Every management and analytics query is scoped to a workspace the caller can access.
- **Link service:** Owns alias uniqueness, destination validation, link lifecycle, and
  rule evaluation. Database constraints are the final authority for alias uniqueness.
- **Redirect path:** Performs only the reads and rule checks required to decide the
  response. It must not wait for analytics aggregation or slow external lookups.
- **Click pipeline:** A Redis-backed durable queue buffers sanitized click events;
  workers persist events to PostgreSQL. Queue health, retries, and dead-letter handling
  are operational requirements before production deployment.
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
3. For password-protected links, require and verify the password before revealing the
   destination.
4. Record the accepted click asynchronously and return the redirect response.

Click-cap enforcement must be atomic across concurrent requests. The final redirect
implementation will use a conditional database update (or an equivalent atomic counter)
to avoid allowing requests past the configured cap.

## Delivery plan

1. **Foundation:** API runtime, validated configuration, health checks, database schema,
   local PostgreSQL/Redis, architecture docs, and automated checks.
2. **Authentication/workspaces:** registration/login, secure password hashing, signed
   access tokens, workspace creation, and role-based access checks.
3. **Link lifecycle:** create/list/update/disable links; aliases; URL validation; expiry,
   click caps, and password protection; redirect behavior and link-creation limits.
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
