# Base image: common tools every workspace needs
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    vim \
    nano \
    sudo \
    build-essential \
    openssh-server \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root dev user (never run workspaces as root)
RUN useradd -m -s /bin/bash dev \
    && echo "dev:dev" | chpasswd \
    && usermod -aG sudo dev \
    && echo "dev ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# SSH server setup - used for VS Code Remote-SSH connections.
# Password auth is disabled entirely; the backend injects a per-workspace
# public key into authorized_keys after the container starts (see
# dockerService.js -> setupSSHAccess).
RUN mkdir -p /var/run/sshd /home/dev/.ssh \
    && chown dev:dev /home/dev/.ssh \
    && chmod 700 /home/dev/.ssh \
    && touch /home/dev/.ssh/authorized_keys \
    && chown dev:dev /home/dev/.ssh/authorized_keys \
    && chmod 600 /home/dev/.ssh/authorized_keys \
    && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config \
    && sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config \
    && sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i '/pam_loginuid.so/s/^/#/' /etc/pam.d/sshd \
    && ssh-keygen -A

RUN mkdir -p /home/dev/workspace && chown dev:dev /home/dev/workspace

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /home/dev/workspace
EXPOSE 22

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
