import { useEffect } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore } from '../../lib/toasts.js';

const STYLES = {
  success: { icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  error: { icon: XCircle, cls: 'border-rose-200 bg-rose-50 text-rose-800' },
  info: { icon: Info, cls: 'border-sky-200 bg-sky-50 text-sky-800' },
};

function ToastItem({ t }) {
  const remove = useToastStore((s) => s.remove);
  const { icon: Icon, cls } = STYLES[t.type] || STYLES.info;
  return (
    <div className={`pointer-events-auto flex w-80 items-start gap-2.5 rounded-xl border p-3.5 shadow-pop ${cls}`}>
      <Icon className="mt-0.5 h-4.5 w-4.5 shrink-0" />
      <p className="flex-1 text-sm font-medium">{t.message}</p>
      <button className="opacity-60 hover:opacity-100" onClick={() => remove(t.id)} aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}
