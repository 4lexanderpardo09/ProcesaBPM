# syntax=docker/dockerfile:1.7
#
# One Dockerfile, three images (docs/despliegue.md):
#   docker build --target api     -t procesabpm-api .      the HTTP API
#   docker build --target worker  -t procesabpm-worker .   the outbox worker and the schedulers
#   docker build --target migrate -t procesabpm-migrate .  applies the migrations (and loads the global catalog)
#   docker build --target web     -t procesabpm-web .      the web app: static files served by Caddy, behind the proxy that sends /api to the API
#   docker build --target landing -t procesabpm-landing .  the public website and its blog: static files served by Caddy
#   docker build -f Dockerfile.test-unit -t procesabpm-test-unit .  the unit tests (Dockerfile.test-unit, deploy/verify.sh); never deployed
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
COPY patches patches
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

# --- Build of the web: its own install (web and shared only), so the API layers do not depend on the web's ------------
FROM ${NODE_IMAGE} AS build-web
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca
RUN --mount=type=secret,id=extra-ca,required=false npm install --global --no-fund --no-audit pnpm@11.20.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=secret,id=extra-ca,required=false --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter '@procesabpm/web...'
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
# The design tokens and logos the web imports through its `@design` alias.
COPY docs/diseno docs/diseno
COPY apps/web apps/web
RUN pnpm --filter @procesabpm/web build

# --- Build of the landing: its own install (landing and shared only), like the web's -------------------------------
FROM ${NODE_IMAGE} AS build-landing
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca
RUN --mount=type=secret,id=extra-ca,required=false npm install --global --no-fund --no-audit pnpm@11.20.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/landing/package.json apps/landing/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=secret,id=extra-ca,required=false --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter '@procesabpm/landing...'
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY docs/diseno docs/diseno
COPY apps/landing apps/landing
ARG LANDING_SITE_URL
ENV LANDING_SITE_URL=${LANDING_SITE_URL}
RUN pnpm --filter @procesabpm/landing build

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
# Liveness only: /api/health does not touch the database, so a database outage does not restart the API.
# Use /api/ready (it checks the database) as the readiness probe of the load balancer or orchestrator.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
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

# --- web -----------------------------------------------------------------------------------------------------------
# Static files only: no Node at run time. Caddy is pinned by version and digest, like Node.
FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS web
# Caddy keeps nothing between runs here (no certificates: TLS is the outer proxy's), so its folders live in /tmp.
ENV XDG_CONFIG_HOME=/tmp XDG_DATA_HOME=/tmp
# The image's binary carries the file capability to bind ports below 1024, which no-new-privileges refuses to exec. This one
# listens on 8080 and needs none: a plain copy drops it.
RUN cp /usr/bin/caddy /usr/bin/caddy.plain && mv /usr/bin/caddy.plain /usr/bin/caddy
COPY --chown=root:root deploy/web.Caddyfile /etc/caddy/Caddyfile
COPY --from=build-web --chown=root:root /repo/apps/web/dist /srv
USER nobody
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]

# --- landing -------------------------------------------------------------------------------------------------------
# The public website and its blog, static like the web. The demo form posts to /api/public/*, which the outer proxy sends
# to the API (deploy/Caddyfile.example).
FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS landing
ENV XDG_CONFIG_HOME=/tmp XDG_DATA_HOME=/tmp
RUN cp /usr/bin/caddy /usr/bin/caddy.plain && mv /usr/bin/caddy.plain /usr/bin/caddy
COPY --chown=root:root deploy/landing.Caddyfile /etc/caddy/Caddyfile
COPY --from=build-landing --chown=root:root /repo/apps/landing/dist /srv
USER nobody
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
