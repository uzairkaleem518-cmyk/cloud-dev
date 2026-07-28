const express = require('express');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { resolvePlan, PLAN_DEFAULTS } = require('../config/plans');
const { sendWelcomeEmail } = require('../services/emailService');
const { signToken } = require('../utils/token');

const router = express.Router();

// Validate email format (RFC 5322 simplified)
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email) && email.length <= 255;
}

// Validate password strength: at least 8 chars, mix of cases + numbers/symbols
function validatePasswordStrength(password) {
  if (password.length < 8) return false;
  if (!/[a-z]/.test(password)) return false; // has lowercase
  if (!/[A-Z]/.test(password)) return false; // has uppercase
  if (!/[\d!@#$%^&*]/.test(password)) return false; // has number or symbol
  return true;
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, plan } = req.body;
    
    // Validate all required fields
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, password are required' });
    }
    
    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Validate password strength
    if (!validatePasswordStrength(password)) {
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters with uppercase, lowercase, and a number or symbol' 
      });
    }
    
    // Trim and validate name
    if (!name.trim() || name.length > 100) {
      return res.status(400).json({ error: 'Name must be 1-100 characters' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const resolvedPlan = resolvePlan(plan);
    const quota = PLAN_DEFAULTS[resolvedPlan];

    const user = new User({
      name: name.trim(),
      email: email.toLowerCase(),
      plan: resolvedPlan,
      maxWorkspaces: quota.maxWorkspaces,
      cpuLimit: quota.cpuLimit,
      memoryLimitMb: quota.memoryLimitMb,
    });
    await user.setPassword(password);
    await user.save();

    // Fire-and-forget - a slow/misconfigured mail server should never
    // block or fail the registration response itself.
    sendWelcomeEmail(user).catch(() => {});

    const token = signToken(user);
    res.status(201).json({ token, user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      if (user && !user.passwordHash) {
        const providers = [user.googleId && 'Google', user.githubId && 'GitHub'].filter(Boolean);
        return res.status(401).json({
          error: `This account signs in with ${providers.join(' or ') || 'a connected provider'}. Use that button instead.`,
        });
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.suspended) {
      return res.status(403).json({ error: 'This account has been suspended. Contact an admin.' });
    }

    const token = signToken(user);
    res.json({ token, user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toSafeObject() });
});

// Public - lets the frontend know which OAuth buttons to show without
// guessing. No secrets exposed, just booleans.
router.get('/oauth-config', (req, res) => {
  res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  });
});

// Called when the user finishes (or explicitly skips) the onboarding
// wizard - see frontend/src/pages/Onboarding.jsx. Idempotent.
router.post('/onboarding/complete', requireAuth, async (req, res) => {
  try {
    req.user.onboarded = true;
    await req.user.save();
    res.json({ user: req.user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Password reset request - sends reset email (or logs it in dev)
router.post('/password-reset-request', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    // Don't reveal if email exists for security
    const user = await User.findOne({ email: email.toLowerCase() });
    
    // Always return 200 to prevent user enumeration attacks
    res.json({ message: 'If an account exists, a reset link has been sent' });

    // Only send email if user exists
    if (user) {
      // In a real app, generate a token and send reset link
      // For now, just log it
      console.log(`[auth] password reset requested for ${email}`);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
