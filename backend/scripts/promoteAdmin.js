/**
 * scripts/promoteAdmin.js
 *
 * Bootstraps the first admin account. There's no "make me admin" button
 * in the app on purpose (that'd be a privilege-escalation hole) - the
 * first admin has to be granted from the server side, once, via this
 * script. After that, admins can promote others from the Admin panel.
 *
 * Usage:
 *   node scripts/promoteAdmin.js someone@example.com
 */
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/promoteAdmin.js <email>');
    process.exit(1);
  }

  await connectDB();
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(`No user found with email ${email}. Register the account first, then re-run this.`);
    process.exit(1);
  }

  user.role = 'admin';
  await user.save();
  console.log(`✓ ${user.email} is now an admin.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
