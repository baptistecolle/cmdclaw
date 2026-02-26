# syntax=docker/dockerfile:1

FROM oven/bun:1.3.9 AS deps
WORKDIR /app
RUN bun --version
COPY package.json bun.lock ./
RUN NODE_ENV=development bun install --frozen-lockfile

FROM oven/bun:1.3.9 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
ARG SKIP_ENV_VALIDATION=1
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ENV SKIP_ENV_VALIDATION=${SKIP_ENV_VALIDATION}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY} \
    NEXT_PUBLIC_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST}
RUN test -n "${NEXT_PUBLIC_APP_URL}" || (echo "Missing build-time NEXT_PUBLIC_APP_URL" && exit 1)
RUN bun run build

FROM oven/bun:1.3.9 AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/src/env.js ./src/env.js
COPY --from=builder /app/src/sandbox-templates/common/skills ./src/sandbox-templates/common/skills
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "run", "start"]
