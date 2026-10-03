# syntax=docker/dockerfile:1.7
#
# One Dockerfile, three images (docs/despliegue.md):
#   docker build --target api     -t procesabpm-api .      the HTTP API
#   docker build --target worker  -t procesabpm-worker .   the outbox worker and the schedulers
#   docker build --target migrate -t procesabpm-migrate .  applies the migrations (and loads the global catalog)
#
# The Node image is pinned by version and digest: a tag can move, a digest cannot. Update both together.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# --- Build: install, generate the Prisma client and bundle the TypeScript ---------------------------------------------
FROM ${NODE_IMAGE} AS build
# Behind a TLS-inspecting proxy, pass its CA: docker build --secret id=extra-ca,src=/path/ca.pem ... (optional; unused otherwise).
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca
RUN --mount=type=secret,id=extra-ca,required=false npm install --global --no-fund --no-audit pnpm@11.20.0
WORKDIR /repo

# Manifests first: the install layer is rebuilt only when dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/migrate/package.json packages/migrate/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=secret,id=extra-ca,required=false --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY scripts/bundle.mjs scripts/
COPY apps/api apps/api
COPY packages packages
RUN --mount=type=secret,id=extra-ca,required=false pnpm --filter @procesabpm/db generate && pnpm build

# Production dependencies only, installed from the lockfile (workspace packages are bundled, so their copies are dropped).
FROM build AS deploy-api
RUN --mount=type=secret,id=extra-ca,required=false --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @procesabpm/api --prod --legacy deploy /out/api \
 && rm -rf /out/api/node_modules/@procesabpm
# `@prisma/client` declares the Prisma CLI as a peer, and the lockfile resolves it, so deploy brings the CLI and its tooling
# (studio, typescript, react…) into the API image. The API only needs the client runtime: remove the rest. If a future
# upgrade renames a package, the leftover only costs size; removing too much would fail the image smoke test in CI.
RUN cd /out/api/node_modules/.pnpm \
 && rm -rf prisma@* @prisma+studio-core@* @prisma+dev@* @prisma+engines@* @prisma+fetch-engine@* @prisma+streams-local@* \
           @prisma+query-plan-executor@* @prisma+config@* @electric-sql+* effect@* react@* react-dom@* @radix-ui+* @visx+* \
           @types+* typescript@* @typescript+* valibot@* jiti@* \
 && du -sh /out/api/node_modules

FROM build AS deploy-migrate
RUN --mount=type=secret,id=extra-ca,required=false --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @procesabpm/migrate --prod --legacy deploy /out/migrate \
 && cp /out/migrate/node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines/schema-engine-* /out/migrate/schema-engine

# --- Runtime base: no package manager, no shell tooling beyond the image's, a non-root user -------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    HOME=/tmp
WORKDIR /app
USER node

# --- api -----------------------------------------------------------------------------------------------------------
FROM runtime AS api
ENV PORT=3000 \
    PDF_FONT_DIR=/app/assets/fonts
COPY --from=deploy-api --chown=root:root /out/api/node_modules ./node_modules
COPY --from=build --chown=root:root /repo/dist/api ./
COPY --from=build --chown=root:root /repo/apps/api/assets ./assets
EXPOSE 3000
# Liveness only: /health does not touch the database, so a database outage does not restart the API.
# Use /ready (it checks the database) as the readiness probe of the load balancer or orchestrator.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "main.js"]

# --- worker --------------------------------------------------------------------------------------------------------
FROM runtime AS worker
ENV PDF_FONT_DIR=/app/assets/fonts
COPY --from=deploy-api --chown=root:root /out/api/node_modules ./node_modules
COPY --from=build --chown=root:root /repo/dist/api ./
COPY --from=build --chown=root:root /repo/apps/api/assets ./assets
# The worker has no port: the orchestrator watches the process (restart policy) and the logs.
CMD ["node", "worker.js"]

# --- migrate -------------------------------------------------------------------------------------------------------
FROM runtime AS migrate
ENV CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
# Prisma detects the system's OpenSSL to choose its schema engine, and the slim image has no `openssl` command (it warns).
# Install it and point Prisma at the engine that was installed with it, so nothing is searched or downloaded at run time.
USER root
RUN apt-get update && apt-get install --yes --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
USER node
ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/schema-engine
COPY --from=deploy-migrate --chown=root:root /out/migrate/node_modules ./node_modules
COPY --from=deploy-migrate --chown=root:root /out/migrate/schema-engine ./schema-engine
COPY --chown=root:root packages/db/prisma ./prisma
COPY --chown=root:root packages/db/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=root:root /repo/dist/seed ./seed
# DATABASE_URL must be the login of the schema owner. To load the global catalog instead (with an app_platform login):
#   docker run --rm -e DATABASE_URL=... procesabpm-migrate node seed/seed.js (or seed/create-platform-admin.js)
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]
