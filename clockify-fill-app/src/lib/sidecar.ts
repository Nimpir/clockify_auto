import { Command } from "@tauri-apps/plugin-shell";
import { join } from "@tauri-apps/api/path";
import { getMonthDir, writeConfigForMonth } from "./storage";
import type { Settings } from "./types";

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
  settings: Settings
): Promise<SidecarResult> {
  const configPath = await writeConfigForMonth(month, settings);
  const paths = await getMonthPaths(month);
  const cmd = Command.sidecar("binaries/clockify_fill", [
    "--config", configPath,
    "--tickets", paths.tickets,
    "--report", paths.report,
    "--output-json", paths.planJson,
    "--output-csv", paths.planCsv,
    "--month", month,
    "--dry-run",
  ]);
  const out = await cmd.execute();
  return { stdout: out.stdout, stderr: out.stderr, code: out.code };
}

/** Submit plan.json entries to Clockify API. */
export async function submitPlan(
  month: string,
  settings: Settings,
  onProgress?: (line: string) => void
): Promise<{ created: number; failed: number }> {
  const configPath = await writeConfigForMonth(month, settings);
  const paths = await getMonthPaths(month);

  const cmd = Command.sidecar("binaries/clockify_fill", [
    "--from-json", paths.planJson,
    "--config", configPath,
  ]);

  let fullStdout = "";
  if (onProgress) {
    cmd.stdout.on("data", (line: string) => {
      fullStdout += line;
      onProgress(line);
    });
  }

  const out = await cmd.execute();
  const combined = fullStdout || out.stdout;
  const match = combined.match(/Created:\s*(\d+)\s*entries\s*\|\s*Failed:\s*(\d+)/);
  return {
    created: match ? parseInt(match[1]) : 0,
    failed: match ? parseInt(match[2]) : 0,
  };
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
