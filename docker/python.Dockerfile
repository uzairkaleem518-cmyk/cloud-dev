FROM cloud-dev-base:latest

USER root
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --default-timeout=300 --retries 5 virtualenv poetry ipython

WORKDIR /home/dev/workspace
# Note: stays as root here - the base image's ENTRYPOINT needs root to start
# sshd. Interactive sessions (terminal + SSH) still land as the "dev" user
# via `docker exec -u dev` / SSH pubkey auth, never as root.
