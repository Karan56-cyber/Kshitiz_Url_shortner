# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The first frontend audience includes first-time users who want to create and manage
short links and check their click performance immediately, without account setup.
Guest workspaces support that first visit; registered workspaces remain available for
users who want a saved account.

## Product Purpose

LinkPulse lets users create short URLs with lifecycle controls and view click
analytics for links in their workspace. Success means a user can start as a guest,
create a shareable link, and understand its recorded traffic in one visit.

## Positioning

Accepted redirects are counted synchronously to enforce link limits, while sanitized
click events are recorded asynchronously and queried for workspace analytics.

## Operating Context

Users work in a browser to authenticate, select a workspace, create and manage short
links, and review click counts. Visitors use the public short URL to reach its
destination. The system uses PostgreSQL, Prisma, and Redis.

## Capabilities and Constraints

- The API supports guest sessions, registration, login, workspace listing/creation, link
  create/list/read/update/disable, public redirects, and workspace analytics.
- Guest workspaces are persisted and scoped like registered workspaces; they expire
  after seven days and cannot create additional workspaces.
- Link options include campaign association, expiry, click limits, and password
  protection. This MVP does not expose campaign creation or QR/CSV/custom-domain
  workflows.
- Analytics is persisted and time-bounded; known bots are excluded from analytics,
  while the accepted redirect click counter counts successful redirects including
  detected bots.
- Raw IP addresses are not stored. Referrers are reduced to HTTP(S) origins and
  user-agent strings are sanitized and truncated.
- The frontend can use same-origin API requests and the existing access token; no
  third-party API integration is required.
- API and worker processes require configured PostgreSQL and Redis services.

## Brand Commitments

The product name is LinkPulse. The user said existing brand assets can be provided;
the supplied Rive mascot animation is included in the login experience. The
frontend uses a replaceable text-and-leaf wordmark.

## Evidence on Hand

The API routes, Prisma schema, migrations, tests, README, and architecture
documentation are the source of truth. The repository contains no customer claims,
benchmarks, testimonials, or supplied brand assets.

## Product Principles

- Keep accepted redirects independent from analytics persistence latency.
- Show analytics from persisted events and reflect the API's bot-counting semantics.
- Scope workspace data by authenticated membership.
- Make link controls understandable and reportable after disablement or expiry.
