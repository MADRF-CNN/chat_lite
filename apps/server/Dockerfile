FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY apps/server/package.json apps/server/tsconfig*.json apps/server/nest-cli.json ./apps/server/
COPY apps/server/prisma ./apps/server/prisma
RUN pnpm install --frozen-lockfile
COPY apps/server/src ./apps/server/src
COPY apps/server/scripts ./apps/server/scripts
RUN pnpm --filter @chat-lite/shared build && pnpm --filter @chat-lite/server prisma:generate && pnpm --filter @chat-lite/server build

FROM node:24-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @chat-lite/server exec prisma migrate deploy && pnpm --filter @chat-lite/server start"]
