# One-shot migration runner for deployed environments (ADR-0003: migrations are
# an explicit step, never run at service start). Build context is the repo root:
#   docker build -f packages/db/Dockerfile -t openreel/db-migrate .
#   docker run --rm -e DATABASE_URL=... openreel/db-migrate          # migrate
#   docker run --rm -e DATABASE_URL=... openreel/db-migrate status
#
# pnpm is installed directly rather than through Corepack, whose bundled npm
# signing keys expire and break version resolution.
FROM node:22.11.0-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install --global pnpm@10.15.0
WORKDIR /app

# Manifests first so dependency installation caches independently of source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

COPY packages/db packages/db
RUN pnpm --filter @openreel/db run build

# Reduce to production dependencies only, flattened into a self-contained tree.
RUN pnpm --filter @openreel/db --prod --legacy deploy /out


FROM node:22.11.0-alpine AS runtime
# NODE_ENV=production makes the CLI refuse the destructive 'reset' command.
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /out ./
USER node

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["migrate"]
