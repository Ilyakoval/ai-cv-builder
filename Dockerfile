# syntax=docker/dockerfile:1
# One multi-stage build for the whole monorepo; compose picks a target per service.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @cvb/shared \
 && npm run build -w @cvb/api \
 && npm run build -w @cvb/web

# ---------- API / worker / migrate (same image, different command) ----------
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --no-audit --no-fund -w @cvb/api -w @cvb/shared && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
# Don't rely on npm creating the workspace symlink for a partial (-w) install:
# its behaviour differs between npm versions/platforms. Link it explicitly.
RUN mkdir -p node_modules/@cvb \
 && ln -sfn ../../packages/shared node_modules/@cvb/shared
WORKDIR /app/apps/api
# Fail the image build, not the container start, if the runtime graph is broken.
RUN node -e "require('@cvb/shared'); require('@node-rs/argon2'); require('./dist/app.module'); require('./dist/worker.module')"
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

# ---------- Web (Next.js standalone) ----------
FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/apps/web/public apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
