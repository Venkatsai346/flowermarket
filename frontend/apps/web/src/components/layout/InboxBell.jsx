import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../../api.js';
import { useAuthStore } from '@flower-market/shared';

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Tiny console inbox — same customer/staff inbox API as the storefront bell.
 * Operators see their own notifications (order events they are a party to).
 */
export default function InboxBell() {
  const isAuth = useAuthStore((s) => s.isAuthenticated?.() ?? Boolean(s.accessToken));
  const sessionId = useAuthStore((s) => s.sessionId);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const wrap = useRef(null);

  const load = () => {
    if (!isAuth) return;
    api.shop.notifications({ limit: 8 })
      .then((r) => {
        setItems(r.data || []);
        setUnread(r.meta?.unread ?? 0);
      })
      .catch(() => {});
  };

  useEffect(() => {
    // The previous identity's notifications must never survive a session
    // change (logout → login, or an account switch) even if this component
    // stays mounted — clear first, then load the current identity's inbox.
    setItems([]);
    setUnread(0);
    load();
    if (!isAuth) return undefined;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [isAuth, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!isAuth) return null;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); if (!open) load(); }}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100"
        aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-700">Inbox</p>
            <p className="text-[11px] text-slate-400">{unread ? `${unread} unread` : 'Caught up'}</p>
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">No notifications.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={async () => {
                      if (n.status === 'read') return;
                      try {
                        await api.shop.markNotificationRead(n.id);
                        setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, status: 'read' } : x)));
                        setUnread((u) => Math.max(0, u - 1));
                      } catch { /* ignore */ }
                    }}
                    className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-slate-50 ${n.status !== 'read' ? 'bg-rose-50/50' : ''}`}
                  >
                    <span className="flex justify-between gap-2">
                      <span className="text-xs font-medium text-slate-800">{n.title || n.subject || n.templateCode}</span>
                      <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(n.createdAt)}</span>
                    </span>
                    {n.body && <span className="line-clamp-2 text-[11px] text-slate-500">{n.body}</span>}
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
