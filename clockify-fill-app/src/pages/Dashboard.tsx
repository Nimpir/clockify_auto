import { useState, useEffect, useCallback } from "react";
import YearSwitcher from "../components/YearSwitcher";
import MonthCard from "../components/MonthCard";
import MonthDetail from "../components/MonthDetail";
import { loadYearMetas } from "../lib/storage";
import type { MonthMeta, Settings, Toast } from "../lib/types";

const MONTHS = [
  { num: 1, short: "Jan" }, { num: 2, short: "Feb" }, { num: 3, short: "Mar" },
  { num: 4, short: "Apr" }, { num: 5, short: "May" }, { num: 6, short: "Jun" },
  { num: 7, short: "Jul" }, { num: 8, short: "Aug" }, { num: 9, short: "Sep" },
  { num: 10, short: "Oct" }, { num: 11, short: "Nov" }, { num: 12, short: "Dec" },
];

interface Props {
  settings: Settings;
  addToast: (msg: string, type: Toast["type"]) => void;
}

export default function Dashboard({ settings, addToast }: Props) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [metas, setMetas] = useState<Record<string, MonthMeta>>({});
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const refreshMetas = useCallback(async () => {
    const m = await loadYearMetas(year);
    setMetas(m);
  }, [year]);

  useEffect(() => { refreshMetas(); }, [refreshMetas]);

  // When returning from a month detail, refresh only that month
  const handleMetaChange = useCallback((meta: MonthMeta) => {
    setMetas((prev) => ({ ...prev, [meta.month]: meta }));
  }, []);

  if (selectedMonth) {
    return (
      <MonthDetail
        month={selectedMonth}
        settings={settings}
        onBack={() => setSelectedMonth(null)}
        onMetaChange={handleMetaChange}
        addToast={addToast}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-2">
      <YearSwitcher year={year} onChange={(y) => { setYear(y); }} />
      <div className="grid grid-cols-4 gap-3 px-4">
        {MONTHS.map(({ num }) => {
          const monthKey = `${year}-${String(num).padStart(2, "0")}`;
          return (
            <MonthCard
              key={monthKey}
              month={monthKey}
              meta={metas[monthKey]}
              onClick={() => setSelectedMonth(monthKey)}
            />
          );
        })}
      </div>
    </div>
  );
}
