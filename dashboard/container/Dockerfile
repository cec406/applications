# syntax=docker/dockerfile:1
#
# Shopline — containerized maintenance dashboard
# ------------------------------------------------
# The build context is the project root (one level above this file), because
# the server needs server.js, lib/, shared/ and public/ alongside the Dockerfile.
#
#   docker build -f container/Dockerfile -t shopline .
#   docker run -d --name shopline -p 4321:4321 -v shopline-data:/app/data shopline
#
# Or, more easily, use the bundled Compose file:
#
#   docker compose -f container/docker-compose.yml up -d --build
#
FROM node:22-alpine

# tini is a tiny init that forwards signals and reaps zombies, so `docker stop`
# reaches the app and it can save the database before exiting.
RUN apk add --no-cache tini

# The app has no runtime dependencies, so there is nothing to `npm install`.
WORKDIR /app

# Copy only what the server actually serves or imports.
COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY display.html ./
COPY lib/ ./lib/
COPY shared/ ./shared/
COPY public/ ./public/

# Data lives in /app/data. Own it as the unprivileged "node" user so the app can
# write db.json, and declare it as a volume so it survives container replacement.
RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production \
    PORT=4321 \
    HOST=0.0.0.0 \
    DATA_FILE=/app/data/db.json

USER node

EXPOSE 4321
VOLUME ["/app/data"]

# Ask the API for a snapshot; 200 means the database loaded and the server is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/api/state').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
