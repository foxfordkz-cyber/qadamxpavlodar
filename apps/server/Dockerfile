FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY apps/server/package*.json ./
RUN npm ci
COPY apps/server ./
RUN npm run build && mkdir -p data uploads && chown -R node:node /app
USER node
ENV NODE_ENV=development LOCAL_CONTAINER=1 PORT=3100 FRONTEND_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh","-c","npm run seed:v2 && npm start"]
