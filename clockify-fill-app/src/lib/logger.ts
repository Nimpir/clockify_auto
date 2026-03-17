import { writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

let logPath: string | null = null;

async function ensureLogFile(): Promise<string> {
  if (logPath) return logPath;
  const dataDir = await appDataDir();
  const logsDir = await join(dataDir, "logs");
  if (!(await exists(logsDir))) {
    await mkdir(logsDir, { recursive: true });
  }
  const now = new Date();
  // e.g. 2026-03-16_14-30-22.log
  const name = now
    .toISOString()
    .slice(0, 19)
    .replace("T", "_")
    .replace(/:/g, "-");
  logPath = await join(logsDir, `${name}.log`);
  await writeTextFile(logPath, `=== session start ${now.toISOString()} ===\n`);
  return logPath;
}

async function write(level: string, message: string, data?: unknown): Promise<void> {
  try {
    const path = await ensureLogFile();
    const ts = new Date().toISOString();
    let line = `[${ts}] [${level}] ${message}`;
    if (data !== undefined) {
      line += "\n" + (typeof data === "string" ? data : JSON.stringify(data, null, 2));
    }
    line += "\n";
    await writeTextFile(path, line, { append: true });
  } catch {
    // Never crash the app due to logging
  }
}

export const logger = {
  info:  (msg: string, data?: unknown) => write("INFO",  msg, data),
  warn:  (msg: string, data?: unknown) => write("WARN",  msg, data),
  error: (msg: string, data?: unknown) => write("ERROR", msg, data),
  debug: (msg: string, data?: unknown) => write("DEBUG", msg, data),

  /** Returns the path of the current session log file (resolves after first write). */
  getPath: async (): Promise<string> => ensureLogFile(),
};
