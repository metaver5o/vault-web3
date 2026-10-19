FROM node:20-alpine AS builder

# Build deps for native addons (@trezor/connect → usb module)
RUN apk add --no-cache python3 make g++ curl wget eudev-dev linux-headers

WORKDIR /app

# Install all workspace deps
COPY package*.json ./
COPY packages/core/package*.json packages/core/
COPY packages/api/package*.json packages/api/
RUN npm ci

# Build core + api
COPY packages/core/ packages/core/
COPY packages/api/ packages/api/
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=packages/api

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM node:20-alpine

# Runtime deps for native addons
RUN apk add --no-cache eudev-dev

WORKDIR /app

# Production deps only
COPY package*.json ./
COPY packages/core/package*.json packages/core/
COPY packages/api/package*.json packages/api/
RUN apk add --no-cache python3 make g++ curl wget linux-headers && \
    npm ci --omit=dev && \
    apk del python3 make g++ linux-headers

# Copy compiled output
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/api/dist packages/api/dist

EXPOSE 8200
CMD ["node", "packages/api/dist/server.js"]
