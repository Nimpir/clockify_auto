interface Props {
  year: number;
  onChange: (year: number) => void;
}

export default function YearSwitcher({ year, onChange }: Props) {
  return (
    <div className="flex items-center justify-center gap-4 py-6">
      <button
        onClick={() => onChange(year - 1)}
        className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-slate-700 transition-colors text-lg"
      >
        ‹
      </button>
      <span className="text-2xl font-bold text-white w-16 text-center">{year}</span>
      <button
        onClick={() => onChange(year + 1)}
        className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-slate-700 transition-colors text-lg"
      >
        ›
      </button>
    </div>
  );
}
