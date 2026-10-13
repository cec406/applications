# Shopline in a container

Run the whole [Shopline](../README.md) maintenance dashboard in a single
container. It is a zero-dependency Node app, so the image is small, needs no
build step and no database server — the entire shop lives in one
`data/db.json` file kept in a Docker volume.

Everything Docker-related lives in this folder so the app code stays clean:

| File | Purpose |
|---|---|
| `Dockerfile` | Builds the image. Build context is the project root (`..`). |
| `docker-compose.yml` | One-command run with a persistent data volume. |
| `README.md` | This guide. |

The one file that must sit at the project root is `.dockerignore`, because
Docker always reads the ignore file from the build-context root. It keeps the
live database and dev files out of the image.

---

## Quick start (Docker Compose)

The image is published at `ghcr.io/cec406/shopline`, so you can either pull it
(preferred — no source needed) or build from this repo.

**Just run the published image.** Save the `docker-compose.yml` from the root
README (it has no build step) into any folder and run:

```bash
docker compose up -d
```

**Build from this repo instead** (for development):

```bash
docker compose -f container/docker-compose.yml up -d --build
```

Then open:

- **This machine:** <http://localhost:4321>
- **Shop network:** `http://<host-ip>:4321`
- **Wall TV / kiosk:** `http://<host-ip>:4321/display`

The first start seeds the dashboard with sample shop data so you can explore
it. Data is stored in the named volume `shopline-data` and survives restarts,
rebuilds and upgrades.

Useful commands:

```bash
docker compose -f container/docker-compose.yml logs -f      # follow logs
docker compose -f container/docker-compose.yml restart      # restart
docker compose -f container/docker-compose.yml down         # stop (keeps data)
docker compose -f container/docker-compose.yml up -d --build  # rebuild + update
```

Serving on a different host port:

```bash
SHOPLINE_PORT=8080 docker compose -f container/docker-compose.yml up -d
```

---

## Quick start (plain Docker)

```bash
# Build (from the project root — note the trailing dot for the context)
docker build -f container/Dockerfile -t shopline .

# Run, keeping the database in a named volume
docker run -d \
  --name shopline \
  --restart unless-stopped \
  -p 4321:4321 \
  -v shopline-data:/app/data \
  shopline
```

---

## Where the data lives

| Mode | Location | Notes |
|---|---|---|
| Named volume (default) | volume `shopline-data` | Managed by Docker; easiest and safest. |
| Bind mount | a host folder, e.g. `./data` | Visible on disk; handy for scripted backups. |

To use a host folder you can see and back up directly, edit
`docker-compose.yml` and swap the named volume for the bind mount
(instructions are commented inline). On Linux, set the folder's owner to the
container user first:

```bash
mkdir -p ./data && sudo chown -R 1000:1000 ./data
```

The container runs as the unprivileged `node` user (UID 1000).

### Backups

The API exposes a full JSON backup, so anything that can reach the server can
snapshot it:

```bash
curl -s http://localhost:4321/api/export > "shopline-backup-$(date +%F).json"
```

Or copy the file straight out of the volume:

```bash
docker run --rm -v shopline-data:/data -v "$PWD:/out" \
  alpine cp /data/db.json "/out/shopline-backup-$(date +%F).json"
```

Restore a backup from the app's **Settings → Data & Backups** screen, or with
the API:

```bash
curl -X POST http://localhost:4321/api/import \
  -H 'Content-Type: application/json' \
  --data-binary @shopline-backup.json
```

---

## Configuration

The image honours the same environment variables as the server:

| Variable | Default (in image) | Purpose |
|---|---|---|
| `PORT` | `4321` | Port the server listens on **inside** the container. |
| `HOST` | `0.0.0.0` | Bind address; keep this to reach it from the LAN. |
| `DATA_FILE` | `/app/data/db.json` | Path to the database file inside the container. |

To change the **host** port, change the left side of the `ports:` mapping (or
set `SHOPLINE_PORT`) instead of `PORT` — leave the container port at `4321`.

---

## Building for other architectures / registries

The image is a plain `node:22-alpine` base, so it builds for both `amd64` and
`arm64` (useful for a Raspberry Pi kiosk or an arm64 server):

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f container/Dockerfile -t youruser/shopline:latest --push .
```

Once pushed, anyone can run it without the source tree:

```bash
docker run -d -p 4321:4321 -v shopline-data:/app/data youruser/shopline:latest
```

---

## Publishing this to GitHub (GHCR)

Shopline is designed to live in the **`cec406/applications` monorepo**, in the
`dashboard/` subfolder, and publishes its **own** image
(`ghcr.io/cec406/shopline`) so it stays separate from your other apps.

GitHub only runs workflows from the **repository root's** `.github/workflows/`
folder — never from a subfolder — so create the workflow there, at
`.github/workflows/shopline.yml`:

```yaml
name: shopline-container

on:
  push:
    branches: [main, master]
    tags: ['shopline-v*']
    paths:
      - 'dashboard/**'
      - '.github/workflows/shopline.yml'
  pull_request:
    branches: [main, master]
    paths:
      - 'dashboard/**'
      - '.github/workflows/shopline.yml'
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository_owner }}/shopline

jobs:
  test:
    name: Test suite
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: dashboard
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node --experimental-vm-modules --test tests/*.test.js

  build:
    name: Build & publish image
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Log in to the container registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Extract metadata (tags, labels)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}
      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: dashboard
          file: dashboard/container/Dockerfile
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

It runs the test suite (`cd dashboard`), then builds
`dashboard/container/Dockerfile` with build context `dashboard` and pushes to
the GitHub Container Registry:

- a push to `main`/`master` that touches `dashboard/**` →
  `ghcr.io/cec406/shopline:latest` (and `:<branch>`)
- a `shopline-v*` tag → `ghcr.io/cec406/shopline:<version>`
- or trigger it by hand from **Actions → shopline-container → Run workflow**

No repository secrets are required — it uses the built-in `GITHUB_TOKEN`. Make
the package public (or log in to pull it) under **Packages → shopline →
Package settings**.

---

## Notes

- **No authentication.** Shopline is built for a trusted shop network. Do not
  expose it directly to the internet — put a reverse proxy with auth and TLS in
  front if you must.
- **The container is stateless** apart from `/app/data`. Back up the volume
  before upgrades and you can rebuild freely.
