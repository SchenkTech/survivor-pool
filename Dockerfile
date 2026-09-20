# One image: the API serves the built PWA, so there is one container to run,
# one port to expose and one volume (/data) to back up.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm test -w @sp/engine && npm run typecheck -w @sp/api && npm run build -w @sp/web

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/survivor.db \
    WEB_DIST_DIR=/app/apps/web/dist \
    NODE_NO_WARNINGS=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine packages/engine
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w @sp/api && npm cache clean --force && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn*
COPY apps/api/src apps/api/src
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/apps/api
CMD ["node", "src/server.ts"]
