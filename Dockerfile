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
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
