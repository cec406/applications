# Shopline — Maintenance Dashboard

A fully editable maintenance dashboard for a shop. It sits between a
spreadsheet and a full ERP: track work orders, an asset register,
preventive-maintenance schedules, parts inventory, people, vendors and shared
network resources — all editable in place, shared over the shop LAN in real
time, and streamable to a wall-mounted TV.

It runs **two ways from the same code**:

- **Demo mode** — no server needed. The whole shop runs in the browser with
  seeded sample data saved in the visitor's own browser. This is what you get
  when you open the files directly or host the folder on any static website —
  perfect for showing the product off on your own site.
- **Server mode** — run the zero-dependency Node server and every screen on
  the shop network shares one live database (`data/db.json`) with instant
  updates over Server-Sent Events.

Zero `npm install`, no build step, no database server, no internet connection
required.

---

## Highlights

- **Editable everywhere.** Click any cell in a table to edit it inline, or open
  the full record form. Add and delete records from any view.
- **Live on every screen.** In server mode, changes broadcast instantly over
  Server-Sent Events. An edit on the office PC appears on the shop floor and
  the wall TV immediately, with no refresh.
- **Wall board / kiosk.** A dedicated kiosk page rotates through live boards
  (overview, work order board, PM due, parts to reorder, asset status and an
  "about" closing slide) with a big clock and an activity ticker. Perfect for
  a TV or spare monitor.
- **Show it off anywhere.** Demo mode needs no backend: upload the folder to
  any static host and visitors get a fully interactive, seeded demo. A
  first-visit intro explains it, and Settings → **Reset demo data** puts the
  sample shop back.
- **Shared resources.** Keep links to manuals, SOPs, drawings and network share
  paths (`\\FILESRV\shop\...`) in one searchable place; copy a path to the
  clipboard with one click.
- **Built-in overview.** KPIs plus an "Attention Needed" list that surfaces
  overdue work orders, overdue PM, low-stock parts, down assets and work orders
  that have gone idle.
- **One-file data.** In server mode everything is stored in `data/db.json`.
  Download and restore backups from the Settings screen — in both modes.
- **Dark and light themes**, responsive layout, keyboard friendly.

---

## Requirements

- [Node.js](https://nodejs.org) **18 or newer** (24 is fine).
- Nothing else. No `npm install` needed.

---

## Quick start

### Option A — the interactive demo (no server)

Open **`index.html`** in a browser, or upload this folder to any static web
host. The dashboard starts in **demo mode**: the sample shop is loaded into the
visitor's browser, everything is editable, and changes are saved in that
browser (localStorage). Settings shows the mode badge (`DEMO · THIS BROWSER`)
and offers **Reset demo data**.

Deploy note: host the **whole folder** — the app (`public/`) imports the data
model from `shared/` one level up.

### Option B — the shop server (shared, real-time LAN mode)

```bash
cd dashboard
npm start          # or: node server.js
```

The server prints the addresses to use:

```
  Local:      http://localhost:4321
  Network:    http://192.168.1.20:4321
  Wall TV:    http://192.168.1.20:4321/display
```

- Open the **Local** address on the host machine.
- Everyone else on the shop network opens the **Network** address in a browser.

The first run seeds the dashboard with sample shop data so you can explore it.
Delete `data/db.json` (or run `npm run reset`) to start empty.

### Change the port

```bash
PORT=8080 npm start
```

---

## The wall display (kiosk)

1. On the TV / monitor PC, open the kiosk:
   - server mode: `http://<host-ip>:4321/display`
   - demo/static: open `public/display.html` (or use the **Kiosk** button)
2. Press **F** to go fullscreen. Press **Space** to pause/resume rotation.
   Arrow keys (**←** / **→**) move between boards manually.

The board rotates every 12 seconds by default and refreshes live. Configure
which boards appear and the rotation speed from **Settings → Shop & Display**
(`kioskViews` and `rotateSeconds`). The `about` closing slide introduces the
product — handy when the wall board is part of a customer-facing demo.

A single browser tab left open on the TV will stay current indefinitely — it
auto-reconnects if the server or network blips.

---

## What you can track

| Collection | Purpose |
|---|---|
| **Work Orders** | Jobs with status, priority, asset, assignee, due date, estimate. Kanban board **or** table. Drag cards between columns to change status. |
| **Assets** | The equipment register: category, location, make/model/serial, criticality, run/down state. |
| **Maintenance Schedule** | Recurring PM tasks. Set an interval and last-done date; Shopline computes the next due date and flags overdue work. "Serviced" resets the clock. |
| **Parts & Inventory** | Stock with on-hand vs. minimum, bin location, vendor and cost. `+`/`-` adjust counts; low stock is highlighted and rolls up into the overview. |
| **People** | Crew, role, shift and availability. |
| **Vendors** | Suppliers with contacts and lead times. |
| **Shared Resources** | Manuals, SOPs, drawings, videos and network folders. Web links open in a new tab; UNC paths copy to the clipboard. |

Every table has search, sortable columns, inline editing and row actions.

---

## Sharing on the network

The server binds to `0.0.0.0`, so any device on the LAN can reach it at
`http://<host-ip>:4321`. The host's current addresses are shown in the startup
banner and on the **Settings** page.

> **Security note:** there is no login. Shopline is designed for a trusted
> shop network. Do not expose it directly to the internet without adding
> authentication and TLS in front of it (e.g. a reverse proxy).

---

## Data & backups

- **Server mode:** all data lives in **`data/db.json`** on the host. Writes are
  atomic (temp file + rename), so a power loss cannot corrupt the file.
- **Demo mode:** data lives in the visitor's browser (localStorage) under the
  key `shopline.db.v1`. It self-seeds, survives reloads, and — if left
  untouched — quietly refreshes the sample data after ~45 days so a website
  demo never looks stale.
- **Settings → Data & Backups** (both modes) lets you download a complete JSON
  backup and restore one.
- To keep a nightly copy of a server's data:
  ```bash
  curl -s http://localhost:4321/api/export > "backup-$(date +%F).json"
  ```

### Starting fresh / handing it to someone

- **Demo mode:** first-time visitors always start with the pristine sample
  data automatically — nothing to clear. Your own browser: **Settings → Reset
  demo data** restores the sample shop (or delete the site's browser data).
- **Server mode, back to the sample shop:**
  ```bash
  npm run reset     # deletes data/db.json; re-seeds on next start
  ```
- **Server mode, start truly empty:** **Settings → Clear all records** (or
  `curl -X POST http://localhost:4321/api/clear`). Every work order, asset,
  part, person, vendor and resource is removed; your shop name, kiosk config
  and backups are kept.
- **Before handing over a machine**, download a final backup for your own
  records first.

---

## Run it as a background service (optional)

On a Linux host you can keep it running with `systemd`. Create
`/etc/systemd/system/shopline.service`:

```ini
[Unit]
Description=Shopline maintenance dashboard
After=network.target

[Service]
WorkingDirectory=/path/to/dashboard
ExecStart=/usr/bin/node server.js
Environment=PORT=4321
Restart=always
User=YOUR_USER

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl enable --now shopline
```

---

## Run it with Docker (optional)

No Node install and **no source code needed** — pull the published image and
run it:

```bash
docker run -d --name shopline --restart unless-stopped \
  -p 4321:4321 -v shopline-data:/app/data \
  ghcr.io/cec406/shopline:latest
```

Then open <http://localhost:4321> (wall TV: `http://<host-ip>:4321/display`).
Data is kept in the `shopline-data` volume and survives restarts and upgrades.

Prefer a compose file? Save the snippet below as `docker-compose.yml` and run
`docker compose up -d`:

```yaml
services:
  shopline:
    image: ghcr.io/cec406/shopline:latest
    container_name: shopline
    restart: unless-stopped
    ports:
      - "4321:4321"
    volumes:
      - shopline-data:/app/data

volumes:
  shopline-data:
```

**Building from source is only needed when developing** (if you have this repo
checked out):

```bash
docker compose -f container/docker-compose.yml up -d --build
```

See **[`container/README.md`](container/README.md)** for plain-Docker commands,
bind mounts, backups and multi-arch builds.

---

## Project layout

```
dashboard/
├── index.html              # main app shell at the project URL (/dashboard/)
├── display.html            # kiosk entry point
├── server.js              # zero-dependency HTTP server + REST API + SSE
├── package.json
├── container/              # Docker deployment (Dockerfile, Compose, guide)
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── README.md
├── lib/
│   ├── db.js              # JSON-file database, validation, activity log
│   └── sse.js             # live-update broadcaster
├── shared/
│   ├── schema.js          # the single source of truth for the data model
│   └── seed.js            # sample shop data used by both modes
├── public/
│   ├── index.html         # main app (also runs standalone as the demo)
│   ├── display.html       # wall-board / kiosk page
│   ├── css/styles.css
│   └── js/                # app, views, components, store, localdb, kiosk, icons
├── tests/                 # boot + demo-database tests (node --test)
└── data/
    └── db.json            # server-mode data (created on first run)
```

`shared/schema.js` defines every collection and field. Add a field there and it
appears in the tables, forms and search automatically.

---

## HTTP API (for integrations)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/state` | Full snapshot (all collections, settings, activity). |
| `GET` | `/api/events` | Server-Sent Events stream of live changes. |
| `POST` | `/api/:collection` | Create a record. |
| `PATCH` | `/api/:collection/:id` | Update fields. |
| `DELETE` | `/api/:collection/:id` | Delete a record. |
| `PATCH` | `/api/settings` | Update shop/display settings. |
| `GET` | `/api/export` | Download the whole database. |
| `POST` | `/api/import` | Restore a database backup. |
| `POST` | `/api/clear` | Empty every collection, keep settings (start clean). |

Collections: `workorders`, `assets`, `schedule`, `parts`, `people`, `vendors`,
`resources`. Send an `X-Actor: YourName` header on writes to attribute changes
in the activity log.

---

## Keyboard shortcuts

- `/` — focus global search
- `Esc` — close a dialog / cancel an inline edit
- `Enter` — open the inline editor for a focused table cell; commit on blur
- On the kiosk: `←`/`→` change board, `Space` pause, `F` fullscreen

---

## Tests

```bash
npm test    # node --experimental-vm-modules --test tests/
```

The suite boots the real browser modules in a DOM stub twice — once against a
real server (including a full "create a work order through the form" round
trip) and once with no server at all (the static/demo path) — plus unit tests
for the browser-local demo database.
