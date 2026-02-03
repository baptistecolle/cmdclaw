# syntax=docker/dockerfile:1

FROM oven/bun:1.2.8 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile

FROM oven/bun:1.2.8 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM oven/bun:1.2.8 AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "run", "start"]
