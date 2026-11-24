# Timeweb App Platform reads EXPOSE and proxies to this port.
# Panel variables are runtime environment, not image build arguments.
# Do not add ARG or ENV for SUPABASE_SERVICE_ROLE_KEY. The server reads it
# from the container environment after the process starts.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN if [ -e .env ] || [ -e .env.local ] || [ -e .env.production ]; then echo "env files must stay out of the image build" && exit 1; fi \
  && npm run build && npm run build:server \
  && ! grep -R "SUPABASE_SERVICE_ROLE_KEY" dist

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs ./server.mjs
USER node
EXPOSE 8080
# No HEALTHCHECK. Timeweb treats one as the deploy gate and left the
# container at "starting" for the whole 180s window after /health had
# already returned 200. The panel path /health accepts a single 2xx.
CMD ["node", "server.mjs"]
