# clockify_fill — Clockify Time Entry Automation

Fills a Clockify workspace with ticket-based time entries for a given month,
distributing work evenly across tickets and respecting already-logged time.

## Requirements

- Python 3.10+
- [`requests`](https://pypi.org/project/requests/) library

```bash
pip install requests
```

---

## Quick start

```bash
# Preview what would be created (no API calls)
python clockify_fill.py --dry-run

# Preview a different month
python clockify_fill.py --month 2026-04 --dry-run

# Create entries (prompts for confirmation)
python clockify_fill.py

# Use custom file paths
python clockify_fill.py --tickets my_tickets.txt --report march_export.csv --config prod.json
```

---

## Input files

### `config.json`

```json
{
    "clockify_api_key": "YOUR_API_KEY_HERE",
    "workspace_id":     "YOUR_WORKSPACE_ID_HERE",
    "month":            "2026-03",
    "work_start":       "12:00",
    "work_end":         "20:00",
    "timezone":         "Europe/Madrid",
    "skip_weekends":    true
}
```

Inline `//` comments are supported.

### `tickets.txt`

One ticket per line, pipe-separated:

```
PROJ-101 | Implement OAuth2 login flow      | 6743a1b2c3d4e5f600000001
PROJ-102 | Fix payment gateway timeout bug  | 6743a1b2c3d4e5f600000002
```

Fields: `Jira key | Title | Clockify Project ID`

Lines starting with `#` are ignored.

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

Option A — from the browser URL:
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
5. Save as `clockify_report.csv` in the same folder as the script

---

## CLI flags

| Flag | Default | Description |
|---|---|---|
| `--tickets PATH` | `tickets.txt` | Path to tickets file |
| `--report PATH` | `clockify_report.csv` | Path to Clockify CSV export |
| `--config PATH` | `config.json` | Path to config file |
| `--dry-run` | off | Show plan only, skip API calls |
| `--month YYYY-MM` | from config | Override target month |

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
