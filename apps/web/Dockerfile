# Сборка веб-приложения Green Pavlodar. Контекст сборки — корень репозитория
# (нужен fixtures/ с данными OSM): docker compose up --build
FROM node:22-alpine AS build
WORKDIR /repo/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY fixtures /repo/fixtures
COPY apps/web ./
# По умолчанию — тестовый источник в браузере; для сервера участника 3: --build-arg DATA_SOURCE=api
ARG DATA_SOURCE=mock
ENV VITE_DATA_SOURCE=$DATA_SOURCE
RUN npm run build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
