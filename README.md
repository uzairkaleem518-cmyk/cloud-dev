# Forge — Self-Hosted Cloud Dev Environments

An open-source, self-hostable alternative to GitHub Codespaces / Gitpod.
Spin up isolated, pre-configured dev containers on your own server and
code against them from a browser terminal — no local setup required.

This repo now covers **Phase 1 + Phase 2 + Phase 3**: auth → provision
container → browser terminal (Phase 1), real VS Code Remote-SSH access
with a companion VS Code extension (Phase 2), and multi-user
administration — an admin panel, per-user resource quotas, a cluster-wide
resource cap, live CPU/RAM gauges on the dashboard, account suspension,
and auth rate limiting (Phase 3). Kernel-level sandboxing (gVisor/Kata)
and multi-node scheduling are still ahead (see Roadmap below).

## Architecture

```
┌─────────────┐   REST + JWT   ┌──────────────┐   HTTP + WS, token auth   ┌──────────────┐   dockerode   ┌───────────────┐
│   React     │ ─────────────▶ │  Express API │ ────────────────────────▶│ Orchestrator │ ────────────▶ │ Docker Engine │
│  Dashboard  │                │  (backend)   │ ◀──────────────────────── │  (daemon)    │ ◀──────────── │ (per host)    │
│             │ ◀───────────── │  - auth      │      container events     │  - the ONLY  │  cde-ws-<id>  │  containers,  │
└─────────────┘  WS (xterm)    │  - workspace │                            │   process    │  container    │  one per      │
       │                       │    CRUD      │                            │   holding    │  events       │  workspace     │
       └───────────────────────│  - billing   │                            │   docker.sock│               └───────────────┘
                                │  - idle reap │                            └──────────────┘
                                └──────┬───────┘
                                       │
                                 ┌──────────┐
                                 │ MongoDB  │
                                 │ (users,  │
                                 │ workspace│
                                 │  & Host  │
                                 │ metadata)│
                                 └──────────┘
```

The backend never touches Docker directly - it's a client of one or more
**orchestrator** daemons (`orchestrator/`), each of which owns exactly
one host's `docker.sock` and nothing else can reach it. This means:
compromising the API process doesn't hand over Docker-equivalent host
control, and adding capacity is "run another orchestrator + register it"
rather than a backend redeploy - see `docs/multi-node.md`. Each
orchestrator can also run workspace containers under gVisor or Kata
instead of plain `runc` for real kernel isolation - see
`docs/gvisor-kata.md`.

**Two ways in, same container:** the browser terminal (Phase 1, `docker
exec` relayed browser → backend → orchestrator → container) is still
there for quick access with zero setup. Phase 2 adds a second path: each
workspace container runs `sshd`, gets its own host port (the orchestrator
picks a free one and maps it to the container's `:22`), and the backend
can ask the orchestrator to generate a fresh SSH keypair on demand,
install the public half into the container, and hand the private key to
the user (or straight to the VS Code extension) exactly once.

## Project layout

```
cloud-dev-env/
├── backend/              # Express API - user-facing, holds NO Docker access
│   ├── config/db.js, plans.js (incl. Stripe Price ID mapping)
│   ├── models/           # User, Workspace, Host (Mongoose)
│   ├── middleware/auth.js
│   ├── routes/           # auth.js, workspaces.js, admin.js, billing.js
│   ├── services/
│   │   ├── dockerService.js    # HTTP client to the orchestrator(s)
│   │   ├── hostRegistry.js     # multi-node scheduler (picks least-loaded host)
│   │   ├── billingService.js   # Stripe checkout/portal/webhook logic
│   │   ├── terminalService.js  # browser WS <-> orchestrator WS bridge
│   │   └── idleReaper.js       # auto-stops idle containers
│   ├── scripts/pullImages.js, promoteAdmin.js, registerHost.js
│   └── server.js
├── orchestrator/         # Privileged daemon - the ONLY thing with docker.sock
│   ├── services/dockerService.js  # actual dockerode calls (create/stop/exec/stats)
│   ├── middleware/auth.js         # shared-secret auth (ORCHESTRATOR_TOKEN)
│   ├── scripts/pullImages.js      # build workspace images on THIS host
│   └── server.js                  # HTTP API + WS exec-stream bridge
├── frontend/             # React dashboard + in-browser terminal
│   └── src/
│       ├── pages/        # Login, Dashboard, WorkspaceView (terminal), Pricing (Stripe checkout)
│       ├── components/
│       └── api/client.js
├── docker/               # Dockerfiles for workspace images
│   ├── base.Dockerfile
│   ├── entrypoint.sh     # starts sshd + clones repo on first boot
│   ├── node.Dockerfile
│   └── python.Dockerfile
├── vscode-extension/     # "Forge: Connect to Workspace" one-click connect
│   ├── package.json
│   └── src/extension.js
├── docs/
│   ├── multi-node.md     # adding more Docker hosts
│   └── gvisor-kata.md    # real kernel isolation setup
└── docker-compose.yml    # runs Mongo + orchestrator + backend together
```

## Prerequisites

- Docker + Docker Compose installed on your host (this is what actually
  runs the workspace containers)
- Node.js 18+ (only needed if you run backend/orchestrator/frontend
  outside Docker)

## Setup

### 1. Build the workspace images

These are the pre-configured environments users can pick from (Node,
Python, or a bare base image). Build them once on each Docker host that
will run an orchestrator (for a single-node setup, that's just once):

```bash
cd orchestrator
npm install
npm run seed:images
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
cp orchestrator/.env.example orchestrator/.env
# edit backend/.env    — at minimum set a real JWT_SECRET
# edit orchestrator/.env — set ORCHESTRATOR_TOKEN (openssl rand -hex 32);
#   both files' ORCHESTRATOR_TOKEN must match (docker-compose.yml already
#   wires this from one shared env var - see below)
```

### 3. Start the stack

```bash
# from the project root
export ORCHESTRATOR_TOKEN=$(openssl rand -hex 32)
docker compose up -d --build

# One-time: tell the backend about this orchestrator instance
docker compose exec backend npm run register:host -- primary http://orchestrator:5001 $ORCHESTRATOR_TOKEN
```

This starts MongoDB, the orchestrator (which holds Docker access), and
the backend API on `localhost:4000` - the backend itself has no Docker
socket mounted at all. To add more Docker hosts later, see
`docs/multi-node.md`.

### 4. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`, register an account, and create your first

workspace.

## Phase 2: VS Code Remote-SSH setup

### 1. Point the backend at a real host

In `backend/.env` (or `docker-compose.yml` via the `SSH_HOST` env var), set:

```
SSH_HOST=your.server.ip.or.hostname
```

`localhost` only works if VS Code and the backend are on the same machine.

### 2. Open the port range in your firewall

Docker maps each workspace's `sshd` to a random free host port (typically
in the `32768–60999` ephemeral range). If your server has a firewall
(ufw, security groups, etc.), open that range for SSH-only traffic, or
narrow it by configuring Docker's `--allowed-port-range` if your setup
supports it.

### 3. Rebuild the workspace images

Phase 2 changes the base image (adds `sshd`, an entrypoint script, port
22). Rebuild before creating new workspaces:

```bash
cd backend && npm run seed:images
```

Existing Phase-1 workspaces (already-running containers) won't have SSH
until you delete and recreate them.

### 4. Connect

**From the dashboard:** open a workspace card → "Connect via SSH" →
follow the on-screen steps (download the key, optionally add the SSH
config snippet, then use a plain `ssh` command or VS Code's Remote-SSH
extension manually).

**From VS Code, one click:** install the extension in `vscode-extension/`
(open that folder in VS Code and press F5 to run it in an Extension
Development Host, or package it with `vsce package` and install the
`.vsix`). Then:

1. `Forge: Sign In` — enter your Forge account email/password
2. `Forge: Connect to Workspace` — pick a running workspace

The extension writes the private key to `~/.forge/keys/<id>`, adds a
matching `Host forge-<id>` block to `~/.ssh/config`, and opens a new VS
Code window connected via Remote-SSH straight into `/home/dev/workspace`.

### How key rotation works (and its current limit)

Each time you (or the extension) request `/ssh-connect`, the backend
generates a **brand new** keypair and overwrites the container's
`authorized_keys` — the previous key stops working immediately. This
keeps things simple for Phase 1/2 but means only one active connection
credential exists per workspace at a time; supporting multiple
simultaneously-valid keys (e.g. one per device) is a small extension of
the same `authorized_keys` file and is a natural next step.

## Phase 3: multi-user administration

### 1. Bootstrap the first admin

There's no in-app "make me admin" button (that would be a privilege
escalation hole). Register a normal account first, then promote it from
the server:

```bash
cd backend
npm run promote:admin -- someone@example.com
```

Sign out and back in (or just refresh `/api/auth/me`) and an **Admin**
link appears in the dashboard header.

### 2. What the admin panel does

At `/admin` (admin-only, enforced both client- and server-side):

- **Cluster overview** — total users, running/total workspaces, and how
  much CPU/RAM is currently allocated vs. the configured cap.
- **User management** — per-user role, `maxWorkspaces`, and CPU/RAM
  quota overrides (leave blank to fall back to the instance defaults),
  plus suspend/unsuspend.
- **All workspaces** — every user's workspaces in one table, with a
  force-delete to reclaim resources from an abandoned container.

### 3. Configure resource limits

Two layers of limits now exist:

- **Per-user quota** (`User.cpuLimit` / `User.memoryLimitMb`, set via the
  admin panel) — overrides the env defaults for that specific user, e.g.
  to give a paying user a bigger plan.
- **Cluster-wide cap** (`MAX_CLUSTER_CPU` / `MAX_CLUSTER_MEMORY_MB` in
  `.env`) — a hard ceiling on total CPU/RAM allocated across *all* live
  workspaces on this host, checked before every new workspace is
  provisioned. This is what actually protects the host from being
  oversubscribed once you have more than a couple of users; set both to
  `0`/blank to disable the check.

### 4. Rate limiting

`AUTH_RATE_LIMIT` (default 20 requests / 15 min) and `API_RATE_LIMIT`
(default 120 requests / min) in `.env` protect a shared instance from
brute-force login attempts and API abuse. Tune these down if you're
running this for the public internet.

## Launch readiness: landing, pricing, onboarding, email

Everything below is aimed at running this as a real product people sign
up for, not just an internal tool.

### Public pages

- **`/`** — marketing landing page (feature grid, CTAs to pricing/signup).
  Logged-in users are redirected straight to `/dashboard`.
- **`/pricing`** — Free / Pro / Team plan cards. These aren't decorative:
  the numbers shown (workspace count, CPU, RAM) are read from
  `frontend/src/plans.js`, which is kept in sync with
  `backend/config/plans.js` — the same numbers actually get applied to a
  new account at registration. Logged-out visitors and the Free plan go
  to signup as before; a logged-in user clicking a paid plan now starts a
  real Stripe Checkout session (see **Billing** below).

### Billing (Stripe)

Real subscription billing, not a stub — `routes/billing.js` +
`services/billingService.js`.

1. Create a Stripe account (test mode is fine to start) and grab the
   secret key: dashboard.stripe.com → Developers → API keys →
   `STRIPE_SECRET_KEY`.
2. Product catalog → create a Product + recurring Price for each paid
   plan → copy each Price's `price_...` ID into `STRIPE_PRICE_PRO` /
   `STRIPE_PRICE_TEAM`.
3. Developers → Webhooks → add endpoint `{BACKEND_URL}/api/billing/webhook`,
   subscribed to `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, and `invoice.payment_failed` → copy
   the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Restart the backend. `/pricing` (for logged-in users) and a "Manage
   billing" button on the dashboard (once a user has a Stripe customer)
   now work end-to-end: Checkout → webhook applies the new plan's quotas
   to the User doc immediately → Customer Portal handles cancel/upgrade/
   payment-method updates without any custom UI on our side.

Test it locally with the Stripe CLI before going live:
`stripe listen --forward-to localhost:4000/api/billing/webhook` (use the
webhook secret it prints, not the dashboard one, while testing this way).

Leaving `STRIPE_SECRET_KEY` unset is fine — checkout/portal just respond
with a clear "billing not configured" error instead of the app crashing.

### Onboarding

New accounts land on `/onboarding` (not straight into an empty
dashboard): pick an image → name and create a workspace → see it come up
→ "Go to dashboard". Each account tracks `onboarded` on the User model,
and there's a "Skip for now" link at every step so it never blocks
someone who just wants to get to the dashboard.

### Transactional email

`backend/services/emailService.js` has three templates, wired in as
follows:

| Email | Triggered by |
|---|---|
| Welcome | `POST /api/auth/register` on success |
| Usage alert | Creating a workspace that puts you at your plan's `maxWorkspaces` limit |
| Payment failed | Nothing yet (see below) — but the template and send function exist |

**Email sending is optional in dev.** If `SMTP_HOST` isn't set in
`.env`, nothing breaks — `sendMail()` logs `[email] would send "..." to
...` to the console instead of throwing, so registration and workspace
creation work fine with zero email config. Set `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` in `.env` to actually send.

**Testing emails without triggering the real event:** as an admin, go to
the Admin panel → Users table → pick a template from the dropdown next
to a user → "Send test". This calls the real template code, so it's a
genuine test of your SMTP config.

**Payment failed / billing:** real Stripe webhook now (see the
**Billing (Stripe)** section above) — `invoice.payment_failed` triggers
this email automatically, with the reason and plan filled in from the
Stripe event.

## Sign in with Google / GitHub

The login page shows "Continue with Google" / "Continue with GitHub"
buttons automatically once you configure the corresponding provider —
nothing to change in the frontend.

### How it works

No `passport` or session dependency — it's a plain OAuth 2.0
authorization-code exchange using Node 20's built-in `fetch`, kept
consistent with the rest of the app's stateless JWT auth:

1. `GET /api/auth/google` (or `/github`) redirects to the provider's
   consent screen, with a random CSRF `state` stored in a short-lived
   httpOnly cookie.
2. The provider redirects back to `GET /api/auth/google/callback`, which
   checks `state`, exchanges the code for an access token, fetches the
   profile/email, and finds-or-creates a `User`.
3. If an account with that email already exists (e.g. originally
   password-based), the provider is **linked** to it rather than
   creating a duplicate — either sign-in method works from then on.
4. The backend issues the same JWT a password login would, and redirects
   to `${APP_URL}/oauth-callback?token=...`, where the frontend stores it
   and continues to onboarding/dashboard exactly like a normal login.

A plan selected on the pricing page carries through OAuth signup too
(same `PLAN_DEFAULTS` as password registration).

### Setup

**Google** — [console.cloud.google.com](https://console.cloud.google.com)
→ APIs & Services → Credentials → **OAuth client ID** (Web application).
Authorized redirect URI: `{BACKEND_URL}/api/auth/google/callback`. Put
the client ID/secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

**GitHub** — [github.com/settings/developers](https://github.com/settings/developers)
→ New OAuth App. Authorization callback URL:
`{BACKEND_URL}/api/auth/github/callback`. Put the client ID/secret in
`.env` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

`BACKEND_URL` must be **publicly reachable** and match exactly what's
registered with each provider — `localhost` only works for testing on
your own machine. Leave a provider's client ID blank to disable it; the
frontend hides that button automatically (`GET /api/auth/oauth-config`).

## Security notes (read before exposing this publicly)

- **Docker socket access = root on the host.** Only the `orchestrator`
  daemon holds `docker.sock` now (not the backend API) - see
  `orchestrator/` and `docs/multi-node.md`. Keep the orchestrator's port
  reachable only from your backend (firewall/private network/VPN), never
  from the public internet, and only run it on a host you fully control.
- Each workspace container runs as a **non-root user**, has **CPU/memory
  limits**, dropped Linux capabilities, and its own **isolated volume**.
  By default that's still plain Docker (`runc`) isolation - fine for
  trusted teams, not for arbitrary strangers' code. For true multi-tenant
  isolation, set `CONTAINER_RUNTIME=runsc` (gVisor) or `kata-runtime`
  (Kata Containers) per orchestrator host - see `docs/gvisor-kata.md`.
- Rotate `JWT_SECRET` and `ORCHESTRATOR_TOKEN` and never commit `.env` to
  git. Rotating `ORCHESTRATOR_TOKEN` requires updating it in both that
  host's orchestrator `.env` and the matching `Host` doc (re-run
  `npm run register:host` in `backend/`).

## Roadmap

**Phase 1** — auth, container provisioning, browser terminal, idle
timeout, resource limits. ✅

**Phase 2** — real VS Code Remote-SSH support: per-workspace `sshd` +
dynamic port mapping, on-demand keypair generation, dashboard "Connect
via SSH" flow, and a VS Code extension for one-click connect. ✅

**Phase 3** — multi-user administration & resource limits:
- Admin panel: cluster overview, per-user role/quota/suspension
  management, cross-user workspace list with force-delete ✅
- Per-user CPU/RAM quota overrides on top of instance-wide defaults ✅
- Cluster-wide CPU/RAM cap enforced before every new workspace is
  provisioned ✅
- Live CPU/RAM gauges on the dashboard (polling the existing `/stats`
  endpoint) ✅
- Account suspension + auth/API rate limiting ✅

**Launch readiness** — landing page, pricing page, onboarding, email:
- Public landing page (`/`) and pricing page (`/pricing`) with plan cards
  tied to real backend quota defaults ✅
- Post-signup onboarding wizard, skippable at every step ✅
- Welcome and usage-alert transactional emails, wired to real events ✅
- Payment-failed email template, now wired to a real Stripe
  `invoice.payment_failed` webhook (see Phase 4) ✅
- Google/GitHub OAuth login, with automatic account linking by email ✅

**Phase 4** — production hardening (architecture-level items done):
- Swap the Docker socket mount for a small privileged "orchestrator"
  daemon, so the main API never touches `docker.sock` directly ✅ (`orchestrator/`)
- Move from plain Docker to gVisor/Kata for real kernel-level isolation
  between untrusted users ✅ (opt-in per host via `CONTAINER_RUNTIME` -
  see `docs/gvisor-kata.md`)
- Integrate a real payment provider against `routes/billing.js` ✅
  (Stripe: checkout, customer portal, webhook-driven subscription
  lifecycle - see `services/billingService.js`)
- Horizontal scaling across multiple Docker hosts (a scheduler picks
  which node gets the next workspace) ✅ (`services/hostRegistry.js`,
  `docs/multi-node.md`)

Still ahead - the smaller gaps from before, plus this phase's own new
production-readiness basics:
- The suspected `CapDrop`/sshd privilege-separation SSH bug is still
  unconfirmed/unfixed
- Stale SSH port shown after a container restart (dashboard doesn't
  re-fetch it)
- Password reset flow, email verification enforcement, "set a password"
  for OAuth-only accounts
- Tests (unit/integration), CI/CD, a production frontend build+serve
  setup (currently `vite dev` only), an HTTPS/TLS guide, error monitoring
  (e.g. Sentry), a MongoDB backup strategy, and Terms/Privacy pages
- No live migration between hosts, no automatic rebalancing after
  creation-time placement, no cross-host failover (see
  `docs/multi-node.md`'s "what this does NOT do")

## Honest limitations right now

- Multi-node scaling exists but is deliberately simple - poll-and-pick
  scheduling at creation time only, no live migration or rebalancing
  (see `docs/multi-node.md`)
- gVisor/Kata support is wired in but you have to install the runtime on
  each host yourself (`docs/gvisor-kata.md`) - it's not on by default
- Stripe billing needs real dashboard setup (API keys, webhook endpoint,
  Price IDs) before it does anything - with `STRIPE_SECRET_KEY` unset,
  checkout/portal just return a clear "not configured" error
- Only one active SSH key per workspace at a time (see "key rotation"
  above) — fine for a single developer, not yet for a shared workspace
- No firewall automation — you must open each host's Docker ephemeral
  port range yourself for remote SSH access to work
- Resizing the terminal (`SIGWINCH`) isn't wired up to `docker exec resize`
  yet — noted as a TODO in `terminalService.js`
- No TLS termination included — put this behind nginx/Caddy with HTTPS
  before exposing it beyond localhost
- The VS Code extension isn't published to the Marketplace — install it
  in dev mode or package it locally with `vsce`
