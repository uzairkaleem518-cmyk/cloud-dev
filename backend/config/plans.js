/**
 * config/plans.js
 *
 * Maps a pricing-page plan name to the actual quota values applied to a
 * new user at registration (see routes/auth.js). Keeping this in one
 * place means the pricing page and the enforcement logic can't drift
 * apart silently.
 *
 * `null` for cpuLimit/memoryLimitMb means "fall back to the instance-wide
 * WORKSPACE_CPU_LIMIT / WORKSPACE_MEMORY_LIMIT_MB env defaults" (same
 * convention as the admin-panel per-user overrides).
 */
const PLAN_DEFAULTS = {
  free: { maxWorkspaces: 1, cpuLimit: 1, memoryLimitMb: 1024 },
  pro: { maxWorkspaces: 5, cpuLimit: 2, memoryLimitMb: 2048 },
  team: { maxWorkspaces: 20, cpuLimit: 4, memoryLimitMb: 4096 },
};

// Stripe Price IDs (price_...), one per paid plan - created in the
// Stripe dashboard under Product catalog. `free` has no Price because
// there's nothing to check out for it. Read from env so the same code
// works against a test-mode and live-mode Stripe account.
const STRIPE_PRICE_IDS = {
  pro: process.env.STRIPE_PRICE_PRO || null,
  team: process.env.STRIPE_PRICE_TEAM || null,
};

// Reverse lookup used by the webhook handler: Stripe tells us which
// Price the customer is now subscribed to, we need to know which of our
// plan labels (and therefore which quota defaults) that corresponds to.
function planForPriceId(priceId) {
  const entry = Object.entries(STRIPE_PRICE_IDS).find(([, id]) => id === priceId);
  return entry ? entry[0] : null;
}

function resolvePlan(plan) {
  return PLAN_DEFAULTS[plan] ? plan : 'free';
}

module.exports = { PLAN_DEFAULTS, STRIPE_PRICE_IDS, planForPriceId, resolvePlan };
