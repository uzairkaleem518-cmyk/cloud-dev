/**
 * services/hostRegistry.js
 *
 * Multi-node scaling. Each registered Host doc is one orchestrator daemon
 * instance = one Docker host workspaces can be scheduled onto. pickHost()
 * is the whole scheduler: it polls every active host's /health, scores
 * by free CPU/RAM, and returns the least-loaded one. New workspaces call
 * pickHost() once at creation time and their Workspace doc remembers
 * which host it landed on (see models/Workspace.js#hostId) - every
 * subsequent operation for that workspace (start/stop/exec/stats) is
 * routed back to that same host, since that's where the container and
 * its volume actually live.
 *
 * This is intentionally simple (poll + greedy pick) rather than a full
 * scheduler with bin-packing/affinity/taints - reasonable for the scale
 * a handful of Docker hosts need, and easy to reason about. Swap this
 * file out first if that ever stops being true.
 */
const Host = require('../models/Host');

const HEALTH_TIMEOUT_MS = 3000;

async function fetchWithTimeout(url, options = {}, timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pingHost(host) {
  try {
    const res = await fetchWithTimeout(`${host.baseUrl}/health`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // host unreachable/down - scheduler just skips it
  }
}

async function listActiveHosts() {
  return Host.find({ active: true });
}

/**
 * Polls every active host and picks the one with the most free capacity
 * (CPU% free + memory% free, unweighted). Persists the load snapshot on
 * the Host doc so the admin panel can show it without a live poll.
 */
async function pickHost() {
  const hosts = await listActiveHosts();
  if (hosts.length === 0) {
    const err = new Error(
      'No orchestrator hosts are registered. Run `npm run register:host` in backend/ to add one.'
    );
    err.statusCode = 503;
    throw err;
  }

  const scored = [];
  for (const host of hosts) {
    const load = await pingHost(host);
    if (!load || !load.ok) continue;

    host.lastSeenAt = new Date();
    host.lastLoad = {
      totalCpus: load.totalCpus,
      totalMemoryMb: load.totalMemoryMb,
      allocatedCpu: load.allocatedCpu,
      allocatedMemoryMb: load.allocatedMemoryMb,
      runningWorkspaces: load.runningWorkspaces,
      runtime: load.runtime,
    };
    await host.save();

    const cpuFreeRatio = 1 - load.allocatedCpu / Math.max(load.totalCpus, 1);
    const memFreeRatio = 1 - load.allocatedMemoryMb / Math.max(load.totalMemoryMb, 1);
    scored.push({ host, score: cpuFreeRatio + memFreeRatio });
  }

  if (scored.length === 0) {
    const err = new Error('No orchestrator hosts are currently reachable.');
    err.statusCode = 503;
    throw err;
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0].host;
}

async function getHostById(hostId) {
  if (!hostId) {
    const err = new Error('This workspace has no host assigned (created before multi-node support?)');
    err.statusCode = 500;
    throw err;
  }
  const host = await Host.findById(hostId);
  if (!host) {
    const err = new Error('The host this workspace was created on is no longer registered.');
    err.statusCode = 500;
    throw err;
  }
  return host;
}

async function getClusterStatus() {
  const hosts = await listActiveHosts();
  const results = await Promise.all(
    hosts.map(async (host) => ({
      host: host.toSafeObject(),
      live: await pingHost(host),
    }))
  );
  return results;
}

module.exports = { pickHost, getHostById, listActiveHosts, getClusterStatus, pingHost };
