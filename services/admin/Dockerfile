# Build context is the repository root, so the pnpm workspace and the shared
# @openreel/service-core package are available:
#   docker build -f services/admin/Dockerfile -t openreel/appview .
#
# pnpm is installed directly rather than through Corepack, whose bundled npm
# signing keys expire and break version resolution.
FROM node:22.11.0-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install --global pnpm@10.15.0
WORKDIR /app

# Manifests first so dependency installation caches independently of source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/service-core/package.json packages/service-core/
COPY services/admin/package.json services/admin/
RUN pnpm install --frozen-lockfile

COPY packages/service-core packages/service-core
COPY services/admin services/admin
RUN pnpm --filter @openreel/admin... run build

# Reduce to production dependencies only, flattened into a self-contained tree.
RUN pnpm --filter @openreel/admin --prod --legacy deploy /out


FROM node:22.11.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run unprivileged; the node image already provides uid/gid 1000.
COPY --from=build --chown=node:node /out ./
USER node

EXPOSE 3003
CMD ["node", "dist/index.js"]
