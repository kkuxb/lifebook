FROM docker.m.daocloud.io/library/node:22-bookworm-slim AS builder

WORKDIR /app

RUN sed -i "s/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ENV npm_config_registry=https://registry.npmmirror.com
ENV npm_config_disturl=https://npmmirror.com/mirrors/node
ENV npm_config_better_sqlite3_binary_host_mirror=https://npmmirror.com/mirrors/better-sqlite3

RUN npm install -g pnpm@11.7.0

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY packages/core packages/core
COPY apps/api apps/api
COPY apps/web apps/web

RUN pnpm --filter @lifebook/core build \
    && pnpm --filter @lifebook/web build \
    && pnpm --filter @lifebook/api build

FROM docker.m.daocloud.io/library/node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3220
ENV DATA_DIR=/data
ENV TZ=Asia/Shanghai
ENV WEB_DIST_DIR=/app/apps/web/dist

RUN sed -i "s/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    wget tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /data

RUN DATA_DIR=/tmp/smoke-db node -e "import('./apps/api/dist/app.js').then(m => { const inst = m.createLifebookApp(); inst.close(); console.log('SMOKE_OK'); })" \
    && rm -rf /tmp/smoke-db

EXPOSE 3220

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3220/api/health || exit 1

CMD ["node", "apps/api/dist/server.js"]
