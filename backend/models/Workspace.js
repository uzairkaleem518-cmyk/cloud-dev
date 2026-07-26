const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    image: { type: String, required: true }, // e.g. cloud-dev-node:latest
    repoUrl: { type: String, default: '' }, // optional git repo to clone on first start

    containerId: { type: String, default: null },
    containerName: { type: String, default: null },

    // Which orchestrator/Docker host this workspace's container actually
    // lives on (multi-node scaling - see services/hostRegistry.js).
    // Set once at creation and never changes; every later operation on
    // this workspace is routed back to this same host.
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Host', default: null },

    status: {
      type: String,
      enum: ['creating', 'running', 'stopped', 'error', 'deleted'],
      default: 'creating',
    },

    // Connection info exposed to the user (SSH port mapping added in phase 2)
    sshPort: { type: Number, default: null },
    sshUsername: { type: String, default: 'dev' },

    cpuLimit: { type: Number, default: 1 }, // number of cores
    memoryLimitMb: { type: Number, default: 1024 },

    lastActiveAt: { type: Date, default: Date.now },
    idleTimeoutMinutes: { type: Number, default: 240 },
  },
  { timestamps: true }
);

workspaceSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    image: this.image,
    repoUrl: this.repoUrl,
    status: this.status,
    sshPort: this.sshPort,
    sshUsername: this.sshUsername,
    cpuLimit: this.cpuLimit,
    memoryLimitMb: this.memoryLimitMb,
    lastActiveAt: this.lastActiveAt,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Workspace', workspaceSchema);
