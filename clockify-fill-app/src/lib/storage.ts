import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  copyFile,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import type { MonthMeta, Settings, PlanEntry, Ticket } from "./types";

const DEFAULT_SETTINGS: Settings = {
  clockify_api_key: "",
  workspace_id: "",
  timezone: "Europe/Madrid",
  work_start: "12:00",
  work_end: "20:00",
  skip_weekends: true,
  documents_path: "",
};

const DEFAULT_META = (month: string): MonthMeta => ({
  month,
  status: "untouched",
  tickets_loaded: false,
  report_loaded: false,
  plan_generated: false,
  submitted: false,
  submitted_at: null,
  entries_created: 0,
  entries_failed: 0,
  last_generated_at: null,
});

async function ensureDir(path: string): Promise<void> {
  if (!(await exists(path))) {
    await mkdir(path, { recursive: true });
  }
}

export async function getMonthDir(month: string): Promise<string> {
  const dataDir = await appDataDir();
  return join(dataDir, "months", month);
}

// Settings
export async function loadSettings(): Promise<Settings> {
  try {
    const dataDir = await appDataDir();
    const path = await join(dataDir, "settings.json");
    if (!(await exists(path))) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await readTextFile(path)) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const dataDir = await appDataDir();
  await ensureDir(dataDir);
  const path = await join(dataDir, "settings.json");
  await writeTextFile(path, JSON.stringify(settings, null, 2));
}

// MonthMeta
export async function loadMonthMeta(month: string): Promise<MonthMeta> {
  try {
    const dir = await getMonthDir(month);
    const path = await join(dir, "meta.json");
    if (!(await exists(path))) return DEFAULT_META(month);
    return { ...DEFAULT_META(month), ...JSON.parse(await readTextFile(path)) };
  } catch {
    return DEFAULT_META(month);
  }
}

export async function saveMonthMeta(meta: MonthMeta): Promise<void> {
  const dir = await getMonthDir(meta.month);
  await ensureDir(dir);
  const path = await join(dir, "meta.json");
  await writeTextFile(path, JSON.stringify(meta, null, 2));
}

// Plan
export async function loadPlan(month: string): Promise<PlanEntry[]> {
  try {
    const dir = await getMonthDir(month);
    const path = await join(dir, "plan.json");
    if (!(await exists(path))) return [];
    return JSON.parse(await readTextFile(path));
  } catch {
    return [];
  }
}

// Tickets
export async function loadTickets(month: string): Promise<Ticket[]> {
  try {
    const dir = await getMonthDir(month);
    const path = await join(dir, "tickets.txt");
    if (!(await exists(path))) return [];
    return parseTicketsTxt(await readTextFile(path));
  } catch {
    return [];
  }
}

export async function saveTickets(
  month: string,
  tickets: Ticket[]
): Promise<void> {
  const dir = await getMonthDir(month);
  await ensureDir(dir);
  const path = await join(dir, "tickets.txt");
  const content = tickets.map((t) => `${t.key} | ${t.title} | ${t.projectId}`).join("\n");
  await writeTextFile(path, content);
}

function parseTicketsTxt(content: string): Ticket[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .flatMap((l) => {
      const parts = l.split("|").map((p) => p.trim());
      if (parts.length !== 3) return [];
      return [{ key: parts[0], title: parts[1], projectId: parts[2] }];
    });
}

// Copy an imported CSV report into the month directory
export async function importReport(
  month: string,
  sourcePath: string
): Promise<void> {
  const dir = await getMonthDir(month);
  await ensureDir(dir);
  const dest = await join(dir, "clockify_report.csv");
  await copyFile(sourcePath, dest);
}

// Write a temporary config.json for the sidecar
export async function writeConfigForMonth(
  month: string,
  settings: Settings
): Promise<string> {
  const dir = await getMonthDir(month);
  await ensureDir(dir);
  const path = await join(dir, "config.json");
  await writeTextFile(
    path,
    JSON.stringify(
      {
        clockify_api_key: settings.clockify_api_key,
        workspace_id: settings.workspace_id,
        timezone: settings.timezone,
        work_start: settings.work_start,
        work_end: settings.work_end,
        skip_weekends: settings.skip_weekends,
        month,
      },
      null,
      2
    )
  );
  return path;
}

// Load all 12 month metas for a given year
export async function loadYearMetas(
  year: number
): Promise<Record<string, MonthMeta>> {
  const metas: Record<string, MonthMeta> = {};
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => i + 1).map(async (m) => {
      const month = `${year}-${String(m).padStart(2, "0")}`;
      metas[month] = await loadMonthMeta(month);
    })
  );
  return metas;
}
