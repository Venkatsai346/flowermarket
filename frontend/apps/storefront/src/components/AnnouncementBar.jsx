import { useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import StoreLink from './StoreLink.jsx';

const dismissKey = (text) => {
  let h = 0;
  const s = `${typeof window !== 'undefined' ? window.location.hostname : ''}:${text || ''}`;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `fm-ann:${h}`;
};

/**
 * Thin announcement bar above the header (festive sale, holiday hours…).
 * Dismissible per session — a returning visit in a new tab sees it again,
 * which is exactly right for time-sensitive notices.
 */
export default function AnnouncementBar({ announcement }) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined' || !announcement?.text) return true;
    try {
      return window.sessionStorage.getItem(dismissKey(announcement.text)) === '1';
    } catch {
      return false;
    }
  });

  if (!announcement?.text || dismissed) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(dismissKey(announcement.text), '1');
    } catch {
      /* private mode — the bar simply returns next visit */
    }
    setDismissed(true);
  };

  return (
    <div
      className="relative z-50 flex items-center justify-center gap-2 px-10 py-2 text-center text-xs font-semibold"
      style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
      role="note"
      aria-label="Store announcement"
    >
      <Megaphone className="h-3.5 w-3.5 shrink-0 opacity-80" />
      {announcement.linkUrl ? (
        <StoreLink to={announcement.linkUrl} className="truncate underline-offset-2 hover:underline">
          {announcement.text}
        </StoreLink>
      ) : (
        <span className="truncate">{announcement.text}</span>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 opacity-70 transition hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
