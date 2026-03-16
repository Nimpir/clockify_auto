import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { saveSettings } from "../lib/storage";
import { testClockifyConnection } from "../lib/sidecar";
import type { Settings, Toast } from "../lib/types";

const TIMEZONES = [
  "UTC", "Europe/Madrid", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Australia/Sydney",
];

interface Props {
  initial: Settings;
  onSave: (s: Settings) => void;
  addToast: (msg: string, type: Toast["type"]) => void;
}

export default function SettingsPage({ initial, onSave, addToast }: Props) {
  const [form, setForm] = useState<Settings>({ ...initial });
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveSettings(form);
      onSave(form);
    } catch (e) {
      addToast(`Save failed: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!form.clockify_api_key) {
      setTestStatus("Enter an API key first");
      return;
    }
    setTesting(true);
    setTestStatus(null);
    const result = await testClockifyConnection(form.clockify_api_key);
    if (result.ok) {
      setTestStatus(`✓ Connected as ${result.name} (${result.email})`);
    } else {
      setTestStatus(`✗ ${result.error}`);
    }
    setTesting(false);
  }

  async function handleBrowse() {
    const selected = await openDialog({ directory: true, title: "Select documents folder" });
    if (selected) set("documents_path", selected as string);
  }

  return (
    <div className="max-w-lg mx-auto py-8 px-4 space-y-8">
      <h1 className="text-xl font-bold text-white">Settings</h1>

      {/* Clockify Credentials */}
      <Section title="Clockify Credentials">
        <Field label="API Key">
          <div className="flex gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={form.clockify_api_key}
              onChange={(e) => set("clockify_api_key", e.target.value)}
              placeholder="Paste your API key"
              className={inputCls}
            />
            <button
              onClick={() => setShowKey((s) => !s)}
              className="text-xs text-slate-400 hover:text-white border border-slate-600 px-3 rounded transition-colors whitespace-nowrap"
            >
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
        </Field>

        <Field label="Workspace ID">
          <input
            value={form.workspace_id}
            onChange={(e) => set("workspace_id", e.target.value)}
            placeholder="24-character workspace ID"
            className={inputCls}
          />
        </Field>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing}
            className="text-sm px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          {testStatus && (
            <span
              className={`text-xs ${
                testStatus.startsWith("✓") ? "text-green-400" : "text-red-400"
              }`}
            >
              {testStatus}
            </span>
          )}
        </div>
      </Section>

      {/* Work Schedule */}
      <Section title="Work Schedule">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Window start">
            <input
              type="time"
              value={form.work_start}
              onChange={(e) => set("work_start", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Window end">
            <input
              type="time"
              value={form.work_end}
              onChange={(e) => set("work_end", e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Timezone">
          <select
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            className={inputCls}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </Field>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.skip_weekends}
            onChange={(e) => set("skip_weekends", e.target.checked)}
            className="w-4 h-4 accent-indigo-500"
          />
          <span className="text-sm text-slate-300">Skip weekends</span>
        </label>
      </Section>

      {/* Storage */}
      <Section title="Storage">
        <Field label="Documents path (optional override)">
          <div className="flex gap-2">
            <input
              value={form.documents_path}
              onChange={(e) => set("documents_path", e.target.value)}
              placeholder="Leave empty to use app data directory"
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={handleBrowse}
              className="text-xs text-slate-400 hover:text-white border border-slate-600 px-3 rounded transition-colors whitespace-nowrap"
            >
              Browse
            </button>
          </div>
        </Field>
      </Section>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

const inputCls =
  "w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-400">{label}</label>
      {children}
    </div>
  );
}
