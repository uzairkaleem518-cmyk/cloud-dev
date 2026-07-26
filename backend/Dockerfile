FROM node:20-slim

# Note: openssh-client (ssh-keygen) used to live in this image because
# the backend generated workspace SSH keypairs itself. That logic moved
# to the orchestrator daemon along with docker.sock access (see
# ../orchestrator/) - this image no longer needs Docker or SSH tooling
# at all, only outbound HTTP/WS to the orchestrator(s) and MongoDB.

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 4000
CMD ["node", "server.js"]
