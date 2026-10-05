# Build context is the repository root, so the pnpm workspace and the shared
# @openreel/service-core package are available:
#   docker build -f services/media/Dockerfile -t openreel/media .
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
COPY packages/db/package.json packages/db/
COPY services/media/package.json services/media/
RUN pnpm install --frozen-lockfile

COPY packages/service-core packages/service-core
COPY packages/db packages/db
COPY services/media services/media
RUN pnpm --filter @openreel/media... run build

# Reduce to production dependencies only, flattened into a self-contained tree.
RUN pnpm --filter @openreel/media --prod --legacy deploy /out


FROM node:22.11.0-alpine AS runtime
ENV NODE_ENV=production
# The transcoder shells out to ffmpeg/ffprobe; Alpine's build includes libx264
# and libx265.
RUN apk add --no-cache ffmpeg
WORKDIR /app

# Run unprivileged; the node image already provides uid/gid 1000.
COPY --from=build --chown=node:node /out ./
# Owned by node so a fresh named volume mounted here inherits writable ownership.
RUN mkdir -p /media && chown node:node /media
USER node

EXPOSE 3005
CMD ["node", "dist/index.js"]
