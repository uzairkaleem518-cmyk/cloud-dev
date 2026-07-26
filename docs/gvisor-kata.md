# Real kernel isolation (gVisor / Kata Containers)

By default every workspace container runs under Docker's default runtime
(`runc`): a normal Linux process with namespaces + cgroups + a dropped
capability set. That's real isolation, but it shares the host kernel -
fine for a trusted team's own workspaces, **not** safe if strangers you
don't trust can run arbitrary code (a kernel exploit in one container
can reach the host and every other container).

This orchestrator supports switching to gVisor or Kata per host via one
env var (`CONTAINER_RUNTIME`), without any application code changes -
see `orchestrator/services/dockerService.js`.

## Option A: gVisor (`runsc`) - recommended default

gVisor intercepts container syscalls in a userspace kernel (Sentry)
instead of letting them hit the host kernel directly. Lower overhead
than a VM, blocks most container-escape classes.

```bash
# On the Docker host that will run this orchestrator instance:
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list
sudo apt-get update && sudo apt-get install -y runsc

# Register runsc as a Docker runtime
sudo tee -a /etc/docker/daemon.json <<'EOF'
{
  "runtimes": {
    "runsc": {
      "path": "/usr/bin/runsc"
    }
  }
}
EOF
sudo systemctl restart docker

# Sanity check
docker run --rm --runtime=runsc hello-world
```

Then set `CONTAINER_RUNTIME=runsc` in this host's orchestrator `.env`
and restart the orchestrator container.

**Known gVisor limitations for this project:**
- Slightly higher syscall latency - noticeable on CPU-bound workloads,
  not on typical dev-workspace usage (editing, running a dev server).
- `ptrace`-based debuggers/profilers inside the workspace may need
  `--platform=ptrace` (slower) instead of the default KVM platform if
  the host doesn't expose `/dev/kvm`.

## Option B: Kata Containers - strongest isolation

Kata boots each container in its own lightweight VM (via QEMU/Cloud
Hypervisor/Firecracker), so it gets a real, separate kernel. Stronger
isolation than gVisor, higher memory overhead per workspace (~130MB+
extra per container) and requires hardware virtualization support
(nested virtualization if the Docker host is itself a VM).

```bash
# On the Docker host (needs /dev/kvm - bare metal or nested-virt VM):
curl -fsSL https://raw.githubusercontent.com/kata-containers/kata-containers/main/utils/kata-manager.sh | bash -s -- install

sudo tee -a /etc/docker/daemon.json <<'EOF'
{
  "runtimes": {
    "kata-runtime": {
      "path": "/usr/bin/kata-runtime"
    }
  }
}
EOF
sudo systemctl restart docker

docker run --rm --runtime=kata-runtime hello-world
```

Then set `CONTAINER_RUNTIME=kata-runtime` in that host's orchestrator
`.env`.

## Rolling this out without downtime

`CONTAINER_RUNTIME` is per-orchestrator-instance, i.e. per Docker host,
which is exactly what the multi-node setup (`docs/multi-node.md`) is
for: bring up one new host with gVisor/Kata enabled, register it, and
either point new workspaces at it only, or migrate existing ones over
time. Existing running containers on the old runtime are unaffected -
the runtime is fixed at container-create time, so a switch only applies
to workspaces created after the change.

## What this does NOT cover

- Network-level isolation between workspaces (already handled by the
  per-instance bridge network + no inter-container Docker exec).
- Host-level hardening (patching, SSH access to the Docker hosts
  themselves, firewalling the orchestrator's port to backend IPs only).
- Seccomp/AppArmor profile tuning beyond Docker's defaults - gVisor/Kata
  make this less critical since the syscall surface is already much
  smaller, but for `runc`-only hosts a custom seccomp profile is a
  worthwhile additional step.
