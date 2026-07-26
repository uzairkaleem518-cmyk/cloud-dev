/**
 * routes/oauth.js
 *
 * "Login with Google" / "Login with GitHub", implemented as a plain
 * authorization-code exchange (no passport/session dependency, since the
 * rest of this app is stateless JWT auth) - Node 20's built-in fetch is
 * all that's needed to talk to the providers.
 *
 * Flow for each provider:
 *   GET  /api/auth/:provider           -> redirect to provider's consent screen
 *   GET  /api/auth/:provider/callback  -> exchange code, find/create user,
 *                                          redirect to APP_URL/oauth-callback?token=...
 *
 * CSRF protection: a random `state` is stored in a short-lived httpOnly
 * cookie when we redirect out, and checked against the `state` query
 * param the provider sends back on callback.
 */
const express = require('express');
const crypto = require('crypto');
const { signToken } = require('../utils/token');
const { findOrCreateOAuthUser } = require('../services/oauthService');

const router = express.Router();

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

const STATE_COOKIE = 'oauth_state';
const PLAN_COOKIE = 'oauth_plan';
const STATE_COOKIE_OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 5 * 60 * 1000, sameSite: 'lax' };
const OAUTH_TIMEOUT_MS = 10000; // 10 second timeout for provider API calls

function newState(res, plan) {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, STATE_COOKIE_OPTS);
  if (plan) res.cookie(PLAN_COOKIE, plan, STATE_COOKIE_OPTS);
  return state;
}

function consumePlan(req, res) {
  const plan = req.cookies?.[PLAN_COOKIE];
  res.clearCookie(PLAN_COOKIE);
  return plan;
}

function clearOAuthCookies(res) {
  res.clearCookie(STATE_COOKIE);
  res.clearCookie(PLAN_COOKIE);
}

function stateIsValid(req) {
  const { state } = req.query;
  return Boolean(state) && state === req.cookies?.[STATE_COOKIE];
}

function failRedirect(res, message) {
  clearOAuthCookies(res);
  res.redirect(`${APP_URL}/login?error=${encodeURIComponent(message)}`);
}

function successRedirect(res, user) {
  clearOAuthCookies(res);
  const token = signToken(user);
  res.redirect(`${APP_URL}/oauth-callback?token=${token}`);
}

// Fetch with timeout
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------- Google

router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(501).json({ error: 'Google sign-in is not configured on this server.' });
  }

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${BACKEND_URL}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state: newState(res, req.query.plan),
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  try {
    if (!stateIsValid(req)) return failRedirect(res, 'Login expired, please try again.');

    const { code } = req.query;
    if (!code) return failRedirect(res, 'Google did not return an authorization code.');

    const tokenRes = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${BACKEND_URL}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return failRedirect(res, tokenData.error_description || 'Google sign-in failed.');
    }

    const profileRes = await fetchWithTimeout('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    if (!profile.email) return failRedirect(res, "Google didn't share an email address.");

    const user = await findOrCreateOAuthUser({
      provider: 'google',
      providerId: profile.sub,
      email: profile.email,
      name: profile.name,
      plan: consumePlan(req, res),
    });

    if (user.suspended) return failRedirect(res, 'This account has been suspended.');
    successRedirect(res, user);
  } catch (err) {
    console.error('[oauth] Google callback error:', err.message);
    failRedirect(res, err.message || 'Google sign-in failed.');
  }
});

// ---------------------------------------------------------------- GitHub

router.get('/github', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return res.status(501).json({ error: 'GitHub sign-in is not configured on this server.' });
  }

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${BACKEND_URL}/api/auth/github/callback`,
    scope: 'read:user user:email',
    state: newState(res, req.query.plan),
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

router.get('/github/callback', async (req, res) => {
  try {
    if (!stateIsValid(req)) return failRedirect(res, 'Login expired, please try again.');

    const { code } = req.query;
    if (!code) return failRedirect(res, 'GitHub did not return an authorization code.');

    const tokenRes = await fetchWithTimeout('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        redirect_uri: `${BACKEND_URL}/api/auth/github/callback`,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return failRedirect(res, tokenData.error_description || 'GitHub sign-in failed.');
    }

    const headers = {
      Authorization: `Bearer ${tokenData.access_token}`,
      'User-Agent': 'forge-cloud-dev-env',
    };
    const profileRes = await fetchWithTimeout('https://api.github.com/user', { headers });
    const profile = await profileRes.json();

    // GitHub only includes email in /user if it's public - fall back to
    // the emails endpoint and pick the primary, verified one.
    let email = profile.email;
    if (!email) {
      const emailsRes = await fetchWithTimeout('https://api.github.com/user/emails', { headers });
      const emails = await emailsRes.json();
      const primary = Array.isArray(emails) && emails.find((e) => e.primary && e.verified);
      email = primary?.email || (Array.isArray(emails) && emails.find((e) => e.verified)?.email);
    }
    if (!email) return failRedirect(res, "GitHub didn't share a verified email address.");

    const user = await findOrCreateOAuthUser({
      provider: 'github',
      providerId: String(profile.id),
      email,
      name: profile.name || profile.login,
      plan: consumePlan(req, res),
    });

    if (user.suspended) return failRedirect(res, 'This account has been suspended.');
    successRedirect(res, user);
  } catch (err) {
    console.error('[oauth] GitHub callback error:', err.message);
    failRedirect(res, err.message || 'GitHub sign-in failed.');
  }
});

module.exports = router;
