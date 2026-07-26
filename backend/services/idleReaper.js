/**
 * idleReaper.js
 *
 * Periodically stops workspaces that have been idle past their timeout,
 * so a forgotten container doesn't burn CPU/RAM (and cloud cost) forever.
 * "Idle" here = no terminal activity recorded via lastActiveAt.
 */
const Workspace = require('../models/Workspace');
const dockerService = require('./dockerService');

function startIdleReaper({ intervalMs = 5 * 60 * 1000 } = {}) {
  setInterval(async () => {
    try {
      const runningWorkspaces = await Workspace.find({ status: 'running' }).catch((err) => {
        console.error('[idleReaper] Failed to fetch workspaces:', err.message);
        return [];
      });
      
      const now = Date.now();

      for (const ws of runningWorkspaces) {
        try {
          const lastActiveTime = new Date(ws.lastActiveAt || ws.createdAt).getTime();
          const idleMs = now - lastActiveTime;
          const timeoutMs = (ws.idleTimeoutMinutes || 240) * 60 * 1000;

          if (idleMs > timeoutMs) {
            console.log(
              `[idleReaper] Stopping idle workspace ${ws._id} (${ws.name}) - ` +
              `idle for ${Math.round(idleMs / 60000)}min (timeout: ${ws.idleTimeoutMinutes}min)`
            );
            
            try {
              await dockerService.stopContainer(ws);
              ws.status = 'stopped';
              await ws.save().catch((err) => {
                console.error(`[idleReaper] Failed to save stopped status for ${ws._id}:`, err.message);
              });
            } catch (stopErr) {
              console.error(
                `[idleReaper] Failed to stop workspace ${ws._id}:`,
                stopErr.statusCode ? `HTTP ${stopErr.statusCode}` : stopErr.message
              );
              // Don't mark as stopped if docker operation failed - let it retry next interval
            }
          }
        } catch (itemErr) {
          console.error(`[idleReaper] Error processing workspace ${ws._id}:`, itemErr.message);
          // Continue with next workspace
        }
      }
    } catch (err) {
      console.error('[idleReaper] tick error:', err.message);
      // Continue looping - don't let a single error stop the reaper
    }
  }, intervalMs);

  console.log(`[idleReaper] started, checking every ${intervalMs / 1000}s`);
}

module.exports = { startIdleReaper };
