FROM node:22.11.0-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install --global pnpm@10.15.0
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/service-core/package.json packages/service-core/
COPY services/event-consumer/package.json services/event-consumer/
RUN pnpm install --frozen-lockfile

COPY packages/service-core packages/service-core
COPY services/event-consumer services/event-consumer
RUN pnpm --filter @openreel/event-consumer... run build
RUN pnpm --filter @openreel/event-consumer --prod --legacy deploy /out

FROM node:22.11.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3004
CMD ["node", "dist/index.js"]
