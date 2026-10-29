# Сервер Green Pavlodar (SRV-03). Контекст сборки — корень репозитория:
# расчёты ТЗ берутся из apps/web/src/shared/analytics, данные OSM — из fixtures/osm.
# Запуск: docker compose up --build (см. docker-compose.yml и README).
FROM node:24-alpine
WORKDIR /app/apps/server
COPY apps/server/package.json apps/server/package-lock.json ./
# tsx нужен и в работе: сервер запускается из исходников TypeScript вместе с общими модулями веба.
RUN npm ci --include=dev && npm cache clean --force
COPY apps/server/tsconfig.json ./
COPY apps/server/scripts ./scripts
COPY apps/server/src ./src
# package.json веба — только ради "type": "module": tsx грузит общие модули как ESM, как в разработке.
COPY apps/web/package.json /app/apps/web/package.json
COPY apps/web/src/shared /app/apps/web/src/shared
COPY fixtures/osm/sites.json fixtures/osm/surroundings.json fixtures/osm/greenery.json /app/fixtures/osm/
COPY fixtures/pavlodar /app/fixtures/pavlodar
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3100 \
    STORAGE_ROOT=/data \
    TRUST_PROXY=uniquelocal
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -q -O /dev/null --header="Host: localhost" http://127.0.0.1:3100/health || exit 1
# Демо-данные досеваются при каждом старте: существующие записи и пароли не перезаписываются.
CMD ["sh", "-c", "node --import ./scripts/local-network-guard.mjs --import tsx src/tz/seed-cli.ts && exec node --import ./scripts/local-network-guard.mjs --import tsx src/server.ts"]
