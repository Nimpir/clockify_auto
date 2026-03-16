import type { PlanEntry } from "../lib/types";

interface Props {
  entries: PlanEntry[];
}

const SHORT_MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

function fmtDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${SHORT_MONTHS[parseInt(m) - 1]} ${parseInt(d)}`;
}

export default function PlanTable({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-10 text-slate-500 text-sm">
        No plan generated yet. Click Regenerate to create a plan.
      </div>
    );
  }

  // Group by date
  const byDate: Record<string, PlanEntry[]> = {};
  for (const e of entries) {
    (byDate[e.date] ??= []).push(e);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-800/60">
            <th className="text-left px-3 py-2 text-slate-400 font-medium w-24">Date</th>
            <th className="text-left px-3 py-2 text-slate-400 font-medium w-28">Time</th>
            <th className="text-left px-3 py-2 text-slate-400 font-medium w-16">Dur</th>
            <th className="text-left px-3 py-2 text-slate-400 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(byDate).map(([date, dayEntries], gi) =>
            dayEntries.map((e, i) => {
              const dur = Math.round(e.hours * 60);
              const h = Math.floor(dur / 60);
              const m = dur % 60;
              const durStr = m ? `${h}h${String(m).padStart(2, "0")}m` : `${h}h`;
              return (
                <tr
                  key={`${date}-${i}`}
                  className={`border-b border-slate-700/50 ${
                    e.isExisting
                      ? "bg-slate-800/30 text-slate-500"
                      : gi % 2 === 0
                      ? "bg-transparent"
                      : "bg-slate-800/20"
                  }`}
                >
                  <td className="px-3 py-1.5 text-slate-400">
                    {i === 0 ? fmtDate(date) : ""}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">
                    {e.localStart}–{e.localEnd}
                  </td>
                  <td className="px-3 py-1.5 text-slate-400 text-xs">{durStr}</td>
                  <td className="px-3 py-1.5">
                    {e.isExisting ? (
                      <span className="text-slate-500">[existing] {e.description}</span>
                    ) : (
                      <span className="text-slate-200">{e.description}</span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
