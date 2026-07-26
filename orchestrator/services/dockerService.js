/**
 * orchestrator/services/dockerService.js
 *
 * This is the ONLY file in the whole system that talks to docker.sock.
 * It used to live in backend/services/dockerService.js and be called
 * in-process; it has been moved here, behind an authenticated HTTP API
 * (see ../server.js), so the main API process never needs docker.sock
 * mounted at all. See backend/services/dockerService.js for the client
 * side of this split.
 *
 * Kernel isolation (gVisor/Kata):
 * Set CONTAINER_RUNTIME=runsc (gVisor) or CONTAINER_RUNTIME=kata-runtime
 * (Kata Containers) once the runtime is installed and registered with
 * this host's Docker daemon (see docs/gvisor-kata.md). Leave unset to
 * keep using the default runc (namespace-only isolation - fine for
 * trusted teams, not for untrusted multi-tenant strangers).
 */
const Docker = require('dockerode');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
});

const ALLOWED_IMAGES = (process.env.ALLOWED_IMAGES || 'cloud-dev-base:latest')
  .split(',')
  .map((s) => s.trim());

const NETWORK_NAME = process.env.WORKSPACE_NETWORK_NAME || 'cloud-dev-net';

// undefined = Docker's default runtime (runc). Set to 'runsc' or
// 'kata-runtime' for real kernel/VM-level isolation of untrusted code.
const CONTAINER_RUNTIME = process.env.CONTAINER_RUNTIME || undefined;

function assertAllowedImage(image) {
  if (!ALLOWED_IMAGES.includes(image)) {
    const err = new Error(
      `Image "${image}" is not allowed. Allowed images: ${ALLOWED_IMAGES.join(', ')}`
    );
    err.statusCode = 400;
    throw err;
  }
}

async function ensureNetwork() {
  const networks = await docker.listNetworks({ filters: { name: [NETWORK_NAME] } });
  if (networks.length === 0) {
    await docker.createNetwork({ Name: NETWORK_NAME, Driver: 'bridge' });
  }
}

async function createWorkspaceContainer({
  workspaceId,
  image,
  cpuLimit = 1,
  memoryLimitMb = 1024,
  repoUrl = '',
}) {
  assertAllowedImage(image);
  await ensureNetwork();

  const containerName = `cde-ws-${workspaceId}`;
  const volumeName = `cde-vol-${workspaceId}`;

  await docker.createVolume({ Name: volumeName });

  const hostConfig = {
    Memory: memoryLimitMb * 1024 * 1024,
    NanoCpus: cpuLimit * 1e9,
    Binds: [`${volumeName}:/home/dev/workspace`],
    NetworkMode: NETWORK_NAME,
    RestartPolicy: { Name: 'unless-stopped' },
    PortBindings: { '22/tcp': [{ HostPort: '' }] },
    SecurityOpt: ['no-new-privileges'],
    CapDrop: ['ALL'],
    CapAdd: ['CHOWN', 'FOWNER', 'SETUID', 'SETGID', 'DAC_OVERRIDE', 'NET_BIND_SERVICE', 'SYS_CHROOT', 'AUDIT_WRITE'],
    PidsLimit: 512,
  };

  // gVisor (runsc) intercepts syscalls in userspace; Kata boots each
  // container in its own lightweight VM. Both require the runtime to be
  // registered in the host's /etc/docker/daemon.json first - this just
  // tells the Docker API which registered runtime to use.
  if (CONTAINER_RUNTIME) {
    hostConfig.Runtime = CONTAINER_RUNTIME;
  }

  const container = await docker.createContainer({
    name: containerName,
    Image: image,
    Hostname: containerName,
    Tty: false,
    Env: repoUrl ? [`CDE_REPO_URL=${repoUrl}`] : [],
    ExposedPorts: { '22/tcp': {} },
    Labels: {
      'cde.workspaceId': String(workspaceId),
      'cde.managed': 'true',
    },
    HostConfig: hostConfig,
  });

  await container.start();

  const info = await container.inspect();
  const sshPort = Number(
    info.NetworkSettings.Ports['22/tcp']?.[0]?.HostPort || null
  );

  return {
    containerId: info.Id,
    containerName,
    sshPort,
    runtime: CONTAINER_RUNTIME || 'runc',
  };
}

async function stopContainer(containerId) {
  const container = docker.getContainer(containerId);
  try {
    await container.stop({ t: 10 });
  } catch (err) {
    if (err.statusCode !== 304 && err.statusCode !== 404) throw err;
  }
}

async function startContainer(containerId) {
  const container = docker.getContainer(containerId);
  try {
    await container.start();
  } catch (err) {
    if (err.statusCode !== 304) throw err;
  }
}

async function removeContainer(containerId, { removeVolume = true, workspaceId } = {}) {
  const container = docker.getContainer(containerId);
  try {
    await container.remove({ force: true });
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }

  if (removeVolume && workspaceId) {
    try {
      await docker.getVolume(`cde-vol-${workspaceId}`).remove();
    } catch (err) {
      // volume may already be gone - not fatal
    }
  }
}

async function execInContainer(containerId, cmd) {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });

  return new Promise((resolve, reject) => {
    exec.start({}, (err, stream) => {
      if (err) return reject(err);
      let output = '';
      stream.on('data', (chunk) => (output += chunk.toString()));
      stream.on('end', async () => {
        const result = await exec.inspect();
        if (result.ExitCode !== 0) {
          return reject(new Error(`Command failed (${result.ExitCode}): ${cmd.join(' ')}\n${output}`));
        }
        resolve(output);
      });
      stream.on('error', reject);
    });
  });
}

function generateSSHKeypair() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-key-'));
  const keyPath = path.join(tmpDir, 'id_ed25519');

  try {
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', '', '-C', 'forge-workspace'], {
      stdio: 'pipe',
    });
    const privateKey = fs.readFileSync(keyPath, 'utf8');
    const publicKey = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim();
    return { privateKey, publicKey };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function setupSSHAccess(containerId) {
  const { privateKey, publicKey } = generateSSHKeypair();

  try {
    // Create .ssh directory inside container
    await execInContainer(containerId, ['mkdir', '-p', '/home/dev/.ssh']);
    
    // Write authorized_keys directly using echo + shell
    await execInContainer(containerId, [
      'bash',
      '-c',
      `echo '${publicKey.replace(/'/g, "'\\''")}' > /home/dev/.ssh/authorized_keys`
    ]);
    
    // Set proper permissions and ownership
    await execInContainer(containerId, [
      'bash',
      '-c',
      'chmod 700 /home/dev/.ssh && chmod 600 /home/dev/.ssh/authorized_keys && chown -R dev:dev /home/dev/.ssh',
    ]);
  } catch (err) {
    console.error('[orchestrator] SSH setup failed:', err.message);
    throw err;
  }

  return { privateKey };
}

async function getSSHPort(containerId) {
  const container = docker.getContainer(containerId);
  const info = await container.inspect();
  const binding = info.NetworkSettings.Ports['22/tcp']?.[0]?.HostPort;
  return binding ? Number(binding) : null;
}

async function getContainerStats(containerId) {
  const container = docker.getContainer(containerId);
  const stats = await container.stats({ stream: false });

  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuPercent =
    systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;

  const memUsage = stats.memory_stats.usage || 0;
  const memLimit = stats.memory_stats.limit || 1;

  return {
    cpuPercent: Number(cpuPercent.toFixed(2)),
    memoryUsageMb: Number((memUsage / (1024 * 1024)).toFixed(1)),
    memoryLimitMb: Number((memLimit / (1024 * 1024)).toFixed(1)),
  };
}

/**
 * Used by the WS exec-stream bridge in server.js (replaces the old
 * in-process createExecSession - same dockerode call, just invoked from
 * here instead of from terminalService.js directly).
 */
async function createExecSession(containerId) {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: ['/bin/bash'],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    User: 'dev',
    WorkingDir: '/home/dev/workspace',
  });

  const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
  return { stream, exec };
}

/**
 * Host capacity snapshot, used by the backend's scheduler
 * (hostRegistry.pickHost) to pick the least-loaded host when creating a
 * new workspace, and by the admin panel to show per-host load.
 */
async function getHostLoad() {
  const info = await docker.info();
  const containers = await docker.listContainers({
    all: true,
    filters: { label: ['cde.managed=true'] },
  });

  let allocatedCpu = 0;
  let allocatedMemoryMb = 0;
  let running = 0;
  for (const c of containers) {
    if (c.State === 'running') running += 1;
    try {
      const details = await docker.getContainer(c.Id).inspect();
      allocatedCpu += (details.HostConfig.NanoCpus || 0) / 1e9;
      allocatedMemoryMb += (details.HostConfig.Memory || 0) / (1024 * 1024);
    } catch {
      // container may have been removed between list and inspect
    }
  }

  return {
    totalCpus: info.NCPU,
    totalMemoryMb: Number((info.MemTotal / (1024 * 1024)).toFixed(0)),
    allocatedCpu: Number(allocatedCpu.toFixed(2)),
    allocatedMemoryMb: Number(allocatedMemoryMb.toFixed(0)),
    runningWorkspaces: running,
    totalManagedContainers: containers.length,
    runtime: CONTAINER_RUNTIME || 'runc',
  };
}

module.exports = {
  docker,
  ALLOWED_IMAGES,
  createWorkspaceContainer,
  stopContainer,
  startContainer,
  removeContainer,
  execInContainer,
  getContainerStats,
  createExecSession,
  setupSSHAccess,
  getSSHPort,
  getHostLoad,
};
