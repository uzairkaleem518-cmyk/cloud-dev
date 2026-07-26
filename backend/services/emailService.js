/**
 * services/emailService.js
 *
 * A single place for every transactional email the app sends. Three
 * emails are wired in right now:
 *   - Welcome            -> sent from routes/auth.js on successful register
 *   - Usage alert        -> sent from routes/workspaces.js when a user hits
 *                           their workspace limit
 *   - Payment failed      -> not wired to a real payment provider (this repo
 *                           doesn't do billing), but the template + send
 *                           function are ready for whenever a Stripe/Paddle/
 *                           etc. webhook lands - see routes/billing.js for
 *                           the stub webhook that calls this.
 *
 * If SMTP isn't configured (no SMTP_HOST in .env), sendMail() logs the
 * email to the console instead of throwing - so registration/workspace
 * creation never fails just because email isn't set up yet. This matters
 * for local dev and for the docker-compose quick-start, where nobody's
 * going to have SMTP credentials on hand.
 */
const nodemailer = require('nodemailer');

let transporter = null;
let loggedMissingConfig = false;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

const FROM = process.env.EMAIL_FROM || 'Forge <no-reply@forge.local>';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();

  if (!t) {
    if (!loggedMissingConfig) {
      console.log(
        '[email] SMTP_HOST not set in .env - emails will be logged here instead of sent. ' +
          'See backend/.env.example for SMTP_* variables.'
      );
      loggedMissingConfig = true;
    }
    console.log(`[email] would send "${subject}" to ${to}`);
    return { skipped: true };
  }

  try {
    await t.sendMail({ from: FROM, to, subject, html, text });
    return { sent: true };
  } catch (err) {
    // Email failures should never break the request that triggered them
    // (registration, workspace creation, etc.) - log and move on.
    console.error(`[email] failed to send "${subject}" to ${to}:`, err.message);
    return { error: err.message };
  }
}

function layout(bodyHtml) {
  return `
  <div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; background: #0f1214; padding: 32px 0;">
    <div style="max-width: 480px; margin: 0 auto; background: #1b2024; border: 1px solid #2a3136; border-radius: 10px; padding: 32px; color: #e8ecee;">
      <div style="font-family: 'IBM Plex Mono', monospace; color: #e8873a; font-size: 20px; margin-bottom: 20px;">&gt;_ Forge</div>
      ${bodyHtml}
      <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #2a3136; color: #5c666d; font-size: 12px;">
        Self-hosted cloud dev environments. You're receiving this because you have an account on this Forge instance.
      </div>
    </div>
  </div>`;
}

async function sendWelcomeEmail(user) {
  return sendMail({
    to: user.email,
    subject: 'Welcome to Forge',
    html: layout(`
      <h2 style="margin: 0 0 12px; font-size: 18px;">Welcome, ${user.name}.</h2>
      <p style="color: #8b959c; font-size: 14px; line-height: 1.6;">
        Your account is ready. Spin up your first cloud dev environment and
        you'll have a full VS Code-ready workspace in under a minute -
        browser terminal included, no local setup required.
      </p>
      <a href="${APP_URL}/onboarding" style="display: inline-block; margin-top: 16px; background: #e8873a; color: #1b1204; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">
        Create your first workspace
      </a>
    `),
    text: `Welcome to Forge, ${user.name}. Create your first workspace: ${APP_URL}/onboarding`,
  });
}

async function sendUsageAlertEmail(user, { used, limit, resource = 'workspaces' }) {
  return sendMail({
    to: user.email,
    subject: `You're at your ${resource} limit`,
    html: layout(`
      <h2 style="margin: 0 0 12px; font-size: 18px;">You've reached your plan's limit</h2>
      <p style="color: #8b959c; font-size: 14px; line-height: 1.6;">
        You're using <strong style="color:#e8ecee;">${used} of ${limit}</strong> ${resource} on your
        current plan. Delete an unused workspace to free up room, or reach
        out to an admin about increasing your quota.
      </p>
      <a href="${APP_URL}/dashboard" style="display: inline-block; margin-top: 16px; background: #4fd1c5; color: #0a1a18; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">
        Manage workspaces
      </a>
    `),
    text: `You're using ${used} of ${limit} ${resource}. Manage workspaces: ${APP_URL}/dashboard`,
  });
}

async function sendPaymentFailedEmail(user, { reason = 'your card was declined', plan } = {}) {
  return sendMail({
    to: user.email,
    subject: 'Action needed: payment failed',
    html: layout(`
      <h2 style="margin: 0 0 12px; font-size: 18px; color: #e5534b;">We couldn't process your payment</h2>
      <p style="color: #8b959c; font-size: 14px; line-height: 1.6;">
        ${reason}${plan ? ` for your <strong style="color:#e8ecee;">${plan}</strong> plan` : ''}.
        Please update your billing details to avoid any interruption to
        your workspaces.
      </p>
      <a href="${APP_URL}/dashboard" style="display: inline-block; margin-top: 16px; background: #e5534b; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">
        Update billing
      </a>
    `),
    text: `Payment failed: ${reason}. Update billing: ${APP_URL}/dashboard`,
  });
}

module.exports = {
  sendMail,
  sendWelcomeEmail,
  sendUsageAlertEmail,
  sendPaymentFailedEmail,
};
