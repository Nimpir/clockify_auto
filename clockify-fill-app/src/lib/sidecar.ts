import { Command } from "@tauri-apps/plugin-shell";
import { join } from "@tauri-apps/api/path";
import { writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { getMonthDir, writeConfigForMonth } from "./storage";
import { logger } from "./logger";
import type { Settings } from "./types";

const CLOCKIFY_API = "https://api.clockify.me/api/v1";

async function getMonthPaths(month: string) {
  const dir = await getMonthDir(month);
  return {
    config: await join(dir, "config.json"),
    tickets: await join(dir, "tickets.txt"),
    report: await join(dir, "clockify_report.csv"),
    planJson: await join(dir, "plan.json"),
    planCsv: await join(dir, "plan.csv"),
  };
}

export interface SidecarResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Run dry-run: generate plan.json + plan.csv without submitting. */
export async function generatePlan(
  month: string,
  settings: Settings,
  skipDays?: string[]
): Promise<SidecarResult> {
  logger.info(`generatePlan start`, { month, skipDays });
  const configPath = await writeConfigForMonth(month, settings);
  const paths = await getMonthPaths(month);
  const args: string[] = [
    "--config", configPath,
    "--tickets", paths.tickets,
    "--report", paths.report,
    "--output-json", paths.planJson,
    "--output-csv", paths.planCsv,
    "--month", month,
    "--dry-run",
  ];
  if (skipDays && skipDays.length > 0) {
    args.push("--skip-days", skipDays.join(","));
  }
  const cmd = Command.sidecar("binaries/clockify_fill", args);
  const out = await cmd.execute();
  if (out.code !== 0) {
    logger.error(`generatePlan failed (code ${out.code})`, { stdout: out.stdout, stderr: out.stderr });
  } else {
    logger.info(`generatePlan done`, { stdout: out.stdout });
  }
  return { stdout: out.stdout, stderr: out.stderr, code: out.code };
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function detectErrors(stdout: string): string[] {
  const warnings: string[] = [];
  if (/HTTP 4[0-9]{2}.*[Uu]nauthorized|HTTP 401/.test(stdout))
    warnings.push("Invalid API key — check Settings");
  if (/HTTP 403/.test(stdout))
    warnings.push("Access denied — verify workspace ID and API key permissions");
  if (/HTTP 404/.test(stdout))
    warnings.push("Workspace not found — check workspace ID in Settings");
  if (/Project doesn't belong to Workspace/i.test(stdout))
    warnings.push("Some project IDs don't belong to this workspace — check tickets.txt");
  return warnings;
}

/** Submit plan.json entries to Clockify API. */
export async function submitPlan(
  month: string,
  settings: Settings,
  onProgress?: (line: string) => void
): Promise<{ created: number; failed: number; warnings: string[] }> {
  logger.info(`submitPlan start`, { month });

  const configPath = await writeConfigForMonth(month, settings);
  logger.info(`submitPlan config written`, { configPath });

  const paths = await getMonthPaths(month);
  logger.info(`submitPlan paths`, paths);

  const args = ["--from-json", paths.planJson, "--config", configPath];
  logger.info(`submitPlan sidecar args`, args);

  const cmd = Command.sidecar("binaries/clockify_fill", args);

  logger.info(`submitPlan calling execute`);
  let out: Awaited<ReturnType<typeof cmd.execute>>;
  try {
    out = await cmd.execute();
  } catch (e) {
    logger.error(`submitPlan execute threw`, String(e));
    throw e;
  }

  logger.info(`submitPlan execute returned`, { code: out.code, stdout: out.stdout, stderr: out.stderr });

  if (out.code !== 0) {
    logger.error(`submitPlan failed (code ${out.code})`, { stdout: out.stdout, stderr: out.stderr });
  } else {
    logger.info(`submitPlan done`, { stdout: out.stdout });
  }
  const cleanStdout = stripAnsi(out.stdout);
  if (onProgress && cleanStdout) {
    cleanStdout.split("\n").filter(Boolean).forEach(onProgress);
  }
  const match = cleanStdout.match(/Created:\s*(\d+)\s*entries\s*\|\s*Failed:\s*(\d+)/);
  return {
    created: match ? parseInt(match[1]) : 0,
    failed: match ? parseInt(match[2]) : 0,
    warnings: detectErrors(cleanStdout),
  };
}

/** Fetch existing time entries for a month from Clockify and save as clockify_report.csv. */
export async function fetchClockifyEntries(
  month: string,
  settings: Settings
): Promise<{ count: number } | { error: string }> {
  const { clockify_api_key, workspace_id, timezone } = settings;
  const headers = { "X-Api-Key": clockify_api_key, "Content-Type": "application/json" };

  // Get current user ID
  const userResp = await fetch(`${CLOCKIFY_API}/user`, { headers });
  if (!userResp.ok) return { error: `Auth failed: HTTP ${userResp.status}` };
  const user = await userResp.json();
  const userId: string = user.id;

  // Month date range in UTC
  const [year, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, m - 1, 1)).toISOString();
  const end   = new Date(Date.UTC(year, m,   0, 23, 59, 59)).toISOString();

  // Fetch all entries (paginated, max 1000 per page)
  const allEntries: unknown[] = [];
  let page = 1;
  while (true) {
    const resp = await fetch(
      `${CLOCKIFY_API}/workspaces/${workspace_id}/user/${userId}/time-entries` +
      `?start=${start}&end=${end}&page-size=1000&page=${page}`,
      { headers }
    );
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    const batch: unknown[] = await resp.json();
    if (!batch.length) break;
    allEntries.push(...batch);
    if (batch.length < 1000) break;
    page++;
  }

  logger.info("fetchClockifyEntries", { month, count: allEntries.length });

  // Format a UTC ISO string into local date/time parts using the configured timezone
  const tz = timezone || "UTC";
  function fmtDate(iso: string): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(iso));
  }
  function fmtTime(iso: string): string {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date(iso));
  }

  // Build CSV rows matching the format clockify_fill.py expects
  const rows = ["Project,Description,Start Date,Start Time,End Date,End Time"];
  for (const e of allEntries as Record<string, unknown>[]) {
    const interval = e.timeInterval as Record<string, string> | undefined;
    if (!interval?.start || !interval?.end) continue; // skip running timers
    const desc = String(e.description ?? "").replace(/"/g, '""');
    rows.push(
      `,"${desc}",${fmtDate(interval.start)},${fmtTime(interval.start)},${fmtDate(interval.end)},${fmtTime(interval.end)}`
    );
  }

  // Save to month directory
  const dir = await getMonthDir(month);
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  await writeTextFile(await join(dir, "clockify_report.csv"), rows.join("\n"));

  return { count: allEntries.length };
}

/** Generate .xlsx invoice from plan.json using the --invoice sidecar mode. */
export async function generateInvoice(
  month: string,
  settings: Settings,
  monthlyTotalOverride?: number,
  invoiceNumber?: string
): Promise<SidecarResult> {
  logger.info(`generateInvoice start`, { month, monthlyTotalOverride, invoiceNumber });
  const effectiveSettings = monthlyTotalOverride != null
    ? { ...settings, monthly_total: monthlyTotalOverride }
    : settings;
  const extras = invoiceNumber ? { invoice_number: invoiceNumber } : undefined;
  const configPath = await writeConfigForMonth(month, effectiveSettings, extras);
  const paths = await getMonthPaths(month);
  const cmd = Command.sidecar("binaries/clockify_fill", [
    "--invoice",
    "--config", configPath,
    "--plan", paths.planJson,
  ]);
  const out = await cmd.execute();
  if (out.code !== 0) {
    logger.error(`generateInvoice failed (code ${out.code})`, { stdout: out.stdout, stderr: out.stderr });
  } else {
    logger.info(`generateInvoice done`, { stdout: out.stdout });
  }
  return { stdout: out.stdout, stderr: out.stderr, code: out.code };
}

/** Test Clockify API credentials — direct fetch, no sidecar needed. */
export async function testClockifyConnection(
  apiKey: string
): Promise<{ ok: true; name: string; email: string } | { ok: false; error: string }> {
  try {
    const resp = await fetch("https://api.clockify.me/api/v1/user", {
      headers: { "X-Api-Key": apiKey },
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { ok: true, name: data.name ?? "", email: data.email ?? "" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
