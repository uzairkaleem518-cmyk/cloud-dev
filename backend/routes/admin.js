/**
 * routes/admin.js
 *
 * Phase 3 addition. Everything here requires an authenticated admin
 * (requireAuth + requireAdmin, wired in server.js). This is what turns
 * "multi-user auth" from just login/JWT into something an operator can
 * actually run a shared instance with: see who's using what, adjust
 * per-user quotas, suspend accounts, and reclaim resources from any
 * workspace - not just your own.
 */
const express = require('express');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const dockerService = require('../services/dockerService');
const hostRegistry = require('../services/hostRegistry');
const { sendWelcomeEmail, sendUsageAlertEmail, sendPaymentFailedEmail } = require('../services/emailService');

const router = express.Router();

const ACTIVE_STATUSES = ['creating', 'running', 'stopped'];

function clusterCaps() {
  return {
    maxCpu: Number(process.env.MAX_CLUSTER_CPU) || null,
    maxMemoryMb: Number(process.env.MAX_CLUSTER_MEMORY_MB) || null,
  };
}

// Cluster-wide snapshot: how many users, how many workspaces, and how
// much CPU/RAM is currently allocated vs. the configured cap.
router.get('/overview', async (req, res) => {
  try {
    const [userCount, workspaces] = await Promise.all([
      User.countDocuments(),
      Workspace.find({ status: { $in: ['creating', 'running'] } }),
    ]);

    const allocatedCpu = workspaces.reduce((sum, w) => sum + (w.cpuLimit || 0), 0);
    const allocatedMemoryMb = workspaces.reduce((sum, w) => sum + (w.memoryLimitMb || 0), 0);

    const [runningCount, totalWorkspaceCount] = await Promise.all([
      Workspace.countDocuments({ status: 'running' }),
      Workspace.countDocuments({ status: { $ne: 'deleted' } }),
    ]);

    res.json({
      userCount,
      totalWorkspaceCount,
      runningCount,
      allocatedCpu,
      allocatedMemoryMb,
      ...clusterCaps(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List every user with their current workspace count, for the admin table.
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    const counts = await Workspace.aggregate([
      { $match: { status: { $ne: 'deleted' } } },
      { $group: { _id: '$owner', count: { $sum: 1 } } },
    ]);
    const countByOwner = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));

    res.json({
      users: users.map((u) => ({
        ...u.toSafeObject(),
        workspaceCount: countByOwner[String(u._id)] || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a user's role, quota, or suspension state. Admins can't demote
// or suspend themselves by accident through this endpoint.
router.patch('/users/:id', async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ error: "You can't modify your own admin account here" });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { role, maxWorkspaces, cpuLimit, memoryLimitMb, suspended } = req.body;

    if (role !== undefined) {
      if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'role must be "user" or "admin"' });
      }
      user.role = role;
    }
    if (maxWorkspaces !== undefined) user.maxWorkspaces = Math.max(0, Number(maxWorkspaces));
    if (cpuLimit !== undefined) user.cpuLimit = cpuLimit === null || cpuLimit === '' ? null : Number(cpuLimit);
    if (memoryLimitMb !== undefined) {
      user.memoryLimitMb = memoryLimitMb === null || memoryLimitMb === '' ? null : Number(memoryLimitMb);
    }
    if (suspended !== undefined) user.suspended = Boolean(suspended);

    await user.save();
    res.json({ user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List every workspace across every user (with owner email attached),
// for the admin to audit or reclaim resources from.
router.get('/workspaces', async (req, res) => {
  try {
    const workspaces = await Workspace.find({ status: { $ne: 'deleted' } })
      .populate('owner', 'email name')
      .sort({ createdAt: -1 });

    res.json({
      workspaces: workspaces.map((w) => ({
        ...w.toSafeObject(),
        owner: w.owner ? { id: w.owner._id, email: w.owner.email, name: w.owner.name } : null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force-delete any user's workspace (e.g. to reclaim resources from an
// abandoned or over-quota container). Same teardown path as the owner's
// own delete route.
router.delete('/workspaces/:id', async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace || workspace.status === 'deleted') {
      return res.status(404).json({ error: 'Workspace not found' });
    }

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

// Send a test email to any user, using the real templates. Handy for
// verifying SMTP_* is configured correctly without waiting for a real
// registration/usage-limit/payment event to trigger it.
router.post('/users/:id/test-email', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { type } = req.body;
    let result;
    if (type === 'welcome') {
      result = await sendWelcomeEmail(user);
    } else if (type === 'usage_alert') {
      result = await sendUsageAlertEmail(user, { used: user.maxWorkspaces, limit: user.maxWorkspaces, resource: 'workspaces' });
    } else if (type === 'payment_failed') {
      result = await sendPaymentFailedEmail(user, { reason: 'this is a test email', plan: user.plan });
    } else {
      return res.status(400).json({ error: 'type must be one of: welcome, usage_alert, payment_failed' });
    }

    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Multi-node cluster status: every registered orchestrator host, its
// live load (polled just now), and reachability. Used by the admin
// panel to show where workspaces are actually landing and to spot a
// dead/unreachable host before users hit "no hosts available" errors.
router.get('/hosts', async (req, res) => {
  try {
    const status = await hostRegistry.getClusterStatus();
    res.json({
      hosts: status.map(({ host, live }) => ({
        ...host,
        reachable: Boolean(live && live.ok),
        currentLoad: live && live.ok ? live : null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
