import { useAuthStore } from '@flower-market/shared';
import Badge from '../ui/Badge.jsx';

export default function Topbar() {
  const user = useAuthStore((s) => s.user);
  const tenant = user?.tenantId ? user.tenantId.slice(0, 8) : null;
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200/70 bg-white/85 px-6 backdrop-blur">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="hidden sm:inline">Tenant</span>
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{tenant}</code>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone="amber">demo</Badge>
        <span className="hidden text-xs text-slate-500 sm:inline">
          {user?.email?.address || user?.phone?.number || ''}
        </span>
      </div>
    </header>
  );
}
