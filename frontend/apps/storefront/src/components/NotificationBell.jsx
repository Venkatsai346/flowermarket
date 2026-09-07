import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api, useShopAuth } from '../api.js';
import { cn } from '../lib/utils.js';

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Customer inbox — GET /users/me/notifications. Hidden when signed out.
 */
export default function NotificationBell() {
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const wrap = useRef(null);

  const load = () => {
    if (!isAuth) return;
    api.shop.notifications({ limit: 8 })
      .then((r) => {
        setItems(r.data || []);
        setUnread(r.meta?.unread ?? (r.data || []).filter((n) => n.status !== 'read').length);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    if (!isAuth) return undefined;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [isAuth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!isAuth) return null;

  const mark = async (n) => {
    if (n.status === 'read') return;
    try {
      await api.shop.markNotificationRead(n.id);
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, status: 'read' } : x)));
      setUnread((u) => Math.max(0, u - 1));
    } catch { /* inbox is best-effort */ }
  };

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); if (!open) load(); }}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lift">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-800">Notifications</p>
            <p className="text-[11px] text-slate-400">{unread ? `${unread} unread` : 'You are up to date'}</p>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No messages yet — order updates will land here.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => mark(n)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-slate-50',
                      n.status !== 'read' && 'bg-rose-50/40'
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">{n.title || n.subject || n.templateCode}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                    </span>
                    {n.body && <span className="line-clamp-2 text-xs text-slate-500">{n.body}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
