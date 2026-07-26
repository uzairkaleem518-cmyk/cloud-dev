const express = require('express');
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const { requireAuth } = require('../middleware/auth');
const dockerService = require('../services/dockerService');
const { sendUsageAlertEmail } = require('../services/emailService');

const router = express.Router();
router.use(requireAuth);

// List current user's workspaces
router.get('/', async (req, res) => {
  try {
    const workspaces = await Workspace.find({ owner: req.user._id, status: { $ne: 'deleted' } });
    res.json({ workspaces: workspaces.map((w) => w.toSafeObject()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Available images user can pick from
router.get('/images', (req, res) => {
  res.json({ images: dockerService.ALLOWED_IMAGES });
});

// Validate workspace name length and format
function validateWorkspaceName(name) {
  if (!name || !name.trim()) return false;
  if (name.length > 100) return false;
  return true;
}

// Validate repo URL format - must be a valid git URL
function isValidRepoUrl(url) {
  if (!url) return true; // optional field
  try {
    // Allow git://, https://, ssh://, git@, and local paths
    return /^(git:\/\/|https:\/\/|ssh:\/\/|git@|file:\/\/|\/|~)/.test(url);
  } catch {
    return false;
  }
}

// Create + provision a new workspace
router.post('/', async (req, res) => {
  try {
    const { name, image, repoUrl } = req.body;
    
    if (!name || !image) {
      return res.status(400).json({ error: 'name and image are required' });
    }
    
    if (!validateWorkspaceName(name)) {
      return res.status(400).json({ error: 'workspace name must be 1-100 characters' });
    }
    
    if (repoUrl && !isValidRepoUrl(repoUrl)) {
      return res.status(400).json({ 
        error: 'repoUrl must be a valid git URL (git://, https://, ssh://, git@, or local path)' 
      });
    }

    const activeCount = await Workspace.countDocuments({
      owner: req.user._id,
      status: { $ne: 'deleted' },
    });
    if (activeCount >= req.user.maxWorkspaces) {
      return res.status(403).json({
        error: `Workspace limit reached (${req.user.maxWorkspaces}). Delete one to create another.`,
      });
    }

    // Per-user quota overrides win over the instance-wide defaults, so an
    // admin can grant a bigger plan to specific users (see routes/admin.js).
    const cpuLimit = req.user.cpuLimit ?? (Number(process.env.WORKSPACE_CPU_LIMIT) || 1);
    const memoryLimitMb =
      req.user.memoryLimitMb ?? (Number(process.env.WORKSPACE_MEMORY_LIMIT_MB) || 1024);

    // Cluster-wide guardrail: don't let total allocated CPU/RAM across all
    // live workspaces exceed what this host actually has, regardless of
    // per-user quotas. Only enforced if the caps are configured.
    const maxClusterCpu = Number(process.env.MAX_CLUSTER_CPU) || null;
    const maxClusterMemoryMb = Number(process.env.MAX_CLUSTER_MEMORY_MB) || null;
    if (maxClusterCpu || maxClusterMemoryMb) {
      const live = await Workspace.find({ status: { $in: ['creating', 'running'] } });
      const allocatedCpu = live.reduce((sum, w) => sum + (w.cpuLimit || 0), 0);
      const allocatedMemoryMb = live.reduce((sum, w) => sum + (w.memoryLimitMb || 0), 0);

      if (maxClusterCpu && allocatedCpu + cpuLimit > maxClusterCpu) {
        return res.status(503).json({
          error: 'This host is at capacity (CPU). Try again later or ask an admin to free up resources.',
        });
      }
      if (maxClusterMemoryMb && allocatedMemoryMb + memoryLimitMb > maxClusterMemoryMb) {
        return res.status(503).json({
          error: 'This host is at capacity (memory). Try again later or ask an admin to free up resources.',
        });
      }
    }

    const workspace = new Workspace({
      owner: req.user._id,
      name: name.trim(),
      image,
      repoUrl: repoUrl || '',
      cpuLimit,
      memoryLimitMb,
      idleTimeoutMinutes: Number(process.env.WORKSPACE_IDLE_TIMEOUT_MINUTES) || 30,
      status: 'creating',
    });
    await workspace.save();

    try {
      const { containerId, containerName, sshPort, hostId } = await dockerService.createWorkspaceContainer({
        workspaceId: workspace._id.toString(),
        image,
        cpuLimit: workspace.cpuLimit,
        memoryLimitMb: workspace.memoryLimitMb,
        repoUrl: repoUrl || '',
      });

      workspace.containerId = containerId;
      workspace.containerName = containerName;
      workspace.sshPort = sshPort;
      workspace.hostId = hostId;
      workspace.status = 'running';
      workspace.lastActiveAt = new Date();
      await workspace.save();
    } catch (provisionErr) {
      workspace.status = 'error';
      await workspace.save();
      return res.status(500).json({ error: `Provisioning failed: ${provisionErr.message}` });
    }

    res.status(201).json({ workspace: workspace.toSafeObject() });

    // Fire-and-forget - response has already gone out above, so a slow
    // mail server can't delay workspace creation. activeCount was the
    // count *before* this workspace, so +1 reflects the new total.
    if (activeCount + 1 >= req.user.maxWorkspaces) {
      sendUsageAlertEmail(req.user, {
        used: activeCount + 1,
        limit: req.user.maxWorkspaces,
        resource: 'workspaces',
      }).catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate workspace ID and ownership
async function findOwnedWorkspace(req, res) {
  try {
    // Validate ObjectId format first
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: 'Workspace not found' });
      return null;
    }
    
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace || workspace.status === 'deleted') {
      res.status(404).json({ error: 'Workspace not found' });
      return null;
    }
    if (String(workspace.owner) !== String(req.user._id)) {
      res.status(403).json({ error: 'Not your workspace' });
      return null;
    }
    return workspace;
  } catch (err) {
    res.status(500).json({ error: err.message });
    return null;
  }
}

router.post('/:id/start', async (req, res) => {
  const workspace = await findOwnedWorkspace(req, res);
  if (!workspace) return;
  try {
    await dockerService.startContainer(workspace);
    workspace.status = 'running';
    workspace.lastActiveAt = new Date();
    workspace.sshPort = await dockerService.getSSHPort(workspace);
    await workspace.save();
    res.json({ workspace: workspace.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/stop', async (req, res) => {
  const workspace = await findOwnedWorkspace(req, res);
  if (!workspace) return;
  try {
    await dockerService.stopContainer(workspace);
    workspace.status = 'stopped';
    await workspace.save();
    res.json({ workspace: workspace.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const workspace = await findOwnedWorkspace(req, res);
  if (!workspace) return;
  try {
    if (workspace.containerId) {
      await dockerService.removeContainer(workspace, { removeVolume: true });
    }
    workspace.status = 'deleted';
    await workspace.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Generates a fresh SSH keypair, installs the public key into the running
 * container, and returns everything needed for VS Code Remote-SSH (or a
 * plain `ssh` command) to connect. The private key is returned exactly
 * once here and is never stored server-side - save it now or request a
 * new one (which invalidates the old one).
 */
router.post('/:id/ssh-connect', async (req, res) => {
  const workspace = await findOwnedWorkspace(req, res);
  if (!workspace) return;

  if (workspace.status !== 'running') {
    return res.status(400).json({ error: 'Start the workspace before connecting' });
  }
  if (!workspace.sshPort) {
    return res.status(500).json({ error: 'No SSH port allocated for this workspace' });
  }

  try {
    const { privateKey } = await dockerService.setupSSHAccess(workspace);
    workspace.lastActiveAt = new Date();
    await workspace.save();

    const host = process.env.SSH_HOST || req.hostname;
    res.json({
      host,
      port: workspace.sshPort,
      username: workspace.sshUsername,
      privateKey,
      remotePath: '/home/dev/workspace',
      sshConfigSnippet: [
        `Host forge-${workspace._id}`,
        `  HostName ${host}`,
        `  Port ${workspace.sshPort}`,
        `  User ${workspace.sshUsername}`,
        `  IdentityFile ~/.forge/keys/${workspace._id}`,
        `  StrictHostKeyChecking accept-new`,
      ].join('\n'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/stats', async (req, res) => {
  const workspace = await findOwnedWorkspace(req, res);
  if (!workspace) return;
  if (workspace.status !== 'running') {
    return res.status(400).json({ error: 'Workspace is not running' });
  }
  try {
    const stats = await dockerService.getContainerStats(workspace);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
