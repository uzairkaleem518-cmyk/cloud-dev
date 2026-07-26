const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // Optional: not set for accounts created via Google/GitHub OAuth that
    // never set a password. Login route checks for this before comparing.
    passwordHash: { type: String, default: null },

    // OAuth provider IDs. Sparse + unique so multiple users can each have
    // one null (i.e. plenty of password-only accounts can coexist), but
    // no two accounts can claim the same provider ID.
    googleId: { type: String, unique: true, sparse: true },
    githubId: { type: String, unique: true, sparse: true },

    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    maxWorkspaces: { type: Number, default: 3 },

    // Per-user resource quota overrides. When null, workspace creation
    // falls back to the WORKSPACE_CPU_LIMIT / WORKSPACE_MEMORY_LIMIT_MB
    // env defaults - this lets an admin grant a bigger plan to specific
    // users without changing the defaults for everyone else.
    cpuLimit: { type: Number, default: null },
    memoryLimitMb: { type: Number, default: null },

    // Admin can suspend an account without deleting it - suspended users
    // can't log in or hit any authenticated route.
    suspended: { type: Boolean, default: false },

    // Which pricing-page plan the user signed up under. This is a label
    // for display/reference - the actual enforcement is the maxWorkspaces/
    // cpuLimit/memoryLimitMb fields above, which get set from
    // PLAN_DEFAULTS (see config/plans.js) at registration time and can
    // still be hand-tuned per user from the admin panel afterwards.
    plan: { type: String, enum: ['free', 'pro', 'team'], default: 'free' },

    // Real Stripe billing (routes/billing.js + services/billingService.js).
    // stripeCustomerId is set the first time a user starts a checkout;
    // it's kept even after a cancellation so the customer portal and
    // future resubscribes reuse the same Stripe customer/payment methods.
    stripeCustomerId: { type: String, default: null, index: true },
    stripeSubscriptionId: { type: String, default: null },
    // Mirrors Stripe's own subscription status vocabulary
    // (active/past_due/canceled/unpaid/trialing/incomplete/...) so the
    // webhook handler can just copy it across without translating.
    subscriptionStatus: { type: String, default: null },

    // Whether the user has been through (or explicitly skipped) the
    // post-signup onboarding wizard. Gates the /onboarding redirect in
    // the frontend - see App.jsx.
    onboarded: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function (plainPassword) {
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(plainPassword, salt);
};

userSchema.methods.comparePassword = function (plainPassword) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plainPassword, this.passwordHash);
};

userSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    maxWorkspaces: this.maxWorkspaces,
    cpuLimit: this.cpuLimit,
    memoryLimitMb: this.memoryLimitMb,
    suspended: this.suspended,
    plan: this.plan,
    subscriptionStatus: this.subscriptionStatus,
    hasBillingAccount: Boolean(this.stripeCustomerId),
    onboarded: this.onboarded,
    hasPassword: Boolean(this.passwordHash),
    googleLinked: Boolean(this.googleId),
    githubLinked: Boolean(this.githubId),
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
