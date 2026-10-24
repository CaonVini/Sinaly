FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @sinaly/api...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @sinaly/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
WORKDIR /repo/apps/api
EXPOSE 3333
CMD ["node", "--import", "tsx", "dist/server.js"]
