#!/bin/bash
# Starts the SSH daemon (needed for VS Code Remote-SSH) as root, then drops
# into the same "keep the container alive, let docker exec / SSH do the
# rest" pattern Phase 1 used. Any repo clone happens once, on first boot.

set -e

if [ -n "$CDE_REPO_URL" ] && [ ! -d /home/dev/workspace/repo ]; then
  su dev -c "git clone '$CDE_REPO_URL' /home/dev/workspace/repo" || true
fi

/usr/sbin/sshd -D &
SSHD_PID=$!

trap "kill $SSHD_PID" TERM INT

wait $SSHD_PID
