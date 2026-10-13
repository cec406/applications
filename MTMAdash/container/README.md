# Shop Ops in a container

Run the dashboard as a single, self-contained container image. It has **no npm
dependencies** — the image just bundles Node and the app — so it stays tiny and
builds in seconds.

Everything in this folder is the packaging; the app itself lives one level up.

```
container/
├── Dockerfile            ← multi-stage: bundle the app, then ship the runtime
├── docker-compose.yml    ← build + run with one command (recommended)
├── shopops.service       ← run the image as a systemd service
├── .env.example          ← optional image/port overrides
└── README.md
```

This app is designed to live in the **`cec406/applications` monorepo**, in the
`MTMAdash/` subfolder, and publishes its **own** image
(`ghcr.io/cec406/mtmadash`) so it stays separate from your other apps:

```
applications/                 ← the git repo
├── .github/workflows/
│   └── mtmadash.yml          ← CI (GitHub only runs workflows from the repo root)
├── MTMAdash/                 ← this project
│   └── container/ …
└── some-other-app/
```

All commands below are run from inside the `MTMAdash/` folder. The build context
is this folder, so the other apps in the monorepo are never touched.

---

## Quick start with Docker Compose

From the **`MTMAdash/` folder**:

```bash
docker compose -f container/docker-compose.yml up -d --build
```

Then open:

| What | URL |
|---|---|
| App | http://localhost:4321 |
| Wall board / kiosk | http://localhost:4321/display |

Give the shop the host's LAN address, e.g. `http://192.168.1.20:4321`.

Stop it with `docker compose -f container/docker-compose.yml down`. Data is kept
in the named volume `shopops-data`, so `down`/`up` never loses records. To wipe
everything, `docker compose -f container/docker-compose.yml down -v`.

### Podman

The same files work with Podman (run from `MTMAdash/`):

```bash
podman build -f container/Dockerfile -t shopops .
podman run -d --name shopops -p 4321:4321 -v shopops-data:/data shopops
```

---

## Plain `docker run`

```bash
# 1. Build from the MTMAdash/ folder (that folder is the build context).
docker build -f container/Dockerfile -t shopops .

# 2. Run it with a volume for the database.
docker run -d --name shopops \
  --restart unless-stopped \
  -p 4321:4321 \
  -v shopops-data:/data \
  shopops
```

---

## Run it as a service (systemd)

1. Build (or pull) the image so it exists on the host:

   ```bash
   docker build -f container/Dockerfile -t ghcr.io/cec406/mtmadash:latest .
   # or: docker pull ghcr.io/cec406/mtmadash:latest
   ```

2. Install the unit and start it:

   ```bash
   sudo cp container/shopops.service /etc/systemd/system/shopops.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now shopops
   sudo systemctl status shopops
   ```

   The unit runs `docker run … shopops-data:/data` and restarts automatically.
   Change the port, volume or image tag by editing the `ExecStart` line.

> Using rootless Podman as your own user? Copy `shopops.service` to
> `~/.config/systemd/user/shopops.service`, replace `docker` with `podman`, then
> `systemctl --user enable --now shopops`.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4321` | Port the container listens on. |
| `HOST` | `0.0.0.0` | Bind address (keep `0.0.0.0` to reach it over the LAN). |
| `DATA_FILE` | `/data/db.json` | Where the JSON database is stored — keep it on the volume. |
| `TZ` | image default | Timezone for timestamps, e.g. `America/New_York`. |

The database is a single atomic JSON file on the `/data` volume. Back it up any
time from **Settings → Data & Backups → Download backup**, or by copying the
volume / `db.json` file off the host.

---

## Publishing to GitHub (GHCR)

The workflow is `MTMAdash/.github/workflows/container.yml`, but **GitHub only
reads workflows from the repository root**, so in the monorepo it must also
exist at `applications/.github/workflows/mtmadash.yml`:

```bash
# from the applications repo root
mkdir -p .github/workflows
cp MTMAdash/.github/workflows/container.yml .github/workflows/mtmadash.yml
```

It runs the test suite (`cd MTMAdash`), then builds `MTMAdash/container/Dockerfile`
with build context `MTMAdash` and pushes to the GitHub Container Registry:

- every push to the default branch that touches `MTMAdash/**` →
  `ghcr.io/cec406/mtmadash:<branch>` and `:latest`
- every `mtmadash-v*` tag → `ghcr.io/cec406/mtmadash:<version>`
- or trigger it by hand from **Actions → mtmadash-container → Run workflow**

It only fires when files under `MTMAdash/` change, so your other apps' pushes
won't rebuild this image. No repository secrets are required — it uses the
built-in `GITHUB_TOKEN`. Make the package public (or log in to pull it) under
**Packages → mtmadash → Package settings**.

---

## Notes

- The container runs as the unprivileged `node` user, not root.
- A `HEALTHCHECK` polls `GET /api/state` so `docker ps` shows `healthy`.
- `SIGTERM` flushes the database to disk before the process exits, so
  `docker stop` (and systemd restarts) are always safe.
- There is **no authentication** — expose it only on a trusted shop network. Put
  a reverse proxy with auth/TLS in front if you must reach it remotely.
