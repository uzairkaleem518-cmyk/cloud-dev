FROM node:20-alpine

# openssh-client is needed for setupSSHAccess()'s ssh-keygen call (moved
# here from the backend image, since Docker access moved here too).
RUN apk add --no-cache openssh-client

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 5001
CMD ["node", "server.js"]
