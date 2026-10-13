# Shop Ops — Appointments · Arms Room · Notes

A locally hosted dashboard for the shop. Schedule **drop-off and pickup
appointments by unit and equipment type**, keep a running count of **weapons by
weapon type**, and maintain the **shop notes** board — all editable in place,
saved automatically, and streamable to a wall-mounted TV.

Everything is **one web file and one optional server**. No `npm install`, no
build tools, no database server, no internet connection required.

---

## Quick start — pick any way to run it

### Option A: just open the file (easiest)

Double-click **`index.html`**. That's it.

- Works straight from the file system in any modern browser.
- Everything you edit is saved **automatically** into that browser's local
  database (localStorage) and restored on the next open.
- Other tabs/windows of the *same browser* stay in sync live.
- The data lives in that one browser on that one machine — perfect for a
  single office PC or a quick trial.

### Option B: run the shop server (share it on the LAN)

```bash
node server.js
```

```
  Local:      http://localhost:4321
  Network:    http://192.168.1.20:4321     ← give this address to the shop
  Wall TV:    http://192.168.1.20:4321/display
```

- Same `index.html`, now talking to a tiny server. Every screen on the shop
  network sees edits **instantly** (Server-Sent Events, no refresh).
- All data is stored in a **single file: `data/db.json`** — atomic writes, so a
  power loss can't corrupt it.
- Requires Node.js 18+ (nothing else — the project has **zero npm
  dependencies**). After editing source files, the server rebuilds the page
  automatically on the next start (or run `node build.js` by hand).

Both modes are the same app. Settings shows which mode you're in
(`THIS BROWSER` vs `LIVE SERVER`).

### Option C: run it as a container (Docker / Podman)

No Node install and **no source code needed** — just pull the published image
and run it:

```bash
docker run -d --name shopops --restart unless-stopped \
  -p 4321:4321 -v shopops-data:/data \
  ghcr.io/cec406/mtmadash:latest
```

Then open `http://localhost:4321` (wall TV: `http://localhost:4321/display`).
Records live in the `shopops-data` volume, so restarts never lose data.

Prefer a compose file? Save the snippet below as `docker-compose.yml` and run
`docker compose up -d`:

```yaml
services:
  shopops:
    image: ghcr.io/cec406/mtmadash:latest
    container_name: shopops
    restart: unless-stopped
    ports:
      - "4321:4321"
    volumes:
      - shopops-data:/data

volumes:
  shopops-data:
```

**Building from source is only needed when developing** (if you have this repo
checked out):

```bash
docker compose -f container/docker-compose.yml up -d --build
```

See **[container/README.md](container/README.md)** for the systemd service and
publishing the image to GitHub.

### Option D: Windows PC — double-click `Start.bat` (data saved to disk)

You don't need Docker or a terminal on Windows. Install **Node.js LTS** once
from the official site — <https://nodejs.org/en/download> (grab the Windows
installer) — then **double-click `Start.bat`** in this folder.

- It starts the server and opens <http://localhost:4321> in your browser.
- Everything is saved to a real file on disk — **`data/db.json`** — not just
  the browser. Copy that file, or use Settings → Data & Backups, to back it up.
- Keep the little black window open while you use the app; close it to stop.
- Other PCs on the shop network can connect at `http://<this-PC-IP>:4321`.

Prefer the data file somewhere else? Open a Command Prompt in this folder and
run:

```bat
set DATA_FILE=C:\ShopData\db.json
node server.js
```

**No-install option:** download the **Node.js Windows .zip**, drop `node.exe`
next to `Start.bat`, and it will use that automatically — nothing gets
installed system-wide.

---

## What's on the board

| View | Purpose |
|---|---|
| **Daily Board** | The open pipeline at a glance: **INBOUND** (drop-offs) and **OUTBOUND** (pickups) side by side. Every appointment is on the board **from the day it's scheduled until it's dropped off or picked up** — upcoming visits included and grouped by day, so the shop can plan ahead. Overdue banner with one-click `Arrived` / `+1 day` actions and the shop notes underneath. Browse past days with Prev/Next. |
| **Schedule** | The full appointment calendar: a **week strip** (Mon–Sun with every visit), a drag-and-drop **status board** (Scheduled → Arrived → Completed), and a sortable **table**. Filter by unit, flow (Drop-off/Pickup), status or free text. |
| **Weapons** | Arms-room counts **by weapon type**: big cards per type, `−`/`＋` to adjust as arms are signed in and out, a total on-hand KPI and a count-by-type chart. |
| **Shop Notes** | The pass-down board. Post a note, edit or delete it; notes are timestamped and appear on the Daily Board and the wall TV. |
| **Units** | The roster of units that visit the shop — name, POC, phone. Units appear here automatically as you type them while scheduling, and scheduling from a unit's row is one click. |
| **Overview** | A single summary screen: today's numbers, what needs attention (overdue, no-shows), the next seven days, weapons by type and recent activity. |
| **Activity** | A live log of everything that changed, with who changed it (set your name in Settings). |
| **Settings** | Shop name, wall-board rotation, equipment-type suggestions, your display name, **legacy CSV import**, JSON backup/restore, and **clear all data**. |

### Appointments

An appointment captures **who (unit), when (date + time), which way (Drop-off or
Pickup), and what (equipment lines)**. Each equipment line is
`type + quantity + description` — e.g. `2× Generator — MEP-803A #3, #7`. Status
moves **Scheduled → Arrived → Completed** (plus **No-show** / **Cancelled**),
either with the quick buttons on a card or by dragging cards on the status
board. Anything still "Scheduled" after its time passes shows up in the red
**Overdue** banner with one-click `Arrived` / `+1 day` actions.

**Appointments stay on the Daily Board from the day they are scheduled until
they are picked up or dropped off.** A drop-off booked for next week already
appears on today's board (grouped under its date), and it stays there — every
day — until it's completed. Completed and cancelled appointments leave the
board; the full history stays on the Schedule page, and past days can still be
browsed day by day on the Daily Board.

**Units are typed, not picked.** In the appointment form you type the unit name
(e.g. `A/2-1 IN`); a name you've used before is suggested as you type, and a new
one is created automatically and appears on the **Units** page. No up-front
setup needed.

**Times can be TBD.** Tick the **TBD** box next to the time when the slot isn't
pinned down yet. The card shows `TBD` in place of a time, it still appears on the
board and in counts, and it doesn't turn red as overdue on the day itself (only
once the day has passed).

### Equipment types

The appointment form suggests equipment types from the **Equipment Types** list
(Settings). It's only a suggestion — the field accepts free text, so a new type
can be typed inline any time.

---

## Bringing over your old Streamlit data

The old tracker used three CSVs. Settings → **Import from the old Streamlit
tracker** accepts them directly:

| Old file | Columns | Becomes |
|---|---|---|
| `equipment.csv` | `TIME, Unit, Equipment, Direction, Notes` | Appointments — `12/25 07:30` becomes date+time, multi-line equipment becomes equipment lines, `Incoming/Outgoing` becomes **Drop-off/Pickup**, and units are created automatically. Past rows are marked Completed. |
| `weapons.csv` | `Weapon, Count` | Weapon types with their counts. |
| `shop_notes.csv` | `Message` | Shop notes. |

Select all three files at once (or any subset). Import appends — run it once on
a fresh database. Quantity markers like `Generator x2` are understood.

---

## The wall display (kiosk)

1. On the TV / monitor PC, open `http://<host-ip>:4321/display`.
2. Press **F** for fullscreen, **Space** to pause rotation, **←/→** to switch
   boards manually.

It rotates through **Drop-offs & Pickups → Schedule (7 days) → Weapons → Shop Notes**
(every 14 s by default; configure `kioskViews` and `rotateSeconds` in
Settings). The board updates live over SSE and auto-reconnects after a network
blip.

---

## Data & backups

- **Server mode:** all data in `data/db.json`. Download a JSON backup from
  Settings → Data & Backups (or `curl http://localhost:4321/api/export >
  backup.json`) and restore one to move machines.
- **File mode:** the data lives in the browser's localStorage. The same
  Download/Restore buttons work — use them to move a browser's data to the
  server (or between machines).
- **Start over:** Settings → Data & Backups → **Clear all data** removes every
  appointment, unit, weapon and note (your shop name, wall-board settings and
  equipment-type list are kept). In server mode you can also just delete
  `data/db.json` and restart.

The app starts **empty** — add appointments, weapons and notes as you go, or
import your old CSVs (below). A short getting-started panel on the Daily Board
walks you through the first steps until there's data.

---

## HTTP API (server mode)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/state` | Full snapshot (all collections, settings, activity). |
| `GET` | `/api/events` | Server-Sent Events stream of live changes. |
| `POST` | `/api/:collection` | Create a record. |
| `PATCH` | `/api/:collection/:id` | Update fields. |
| `DELETE` | `/api/:collection/:id` | Delete a record. |
| `PATCH` | `/api/settings` | Update settings. |
| `GET` | `/api/export` | Download the whole database. |
| `POST` | `/api/import` | Restore a database backup. |

Collections: `appointments`, `units`, `weapons`, `notes`, `eqtypes`.
Send an `X-Actor: YourName` header on writes to attribute the change in the
activity log. A unit can be referenced **by name** instead of id — the server
creates it if it doesn't exist (handy for scripts/imports).

---

## Run it as a background service (optional)

Two ways: run the container under systemd (see
**[container/README.md](container/README.md)** and `container/shopops.service`),
or run Node directly.

### Run Node directly

Create `/etc/systemd/system/shopops.service`:

```ini
[Unit]
Description=Shop Ops dashboard
After=network.target

[Service]
WorkingDirectory=/path/to/MTMAdash
ExecStart=/usr/bin/node server.js
Environment=PORT=4321
Restart=always
User=YOUR_USER

[Install]
WantedBy=multi-user.target
```

Then: `sudo systemctl enable --now shopops`

Change the port with `PORT=8080 node server.js`.

---

## Security note

There is no login. This is designed for a trusted shop network; don't expose it
to the internet without adding authentication/TLS in front (e.g. a reverse
proxy). The server never serves its own code, tooling or the database file
over HTTP.

---

## Project layout

```
MTMAdash/
├── index.html          ← THE APP (built single file — double-click it)
├── display.html        ← the wall-board/kiosk page (built single file)
├── server.js           ← zero-dependency HTTP server + REST API + SSE
├── Start.bat           ← Windows: double-click to run (saves to data/db.json)
├── build.js            ← bundles js/ css/ shared/ into the two HTML files
├── js/                 ← modular sources (app, views, components, store…)
├── css/styles.css      ← theme + all styles
├── shared/             ← data model (schema), CSV importer, seed data
├── lib/                ← server-side db (JSON file) + SSE broadcaster
├── container/          ← Dockerfile, compose stack, systemd unit (optional)
├── data/db.json        ← your data (server mode; created on first run)
└── tests/              ← test suite:  node --test tests/*.test.js
```

`shared/schema.js` is the single source of truth for the data model — a field
added there shows up in tables, forms and search automatically.

---

## Tests

```bash
node --test tests/*.test.js
```

Covers the data model, the legacy CSV importer, the JSON-file database, the
browser-local database, the bundler, and the running server (API lifecycle,
static file protection, SSE).
