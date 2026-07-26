/**
 * services/dockerService.js
 *
 * IMPORTANT: this file no longer touches Docker or docker.sock at all.
 * It's now a thin HTTP client for the orchestrator daemon(s) (see
 * ../../orchestrator/) - the backend process has zero Docker privileges,
 * which was the whole point of splitting the orchestrator out (item #2,
 * production hardening). Function names/shapes are kept close to the old
 * in-process version to minimize churn in callers, with one deliberate
 * change: functions that act on an existing container now take the
 * `workspace` document (not just a containerId string), because we need
 * workspace.hostId to know which orchestrator/Docker host to call - see
 * models/Workspace.js and services/hostRegistry.js.
 */
const hostRegistry = require('./hostRegistry');

// Purely a client-side whitelist for the "available images" dropdown -
// doesn't require Docker access, so it's still read directly from env
// here rather than round-tripping to an orchestrator. Keep this in sync
// with each orchestrator's own ALLOWED_IMAGES (see docs/multi-node.md).
const ALLOWED_IMAGES = (process.env.ALLOWED_IMAGES || 'cloud-dev-base:latest')
  .split(',')
  .map((s) => s.trim());

// Retry strategy: exponential backoff with jitter
async function retryWithBackoff(fn, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        // Only retry on network/timeout errors, not on validation errors
        if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
          throw err; // Don't retry client errors
        }
        const delayMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 10000);
        console.log(`[dockerService] Retrying (attempt ${attempt + 1}/${maxRetries}) after ${delayMs}ms:`, err.message);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

async function callHost(host, path, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${host.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Orchestrator-Token': host.token,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const wrapped = new Error(
      `Could not reach orchestrator host "${host.name}" (${host.baseUrl}): ${err.message}`
    );
    wrapped.statusCode = 503;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Orchestrator request failed (${res.status})`);
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

/**
 * Picks the least-loaded registered host (see hostRegistry.pickHost) and
 * provisions the container there. Returns hostId alongside the usual
 * container fields so the caller can persist it on the Workspace doc -
 * every later operation for this workspace must go back to this host.
 */
async function createWorkspaceContainer({ workspaceId, image, cpuLimit, memoryLimitMb, repoUrl }) {
  // Create operations are longer and should retry on transient failures
  return retryWithBackoff(async () => {
    const host = await hostRegistry.pickHost();
    return callHost(host, '/containers', {
      method: 'POST',
      body: { workspaceId, image, cpuLimit, memoryLimitMb, repoUrl },
      timeoutMs: 60000, // image pull + container start can be slow on a cold host
    }).then((result) => ({ ...result, hostId: host._id.toString() }));
  }, 2); // Only retry once for creation (image pulls are slow)
}

async function stopContainer(workspace) {
  const host = await hostRegistry.getHostById(workspace.hostId);
  return retryWithBackoff(() =>
    callHost(host, `/containers/${workspace.containerId}/stop`, { method: 'POST' }), 3
  );
}

async function startContainer(workspace) {
  const host = await hostRegistry.getHostById(workspace.hostId);
  return retryWithBackoff(() =>
    callHost(host, `/containers/${workspace.containerId}/start`, { method: 'POST' }), 3
  );
}

async function removeContainer(workspace, { removeVolume = true } = {}) {
  const host = await hostRegistry.getHostById(workspace.hostId);
  const qs = new URLSearchParams({
    removeVolume: String(removeVolume),
    workspaceId: workspace._id ? String(workspace._id) : '',
  });
  return retryWithBackoff(() =>
    callHost(host, `/containers/${workspace.containerId}?${qs.toString()}`, { method: 'DELETE' }), 3
  );
}

async function setupSSHAccess(workspace) {
  const host = await hostRegistry.getHostById(workspace.hostId);
  return retryWithBackoff(() =>
    callHost(host, `/containers/${workspace.containerId}/ssh-setup`, { method: 'POST' }), 2
  );
}

async function getContainerStats(workspace) {
  const host = await hostRegistry.getHostById(workspace.hostId);
  return retryWithBackoff(() =>
    callHost(host, `/containers/${workspace.containerId}/stats`), 2
  );
}

async function getSSHPort(workspace) {
  const host = await hostRegistry.getHostById(workspace.hostId);
  const { sshPort } = await retryWithBackoff(() =>
    callHost(host, `/containers/${workspace.containerId}/ssh-port`), 2
  );
  return sshPort;
}

/**
 * Used by terminalService.js to know which orchestrator to open the
 * exec-stream WebSocket against.
 */
async function resolveHostForWorkspace(workspace) {
  return hostRegistry.getHostById(workspace.hostId);
}

module.exports = {
  ALLOWED_IMAGES,
  createWorkspaceContainer,
  stopContainer,
  startContainer,
  removeContainer,
  setupSSHAccess,
  getContainerStats,
  getSSHPort,
  resolveHostForWorkspace,
};
