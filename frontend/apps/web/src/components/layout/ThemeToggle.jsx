import { useState, useEffect } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

const STORAGE_KEY = 'bloomy-theme';

/**
 * Theme toggle — supports light, dark, and system modes.
 * Persists to localStorage and applies `dark` class to <html>.
 */
export default function ThemeToggle() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    const apply = (m) => {
      root.classList.remove('light', 'dark');
      if (m === 'dark' || (m === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        root.classList.add('dark');
      } else {
        root.classList.add('light');
      }
    };

    apply(mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}

    // Listen for system theme changes
    if (mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => apply('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [mode]);

  const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;
  const label = mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System';

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      aria-label={`Theme: ${label}. Click to switch.`}
      title={`Theme: ${label}`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
