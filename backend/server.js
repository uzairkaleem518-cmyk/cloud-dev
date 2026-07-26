require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const oauthRoutes = require('./routes/oauth');
const workspaceRoutes = require('./routes/workspaces');
const adminRoutes = require('./routes/admin');
const billingRoutes = require('./routes/billing');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const { attachTerminalServer } = require('./services/terminalService');
const { startIdleReaper } = require('./services/idleReaper');

const app = express();

// Configure CORS - restrict to frontend URL in production
const corsOptions = {
  origin: process.env.APP_URL || 'http://localhost:5173',
  credentials: true, // allow cookies
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));

// Stripe webhook needs the raw, unparsed body to verify its signature
// (see services/billingService.js#verifyWebhookSignature) - this MUST
// be registered before express.json() below, and only for this one
// exact path, or Stripe's signature check will always fail.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));

// Multi-user hardening: auth endpoints are the main brute-force target on
// a shared instance, so they get a tighter, dedicated limiter. Everything
// else under /api gets a looser general limiter.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Please wait a few minutes and try again.' },
  skip: (req) => req.method === 'GET', // Don't rate limit GET requests (oauth-config, etc.)
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

// Central error handler (catches anything not handled in routes)
app.use((err, req, res, next) => {
  console.error('[server] error:', err);
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
});

const server = http.createServer(app);
attachTerminalServer(server); // upgrades /ws/terminal connections

const PORT = process.env.PORT || 4000;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`[server] listening on port ${PORT}`);
    startIdleReaper();
  });
}).catch((err) => {
  console.error('[server] failed to connect to database:', err.message);
  process.exit(1);
});
