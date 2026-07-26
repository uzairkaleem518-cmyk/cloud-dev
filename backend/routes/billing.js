/**
 * routes/billing.js
 *
 * Real Stripe integration (this used to be a documented stub - see git
 * history / previous version of this file for the old placeholder).
 * Actual Stripe API calls live in services/billingService.js; this file
 * is just the HTTP surface + auth.
 *
 * IMPORTANT: POST /webhook must receive the RAW request body (not
 * JSON-parsed) so Stripe's signature can be verified - see the
 * express.raw() mount for this exact path in server.js, which has to be
 * registered BEFORE the app-wide express.json() middleware.
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const billingService = require('../services/billingService');

const router = express.Router();

// POST /api/billing/checkout  { plan: "pro" | "team" }
// Returns a Stripe Checkout URL the frontend redirects the browser to.
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!plan) return res.status(400).json({ error: 'plan is required' });

    const url = await billingService.createCheckoutSession(req.user, plan);
    res.json({ url });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// POST /api/billing/portal
// Returns a Stripe Customer Portal URL (manage payment method, view
// invoices, upgrade/downgrade, cancel) for a user who has already
// checked out at least once.
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const url = await billingService.createPortalSession(req.user);
    res.json({ url });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// POST /api/billing/webhook
// Point this at Stripe Dashboard -> Developers -> Webhooks. Needs the
// raw body for signature verification (see server.js).
router.post('/webhook', async (req, res) => {
  let event;
  try {
    event = billingService.verifyWebhookSignature(req.body, req.headers['stripe-signature']);
  } catch (err) {
    // Signature mismatch or malformed payload - reject so a
    // misconfigured/malicious sender doesn't get to pretend to be
    // Stripe. Real Stripe requests will always verify correctly.
    console.error('[billing webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  try {
    const result = await billingService.handleWebhookEvent(event);
    // Always 200 once signature is verified - a 4xx/5xx here makes
    // Stripe retry, which is only useful for transient errors, not for
    // "we don't handle this event type" (that's normal and expected).
    res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error('[billing webhook] handler error:', err);
    // A genuine processing error (e.g. DB down) SHOULD be retried by
    // Stripe, so this one path is allowed to return non-200.
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
