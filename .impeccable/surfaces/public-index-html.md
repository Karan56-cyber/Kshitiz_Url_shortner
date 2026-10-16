---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

# LinkPulse app

- **Scope and mode:** Login, link creation/management, and workspace traffic dashboard; Operate.
- **Audience and task:** A first-time user creating a link and checking recorded visits without account setup; saved accounts remain available.
- **Primary action and proof:** Start as a guest, create a short link, and review persisted click totals and link status from the API.
- **Direction:** Seedling Field Ledger. Pair a forest-green welcome panel and supplied Teddy animation with a bright-paper account form; stack the illustration and form on narrow screens.
- **Memorable moment:** Teddy's local Rive `Login Machine` animation accompanies the first sign-in; the dashboard makes asynchronous analytics timing explicit.
- **Constraints:** Same-origin API only; no browser API key or separate frontend URL. PostgreSQL and Redis remain server requirements. Guest data expires after seven days. Analytics exclude known bots and can lag accepted redirects. Preserve workspace isolation and report inactive links.
- **Unresolved:** Campaign management, password-protected-link creation, and link pagination beyond the first 50 entries are not exposed in this first UI.
