FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/painel/package.json apps/painel/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @sinaly/painel...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/painel apps/painel
RUN pnpm --filter @sinaly/painel build

# Imagem final só com o que o servidor Next precisa (output: standalone).
FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/painel/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/painel/.next/static ./apps/painel/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/painel/server.js"]
