FROM cloud-dev-base:latest

USER root
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn pnpm typescript ts-node nodemon \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/dev/workspace
# Note: stays as root here - the base image's ENTRYPOINT needs root to start
# sshd. Interactive sessions (terminal + SSH) still land as the "dev" user
# via `docker exec -u dev` / SSH pubkey auth, never as root.
