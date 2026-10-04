# Studio: build the SPA, serve it with nginx (proxying /api to the engine).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && node scripts/check-dist-paths.mjs dist

FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# Agent bridge token meta, written into index.html at container start (never at build).
COPY --chmod=0755 docker/40-dtk-ui-token.sh /docker-entrypoint.d/40-dtk-ui-token.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
