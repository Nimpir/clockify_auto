# clockify_fill — Clockify Time Entry Automation

Fills a Clockify workspace with ticket-based time entries for a given month,
distributing work evenly across tickets and respecting already-logged time.

Available as a **CLI Python script** and a **desktop GUI app** (Tauri + React).

---

## Desktop App (recommended)

A cross-platform desktop app built with Tauri v2 and React.

### Requirements

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable toolchain)
- Python 3.10+ with `pip install pyinstaller requests`

### Build

```bash
# 1. Compile the Python sidecar
pyinstaller --onefile --name clockify_fill clockify_fill.py
cp dist/clockify_fill.exe clockify-fill-app/src-tauri/binaries/clockify_fill-x86_64-pc-windows-msvc.exe

# 2. Generate app icons (only needed once)
cd clockify-fill-app
npx @tauri-apps/cli icon app-icon.png

# 3. Run in dev mode
npm run tauri dev

# 4. Build installer
npm run tauri build
```

### App structure

```
clockify-fill-app/
├── src/
│   ├── App.tsx                 # Root: routing, toasts, settings load
│   ├── pages/
│   │   ├── Dashboard.tsx       # Year overview — month cards grid
│   │   └── Settings.tsx        # Settings form
│   ├── components/
│   │   ├── MonthDetail.tsx     # Per-month workflow panel
│   │   ├── PlanTable.tsx       # Plan entries table
│   │   ├── MonthCard.tsx       # Month status card
│   │   ├── NavBar.tsx          # Top navigation bar
│   │   ├── YearSwitcher.tsx    # Year navigation
│   │   └── Toast.tsx           # Toast notifications
│   └── lib/
│       ├── storage.ts          # File I/O: settings, meta, tickets, plan
│       ├── sidecar.ts          # Python sidecar invocation
│       ├── logger.ts           # Session log file
│       └── types.ts            # Shared TypeScript types
└── src-tauri/
    ├── capabilities/default.json   # Tauri permission scopes
    ├── binaries/                   # Compiled Python sidecar (not committed)
    └── icons/                      # App icons (generated)
```

### Workflow

1. **Dashboard** — shows all 12 months of the selected year as status cards.
2. **Open a month** — click a card to open the month detail panel.
3. **Load tickets** — paste or import a `tickets.txt` file; or edit inline.
4. **Load existing entries** — either click **From Clockify** to fetch them directly from the API, or **Load CSV** to import a Clockify Detailed Report CSV.
5. **Days off** — expand the collapsible panel to click individual weekdays to skip (vacation, holidays). Persisted to `skip_days.json`.
6. **Generate** — runs the Python sidecar in dry-run mode; previews the plan.
7. **Submit** — sends all new entries to the Clockify API with live progress.
8. **Invoice** — generate an `.xlsx` invoice from the plan. Set the amount and invoice number inline.
9. **Open folder** — opens the month's data directory in Explorer (creates it if needed).

### Settings

| Field | Description |
|---|---|
| **API Key** | Clockify API key (show/hide toggle + live connection test) |
| **Workspace ID** | 24-character Clockify workspace ID |
| **Window start / end** | Daily work window (e.g. 12:00–20:00) |
| **Timezone** | IANA timezone for entry scheduling |
| **Skip weekends** | Exclude Sat/Sun from scheduling |
| **Default monthly total (USD)** | Default invoice amount used when generating invoices. Can be overridden per-month in the month detail panel. |
| **Documents path** | Base directory for month data folders. Defaults to app data dir (`%APPDATA%\com.clockifyfill.app\months`). When set, months are stored as `<documents_path>\YYYY-MM\`. |

### Data directory layout

Each month gets its own subdirectory:

```
<documents_path>/
└── 2026-03/
    ├── tickets.txt          # Ticket list
    ├── clockify_report.csv  # Existing entries (fetched or imported)
    ├── skip_days.json       # Days excluded from scheduling (vacation, etc.)
    ├── config.json          # Auto-generated sidecar config
    ├── plan.json            # Generated plan (machine-readable)
    ├── plan.csv             # Generated plan (human-readable)
    ├── meta.json            # UI state (status, timestamps, counts)
    └── invoice_espana_20260331.xlsx  # Generated invoice (if any)
```

### Logging

Each app session writes a log file to `<documents_path_base>/../logs/` (always inside the app data dir regardless of the documents path setting):

```
%APPDATA%\com.clockifyfill.app\logs\2026-03-16_14-30-22.log
```

Log levels: `INFO`, `WARN`, `ERROR`, `DEBUG`. All sidecar stdout/stderr is captured on failure.

---

## CLI script

### Requirements

- Python 3.10+
- [`requests`](https://pypi.org/project/requests/) library

```bash
pip install requests
```

### `config.json` (CLI only)

The desktop app generates this file automatically from Settings. CLI users must create it manually:

```json
{
    "clockify_api_key": "YOUR_API_KEY_HERE",
    "workspace_id":     "YOUR_WORKSPACE_ID_HERE",
    "month":            "2026-03",
    "work_start":       "12:00",
    "work_end":         "20:00",
    "timezone":         "Europe/Madrid",
    "skip_weekends":    true,
    "monthly_total":    3500,
    "invoice_number":   "espana"
}
```

Inline `//` comments are supported.

### Quick start

```bash
# Preview what would be created (no API calls)
python clockify_fill.py --dry-run

# Preview a different month
python clockify_fill.py --month 2026-04 --dry-run

# Create entries (prompts for confirmation)
python clockify_fill.py

# Skip specific days (vacation, holidays)
python clockify_fill.py --skip-days 2026-03-17,2026-03-18 --dry-run

# Use custom file paths
python clockify_fill.py --tickets my_tickets.txt --report march_export.csv --config prod.json

# Generate invoice from existing plan
python clockify_fill.py --invoice --config 2026-03/config.json
```

### CLI flags

| Flag | Default | Description |
|---|---|---|
| `--tickets PATH` | `tickets.txt` | Path to tickets file |
| `--report PATH` | `clockify_report.csv` | Path to Clockify CSV export |
| `--config PATH` | `config.json` | Path to config file |
| `--output-json PATH` | _(none)_ | Write plan to JSON file |
| `--output-csv PATH` | _(none)_ | Write plan to CSV file |
| `--from-json PATH` | _(none)_ | Submit a previously saved plan JSON |
| `--dry-run` | off | Show plan only, skip API calls |
| `--month YYYY-MM` | from config | Override target month |
| `--skip-days DATES` | _(none)_ | Comma-separated `YYYY-MM-DD` dates to exclude (vacation, holidays) |
| `--invoice` | off | Generate `.xlsx` invoice from plan.json instead of scheduling entries |
| `--plan PATH` | same dir as config | Path to `plan.json` (used with `--invoice`) |
| `--invoice-output PATH` | same dir as config | Output `.xlsx` path (used with `--invoice`) |

---

## Input files

### `tickets.txt`

One ticket per line, pipe-separated:

```
# 3-field format (ticket active for the whole month)
PROJ-101 | Implement OAuth2 login flow      | 6743a1b2c3d4e5f600000001

# 5-field format (ticket active only within a date range)
PROJ-102 | Fix payment gateway timeout bug  | 6743a1b2c3d4e5f600000002 | 2026-03-01 | 2026-03-15
PROJ-103 | Add unit tests for checkout      | 6743a1b2c3d4e5f600000003 | 2026-03-16 | 2026-03-31
```

Fields: `Jira key | Title | Clockify Project ID | date_from (optional) | date_to (optional)`

- Date format: `YYYY-MM-DD`. Both `date_from` and `date_to` are optional — omit either to leave that end unbounded.
- On days covered by multiple tickets, time is split evenly among them.
- If a workday falls outside all tickets' ranges, it is assigned to the ticket with the closest date range.
- Lines starting with `#` are ignored.

### `clockify_report.csv`

Standard **Detailed Report** CSV exported from Clockify (Reports → Detailed → Export CSV).
The script uses these columns: `Project`, `Description`, `Start Date`, `Start Time`,
`End Date`, `End Time`. All other columns are ignored.

The report must cover the target month. Entries outside the `work_start`–`work_end`
window are clipped or discarded.

---

## How to obtain credentials

### Clockify API key

1. Log in to [clockify.me](https://clockify.me)
2. Click your avatar (top-right) → **Profile settings**
3. Scroll to the **API** section at the bottom
4. Click **Generate** (or copy the existing key)

### Workspace ID

Clockify organises entries into workspaces. The workspace ID tells the API where to create entries. You can belong to multiple workspaces (e.g. personal and company), so this must be specified.

Option A — from the browser URL (navigate to your workspace settings):
```
https://clockify.me/workspaces/6743a1b2c3d4e5f600000099/settings
                               ^^^^^^^^^^^^^^^^^^^^^^^^
```

Option B — from the API (replace `YOUR_API_KEY`):
```bash
curl -H "X-Api-Key: YOUR_API_KEY" https://api.clockify.me/api/v1/workspaces
```

### Project ID

Option A — from the browser URL when viewing a project:
```
https://clockify.me/workspaces/.../projects/6743a1b2c3d4e5f600000001/...
                                             ^^^^^^^^^^^^^^^^^^^^^^^^
```

Option B — from the API:
```bash
curl -H "X-Api-Key: YOUR_API_KEY" \
     "https://api.clockify.me/api/v1/workspaces/WORKSPACE_ID/projects"
```

### Exporting the Clockify CSV

1. Go to **Reports → Detailed**
2. Set the date range to the full target month
3. Remove all filters (or keep only the relevant workspace/user)
4. Click **Export → CSV**
5. Save as `clockify_report.csv` in the month folder

---

## How it works

1. **Parse** — reads tickets, CSV report, and working days for the month.
2. **Distribute** — calculates free time slots (gaps within the `work_start`–`work_end`
   window not covered by existing entries) and divides total free hours evenly across
   all tickets. Each ticket gets `total_free_hours / ticket_count` hours.
3. **Preview** — prints a full day-by-day schedule. Existing entries are shown in grey.
4. **Approve** — prompts `yes/no`. On `no`, exits without touching the API.
5. **Create** — POSTs each new entry to the Clockify API, converting local times to UTC.
   A 0.2 s delay is added between requests to stay under the rate limit.

### Scheduling rules

- Entries are placed only in **free slots** within the configured window.
- Each day targets **8 hours total** (existing + new).
- Minimum entry duration: **30 minutes**.
- A ticket can span multiple consecutive days; a day can contain multiple tickets.

---

## Invoice generation

Invoice generation is built into `clockify_fill.py` via the `--invoice` flag. In the desktop app, click **📄 Invoice** in the month panel.

**CLI usage:**

```bash
pip install openpyxl
python clockify_fill.py --invoice --config 2026-03/config.json
```

Reads `plan.json` from the same directory as `config.json` and writes:

```
<documents_path>/2026-03/invoice_espana_20260331.xlsx
```

The filename suffix is the generation date. To avoid overwriting an open file, a `_2`, `_3`, … suffix is appended automatically.

### `config.json` — invoice fields

```json
{
    "monthly_total":  3500,
    "invoice_number": "espana"
}
```

- **`monthly_total`** — fixed invoice amount in USD. Required for invoice generation (also accepted: legacy `hourly_rate`, which multiplies hours × rate instead).
- **`invoice_number`** — short label used in the filename and in cell C8 of the invoice (max 10 chars). Defaults to `"espana"`.

### Invoice layout

- **Rows 1–15** — header block: payee info, bank details, bill-to address, invoice date / number
- **Row 16** — table header: Date | Description | Hours
- **Rows 17+** — one row per plan entry, sorted newest-first; hours shown as `HH:MM:SS`
- **Footer** — TOTAL amount in USD, boilerplate contact text

---

## Example output

```
Loaded 5 ticket(s) from 'tickets.txt'.
Existing entries found on 4 day(s).
Working days in 2026-03: 21

────────────────────────────────────────────────────────────────────────────────
DATE          START   END     DUR       DESCRIPTION
────────────────────────────────────────────────────────────────────────────────

2026-03-02 (Mon)  ✓
  12:00   15:20   3h20m     PROJ-101 Implement OAuth2 login flow
  15:20   16:00   0h40m     [existing] Daily Scrum (Engineering)
  16:00   20:00   4h00m     PROJ-101 Implement OAuth2 login flow

2026-03-03 (Tue)  ✓
  12:00   12:30   0h30m     PROJ-101 Implement OAuth2 login flow
  12:30   13:00   0h30m     [existing] Sprint planning (Engineering)
  13:00   20:00   7h00m     PROJ-102 Fix payment gateway timeout bug
...

Summary:
  Working days in month : 21
  Days already complete : 0
  Days with new entries : 21
  New entries to create : 47
  Total hours to add    : 168h00m

  Per-ticket allocation:
      33h36m  PROJ-101 Implement OAuth2 login flow
      33h36m  PROJ-102 Fix payment gateway timeout bug
      33h36m  PROJ-103 Add unit tests for checkout service
      33h36m  PROJ-104 Refactor user profile API endpoints
      33h36m  PROJ-105 Write onboarding documentation

Proceed with creating these entries in Clockify? (yes/no): yes
✓ PROJ-101 Implement OAuth2 login flow | 2026-03-02 12:00–15:20
✓ PROJ-101 Implement OAuth2 login flow | 2026-03-02 16:00–20:00
...
Created: 47 entries | Failed: 0
```
