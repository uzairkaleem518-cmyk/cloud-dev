# Multi-node scaling

Before this, every workspace container ran on the one Docker host the
backend's container happened to be on. That's fine until that host runs
out of CPU/RAM. This adds a thin scheduling layer so workspaces can be
spread across multiple Docker hosts.

## How it works

- `orchestrator/` is a small daemon that owns `docker.sock`. You run one
  instance **per Docker host** you want to schedule workspaces onto.
- The backend keeps a `Host` collection in MongoDB (one doc per
  orchestrator instance/host) - see `backend/models/Host.js`.
- `backend/services/hostRegistry.js#pickHost()` is the scheduler: on
  every workspace create, it polls `GET /health` on each active host,
  scores by free CPU% + free memory%, and picks the winner.
- The chosen host's `_id` is saved on the `Workspace` doc
  (`workspace.hostId`) and never changes - every later action for that
  workspace (start/stop/delete/terminal/SSH/stats) is routed back to the
  same host, because that's physically where the container and its
  volume live.

This is deliberately simple (poll-and-pick, no bin-packing/affinity/
draining mid-flight) - it scales to a handful of hosts, which covers
"outgrew one box" without pulling in a real cluster scheduler.

## Adding a second host

1. On the new host, install Docker, then run just the orchestrator
   (you don't need `mongo`/`backend` there - they stay wherever your
   primary instance lives):

   ```bash
   git clone <your repo> && cd cloud-dev-env/orchestrator
   cp .env.example .env
   # Generate a unique token for THIS host - do not reuse the primary's
   openssl rand -hex 32   # paste into ORCHESTRATOR_TOKEN in .env
   docker build -t cde-orchestrator .
   docker run -d --restart unless-stopped -p 5001:5001 \
     --env-file .env \
     -v /var/run/docker.sock:/var/run/docker.sock \
     cde-orchestrator
   ```

   Also pull/build the workspace images (`cloud-dev-base`,
   `cloud-dev-node`, `cloud-dev-python`) on this host - each host needs
   its own local copies, containers can't run on images that only exist
   on a different host.

2. Make sure the new host's port 5001 is reachable from wherever your
   `backend` runs, but **not** from the public internet (it holds
   Docker-equivalent power) - firewall it to the backend's IP only, or
   put it on a private network/VPN between hosts.

3. Register it with the backend:

   ```bash
   docker compose exec backend npm run register:host -- \
     gpu-host-1 http://<new-host-ip>:5001 <the token you generated>
   ```

4. Done - the next workspace creation will consider this host too. Check
   `GET /api/admin/hosts` (or the admin panel) to confirm it shows up as
   reachable.

## Draining a host

To stop new workspaces landing on a host without touching workspaces
already running there (e.g. before maintenance):

```bash
docker compose exec backend npm run register:host -- gpu-host-1 --deactivate
```

Re-run the full `register:host <name> <url> <token>` form to reactivate it.

## What this does NOT do

- No live migration of a running workspace between hosts - deleting and
  recreating it is currently the only way to "move" one.
- No automatic rebalancing of existing workspaces if a host becomes
  overloaded after they were placed - the scheduler only runs at
  creation time.
- No cross-host failover - if the host a specific workspace lives on
  goes down, that workspace is down until the host comes back (other
  hosts are unaffected, and new workspaces just avoid the dead host
  since `pickHost()` skips unreachable ones).
