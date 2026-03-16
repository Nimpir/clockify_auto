import type { MonthMeta, MonthStatus } from "../lib/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STATUS_CONFIG: Record<
  MonthStatus,
  { icon: string; color: string; label: string }
> = {
  submitted: { icon: "✓", color: "text-green-400", label: "Submitted" },
  generated: { icon: "●", color: "text-indigo-400", label: "Plan ready" },
  partial:   { icon: "◑", color: "text-yellow-400", label: "Incomplete setup" },
  untouched: { icon: "○", color: "text-slate-500",  label: "Not started" },
};

interface Props {
  month: string; // YYYY-MM
  meta: MonthMeta | undefined;
  onClick: () => void;
}

export default function MonthCard({ month, meta, onClick }: Props) {
  const monthIdx = parseInt(month.split("-")[1]) - 1;
  const name = MONTH_NAMES[monthIdx];
  const status: MonthStatus = meta?.status ?? "untouched";
  const cfg = STATUS_CONFIG[status];
  const isCurrentMonth = month === new Date().toISOString().slice(0, 7);

  return (
    <button
      onClick={onClick}
      title={cfg.label}
      className={`group relative flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all duration-150 cursor-pointer
        ${isCurrentMonth
          ? "border-indigo-500 bg-slate-800"
          : "border-slate-700 bg-slate-800 hover:border-slate-500"
        }
        hover:shadow-lg hover:-translate-y-0.5`}
    >
      {isCurrentMonth && (
        <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-indigo-400" />
      )}
      <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">
        {name}
      </span>
      <span className={`text-xl font-bold ${cfg.color}`}>{cfg.icon}</span>
      {meta?.plan_generated && !meta.submitted && (
        <span className="text-xs text-slate-500">
          {meta.entries_created > 0
            ? `${meta.entries_created} entries`
            : "Plan ready"}
        </span>
      )}
      {meta?.submitted && (
        <span className="text-xs text-green-500">{meta.entries_created} entries</span>
      )}
    </button>
  );
}
