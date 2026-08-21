# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
ENV NODE_ENV=production
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @timeline/api --include-workspace-root --include=dev

FROM deps AS build
COPY apps/api ./apps/api
RUN npm run build -w @timeline/api

FROM base AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @timeline/api --include-workspace-root --omit=dev \
 && npm cache clean --force
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/migrations ./apps/api/migrations

# Photos live on a private volume owned by the app user, never inside the image.
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 4281
HEALTHCHECK --interval=15s --timeout=3s --start-period=25s --retries=5 \
  CMD curl -fsS http://127.0.0.1:4281/api/health || exit 1
CMD ["node", "dist/server.js"]
