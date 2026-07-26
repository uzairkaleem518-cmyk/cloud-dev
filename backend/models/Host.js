const mongoose = require('mongoose');

/**
 * One document per orchestrator daemon instance = one per Docker host.
 * Single-node deployments just have one Host doc pointing at
 * http://orchestrator:5001. Multi-node deployments add more (see
 * docs/multi-node.md and scripts/registerHost.js).
 */
const hostSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    baseUrl: { type: String, required: true }, // e.g. http://10.0.1.5:5001
    token: { type: String, required: true }, // this host's ORCHESTRATOR_TOKEN
    active: { type: Boolean, default: true }, // set false to drain (no new workspaces, existing ones keep running)

    lastSeenAt: { type: Date, default: null },
    lastLoad: {
      totalCpus: { type: Number, default: null },
      totalMemoryMb: { type: Number, default: null },
      allocatedCpu: { type: Number, default: null },
      allocatedMemoryMb: { type: Number, default: null },
      runningWorkspaces: { type: Number, default: null },
      runtime: { type: String, default: null },
    },
  },
  { timestamps: true }
);

hostSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    baseUrl: this.baseUrl,
    active: this.active,
    lastSeenAt: this.lastSeenAt,
    lastLoad: this.lastLoad,
    // token deliberately omitted
  };
};

module.exports = mongoose.model('Host', hostSchema);
