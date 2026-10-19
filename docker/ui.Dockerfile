FROM node:20-alpine AS builder

# Build deps for native addons (@trezor/connect -> usb module)
RUN apk add --no-cache python3 make g++ eudev-dev linux-headers

WORKDIR /app

COPY package*.json ./
COPY packages/core/package*.json packages/core/
COPY packages/ui/package*.json packages/ui/
RUN npm ci

COPY packages/core/ packages/core/
COPY packages/ui/ packages/ui/
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=packages/ui

FROM nginx:alpine
COPY --from=builder /app/packages/ui/dist /usr/share/nginx/html
COPY docker/nginx-ui.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
