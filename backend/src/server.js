require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const connectDB = require('../config/db');
const authRoutes = require('../routes/auth');
const oauthRoutes = require('../routes/oauth');
const workspaceRoutes = require('../routes/workspaces');
const adminRoutes = require('../routes/admin');
const billingRoutes = require('../routes/billing');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { attachTerminalServer } = require('../services/terminalService');
const { startIdleReaper } = require('../services/idleReaper');

function createApp() {
  const app = express();

  const corsOptions = {
    origin: process.env.APP_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };

  app.use(cors(corsOptions));
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (req, res) => res.json({ ok: true }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth attempts. Please wait a few minutes and try again.' },
    skip: (req) => req.method === 'GET',
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.API_RATE_LIMIT) || 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/auth', authLimiter, oauthRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api/admin', requireAuth, requireAdmin, adminRoutes);
  app.use('/api/billing', billingRoutes);

  app.use((err, req, res, next) => {
    console.error('[server] error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

function startServer(port = process.env.PORT || 4000) {
  const app = createApp();
  const server = http.createServer(app);
  attachTerminalServer(server);

  return connectDB()
    .then(() => new Promise((resolve, reject) => {
      server.listen(port, () => {
        console.log(`[server] listening on port ${port}`);
        startIdleReaper();
        resolve(server);
      });
      server.on('error', reject);
    }))
    .catch((err) => {
      console.error('[server] failed to connect to database:', err.message || err);
      process.exit(1);
    });
}

module.exports = { createApp, startServer };
module.exports.default = module.exports;