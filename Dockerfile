# Stage 1: Build frontend
FROM node:24.13.0-alpine3.23 AS builder
WORKDIR /app

# Upgrade npm to latest version to fix CVEs in npm's bundled dependencies
RUN npm install -g npm@latest && \
    npm install -g tar@7.5.7 && \
    rm -rf /usr/local/lib/node_modules/npm/node_modules/tar && \
    cp -r /usr/local/lib/node_modules/tar /usr/local/lib/node_modules/npm/node_modules/

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production with Node.js server
FROM node:24.13.0-alpine3.23

# Set production environment
ENV NODE_ENV=production

# Upgrade npm to latest version FIRST to fix CVEs in npm's bundled dependencies
RUN npm install -g npm@latest && \
    npm install -g tar@7.5.7 && \
    rm -rf /usr/local/lib/node_modules/npm/node_modules/tar && \
    cp -r /usr/local/lib/node_modules/tar /usr/local/lib/node_modules/npm/node_modules/

# Create hostnote user with UID/GID 8888 and upgrade all Alpine packages
RUN addgroup -g 8888 hostnote && \
    adduser -D -u 8888 -G hostnote hostnote && \
    apk update && \
    apk upgrade --no-cache --available && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Install express - npm's bundled dependencies are now fixed
RUN npm install express@^4.21.2 && \
    npm pkg set type="module" && \
    npm cache clean --force && \
    rm -rf /root/.npm

# Copy built frontend and server
COPY --from=builder /app/dist ./dist
COPY server.js ./

# Create data directory and set permissions
RUN mkdir -p /data && chown -R hostnote:hostnote /app /data

USER 8888

EXPOSE 8080

CMD ["node", "server.js"]
