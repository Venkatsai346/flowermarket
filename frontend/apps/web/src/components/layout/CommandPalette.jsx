import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuthStore } from '@flower-market/shared';
import { commandsForRole, filterCommands, GO_SHORTCUTS } from '../../lib/nav.js';
import { cn } from '../../lib/utils.js';

/**
 * Operator command palette.
 *
 *   ⌘K / Ctrl+K  — open
 *   g then o     — orders (and the rest of GO_SHORTCUTS)
 *
 * Never steals keystrokes from inputs. `g o` is the muscle-memory the
 * fulfillment desk asked for — world-class ops software has this, dashboards don't.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const pendingG = useRef(0);
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const commands = useMemo(() => filterCommands(commandsForRole(role), q), [role, q]);

  useEffect(() => {
    if (!open) return undefined;
    setQ('');
    setActive(0);
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => { setActive(0); }, [q]);

  useEffect(() => {
    const onKey = (e) => {
      const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        if (open) { e.preventDefault(); setOpen(false); }
        return;
      }
      if (open) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(commands.length - 1, 0))); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
        if (e.key === 'Enter' && commands[active]) {
          e.preventDefault();
          navigate(commands[active].to);
          setOpen(false);
        }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'g') {
        pendingG.current = Date.now();
        return;
      }
      if (pendingG.current && Date.now() - pendingG.current < 800) {
        pendingG.current = 0;
        const to = GO_SHORTCUTS[e.key];
        if (to) {
          e.preventDefault();
          navigate(to);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, commands, active, navigate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to…  (g o = orders)"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400 sm:inline">esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {commands.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">No matches</li>
          )}
          {commands.map((c, i) => (
            <li key={c.to + c.label}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => { navigate(c.to); setOpen(false); }}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm',
                  i === active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                )}
              >
                {c.icon && <c.icon className="h-4 w-4 shrink-0 opacity-70" />}
                <span className="flex-1 truncate font-medium">{c.label}</span>
                <span className={cn('text-[11px]', i === active ? 'text-white/60' : 'text-slate-400')}>{c.group}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
