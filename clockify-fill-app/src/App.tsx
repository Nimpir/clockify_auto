import { useState, useEffect, useCallback } from "react";
import NavBar from "./components/NavBar";
import Toast from "./components/Toast";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import { loadSettings } from "./lib/storage";
import type { Toast as ToastType, Settings as SettingsType } from "./lib/types";

let toastCounter = 0;

export default function App() {
  const [page, setPage] = useState<"dashboard" | "settings">("dashboard");
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [toasts, setToasts] = useState<ToastType[]>([]);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  // Cmd/Ctrl+, opens settings
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        setPage("settings");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType["type"] = "info") => {
      const id = ++toastCounter;
      setToasts((t) => [...t, { id, message, type }]);
    },
    []
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const handleSettingsSave = useCallback((s: SettingsType) => {
    setSettings(s);
    addToast("Settings saved", "success");
  }, [addToast]);

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-900 overflow-hidden">
      <NavBar currentPage={page} onNavigate={setPage} />
      <main className="flex-1 overflow-y-auto">
        {page === "dashboard" && (
          <Dashboard settings={settings} addToast={addToast} />
        )}
        {page === "settings" && (
          <Settings
            initial={settings}
            onSave={handleSettingsSave}
            addToast={addToast}
          />
        )}
      </main>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
