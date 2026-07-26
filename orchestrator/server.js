/**
 * orchestrator/server.js
 *
 * Privileged daemon. Runs one per Docker host. Owns docker.sock
 * exclusively - nothing else in the system should have it mounted.
 * The main backend (backend/services/dockerService.js) talks to this
 * over HTTP (control operations) and WebSocket (interactive exec/
 * terminal streaming), authenticated with ORCHESTRATOR_TOKEN.
 *
 * Deploy: one container/VM per Docker host you want to schedule
 * workspaces onto. Register each instance's URL + token with the
 * backend via `npm run register:host` (see backend/scripts/registerHost.js)
 * to enable multi-node scaling.
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const url = require('url');
const rateLimit = require('express-rate-limit');

const { requireOrchestratorToken } = require('./middleware/auth');
const dockerService = require('./services/dockerService');

const app = express();
app.use(express.json());

// Rate limit for the public /health endpoint to prevent DDoS
const healthLimiter = rateLimit({
  windowMs: 1000,
  limit: 50, // Very loose - one per 20ms is fine for polling
  standardHeaders: true,
  legacyHeaders: false,
});

// Unauthenticated - the scheduler polls this frequently to pick the
// least-loaded host, and it's harmless (no secrets, no control).
app.get('/health', healthLimiter, async (req, res) => {
  try {
    const load = await dockerService.getHostLoad();
    res.json({ ok: true, ...load });
  } catch (err) {
    console.error('[orchestrator] /health error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use(requireOrchestratorToken);

app.post('/containers', async (req, res) => {
  try {
    const result = await dockerService.createWorkspaceContainer(req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('[orchestrator] /containers POST error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/containers/:id/stop', async (req, res) => {
  try {
    await dockerService.stopContainer(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[orchestrator] /containers/:id/stop error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/containers/:id/start', async (req, res) => {
  try {
    await dockerService.startContainer(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[orchestrator] /containers/:id/start error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/containers/:id', async (req, res) => {
  try {
    await dockerService.removeContainer(req.params.id, {
      removeVolume: req.query.removeVolume !== 'false',
      workspaceId: req.query.workspaceId,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[orchestrator] /containers/:id DELETE error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/containers/:id/stats', async (req, res) => {
  try {
    const stats = await dockerService.getContainerStats(req.params.id);
    res.json(stats);
  } catch (err) {
    console.error('[orchestrator] /containers/:id/stats error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/containers/:id/ssh-port', async (req, res) => {
  try {
    const sshPort = await dockerService.getSSHPort(req.params.id);
    res.json({ sshPort });
  } catch (err) {
    console.error('[orchestrator] /containers/:id/ssh-port error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/containers/:id/ssh-setup', async (req, res) => {
  try {
    const { privateKey } = await dockerService.setupSSHAccess(req.params.id);
    res.json({ privateKey });
  } catch (err) {
    console.error('[orchestrator] /containers/:id/ssh-setup error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/containers/:id/exec', async (req, res) => {
  try {
    const output = await dockerService.execInContainer(req.params.id, req.body.cmd);
    res.json({ output });
  } catch (err) {
    console.error('[orchestrator] /containers/:id/exec error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error('[orchestrator] unhandled error:', err);
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal error' });
});

const server = http.createServer(app);

// Interactive terminal bridge. The backend's terminalService.js opens a
// browser<->orchestrator WS pair per session; this is the second leg
// (orchestrator<->docker exec). Auth is the same shared token, passed as
// a query param since browsers can't set custom headers on WS upgrade -
// but the caller here is always the backend, never the browser directly,
// so the token never reaches the client.
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname, query } = url.parse(req.url, true);
  if (pathname !== '/exec-stream') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  if (query.token !== process.env.ORCHESTRATOR_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  if (!query.containerId) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, query.containerId);
  });
});

wss.on('connection', async (ws, containerId) => {
  let dockerStream;
  try {
    const session = await dockerService.createExecSession(containerId);
    dockerStream = session.stream;
  } catch (err) {
    console.error('[orchestrator] exec session creation failed:', err.message);
    ws.send(`\r\n[error] could not attach to container: ${err.message}\r\n`);
    ws.close();
    return;
  }

  dockerStream.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(chunk);
      } catch (err) {
        console.error('[orchestrator] WS send error:', err.message);
      }
    }
  });
  
  dockerStream.on('end', () => {
    try {
      ws.close();
    } catch (err) {
      // socket already closed
    }
  });
  
  dockerStream.on('error', (err) => {
    console.error('[orchestrator] docker stream error:', err.message);
    try {
      ws.close();
    } catch {
      // socket already closed
    }
  });

  ws.on('message', (msg) => {
    try {
      dockerStream.write(msg);
    } catch (err) {
      console.error('[orchestrator] stream write error:', err.message);
      // stream already closed
    }
  });

  ws.on('close', () => {
    try {
      dockerStream.end();
    } catch {
      // already closed
    }
  });

  ws.on('error', (err) => {
    console.error('[orchestrator] WS error:', err.message);
  });
});

const PORT = process.env.ORCHESTRATOR_PORT || 5001;
server.listen(PORT, () => {
  console.log(`[orchestrator] listening on port ${PORT} (runtime=${process.env.CONTAINER_RUNTIME || 'runc'})`);
});
