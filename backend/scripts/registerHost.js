/**
 * scripts/registerHost.js
 *
 * Registers (or updates) one orchestrator daemon instance = one Docker
 * host the scheduler is allowed to place workspaces on. Run this once
 * per host after that host's orchestrator container is up. Single-node
 * deployments still need to run this exactly once, for their one host -
 * without at least one registered Host, workspace creation fails with
 * "no orchestrator hosts registered".
 *
 * Usage:
 *   node scripts/registerHost.js <name> <baseUrl> <token>
 *
 * Example (single-node, docker-compose default):
 *   node scripts/registerHost.js primary http://orchestrator:5001 $ORCHESTRATOR_TOKEN
 *
 * Example (adding a second host for multi-node scaling):
 *   node scripts/registerHost.js gpu-host-1 http://10.0.1.12:5001 <that host's token>
 *
 * To drain a host (stop scheduling new workspaces onto it, without
 * touching workspaces already running there), pass --deactivate:
 *   node scripts/registerHost.js primary --deactivate
 */
require('dotenv').config();
const connectDB = require('../config/db');
const Host = require('../models/Host');

async function main() {
  const [name, arg2, arg3] = process.argv.slice(2);

  if (!name) {
    console.error('Usage: node scripts/registerHost.js <name> <baseUrl> <token>');
    console.error('   or: node scripts/registerHost.js <name> --deactivate');
    process.exit(1);
  }

  await connectDB();

  if (arg2 === '--deactivate') {
    const host = await Host.findOneAndUpdate({ name }, { active: false }, { new: true });
    if (!host) {
      console.error(`No host named "${name}" found.`);
      process.exit(1);
    }
    console.log(`✓ Host "${name}" deactivated (existing workspaces there are unaffected).`);
    process.exit(0);
  }

  const baseUrl = arg2;
  const token = arg3;
  if (!baseUrl || !token) {
    console.error('Usage: node scripts/registerHost.js <name> <baseUrl> <token>');
    process.exit(1);
  }

  const host = await Host.findOneAndUpdate(
    { name },
    { name, baseUrl: baseUrl.replace(/\/$/, ''), token, active: true },
    { upsert: true, new: true }
  );

  console.log(`✓ Host "${host.name}" registered -> ${host.baseUrl}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
