/**
 * terminalService.js
 *
 * Bridges a browser (xterm.js over WebSocket) to a shell running inside
 * the user's container. Used to live in-process via dockerode; now that
 * docker.sock has moved to the orchestrator daemon (production
 * hardening - see ../../orchestrator/), this has become a two-leg relay:
 *
 *   browser <--ws--> backend (this file) <--ws--> orchestrator <--> docker exec
 *
 * The backend leg still does real user/workspace auth (JWT + ownership +
 * running-status checks) exactly as before; the orchestrator leg is
 * authenticated with the shared ORCHESTRATOR_TOKEN for whichever host
 * this workspace actually lives on (workspace.hostId).
 */
const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');
const Workspace = require('../models/Workspace');
const dockerService = require('./dockerService');

const KEEPALIVE_INTERVAL_MS = 30000; // Send ping every 30 seconds

function attachTerminalServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (req, socket, head) => {
    const { pathname, query } = url.parse(req.url, true);
    if (pathname !== '/ws/terminal') {
      socket.destroy();
      return;
    }

    try {
      const token = query.token;
      const workspaceId = query.workspaceId;
      if (!token || !workspaceId) throw new Error('Missing token or workspaceId');

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const workspace = await Workspace.findById(workspaceId);

      if (!workspace) throw new Error('Workspace not found');
      if (String(workspace.owner) !== payload.sub) throw new Error('Forbidden');
      if (workspace.status !== 'running') throw new Error('Workspace is not running');

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, workspace);
      });
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', async (ws, req, workspace) => {
    let host;
    let upstreamKeepalive;
    
    try {
      host = await dockerService.resolveHostForWorkspace(workspace);
    } catch (err) {
      ws.send(`\r\n[error] ${err.message}\r\n`);
      ws.close();
      return;
    }

    const orchestratorWsUrl =
      host.baseUrl.replace(/^http/, 'ws') +
      `/exec-stream?containerId=${encodeURIComponent(workspace.containerId)}` +
      `&token=${encodeURIComponent(host.token)}`;

    const upstream = new WebSocket(orchestratorWsUrl);
    let upstreamOpen = false;
    const pending = []; // input received from the browser before upstream is ready

    // Start keepalive for upstream connection
    upstreamKeepalive = setInterval(() => {
      if (upstream.readyState === WebSocket.OPEN) {
        try {
          upstream.ping();
        } catch (err) {
          console.error('[terminal] upstream ping failed:', err.message);
        }
      }
    }, KEEPALIVE_INTERVAL_MS);

    upstream.on('open', () => {
      upstreamOpen = true;
      while (pending.length) upstream.send(pending.shift());
    });

    // container -> orchestrator -> browser
    upstream.on('message', (chunk) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(chunk);
        } catch (err) {
          console.error('[terminal] ws send error:', err.message);
        }
      }
    });

    upstream.on('pong', () => {
      // Keepalive pong received
    });

    upstream.on('close', () => {
      clearInterval(upstreamKeepalive);
      try {
        ws.close();
      } catch {
        // already closed
      }
    });

    upstream.on('error', (err) => {
      console.error('[terminal] upstream error:', err.message);
      ws.send(`\r\n[error] lost connection to workspace host: ${err.message}\r\n`);
      clearInterval(upstreamKeepalive);
      try {
        ws.close();
      } catch {
        // already closed
      }
    });

    // browser -> orchestrator -> container
    ws.on('message', (msg) => {
      try {
        // Update workspace lastActiveAt on any terminal input
        workspace.lastActiveAt = new Date();
        workspace.save().catch((err) => {
          console.error('[terminal] failed to update lastActiveAt:', err.message);
        });

        const parsed = JSON.parse(msg);
        if (parsed.type === 'resize') {
          // exec resize would need the orchestrator to expose an inspect
          // endpoint; omitted here for brevity, same as before the split.
          return;
        }
        if (parsed.type === 'input') {
          if (upstreamOpen) upstream.send(parsed.data);
          else pending.push(parsed.data);
          return;
        }
      } catch {
        // fallback: raw text input
      }
      if (upstreamOpen) upstream.send(msg);
      else pending.push(msg);
    });

    ws.on('pong', () => {
      // Browser sent pong in response to our ping
    });

    ws.on('close', () => {
      clearInterval(upstreamKeepalive);
      try {
        upstream.close();
      } catch {
        // already closed
      }
    });

    ws.on('error', (err) => {
      console.error('[terminal] ws error:', err.message);
      clearInterval(upstreamKeepalive);
    });
  });
}

module.exports = { attachTerminalServer };
