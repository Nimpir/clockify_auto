import { useEffect } from "react";
import type { Toast as ToastType } from "../lib/types";

interface Props {
  toasts: ToastType[];
  onDismiss: (id: number) => void;
}

export default function Toast({ toasts, onDismiss }: Props) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastType; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const colors = {
    success: "bg-green-600 border-green-500",
    error: "bg-red-700 border-red-500",
    info: "bg-indigo-600 border-indigo-500",
    warning: "bg-amber-600 border-amber-500",
  };

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm text-white shadow-xl max-w-sm cursor-pointer ${colors[toast.type]}`}
      onClick={() => onDismiss(toast.id)}
    >
      <span className="flex-1">{toast.message}</span>
      <span className="text-white/60 text-xs mt-0.5">✕</span>
    </div>
  );
}
