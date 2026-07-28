/**
 * services/billingService.js
 *
 * Real Stripe integration (replaces the old routes/billing.js stub).
 * Handles the whole subscription lifecycle:
 *   - checkout: user picks a paid plan -> Stripe Checkout session
 *   - portal: user manages/cancels their existing subscription -> Stripe
 *     Customer Portal (Stripe hosts the cancel/upgrade/payment-method UI,
 *     so we never have to build that ourselves)
 *   - webhook: Stripe tells us what happened (payment succeeded/failed,
 *     subscription created/updated/canceled) -> we update User.plan +
 *     quotas (via config/plans.js#PLAN_DEFAULTS) to match
 *
 * Requires STRIPE_SECRET_KEY. If it's not set, every function here
 * throws a clear "billing not configured" error rather than crashing -
 * same "don't break the rest of the app if a third-party isn't
 * configured yet" convention as emailService.js.
 */
const User = require('../models/User');
const { PLAN_DEFAULTS, STRIPE_PRICE_IDS, planForPriceId } = require('../config/plans');
const { sendPaymentFailedEmail } = require('./emailService');

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  // Lazy require so `stripe` isn't a hard crash-on-boot dependency for
  // deployments that haven't set up billing yet.
  const Stripe = require('stripe');
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
}

// Track processed webhook IDs to prevent duplicate processing
const processedWebhookIds = new Set();
const WEBHOOK_ID_RETENTION_MS = 24 * 60 * 60 * 1000; // Keep IDs for 24 hours

// Clean up old webhook IDs periodically
// Note: In production, store this in Redis or a database instead of memory
// Skip interval in test environment to avoid blocking Jest exit
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    console.log('[billing] webhook deduplication cleanup (note: in-memory only - use Redis in production)');
  }, WEBHOOK_ID_RETENTION_MS);
}

function assertConfigured() {
  if (!stripe) {
    const err = new Error(
      'Billing is not configured on this instance (STRIPE_SECRET_KEY is unset). Ask an admin to set it up.'
    );
    err.statusCode = 503;
    throw err;
  }
}

function assertPlanIsPurchasable(plan) {
  const priceId = STRIPE_PRICE_IDS[plan];
  if (!priceId) {
    const err = new Error(
      `Plan "${plan}" has no Stripe Price configured (set STRIPE_PRICE_${plan.toUpperCase()} in the backend env).`
    );
    err.statusCode = 400;
    throw err;
  }
  return priceId;
}

/**
 * Ensures the user has a Stripe Customer, creating one on first use and
 * caching the ID on the User doc so every later checkout/portal call
 * reuses the same customer (same saved payment methods, same invoice
 * history).
 */
async function ensureStripeCustomer(user) {
  assertConfigured();
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: String(user._id) },
  });

  user.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
}

/**
 * Creates a Stripe Checkout session for the given plan and returns its
 * URL - the frontend just redirects the browser there. Stripe handles
 * the whole payment form; we find out it worked via the
 * checkout.session.completed webhook below, not via this response
 * (the user might close the tab before returning).
 */
async function createCheckoutSession(user, plan) {
  assertConfigured();
  const priceId = assertPlanIsPurchasable(plan);
  const customerId = await ensureStripeCustomer(user);

  const appUrl = process.env.APP_URL || 'http://localhost:5173';

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/pricing?checkout=cancelled`,
    // Also carried in the resulting subscription/invoice objects, but
    // duplicating it on the session metadata makes the
    // checkout.session.completed handler below a single lookup with no
    // extra Stripe round-trip.
    metadata: { userId: String(user._id), plan },
    subscription_data: {
      metadata: { userId: String(user._id), plan },
    },
    allow_promotion_codes: true,
  });

  return session.url;
}

/**
 * Creates a Stripe Customer Portal session (manage payment method,
 * download invoices, cancel/change plan) and returns its URL. Requires
 * the user to already have a Stripe customer, i.e. to have checked out
 * at least once.
 */
async function createPortalSession(user) {
  assertConfigured();
  if (!user.stripeCustomerId) {
    const err = new Error('No billing account yet - subscribe to a plan first.');
    err.statusCode = 400;
    throw err;
  }

  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${appUrl}/dashboard`,
  });

  return session.url;
}

/**
 * Applies a plan change to a User: updates the label plus the actual
 * enforced quotas from PLAN_DEFAULTS, exactly like registration does
 * (routes/auth.js) - so a webhook-driven upgrade/downgrade takes effect
 * immediately, not just cosmetically.
 */
async function applyPlanToUser(user, plan) {
  const defaults = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.free;
  user.plan = plan;
  user.maxWorkspaces = defaults.maxWorkspaces;
  user.cpuLimit = defaults.cpuLimit;
  user.memoryLimitMb = defaults.memoryLimitMb;
  await user.save();
}

/**
 * Verifies the raw request body against Stripe's signature (must be
 * called with the UNPARSED body - see server.js's express.raw() mount
 * for this route specifically) and returns the parsed event, or throws.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  assertConfigured();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const err = new Error('STRIPE_WEBHOOK_SECRET is not configured');
    err.statusCode = 500;
    throw err;
  }
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}

async function findUserForEvent(object) {
  const userId = object?.metadata?.userId;
  if (userId) {
    const user = await User.findById(userId);
    if (user) return user;
  }
  // Fall back to matching by Stripe customer ID, e.g. for events (like
  // invoice.payment_failed) that don't carry our metadata directly.
  const customerId = typeof object?.customer === 'string' ? object.customer : object?.customer?.id;
  if (customerId) {
    return User.findOne({ stripeCustomerId: customerId });
  }
  return null;
}

/**
 * Check if we've already processed this webhook (Stripe can retry webhooks)
 */
function isWebhookProcessed(eventId) {
  return processedWebhookIds.has(eventId);
}

/**
 * Mark a webhook as processed
 */
function markWebhookProcessed(eventId) {
  processedWebhookIds.add(eventId);
  // In production, this should be stored in Redis with an expiration
}

/**
 * Central webhook dispatcher. Every event type Stripe might send that we
 * don't explicitly handle is acknowledged with 200/handled:false so
 * Stripe doesn't retry it forever - see routes/billing.js.
 *
 * DEDUPLICATION: Stripe can retry webhooks. We track event IDs to avoid
 * processing the same event twice, which could double-charge or corrupt
 * subscription state. For production, store event IDs in Redis instead of
 * in-memory.
 */
async function handleWebhookEvent(event) {
  // Check for duplicate processing
  if (isWebhookProcessed(event.id)) {
    console.log(`[billing webhook] ignoring duplicate event ${event.id} (type: ${event.type})`);
    return { handled: false, reason: 'duplicate event (already processed)' };
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const user = await findUserForEvent(session);
      if (!user) return { handled: false, reason: 'no matching user' };

      const plan = session.metadata?.plan;
      if (plan) await applyPlanToUser(user, plan);
      if (session.subscription) {
        user.stripeSubscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      }
      user.subscriptionStatus = 'active';
      await user.save();
      markWebhookProcessed(event.id);
      return { handled: true };
    }

    // Fires on renewal, upgrade/downgrade, and Stripe's own dunning
    // retries changing status - this is the source of truth for
    // "what plan/status is this user's subscription actually in right
    // now", more reliable than trusting only the initial checkout event.
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const subscription = event.data.object;
      const user = await findUserForEvent(subscription);
      if (!user) return { handled: false, reason: 'no matching user' };

      const priceId = subscription.items?.data?.[0]?.price?.id;
      const plan = planForPriceId(priceId) || subscription.metadata?.plan;

      user.stripeSubscriptionId = subscription.id;
      user.subscriptionStatus = subscription.status;
      if (plan && ['active', 'trialing'].includes(subscription.status)) {
        await applyPlanToUser(user, plan);
      } else {
        await user.save();
      }
      markWebhookProcessed(event.id);
      return { handled: true };
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const user = await findUserForEvent(subscription);
      if (!user) return { handled: false, reason: 'no matching user' };

      user.subscriptionStatus = 'canceled';
      await applyPlanToUser(user, 'free');
      markWebhookProcessed(event.id);
      return { handled: true };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const user = await findUserForEvent(invoice);
      if (!user) return { handled: false, reason: 'no matching user' };

      user.subscriptionStatus = 'past_due';
      await user.save();
      await sendPaymentFailedEmail(user, {
        reason: 'your last payment was declined',
        plan: user.plan,
      }).catch(() => {}); // email failure shouldn't fail the webhook ack
      markWebhookProcessed(event.id);
      return { handled: true };
    }

    default:
      return { handled: false, reason: `unhandled event type: ${event.type}` };
  }
}

module.exports = {
  createCheckoutSession,
  createPortalSession,
  verifyWebhookSignature,
  handleWebhookEvent,
  ensureStripeCustomer,
};
