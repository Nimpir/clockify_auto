import { useState, useEffect, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Command } from "@tauri-apps/plugin-shell";
import { exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { logger } from "../lib/logger";
import PlanTable from "./PlanTable";
import type { MonthMeta, Ticket, PlanEntry, Settings } from "../lib/types";
import {
  loadMonthMeta,
  saveMonthMeta,
  loadTickets,
  saveTickets,
  loadPlan,
  importReport,
  getMonthDir,
  loadSkipDays,
  saveSkipDays,
} from "../lib/storage";
import { generatePlan, submitPlan, fetchClockifyEntries, generateInvoice } from "../lib/sidecar";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

interface Props {
  month: string;
  settings: Settings;
  onBack: () => void;
  onMetaChange: (meta: MonthMeta) => void;
  addToast: (msg: string, type: "success" | "error" | "info" | "warning") => void;
}

export default function MonthDetail({ month, settings, onBack, onMetaChange, addToast }: Props) {
  const [meta, setMeta] = useState<MonthMeta | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [plan, setPlan] = useState<PlanEntry[]>([]);
  const [skipDays, setSkipDays] = useState<string[]>([]);
  const [editingTickets, setEditingTickets] = useState(false);
  const [draftTickets, setDraftTickets] = useState<Ticket[]>([]);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitModal, setSubmitModal] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [invoiceExists, setInvoiceExists] = useState(false);
  const [monthlyTotal, setMonthlyTotal] = useState<number>(0);
  const [invoiceNumber, setInvoiceNumber] = useState<string>("espana");
  const [daysOffOpen, setDaysOffOpen] = useState(false);

  const monthName = MONTH_NAMES[parseInt(month.split("-")[1]) - 1];
  const year = month.split("-")[0];

  const reload = useCallback(async () => {
    const [m, t, p, s] = await Promise.all([
      loadMonthMeta(month),
      loadTickets(month),
      loadPlan(month),
      loadSkipDays(month),
    ]);
    setMeta(m);
    setTickets(t);
    setPlan(p);
    setSkipDays(s);
    setMonthlyTotal(m.monthly_total_override ?? settings.monthly_total ?? 3500);
    setInvoiceNumber(m.invoice_number ?? "espana");
  }, [month]);

  useEffect(() => { reload(); }, [reload]);

  async function updateMeta(patch: Partial<MonthMeta>) {
    if (!meta) return;
    const updated = { ...meta, ...patch };
    // Derive status
    if (updated.submitted) updated.status = "submitted";
    else if (updated.plan_generated) updated.status = "generated";
    else if (updated.tickets_loaded || updated.report_loaded) updated.status = "partial";
    else updated.status = "untouched";
    await saveMonthMeta(updated);
    setMeta(updated);
    onMetaChange(updated);
  }

  // ── Ticket import (copy existing tickets.txt from user-chosen file) ─────────
  async function handleLoadTickets() {
    const selected = await openDialog({
      filters: [{ name: "Text", extensions: ["txt"] }],
      title: "Select tickets.txt",
    });
    if (!selected) return;
    try {
      const dir = await getMonthDir(month);
      const { copyFile } = await import("@tauri-apps/plugin-fs");
      await copyFile(selected as string, await join(dir, "tickets.txt"));
      const t = await loadTickets(month);
      setTickets(t);
      await updateMeta({ tickets_loaded: t.length > 0 });
      addToast(`Loaded ${t.length} ticket(s)`, "success");
      if (t.length > 0) handleGenerate();
    } catch (e) {
      logger.error("handleLoadTickets failed", String(e));
      addToast(`Failed to load tickets: ${String(e)}`, "error");
    }
  }

  // ── Report import ───────────────────────────────────────────────────────────
  async function handleLoadReport() {
    const selected = await openDialog({
      filters: [{ name: "CSV", extensions: ["csv"] }],
      title: "Select Clockify CSV export",
    });
    if (!selected) return;
    try {
      await importReport(month, selected as string);
      await updateMeta({ report_loaded: true });
      addToast("Report imported", "success");
      handleGenerate();
    } catch (e) {
      logger.error("handleLoadReport failed", String(e));
      addToast(`Failed to import report: ${String(e)}`, "error");
    }
  }

  // ── Fetch report from Clockify API ───────────────────────────────────────────
  async function handleFetchReport() {
    if (!settings.clockify_api_key || !settings.workspace_id) {
      addToast("Configure API key and workspace ID in Settings first", "info");
      return;
    }
    setFetchingReport(true);
    try {
      const result = await fetchClockifyEntries(month, settings);
      if ("error" in result) {
        logger.error("handleFetchReport failed", result.error);
        addToast(`Failed to fetch entries: ${result.error}`, "error");
      } else {
        setReportExists(true);
        await updateMeta({ report_loaded: true });
        addToast(`Fetched ${result.count} entries from Clockify`, "success");
        handleGenerate();
      }
    } catch (e) {
      logger.error("handleFetchReport threw", String(e));
      addToast(`Error fetching entries: ${String(e)}`, "error");
    } finally {
      setFetchingReport(false);
    }
  }

  // ── Ticket editor ────────────────────────────────────────────────────────────
  function startEditing() {
    setDraftTickets(tickets.map((t) => ({ ...t })));
    setEditingTickets(true);
  }

  async function saveTicketEdits() {
    const valid = draftTickets.filter((t) => t.key.trim() && t.title.trim());
    await saveTickets(month, valid);
    setTickets(valid);
    await updateMeta({ tickets_loaded: valid.length > 0 });
    setEditingTickets(false);
    addToast(`Saved ${valid.length} ticket(s)`, "success");
  }

  function updateDraft(i: number, field: keyof Ticket, value: string) {
    setDraftTickets((d) => d.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  }

  function addDraftRow() {
    setDraftTickets((d) => [...d, { key: "", title: "", projectId: "" }]);
  }

  function removeDraftRow(i: number) {
    setDraftTickets((d) => d.filter((_, idx) => idx !== i));
  }

  // ── Generate ─────────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (tickets.length === 0) {
      addToast("tickets.txt is empty — add tickets before generating", "warning");
      return;
    }
    setGenerating(true);
    setPlan((p) => p.filter((e) => e.isExisting));
    try {
      const currentSkipDays = await loadSkipDays(month);
      setSkipDays(currentSkipDays);
      logger.info("handleGenerate skipDays", { skipDays: currentSkipDays });
      const result = await generatePlan(month, settings, currentSkipDays);
      if (result.code !== 0) {
        addToast(`Generation failed: ${result.stderr || result.stdout}`, "error");
      } else {
        const p = await loadPlan(month);
        setPlan(p);
        await updateMeta({ plan_generated: true, last_generated_at: new Date().toISOString(), submitted: false, submitted_at: null });
        addToast(`Plan generated — ${p.filter((e) => !e.isExisting).length} new entries`, "success");
      }
    } catch (e) {
      logger.error("handleGenerate threw", String(e));
      addToast(`Error: ${String(e)}`, "error");
    } finally {
      setGenerating(false);
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!settings.clockify_api_key || !settings.workspace_id) {
      addToast("Configure API key and workspace ID in Settings first", "info");
      setSubmitModal(false);
      return;
    }
    setSubmitModal(false);
    setSubmitting(true);
    setProgress([]);
    try {
      const { created, failed, warnings } = await submitPlan(month, settings, (line) => {
        setProgress((p) => [...p, line.trim()].slice(-20));
      });
      await updateMeta({
        submitted: true,
        submitted_at: new Date().toISOString(),
        entries_created: created,
        entries_failed: failed,
      });
      addToast(
        `Done — created ${created} entries${failed > 0 ? `, ${failed} failed` : ""}`,
        failed > 0 ? "error" : "success"
      );
      for (const w of warnings) {
        addToast(w, "warning");
      }
    } catch (e) {
      logger.error("handleSubmit threw", String(e));
      addToast(`Submit error: ${String(e)}`, "error");
    } finally {
      setSubmitting(false);
      setProgress([]);
    }
  }

  // ── Generate invoice ─────────────────────────────────────────────────────────
  async function handleGenerateInvoice() {
    const total = monthlyTotal || settings.monthly_total || 3500;
    setGeneratingInvoice(true);
    try {
      const result = await generateInvoice(month, settings, total, invoiceNumber || "espana");
      if (result.code !== 0) {
        addToast(`Invoice generation failed: ${result.stderr || result.stdout}`, "error");
      } else {
        addToast("Invoice generated", "success");
        setInvoiceExists(true);
      }
    } catch (e) {
      logger.error("handleGenerateInvoice threw", String(e));
      addToast(`Error: ${String(e)}`, "error");
    } finally {
      setGeneratingInvoice(false);
    }
  }

  // ── Open folder ──────────────────────────────────────────────────────────────
  async function handleOpenFolder() {
    const dir = await getMonthDir(month);
    logger.info("handleOpenFolder", { dir });
    try {
      if (!(await exists(dir))) {
        const { mkdir } = await import("@tauri-apps/plugin-fs");
        await mkdir(dir, { recursive: true });
        logger.info("handleOpenFolder created dir", { dir });
      }
      await Command.create("explorer", [dir]).execute();
    } catch (e) {
      logger.error("handleOpenFolder failed", String(e));
      addToast(`Failed to open folder: ${String(e)}`, "error");
    }
  }

  // ── Report / invoice file presence ───────────────────────────────────────────
  const [reportExists, setReportExists] = useState(false);
  const [fetchingReport, setFetchingReport] = useState(false);
  useEffect(() => {
    (async () => {
      const dir = await getMonthDir(month);
      setReportExists(await exists(await join(dir, "clockify_report.csv")));
    })();
  }, [month, meta?.report_loaded]);

  useEffect(() => {
    (async () => {
      const dir = await getMonthDir(month);
      const { readDir } = await import("@tauri-apps/plugin-fs");
      try {
        const entries = await readDir(dir);
        setInvoiceExists(entries.some((e) => e.name?.startsWith("invoice_") && e.name.endsWith(".xlsx")));
      } catch {
        setInvoiceExists(false);
      }
    })();
  }, [month, generatingInvoice]);

  const newEntryCount = plan.filter((e) => !e.isExisting).length;

  // Weekdays only for the days-off picker (weekends are always excluded)
  const monthWorkingDays = (() => {
    const [y, m] = month.split("-").map(Number);
    const days: string[] = [];
    const d = new Date(y, m - 1, 1);
    while (d.getMonth() === m - 1) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        days.push(iso);
      }
      d.setDate(d.getDate() + 1);
    }
    return days;
  })();

  async function toggleSkipDay(day: string) {
    const current = await loadSkipDays(month);
    const updated = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day];
    setSkipDays(updated);
    await saveSkipDays(month, updated);
  }

  if (!meta) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 py-20">
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-white transition-colors text-sm flex items-center gap-1"
        >
          ‹ Back
        </button>
        <h1 className="text-xl font-bold text-white">
          {monthName} {year}
        </h1>
        <StatusBadge status={meta.status} />
        <div className="ml-auto">
          <button
            onClick={handleOpenFolder}
            className="text-xs text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 px-3 py-1 rounded transition-colors"
          >
            📁 Open folder
          </button>
        </div>
      </div>

      {/* Inputs */}
      <section className="mb-6 space-y-3">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Inputs</h2>

        {/* Tickets */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-slate-200">📄 tickets.txt</span>
            <div className="flex gap-2">
              <Btn size="xs" onClick={startEditing}>Edit</Btn>
              <Btn size="xs" onClick={handleLoadTickets}>Load file</Btn>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {tickets.length > 0 ? `${tickets.length} tickets loaded` : "No tickets — click Edit or Load file"}
          </p>
        </div>

        {/* Report */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-slate-200">📊 Existing entries</span>
            <div className="flex gap-2">
              <Btn size="xs" onClick={handleFetchReport} loading={fetchingReport}>
                {fetchingReport ? "Fetching…" : "From Clockify"}
              </Btn>
              <Btn size="xs" onClick={handleLoadReport}>Load CSV</Btn>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {reportExists ? "Entries loaded" : "No existing entries — fetch from Clockify or load CSV"}
          </p>
        </div>
      </section>

      {/* Days off */}
      <section className="mb-6">
        <button
          onClick={() => setDaysOffOpen((o) => !o)}
          className="flex items-center gap-2 w-full text-left mb-2"
        >
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Days off
          </h2>
          {skipDays.length > 0 && (
            <span className="text-amber-400 text-xs font-normal">
              {skipDays.length} skipped
            </span>
          )}
          <span className="text-slate-500 text-xs ml-auto">{daysOffOpen ? "▲" : "▼"}</span>
        </button>
        {daysOffOpen && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {monthWorkingDays.map((day) => {
                const d = new Date(day + "T00:00:00");
                const dow = ["Su","Mo","Tu","We","Th","Fr","Sa"][d.getDay()];
                const num = d.getDate();
                const skipped = skipDays.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => toggleSkipDay(day)}
                    title={day}
                    className={`flex flex-col items-center px-2 py-1 rounded text-xs font-medium transition-colors ${
                      skipped
                        ? "bg-amber-600/30 border border-amber-500/50 text-amber-300 line-through"
                        : "bg-slate-700 border border-slate-600 text-slate-300 hover:border-slate-400 hover:text-white"
                    }`}
                  >
                    <span className="text-[10px] opacity-70">{dow}</span>
                    <span>{num}</span>
                  </button>
                );
              })}
            </div>
            {skipDays.length > 0 && (
              <button
                onClick={async () => { setSkipDays([]); await saveSkipDays(month, []); }}
                className="mt-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear all
              </button>
            )}
          </>
        )}
      </section>

      {/* Ticket editor */}
      {editingTickets && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Edit Tickets
          </h2>
          <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left px-3 py-2 text-slate-400 font-medium">Key</th>
                  <th className="text-left px-3 py-2 text-slate-400 font-medium">Title</th>
                  <th className="text-left px-3 py-2 text-slate-400 font-medium">Project ID</th>
                  <th className="text-left px-3 py-2 text-slate-400 font-medium">From</th>
                  <th className="text-left px-3 py-2 text-slate-400 font-medium">To</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {draftTickets.map((t, i) => (
                  <tr key={i} className="border-b border-slate-700/50">
                    <td className="px-2 py-1">
                      <input
                        value={t.key}
                        onChange={(e) => updateDraft(i, "key", e.target.value)}
                        placeholder="PROJ-123"
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={t.title}
                        onChange={(e) => updateDraft(i, "title", e.target.value)}
                        placeholder="Short description"
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={t.projectId}
                        onChange={(e) => updateDraft(i, "projectId", e.target.value)}
                        placeholder="Clockify project ID"
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="date"
                        value={t.dateFrom ?? ""}
                        onChange={(e) => updateDraft(i, "dateFrom", e.target.value)}
                        className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="date"
                        value={t.dateTo ?? ""}
                        onChange={(e) => updateDraft(i, "dateTo", e.target.value)}
                        className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button
                        onClick={() => removeDraftRow(i)}
                        className="text-slate-500 hover:text-red-400 transition-colors text-xs"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={addDraftRow}
              className="w-full py-2 text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors border-t border-slate-700"
            >
              + Add row
            </button>
          </div>
          <div className="flex gap-2 mt-3">
            <Btn onClick={() => setEditingTickets(false)} variant="ghost">Cancel</Btn>
            <Btn onClick={saveTicketEdits}>Save tickets.txt</Btn>
          </div>
        </section>
      )}

      {/* Plan */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Plan</h2>
          <div className="flex items-center gap-2">
            {plan.length > 0 && (
              <>
                <Btn
                  size="sm"
                  onClick={() => setSubmitModal(true)}
                  disabled={submitting || meta.submitted || newEntryCount === 0}
                  variant={meta.submitted ? "ghost" : "primary"}
                  loading={submitting}
                >
                  {submitting ? "Submitting…" : meta.submitted ? "✓ Submitted" : `🚀 Submit ${newEntryCount}`}
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => setPlan([])}>
                  Clear
                </Btn>
              </>
            )}
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <span className="text-slate-400 text-xs whitespace-nowrap">Amount $</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={monthlyTotal || ""}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setMonthlyTotal(val);
                    updateMeta({ monthly_total_override: val || undefined });
                  }}
                  className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-slate-400 text-xs whitespace-nowrap">Invoice #</span>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => {
                    const val = e.target.value.slice(0, 10);
                    setInvoiceNumber(val);
                    updateMeta({ invoice_number: val || undefined });
                  }}
                  placeholder="espana"
                  maxLength={10}
                  className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </label>
              <Btn
                size="sm"
                variant="ghost"
                onClick={handleGenerateInvoice}
                disabled={generatingInvoice || plan.length === 0}
                loading={generatingInvoice}
              >
                {generatingInvoice ? "Generating…" : invoiceExists ? "↻ Invoice" : "📄 Invoice"}
              </Btn>
            </div>
            <Btn size="sm" onClick={handleGenerate} loading={generating}>
              {generating ? "Generating…" : plan.length > 0 ? "↻ Regenerate" : "Generate"}
            </Btn>
          </div>
        </div>
        <PlanTable entries={plan} />
      </section>

      {/* Submit progress */}
      {submitting && (
        <div className="mt-4 bg-slate-800 border border-slate-700 rounded-lg p-3 font-mono text-xs text-slate-300 max-h-40 overflow-y-auto">
          {progress.length === 0 ? (
            <div className="text-slate-400 animate-pulse">Sending entries to Clockify…</div>
          ) : (
            progress.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
      )}

      {/* Confirmation modal */}
      {submitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-2">Submit to Clockify?</h3>
            <p className="text-slate-400 text-sm mb-6">
              This will create <span className="text-white font-medium">{newEntryCount} time entries</span> in
              Clockify for <span className="text-white font-medium">{monthName} {year}</span>. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Btn variant="ghost" onClick={() => setSubmitModal(false)}>Cancel</Btn>
              <Btn onClick={handleSubmit}>Confirm</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MonthMeta["status"] }) {
  const cfg = {
    submitted: "bg-green-500/20 text-green-400 border-green-500/30",
    generated: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
    partial:   "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    untouched: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  const label = {
    submitted: "Submitted",
    generated: "Plan ready",
    partial:   "Incomplete",
    untouched: "Not started",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg[status]}`}>
      {label[status]}
    </span>
  );
}

interface BtnProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  size?: "xs" | "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
}

function Btn({ children, onClick, variant = "primary", size = "md", disabled, loading }: BtnProps) {
  const base = "rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-indigo-600 hover:bg-indigo-500 text-white",
    ghost:   "border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white",
  };
  const sizes = {
    xs: "text-xs px-2 py-1",
    sm: "text-xs px-3 py-1.5",
    md: "text-sm px-4 py-2",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]}`}
    >
      {children}
    </button>
  );
}
