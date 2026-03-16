#!/usr/bin/env python3
"""
clockify_fill.py — Clockify Time Entry Automation Tool

Reads tickets and a Clockify CSV export, generates a per-day plan
filling remaining time (up to 8h/day, window 12:00–20:00), shows
the plan for approval, then creates entries via the Clockify API.
"""

import argparse
import csv
import json
import sys
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

try:
    import requests
except ImportError:
    print("Error: 'requests' library not found. Install it with: pip install requests")
    sys.exit(1)

# Ensure Unicode output works on Windows (UTF-8 console or file redirect)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ─── ANSI colours ─────────────────────────────────────────────────────────────
GREY  = "\033[90m"
GREEN = "\033[32m"
RED   = "\033[31m"
BOLD  = "\033[1m"
RESET = "\033[0m"

CLOCKIFY_API_BASE  = "https://api.clockify.me/api/v1"
WORK_DAY_MINUTES   = 8 * 60   # 480
MIN_ENTRY_MINUTES  = 30
RATE_LIMIT_DELAY_S = 0.2


# ─── Data structures ──────────────────────────────────────────────────────────

class Ticket:
    def __init__(self, key: str, title: str, project_id: str):
        self.key        = key.strip()
        self.title      = title.strip()
        self.project_id = project_id.strip()

    @property
    def description(self) -> str:
        return f"{self.key} {self.title}"


class TimeSlot:
    """A time interval on a specific date (naive local time)."""

    def __init__(self, day: date, start: datetime, end: datetime, *,
                 description: str = "", project_id: str = "", existing: bool = False):
        self.day         = day
        self.start       = start
        self.end         = end
        self.description = description
        self.project_id  = project_id
        self.existing    = existing

    @property
    def duration_minutes(self) -> int:
        return max(0, int((self.end - self.start).total_seconds() / 60))

    @property
    def duration_hours(self) -> float:
        return self.duration_minutes / 60


# ─── Config / file parsing ────────────────────────────────────────────────────

def _strip_json_comments(text: str) -> str:
    """Remove // line-comments that are not inside JSON string literals."""
    result    = []
    in_string = False
    i         = 0
    while i < len(text):
        ch = text[i]
        if ch == '\\' and in_string:
            # Escaped character — keep both chars as-is
            result.append(ch)
            i += 1
            if i < len(text):
                result.append(text[i])
                i += 1
            continue
        if ch == '"':
            in_string = not in_string
            result.append(ch)
            i += 1
            continue
        if not in_string and text[i:i+2] == '//':
            # Skip until end of line
            while i < len(text) and text[i] != '\n':
                i += 1
            continue
        result.append(ch)
        i += 1
    return ''.join(result)


def load_config(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    return json.loads(_strip_json_comments(raw))


def load_tickets(path: str) -> list[Ticket]:
    tickets = []
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) != 3:
                print(f"Warning: line {lineno} in tickets file has "
                      f"{len(parts)} field(s) (expected 3), skipping.")
                continue
            tickets.append(Ticket(parts[0], parts[1], parts[2]))
    return tickets


# ─── CSV parsing ──────────────────────────────────────────────────────────────

_DATE_FORMATS = ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y")
_TIME_FORMATS = ("%H:%M:%S", "%H:%M", "%I:%M:%S %p", "%I:%M %p")


def _parse_date(s: str) -> date | None:
    s = s.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def _parse_time(s: str, ref_date: date) -> datetime | None:
    s = s.strip()
    for fmt in _TIME_FORMATS:
        try:
            return datetime.combine(ref_date, datetime.strptime(s, fmt).time())
        except ValueError:
            pass
    return None


def _window_bounds(day: date, work_start: str, work_end: str) -> tuple[datetime, datetime]:
    ws_h, ws_m = map(int, work_start.split(":"))
    we_h, we_m = map(int, work_end.split(":"))
    return (
        datetime(day.year, day.month, day.day, ws_h, ws_m),
        datetime(day.year, day.month, day.day, we_h, we_m),
    )


def parse_clockify_csv(path: str, target_month: str,
                       work_start: str, work_end: str) -> dict[date, list[TimeSlot]]:
    """Return {date: [TimeSlot, ...]} for existing entries clipped to the work window."""
    year, month = map(int, target_month.split("-"))
    entries: dict[date, list[TimeSlot]] = {}

    try:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                start_day = _parse_date(row.get("Start Date", ""))
                if start_day is None:
                    continue
                if start_day.year != year or start_day.month != month:
                    continue

                start_dt = _parse_time(row.get("Start Time", ""), start_day)
                if start_dt is None:
                    continue

                end_day_str = (row.get("End Date") or "").strip()
                end_day     = _parse_date(end_day_str) if end_day_str else start_day
                if end_day is None:
                    end_day = start_day
                end_dt = _parse_time(row.get("End Time", ""), end_day)
                if end_dt is None:
                    continue

                win_start, win_end = _window_bounds(start_day, work_start, work_end)
                clipped_start = max(start_dt, win_start)
                clipped_end   = min(end_dt,   win_end)
                if clipped_end <= clipped_start:
                    continue

                desc    = (row.get("Description") or row.get("Task") or "").strip()
                project = (row.get("Project") or "").strip()
                label   = f"{desc} ({project})" if project and desc else desc or project or "entry"

                slot = TimeSlot(start_day, clipped_start, clipped_end,
                                description=label, existing=True)
                entries.setdefault(start_day, []).append(slot)

    except FileNotFoundError:
        print(f"Note: CSV report not found at '{path}'. Assuming no existing entries.")

    for d in entries:
        entries[d].sort(key=lambda s: s.start)
    return entries


# ─── Working-day helpers ──────────────────────────────────────────────────────

def get_working_days(target_month: str, skip_weekends: bool) -> list[date]:
    year, month = map(int, target_month.split("-"))
    days = []
    d = date(year, month, 1)
    while d.month == month:
        if not skip_weekends or d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    return days


def day_logged_minutes(existing: list[TimeSlot]) -> int:
    return sum(s.duration_minutes for s in existing)


def compute_free_slots(day: date, existing: list[TimeSlot],
                       work_start: str, work_end: str) -> list[TimeSlot]:
    """Return gaps within the work window not covered by existing entries."""
    win_start, win_end = _window_bounds(day, work_start, work_end)
    occupied = sorted(existing, key=lambda s: s.start)
    free   = []
    cursor = win_start
    for slot in occupied:
        if slot.start > cursor:
            free.append(TimeSlot(day, cursor, slot.start))
        cursor = max(cursor, slot.end)
    if cursor < win_end:
        free.append(TimeSlot(day, cursor, win_end))
    return free


# ─── Distribution algorithm ───────────────────────────────────────────────────

def distribute_tickets(working_days: list[date],
                       existing_by_day: dict[date, list[TimeSlot]],
                       tickets: list[Ticket],
                       work_start: str, work_end: str) -> list[TimeSlot]:
    """
    Distribute ticket hours evenly across all tickets into the free slots.
    Returns a list of new TimeSlot objects (one per entry to create).
    """
    if not tickets:
        return []

    # Gather free slots per day (only days that still need filling)
    day_free_slots: dict[date, list[TimeSlot]] = {}
    total_free_minutes = 0

    for day in working_days:
        existing     = existing_by_day.get(day, [])
        logged       = day_logged_minutes(existing)
        still_needed = WORK_DAY_MINUTES - logged
        if still_needed <= 0:
            continue

        free_slots    = compute_free_slots(day, existing, work_start, work_end)
        free_in_day   = sum(s.duration_minutes for s in free_slots)
        usable         = min(still_needed, free_in_day)

        if usable < MIN_ENTRY_MINUTES:
            continue

        day_free_slots[day] = free_slots
        total_free_minutes  += usable

    if total_free_minutes == 0:
        return []

    # Target minutes per ticket (even distribution)
    target_per_ticket = total_free_minutes / len(tickets)

    # Track remaining budget per ticket
    ticket_remaining = {t.key: target_per_ticket for t in tickets}
    ticket_by_key    = {t.key: t for t in tickets}
    ticket_keys      = [t.key for t in tickets]

    new_entries: list[TimeSlot] = []
    ticket_idx = 0   # index into ticket_keys (advances as tickets are exhausted)

    for day in working_days:
        if day not in day_free_slots:
            continue

        day_budget_remaining = WORK_DAY_MINUTES - day_logged_minutes(
            existing_by_day.get(day, []))

        for free_slot in day_free_slots[day]:
            slot_remaining = free_slot.duration_minutes
            cursor         = free_slot.start

            while slot_remaining >= MIN_ENTRY_MINUTES and ticket_idx < len(ticket_keys):
                tkey   = ticket_keys[ticket_idx]
                ticket = ticket_by_key[tkey]
                t_rem  = ticket_remaining[tkey]

                if t_rem < MIN_ENTRY_MINUTES:
                    # This ticket's budget is spent; move on
                    ticket_idx += 1
                    continue

                assign = min(slot_remaining, t_rem, day_budget_remaining)

                if assign < MIN_ENTRY_MINUTES:
                    break  # Can't fit a valid entry here today

                # If the leftover in the slot would be too small to be useful,
                # absorb it into this entry (small rounding bump is acceptable).
                leftover = slot_remaining - assign
                if 0 < leftover < MIN_ENTRY_MINUTES:
                    assign = slot_remaining

                entry_end = cursor + timedelta(minutes=assign)
                new_entries.append(TimeSlot(
                    day, cursor, entry_end,
                    description=ticket.description,
                    project_id=ticket.project_id,
                    existing=False,
                ))

                ticket_remaining[tkey]  -= assign
                slot_remaining          -= assign
                day_budget_remaining    -= assign
                cursor                   = entry_end

                if ticket_remaining[tkey] < MIN_ENTRY_MINUTES:
                    ticket_idx += 1

            if day_budget_remaining < MIN_ENTRY_MINUTES:
                break  # Day is full

    return new_entries


# ─── Display ──────────────────────────────────────────────────────────────────

def _fmt_time(dt: datetime) -> str:
    return dt.strftime("%H:%M")


def _fmt_dur(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    return f"{h}h{m:02d}m" if m else f"{h}h"


def print_plan(working_days: list[date],
               existing_by_day: dict[date, list[TimeSlot]],
               new_entries: list[TimeSlot]):
    new_by_day: dict[date, list[TimeSlot]] = {}
    for e in new_entries:
        new_by_day.setdefault(e.day, []).append(e)

    W = 80
    print(f"\n{'─' * W}")
    print(f"{'DATE':<13} {'START':<7} {'END':<7} {'DUR':<8}  DESCRIPTION")
    print(f"{'─' * W}")

    days_complete = 0

    for day in working_days:
        existing = existing_by_day.get(day, [])
        new      = new_by_day.get(day, [])
        if not existing and not new:
            continue

        all_entries  = sorted(existing + new, key=lambda s: s.start)
        total_min    = sum(s.duration_minutes for s in all_entries)
        is_complete  = total_min >= WORK_DAY_MINUTES - 1
        if is_complete:
            days_complete += 1

        tag = "  ✓" if is_complete else f"  ({_fmt_dur(total_min)}/8h)"
        print(f"\n{BOLD}{day.strftime('%Y-%m-%d (%a)')}{tag}{RESET}")

        for slot in all_entries:
            dur = _fmt_dur(slot.duration_minutes)
            if slot.existing:
                print(f"  {GREY}{_fmt_time(slot.start):<7} {_fmt_time(slot.end):<7}"
                      f" {dur:<8}  [existing] {slot.description}{RESET}")
            else:
                print(f"  {_fmt_time(slot.start):<7} {_fmt_time(slot.end):<7}"
                      f" {dur:<8}  {slot.description}")

    print(f"\n{'─' * W}")

    # Per-ticket summary
    ticket_minutes: dict[str, int] = {}
    for e in new_entries:
        ticket_minutes[e.description] = ticket_minutes.get(e.description, 0) + e.duration_minutes

    days_already_full = sum(
        1 for d in working_days
        if day_logged_minutes(existing_by_day.get(d, [])) >= WORK_DAY_MINUTES - 1
    )
    total_new_min = sum(e.duration_minutes for e in new_entries)

    print(f"\nSummary:")
    print(f"  Working days in month : {len(working_days)}")
    print(f"  Days already complete : {days_already_full}")
    print(f"  Days with new entries : {len(new_by_day)}")
    print(f"  New entries to create : {len(new_entries)}")
    print(f"  Total hours to add    : {_fmt_dur(total_new_min)}")

    if ticket_minutes:
        print(f"\n  Per-ticket allocation:")
        for desc, mins in sorted(ticket_minutes.items()):
            print(f"    {_fmt_dur(mins):>8}  {desc}")
    print()


# ─── Clockify API ─────────────────────────────────────────────────────────────

def _local_to_utc(dt: datetime, tz: ZoneInfo) -> datetime:
    return dt.replace(tzinfo=tz).astimezone(ZoneInfo("UTC"))


def _create_entry(session: requests.Session, workspace_id: str,
                  slot: TimeSlot, tz: ZoneInfo) -> tuple[bool, str]:
    url = f"{CLOCKIFY_API_BASE}/workspaces/{workspace_id}/time-entries"
    payload = {
        "description": slot.description,
        "projectId":   slot.project_id,
        "start":       _local_to_utc(slot.start, tz).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end":         _local_to_utc(slot.end,   tz).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    resp = session.post(url, json=payload)
    if resp.status_code in (200, 201):
        return True, ""
    try:
        msg = resp.json().get("message", resp.text)
    except Exception:
        msg = resp.text
    return False, f"HTTP {resp.status_code}: {msg}"


def push_entries(new_entries: list[TimeSlot],
                 api_key: str, workspace_id: str, tz: ZoneInfo):
    session = requests.Session()
    session.headers.update({
        "X-Api-Key":    api_key,
        "Content-Type": "application/json",
    })

    created = failed = 0
    for slot in new_entries:
        label = (f"{slot.description} | "
                 f"{slot.day} {_fmt_time(slot.start)}–{_fmt_time(slot.end)}")
        try:
            ok, err = _create_entry(session, workspace_id, slot, tz)
        except requests.RequestException as exc:
            ok, err = False, str(exc)

        if ok:
            print(f"{GREEN}✓{RESET} {label}")
            created += 1
        else:
            print(f"{RED}✗{RESET} {label} | Error: {err}")
            failed += 1

        time.sleep(RATE_LIMIT_DELAY_S)

    print(f"\nCreated: {created} entries | Failed: {failed}")


# ─── Plan serialisation ───────────────────────────────────────────────────────

def _build_plan_json(working_days: list[date],
                     existing_by_day: dict[date, list[TimeSlot]],
                     new_entries: list[TimeSlot],
                     tz: ZoneInfo) -> list[dict]:
    """Build the plan.json array (both existing and new entries)."""
    plan = []
    for day in working_days:
        for slot in existing_by_day.get(day, []):
            plan.append({
                "description": slot.description,
                "projectId":   "",
                "start":       _local_to_utc(slot.start, tz).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "end":         _local_to_utc(slot.end,   tz).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "date":        day.isoformat(),
                "localStart":  slot.start.strftime("%H:%M"),
                "localEnd":    slot.end.strftime("%H:%M"),
                "ticketKey":   "",
                "hours":       round(slot.duration_hours, 4),
                "isExisting":  True,
            })
    for slot in new_entries:
        plan.append({
            "description": slot.description,
            "projectId":   slot.project_id,
            "start":       _local_to_utc(slot.start, tz).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end":         _local_to_utc(slot.end,   tz).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "date":        slot.day.isoformat(),
            "localStart":  slot.start.strftime("%H:%M"),
            "localEnd":    slot.end.strftime("%H:%M"),
            "ticketKey":   slot.description.split()[0] if slot.description else "",
            "hours":       round(slot.duration_hours, 4),
            "isExisting":  False,
        })
    return plan


def _write_plan_json(path: str, plan: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(plan, fh, indent=2)
    print(f"Plan written to: {path}")


def _write_plan_csv(path: str, plan: list[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["date", "start", "end", "ticket", "description", "project_id", "hours"])
        for e in plan:
            desc_parts = e["description"].split(None, 1)
            ticket = desc_parts[0] if not e["isExisting"] and len(desc_parts) > 1 else ""
            title  = desc_parts[1] if not e["isExisting"] and len(desc_parts) > 1 else e["description"]
            writer.writerow([
                e["date"], e["localStart"], e["localEnd"],
                ticket, title, e["projectId"], e["hours"],
            ])
    print(f"Plan CSV written to: {path}")


def _push_from_json(plan_path: str, api_key: str, workspace_id: str, tz: ZoneInfo) -> None:
    """Read plan.json and submit only non-existing entries to Clockify."""
    with open(plan_path, encoding="utf-8") as fh:
        plan: list[dict] = json.load(fh)

    to_submit = [e for e in plan if not e.get("isExisting")]
    if not to_submit:
        print("No new entries found in plan.json.")
        return

    print(f"Submitting {len(to_submit)} entries from {plan_path} …\n")
    session = requests.Session()
    session.headers.update({"X-Api-Key": api_key, "Content-Type": "application/json"})

    created = failed = 0
    for e in to_submit:
        label = f"{e['description']} | {e['date']} {e['localStart']}–{e['localEnd']}"
        payload = {
            "description": e["description"],
            "projectId":   e["projectId"],
            "start":       e["start"],
            "end":         e["end"],
        }
        try:
            resp = session.post(
                f"{CLOCKIFY_API_BASE}/workspaces/{workspace_id}/time-entries",
                json=payload,
            )
            if resp.status_code in (200, 201):
                print(f"{GREEN}✓{RESET} {label}")
                created += 1
            else:
                try:
                    msg = resp.json().get("message", resp.text)
                except Exception:
                    msg = resp.text
                print(f"{RED}✗{RESET} {label} | HTTP {resp.status_code}: {msg}")
                failed += 1
        except requests.RequestException as exc:
            print(f"{RED}✗{RESET} {label} | Error: {exc}")
            failed += 1
        time.sleep(RATE_LIMIT_DELAY_S)

    print(f"\nCreated: {created} entries | Failed: {failed}")


# ─── CLI entry point ──────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Fill Clockify with ticket time entries for a given month.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python clockify_fill.py --dry-run\n"
            "  python clockify_fill.py --month 2026-04 --dry-run\n"
            "  python clockify_fill.py --from-json plan.json --config config.json\n"
        ),
    )
    p.add_argument("--tickets",      default="tickets.txt",        metavar="PATH",
                   help="Path to tickets file (default: tickets.txt)")
    p.add_argument("--report",       default="clockify_report.csv", metavar="PATH",
                   help="Path to Clockify CSV export (default: clockify_report.csv)")
    p.add_argument("--config",       default="config.json",        metavar="PATH",
                   help="Path to config file (default: config.json)")
    p.add_argument("--dry-run",      action="store_true",
                   help="Show plan only, skip API calls")
    p.add_argument("--month",        default=None, metavar="YYYY-MM",
                   help="Override 'month' from config")
    p.add_argument("--output-json",  default=None, metavar="PATH",
                   help="Write plan as JSON to this path (used with --dry-run)")
    p.add_argument("--output-csv",   default=None, metavar="PATH",
                   help="Write plan as CSV to this path (used with --dry-run)")
    p.add_argument("--from-json",    default=None, metavar="PATH",
                   help="Submit entries from a saved plan.json (skips generation)")
    return p.parse_args()


def main():
    args = _parse_args()

    # ── --from-json: submit a pre-generated plan without regenerating ──────────
    if args.from_json:
        try:
            cfg = load_config(args.config)
        except FileNotFoundError:
            print(f"Error: config file not found at '{args.config}'")
            sys.exit(1)
        api_key      = cfg.get("clockify_api_key", "")
        workspace_id = cfg.get("workspace_id",     "")
        tz_name      = cfg.get("timezone", "UTC")
        if not api_key or api_key.startswith("YOUR_"):
            print("Error: 'clockify_api_key' is not configured.")
            sys.exit(1)
        if not workspace_id or workspace_id.startswith("YOUR_"):
            print("Error: 'workspace_id' is not configured.")
            sys.exit(1)
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            print(f"Error: unknown timezone '{tz_name}'")
            sys.exit(1)
        _push_from_json(args.from_json, api_key, workspace_id, tz)
        return

    # ── Config ────────────────────────────────────────────────────────────────
    try:
        cfg = load_config(args.config)
    except FileNotFoundError:
        print(f"Error: config file not found at '{args.config}'")
        sys.exit(1)
    except json.JSONDecodeError as exc:
        print(f"Error: invalid JSON in config: {exc}")
        sys.exit(1)

    target_month = args.month or cfg.get("month", "")
    if not target_month:
        print("Error: 'month' not set in config and --month not provided.")
        sys.exit(1)
    try:
        datetime.strptime(target_month, "%Y-%m")
    except ValueError:
        print(f"Error: month must be in YYYY-MM format, got '{target_month}'")
        sys.exit(1)

    work_start   = cfg.get("work_start",    "12:00")
    work_end     = cfg.get("work_end",      "20:00")
    skip_weekends = cfg.get("skip_weekends", True)
    tz_name      = cfg.get("timezone",      "UTC")
    api_key      = cfg.get("clockify_api_key", "")
    workspace_id = cfg.get("workspace_id",  "")

    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        print(f"Error: unknown timezone '{tz_name}'")
        sys.exit(1)

    # ── Tickets ───────────────────────────────────────────────────────────────
    try:
        tickets = load_tickets(args.tickets)
    except FileNotFoundError:
        print(f"Error: tickets file not found at '{args.tickets}'")
        sys.exit(1)

    if not tickets:
        print("Error: no tickets found in tickets file.")
        sys.exit(1)
    print(f"Loaded {len(tickets)} ticket(s) from '{args.tickets}'.")

    # ── CSV report ────────────────────────────────────────────────────────────
    existing_by_day = parse_clockify_csv(args.report, target_month, work_start, work_end)
    print(f"Existing entries found on {len(existing_by_day)} day(s).")

    # ── Working days ──────────────────────────────────────────────────────────
    working_days = get_working_days(target_month, skip_weekends)
    print(f"Working days in {target_month}: {len(working_days)}")

    # ── Distribute ────────────────────────────────────────────────────────────
    new_entries = distribute_tickets(working_days, existing_by_day, tickets, work_start, work_end)

    if not new_entries:
        print("No free slots available to fill — all days may already be at 8h.")
        sys.exit(0)

    # ── Display plan ──────────────────────────────────────────────────────────
    print_plan(working_days, existing_by_day, new_entries)

    # ── Write output files if requested ───────────────────────────────────────
    if args.output_json or args.output_csv:
        plan_data = _build_plan_json(working_days, existing_by_day, new_entries, tz)
        if args.output_json:
            _write_plan_json(args.output_json, plan_data)
        if args.output_csv:
            _write_plan_csv(args.output_csv, plan_data)

    if args.dry_run:
        print("Dry-run mode — no entries will be created.")
        sys.exit(0)

    # ── Validate API credentials before asking ─────────────────────────────────
    if not api_key or api_key.startswith("YOUR_"):
        print("Error: 'clockify_api_key' is not configured.\n"
              "       Edit config.json or run with --dry-run to preview only.")
        sys.exit(1)
    if not workspace_id or workspace_id.startswith("YOUR_"):
        print("Error: 'workspace_id' is not configured.\n"
              "       Edit config.json or run with --dry-run to preview only.")
        sys.exit(1)

    # ── Approval ──────────────────────────────────────────────────────────────
    try:
        answer = input("Proceed with creating these entries in Clockify? (yes/no): ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print("\nAborted. No entries created.")
        sys.exit(0)

    if answer not in ("yes", "y"):
        print("Aborted. No entries created.")
        sys.exit(0)

    # ── Push to API ───────────────────────────────────────────────────────────
    push_entries(new_entries, api_key, workspace_id, tz)


if __name__ == "__main__":
    main()
