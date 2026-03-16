interface Props {
  currentPage: "dashboard" | "settings";
  onNavigate: (page: "dashboard" | "settings") => void;
}

export default function NavBar({ currentPage, onNavigate }: Props) {
  return (
    <nav className="flex items-center justify-between px-6 py-3 bg-slate-800 border-b border-slate-700 select-none">
      <div className="flex items-center gap-2">
        <span className="text-indigo-400 text-xl">⏱</span>
        <span className="font-semibold text-white text-base">Clockify Fill</span>
      </div>
      <div className="flex items-center gap-1">
        <NavBtn
          label="Dashboard"
          active={currentPage === "dashboard"}
          onClick={() => onNavigate("dashboard")}
        />
        <NavBtn
          label="⚙ Settings"
          active={currentPage === "settings"}
          onClick={() => onNavigate("settings")}
        />
      </div>
    </nav>
  );
}

function NavBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-indigo-600 text-white"
          : "text-slate-400 hover:text-white hover:bg-slate-700"
      }`}
    >
      {label}
    </button>
  );
}
