/**
 * services/oauthService.js
 *
 * Shared "what happens after we've verified the person with Google/GitHub"
 * logic, used by both callback routes in routes/oauth.js. Three cases:
 *
 *   1. We've seen this provider ID before -> log them into that account.
 *   2. No provider ID match, but the email matches an existing account
 *      (e.g. they originally signed up with a password) -> link this
 *      provider to that account, so either sign-in method works from now on.
 *   3. Brand new email -> create a new account on the Free plan, same as
 *      a normal registration, minus the password.
 */
const User = require('../models/User');
const { PLAN_DEFAULTS, resolvePlan } = require('../config/plans');
const { sendWelcomeEmail } = require('../services/emailService');

const ID_FIELD = { google: 'googleId', github: 'githubId' };

async function findOrCreateOAuthUser({ provider, providerId, email, name, plan }) {
  const idField = ID_FIELD[provider];
  if (!idField) throw new Error(`Unknown OAuth provider: ${provider}`);

  let user = await User.findOne({ [idField]: providerId });
  if (user) return user;

  const normalizedEmail = email.toLowerCase();
  user = await User.findOne({ email: normalizedEmail });

  if (user) {
    // Existing account (probably password-based) signing in with a new
    // provider for the first time - link it rather than duplicating.
    user[idField] = providerId;
    await user.save();
    return user;
  }

  // Brand new account. Respects a plan carried over from the pricing
  // page (see routes/oauth.js consumePlan()), defaulting to Free.
  const resolvedPlan = resolvePlan(plan);
  const quota = PLAN_DEFAULTS[resolvedPlan];
  user = new User({
    name: name || normalizedEmail.split('@')[0],
    email: normalizedEmail,
    plan: resolvedPlan,
    maxWorkspaces: quota.maxWorkspaces,
    cpuLimit: quota.cpuLimit,
    memoryLimitMb: quota.memoryLimitMb,
    [idField]: providerId,
  });
  await user.save();

  sendWelcomeEmail(user).catch(() => {});

  return user;
}

module.exports = { findOrCreateOAuthUser };
