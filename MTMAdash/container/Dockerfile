# syntax=docker/dockerfile:1
#
# Shop Ops — self-contained dashboard image.
#
# The project has ZERO npm dependencies, so there is no `npm install` step.
# Stage 1 bundles the modular sources (js/, css/, shared/) into the two
# single-file pages. Stage 2 ships the runtime, which can serve the app and
# (re)build it on startup if the sources ever change.
#
# Build from the repository root:
#   docker build -f container/Dockerfile -t shopops .
#   podman build -f container/Dockerfile -t shopops .

# ---- Stage 1: bundle the app -------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json build.js favicon.svg ./
COPY css ./css
COPY js ./js
COPY shared ./shared
RUN node build.js

# ---- Stage 2: runtime --------------------------------------------------------
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=4321 \
    HOST=0.0.0.0 \
    DATA_FILE=/data/db.json

WORKDIR /app

# Runtime code + sources (so `server.js` can rebuild the bundle on first start
# if the built pages are missing or stale).
COPY package.json server.js build.js favicon.svg manifest.webmanifest ./
COPY lib ./lib
COPY css ./css
COPY js ./js
COPY shared ./shared
COPY --from=build /app/index.html ./index.html
COPY --from=build /app/display.html ./display.html

# The database lives on a volume so the shop's records survive re-creating the
# container. Create it and hand ownership to the unprivileged `node` user.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/api/state').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
